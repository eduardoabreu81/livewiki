/**
 * llm/index — public interface of the LLM client + factory.
 *
 * SPEC §"Stack": "our own thin HTTP client, providers: Anthropic +
 * OpenAI-compatible (a configurable base URL covers OpenRouter/LiteLLM/Ollama).
 * No agent framework."
 *
 * **No SDK**: uses Node 20+ native fetch. Keeps deps minimal and allows
 * full control over the normalized usage shape.
 *
 * **No default model**: `createLlmClient` calls `validateConfigForBatch`
 * (delegating to config.ts). If provider or model is missing, it throws
 * MissingProviderConfigError with a clear message.
 *
 * **Credential resolution**: the process environment takes precedence over
 * the global credential store. Keys are NEVER read from config.json,
 * checkpoint_json, logs, or error messages.
 */

import type { LivewikiConfig, LlmProvider } from "../config.js";
import {
  validateConfigForBatch,
  resolveBaseUrl,
  resolveProviderFromConfig,
  MissingProviderConfigError,
} from "../config.js";
import type { GenerateRequest, GenerateResult } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAiCompatAdapter } from "./openai-compat.js";
import { resolveCredentialSync } from "../credentials.js";

/** Public interface of the client. Only what `batch.ts` (and others) need. */
export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Creates the LLM client from validated repo config and a resolved credential.
 *
 * Provider resolution:
 *   1. config.preset (Phase 5 step 5) → expands into adapter/baseUrl/envVar/pricing
 *   2. config.provider (Phase 3 legacy) → adapter + default baseUrl + default envVar
 *   3. Neither → MissingProviderConfigError (validateConfigForBatch)
 *
 * Env var name:
 *   - preset set: comes from the preset (e.g. "minimax" → "MiniMax_API_KEY")
 *   - provider set, no preset: ANTHROPIC_API_KEY / OPENAI_API_KEY
 *
 * Throw chain:
 *   - config.provider/preset missing (validateConfigForBatch)
 *   - config.model missing (validateConfigForBatch)
 *   - credential absent from both environment and global store
 */
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
  // Validates provider/model and timeoutMs (even when not from loadConfig).
  validateConfigForBatch(repoRoot, config);
  // After validateConfigForBatch, provider/preset and model are guaranteed to be strings.
  const resolved = resolveProviderFromConfig(config);
  const model = config.model as string;
  // baseUrl: prefer explicit config, otherwise preset baseUrl, otherwise provider default
  const baseUrl = resolved.baseUrl || resolveBaseUrl(config);

  const credential = resolveCredentialSync(resolved.envVar).value;
  const apiKey = credential ?? (resolved.credentialOptional ? "livewiki-local" : null);
  if (!apiKey) {
    throw new MissingApiKeyError(resolved.adapter, resolved.envVar);
  }

  // Client/provider timeout from config (default applied in requestWithRetry).
  // Use explicit undefined checks so timeoutMs: 0 (disable) is preserved.
  const timeoutOpts =
    config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {};

  if (resolved.adapter === "anthropic") {
    return new AnthropicAdapter({ apiKey, baseUrl, model, ...timeoutOpts });
  }
  // openai-compat — pass preset defaults for thinking / token field name
  return new OpenAiCompatAdapter({
    apiKey,
    baseUrl,
    model,
    thinkingDefault: resolved.thinkingDefault,
    preferMaxCompletionTokens: resolved.preferMaxCompletionTokens,
    ...timeoutOpts,
  });
}

/**
 * Error raised when a remote provider credential is unavailable.
 * The message names only the environment-variable slot, never a value.
 */
export class MissingApiKeyError extends Error {
  public readonly provider: LlmProvider;
  public readonly envVar: string;
  constructor(provider: LlmProvider, envVar: string) {
    super(
      `Missing API key for provider "${provider}". ` +
        `Run livewiki config or set env var ${envVar} before running the batch. ` +
        `Keys never live in config.json, checkpoint_json, logs, or error messages.`,
    );
    this.name = "MissingApiKeyError";
    this.provider = provider;
    this.envVar = envVar;
  }
}

/**
 * LLM call error — when the provider returns an error or the request fails.
 * The message carries the provider's `errorBody` (limited), but NEVER the
 * headers (which contain the key). Covered by key-leak.test.ts.
 */
export class LlmRequestError extends Error {
  public readonly status: number;
  public readonly provider: LlmProvider;
  public readonly errorBody: string;
  constructor(provider: LlmProvider, status: number, errorBody: string) {
    // Truncates body to avoid dumping huge JSON in messages
    const truncated = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
    super(`LLM ${provider} request failed (status ${status}): ${truncated}`);
    this.name = "LlmRequestError";
    this.status = status;
    this.provider = provider;
    this.errorBody = errorBody;
  }
}

export { LlmTimeoutError, DEFAULT_LLM_TIMEOUT_MS } from "./base.js";

export { probeProvider, formatProbeFailure } from "./probe.js";
export type { ProviderProbeResult } from "./probe.js";

export type { GenerateRequest, GenerateResult, LlmUsage, StopReason } from "./types.js";
