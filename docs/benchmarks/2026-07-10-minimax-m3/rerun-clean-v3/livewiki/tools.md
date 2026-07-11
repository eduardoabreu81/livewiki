---
title: tools
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall
---

## Output handling
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir` creates `OUT_DIR` recursively before any write so first-run crashes do not lose data. `save` writes the in-memory `state` (label, counters, `callLog`) to `token-proxy-<label>.json` and is invoked on every recorded call plus at startup and shutdown. The JSONL log (`token-proxy-<label>.jsonl`) is truncated at startup and appended per call.

## Usage normalization
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`num` returns a finite number or `null` so missing/non-numeric fields never poison totals. `normalizeUsage` maps provider-specific usage shapes (OpenAI-style, MiniMax, Anthropic-compat) into the `NormalizedUsage` record: `promptTokens`, `completionTokens`, `totalTokens` (falls back to the sum), plus optional `cachedPromptTokens` and `reasoningTokens`, preserving the raw object for debugging.

## Body parsing
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractBodyError` pulls an error string out of JSON responses (string `error`, object `error.message`/`error.code`, or `type: "error"` with a `message`). `extractUsageFromBody` parses non-stream JSON for `usage` plus any body error, or walks SSE lines (matching `data: {...}`) to find the final usage chunk; partial SSE JSON is ignored. It returns `{ usage, parseError, bodyError }` so the caller can attribute failures.

## Request metadata
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`peekRequestMeta` inspects the request body to extract `model` and `stream` for `/chat/completions` POSTs. When streaming is requested it sets `stream_options.include_usage = true` (merging with any existing options) and rewrites the buffer so the upstream returns the final usage chunk.

## Call recording
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`recordCall` appends a `CallRecord` to `state.callLog`, bumps aggregate counters (tokens, cache, reasoning, error counts, calls-without-usage), appends a JSON line to the JSONL log, and rewrites the JSON summary. It then logs a one-line summary to stdout including status, in/out tokens, cache/reasoning deltas, running total, and duration, with separate lines for errors and missing-usage cases.