/**
 * Adapter HTTP base compartilhado pelos providers.
 *
 * Centraliza:
 *   - fetch wrapper com timeout
 *   - retry com backoff exponencial (3 tentativas em 429/5xx)
 *   - Normalização de erro (LlmRequestError com body truncado, sem headers)
 *
 * Não conhece formato bruto de nenhum provider — só faz HTTP.
 */

import type { LlmClient } from "./index.js";
import { LlmRequestError } from "./index.js";
import type { LlmProvider } from "../config.js";
import type { GenerateRequest, GenerateResult } from "./types.js";

export interface AdapterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Override fetch (pra testes). Default: globalThis.fetch */
  fetchImpl?: typeof fetch;
  /** Timeout por tentativa em ms. Default 60_000. */
  timeoutMs?: number;
  /** Tentativas em erro retryable. Default 3. */
  maxRetries?: number;
  /** Delay base entre tentativas (exponential backoff). Default 1000. */
  retryDelayMs?: number;
}

/** Status HTTP que justificam retry. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Faz uma request HTTP com retry. NÃO inclui os headers da chamada externa
 * (a key) no erro — só status + body do provider.
 */
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response> {
  const fetchImpl = adapterConfig.fetchImpl ?? globalThis.fetch;
  const timeoutMs = adapterConfig.timeoutMs ?? 60_000;
  const maxRetries = adapterConfig.maxRetries ?? 3;
  const retryDelayMs = adapterConfig.retryDelayMs ?? 1000;
  // NÃO guardamos o body do erro entre tentativas — só o status (e a categoria
  // do erro de rede/timeout). Body bruto do provider pode conter dados
  // sensíveis em raros casos; mensagem final só carrega status.
  let lastStatus: number | null = null;
  let lastErrorKind: "network" | "timeout" | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const ac = new AbortController();
      timer = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetchImpl(url, { ...init, signal: ac.signal });
      if (res.ok) return res;
      // Não-retryable: lança direto (com body — esse path é 1-shot, não retry)
      if (!isRetryableStatus(res.status)) {
        const body = await res.text().catch(() => "");
        throw new LlmRequestError(provider, res.status, body);
      }
      // Retryable: guarda status pra próxima tentativa
      lastStatus = res.status;
      // Consome o body pra evitar leak de socket, mas NÃO guarda pra mensagem
      await res.text().catch(() => "");
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    } catch (err) {
      if (err instanceof LlmRequestError) throw err; // não-retryable
      // Erro de rede/timeout — classifica
      if (err instanceof Error && err.name === "AbortError") {
        lastErrorKind = "timeout";
      } else {
        lastErrorKind = "network";
      }
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Mensagem final: só status ou categoria. NUNCA body bruto.
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

/** Helper compartilhado pra adapters: extrair texto do body bruto. */
export async function readText(res: Response): Promise<string> {
  return res.text();
}

/** Re-export pra adapters implementarem LlmClient. */
export type { LlmClient, GenerateRequest, GenerateResult };