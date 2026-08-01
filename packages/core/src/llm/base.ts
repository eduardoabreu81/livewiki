/**
 * Shared HTTP adapter for LLM providers.
 *
 * Centralizes:
 *   - fetch wrapper with optional per-attempt timeout
 *   - retry with exponential backoff for explicit HTTP retryables (429/5xx);
 *     the `Retry-After` header is honored on 429/503
 *     (max(exponentialBackoff, retryAfterSeconds * 1000))
 *   - normalized errors (LlmRequestError / LlmTimeoutError; no auth headers)
 *
 * Timeout policy (client/provider-level, not stage-specific):
 *   - default timeoutMs = 300_000 (5 min)
 *   - timeoutMs = 0 → no abort timer (local providers may use higher values)
 *   - AbortError / timeout → NO automatic retry (generation state unknown;
 *     provider may still bill). HTTP 429/5xx still retry up to maxRetries.
 */

import type { LlmClient } from "./index.js";
import { LlmRequestError } from "./index.js";
import type { LlmProvider } from "../config.js";
import type { GenerateRequest, GenerateResult } from "./types.js";

/** Default client timeout when config omits timeoutMs (5 minutes). */
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;

/**
 * Client-side timeout. Provider may still complete and bill; usage is unknown.
 * Must not trigger automatic adapter retries.
 */
export class LlmTimeoutError extends Error {
  public readonly provider: LlmProvider;
  public readonly timeoutMs: number;
  constructor(provider: LlmProvider, timeoutMs: number) {
    super(
      timeoutMs > 0
        ? `LLM ${provider} request timed out after ${timeoutMs}ms (client abort; provider may still bill; usage unknown)`
        : `LLM ${provider} request aborted (timeout)`,
    );
    this.name = "LlmTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

export interface AdapterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Override fetch (for tests). Default: globalThis.fetch */
  fetchImpl?: typeof fetch;
  /**
   * Per-attempt timeout in ms.
   * - undefined → DEFAULT_LLM_TIMEOUT_MS (300_000)
   * - 0 → disable automatic abort
   * - > 0 → AbortController timer
   */
  timeoutMs?: number;
  /** Attempts for HTTP-retryable errors only. Default 3. */
  maxRetries?: number;
  /** Base delay between retries (exponential backoff). Default 1000. */
  retryDelayMs?: number;
}

/** HTTP statuses that justify a new request attempt. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Parse the `Retry-After` header (honored on 429/503 — the statuses whose
 * semantics include rate limiting / temporary overload). Returns the delay
 * in ms, or null when the header is absent or unparseable.
 *
 * The standard form is integer seconds; the HTTP-date form is handled
 * defensively (rare on 429). Non-numeric, unparseable values are ignored —
 * the caller falls back to pure exponential backoff. There is no cap: the
 * provider asked for the delay, and per-call 429 retries are uncoordinated
 * by design (the stage-4 worker pool size IS the client-side limiter).
 */
function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/**
 * Spread helper: include `timeoutMs` even when it is 0 (truthy checks drop 0).
 */
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never> {
  return timeoutMs !== undefined ? { timeoutMs } : {};
}

/**
 * HTTP request with retry for 429/5xx only. Timeouts abort once and throw
 * LlmTimeoutError without a second generation attempt.
 */
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response> {
  const fetchImpl = adapterConfig.fetchImpl ?? globalThis.fetch;
  const timeoutMs =
    adapterConfig.timeoutMs !== undefined
      ? adapterConfig.timeoutMs
      : DEFAULT_LLM_TIMEOUT_MS;
  const maxRetries = adapterConfig.maxRetries ?? 3;
  const retryDelayMs = adapterConfig.retryDelayMs ?? 1000;

  let lastStatus: number | null = null;
  let lastErrorKind: "network" | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const ac = new AbortController();
      // Only arm abort when timeout is enabled (timeoutMs > 0).
      if (timeoutMs > 0) {
        timer = setTimeout(() => ac.abort(), timeoutMs);
      }
      const res = await fetchImpl(url, { ...init, signal: ac.signal });
      if (res.ok) return res;
      // Non-retryable HTTP: throw once (body for diagnostics only).
      if (!isRetryableStatus(res.status)) {
        const body = await res.text().catch(() => "");
        throw new LlmRequestError(provider, res.status, body);
      }
      lastStatus = res.status;
      const retryAfterMs =
        res.status === 429 || res.status === 503 ? parseRetryAfterMs(res) : null;
      await res.text().catch(() => "");
      if (attempt < maxRetries) {
        await sleep(
          Math.max(retryDelayMs * Math.pow(2, attempt - 1), retryAfterMs ?? 0),
        );
      }
    } catch (err) {
      if (err instanceof LlmRequestError) throw err;
      if (err instanceof LlmTimeoutError) throw err;
      // Timeout: do NOT retry — generation state unknown; provider may still bill.
      if (err instanceof Error && err.name === "AbortError") {
        throw new LlmTimeoutError(provider, timeoutMs);
      }
      // Network errors: keep existing retry behavior (risk of unknown state
      // after send is documented in TIMEOUT-DIAGNOSIS / SPEC).
      lastErrorKind = "network";
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const detail =
    lastStatus !== null
      ? `last status: ${lastStatus}`
      : lastErrorKind !== null
        ? `last error: ${lastErrorKind}`
        : "unknown";
  throw new LlmRequestError(
    provider,
    0,
    `Failed after ${maxRetries} attempts (${detail})`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readText(res: Response): Promise<string> {
  return res.text();
}

export type { LlmClient, GenerateRequest, GenerateResult };
