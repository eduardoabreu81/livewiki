/**
 * llm/probe — bounded connectivity + thinking-leak probe.
 *
 * Root cause this guards (dogfood incident 2026-08-16): providers change
 * their DEFAULTS without notice — DeepSeek v4 enabled reasoning when the
 * `thinking` field is omitted, and the reasoning silently burned the whole
 * output budget (`truncated_by_token_limit` on every large page). Static
 * preset data cannot catch weekly provider changes; a live minimal call can.
 *
 * The probe sends exactly what the resolved configuration would send (no
 * thinking override beyond what the config/preset already dictates), costs
 * a handful of tokens, and answers two questions before any paid run:
 *   1. Does the endpoint answer with usable content?
 *   2. Does reasoning leak anyway (`reasoning_tokens` > 0 or an inline
 *      `<think>` block in the content)?
 *
 * Used by `livewiki config` (setup-time verification) and by the batch
 * preflight (run-time verification). It never writes anything and never
 * logs or returns credential material.
 */

import type { LivewikiConfig } from "../config.js";
import { createLlmClient } from "./index.js";

export interface ProviderProbeResult {
  /** The endpoint answered with non-empty content. */
  ok: boolean;
  /** Reasoning observed in the response (tokens reported or `<think` inline). */
  thinkingLeak: boolean;
  /** Model id echoed by the provider (may differ from the configured alias). */
  modelEcho: string | null;
  /** Reasoning tokens reported by the provider (0 when absent). */
  reasoningTokens: number;
  /** Request/config failure detail when the probe could not complete. */
  error: string | null;
}

const PROBE_SYSTEM = "You are a connectivity probe. Reply with exactly: OK";
const PROBE_USER = "Reply with exactly: OK";
const PROBE_MAX_TOKENS = 32;

export async function probeProvider(
  repoRoot: string,
  config: LivewikiConfig,
): Promise<ProviderProbeResult> {
  const failed = (error: unknown): ProviderProbeResult => ({
    ok: false,
    thinkingLeak: false,
    modelEcho: null,
    reasoningTokens: 0,
    error: error instanceof Error ? error.message : String(error),
  });

  let client;
  try {
    client = createLlmClient(repoRoot, config);
  } catch (error) {
    return failed(error);
  }

  try {
    const result = await client.generate({
      system: PROBE_SYSTEM,
      user: PROBE_USER,
      maxTokens: PROBE_MAX_TOKENS,
    });
    const reasoningTokens = result.usage.reasoningTokens ?? 0;
    const thinkInContent = /<think[\s>]/.test(result.content);
    return {
      ok: result.content.trim().length > 0,
      thinkingLeak: reasoningTokens > 0 || thinkInContent,
      modelEcho: result.usage.model,
      reasoningTokens,
      error: null,
    };
  } catch (error) {
    return failed(error);
  }
}

/**
 * One-line human remediation for a failed probe. Names configuration slots
 * only — never credentials.
 */
export function formatProbeFailure(probe: ProviderProbeResult): string {
  if (probe.thinkingLeak) {
    return (
      `the provider returned reasoning (${probe.reasoningTokens} reasoning tokens or an inline <think> block) ` +
      `under the current configuration. Reasoning burns the output budget and truncates pages. ` +
      `Set "thinking": "disabled" in .livewiki/config.json, or choose a model without default reasoning.`
    );
  }
  return `the provider did not answer a minimal request: ${probe.error ?? "empty response"}. Check preset/model/baseUrl and the credential.`;
}
