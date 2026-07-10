---
title: tools / token-proxy
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

# tools / token-proxy

Local pass-through HTTP proxy in front of an OpenAI-compatible upstream
(default: `https://api.minimax.io`). Forwards the `Authorization` header
untouched, measures token usage at the wire, and writes a per-call log plus a
running summary to `OUT_DIR`.

Configuration is read from environment variables:

| Var | Default |
| --- | --- |
| `LIVEWIKI_PROXY_PORT` | `8900` |
| `LIVEWIKI_PROXY_UPSTREAM` | `https://api.minimax.io` |
| `LIVEWIKI_PROXY_OUT_DIR` | `TEMP` / `TMP` / `.` |
| `LABEL` (argv[2]) | `"run"` |

Output files:

- `<outDir>/token-proxy-<label>.json` — summary + full `callLog`.
- `<outDir>/token-proxy-<label>.jsonl` — one JSON object per call (append).

## Filesystem helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir()` creates `OUT_DIR` recursively. Idempotent; safe to call before
each write.

`save()` re-ensures the directory, stamps `state.updatedAt`, and writes the
summary JSON (`summary.json`) with the legacy field names
(`calls`, `promptTokens`, `completionTokens`, `totalTokens`) plus
`cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`,
`callsWithError`, `updatedAt`, and the full `callLog`.

## Numeric helper
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`num(v)` returns `v` if it is a finite `number`, otherwise `null`. Used as a
narrowing wrapper around provider-reported integer fields.

## Usage normalization
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage -->

`normalizeUsage(usage)` coerces provider-specific usage shapes into the
internal `NormalizedUsage` record:

- `promptTokens` ← `prompt_tokens` / `input_tokens` / `promptTokens`, else `0`.
- `completionTokens` ← `completion_tokens` / `output_tokens` / `completionTokens`, else `0`.
- `totalTokens` ← `total_tokens` / `totalTokens`, else `promptTokens + completionTokens`.
- `cachedPromptTokens` ← `prompt_tokens_details.cached_tokens` /
  `input_tokens_details.cached_tokens` / `cache_read_input_tokens` /
  `cached_tokens` / `prompt_cache_hit_tokens`, else `null`.
- `reasoningTokens` ← `completion_tokens_details.reasoning_tokens` /
  `output_tokens_details.reasoning_tokens` / `reasoning_tokens` /
  `thinking_tokens`, else `null`.
- `raw` ← original `usage` object for forensics.

Returns `null` when `usage` is missing or not an object.

## Body parsing
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractBodyError(j)` returns a string error message from a parsed JSON body,
recognising `j.error` (string or object), or `j.type === "error"` with a string
`message`. Returns `null` if no error is present.

`extractUsageFromBody(buf, isStream)` returns `{ usage, parseError, bodyError }`:

- Non-stream: parses `buf` as JSON and returns `j.usage` plus any `bodyError`.
- Stream: scans `data: { ... }` SSE lines, keeps the last `usage` seen, and
  collects any `bodyError`. Partial SSE chunks are tolerated via per-line
  `try/catch`.
- On outer `JSON.parse` failure (non-stream only), returns
  `{ usage: null, parseError: String(e.message ?? e), bodyError: null }`.

## Request inspection
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`peekRequestMeta(bodyBuf)` parses the request body to extract `model` and the
`stream` flag for `/chat/completions` requests:

- Empty body → `{ model: null, stream: false, bodyBuf, isStream: false }`.
- When `j.stream === true`, sets `j.stream_options.include_usage = true` and
  returns the re-serialised buffer so the upstream includes a final usage
  chunk.
- Parse failure → `{ model: null, stream: false, bodyBuf, isStream: false }`.

## Call recording
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`recordCall(record)` is invoked after each proxied chat completion. It:

1. Increments `state.calls` and appends to `state.callLog`.
2. On `record.error`: increments `state.callsWithError`.
3. On `record.usage`: aggregates `promptTokens`, `completionTokens`,
   `totalTokens`; adds `cachedPromptTokens` / `reasoningTokens` when not
   `null`.
4. If the call was `ok` but had no `usage` and no `error`, increments
   `state.callsWithoutUsage`.
5. Ensures `OUT_DIR` exists, appends the record as one JSON line to
   `OUT_JSONL`, then re-writes the summary via `save()`.
6. Logs a one-line trace per call. Three shapes:

   - `ERROR status=<code> <error> (<durationMs>ms)`
   - `status=<code> in=<prompt> out=<completion>[ cache=<n>][ reasoning=<n>] | cum total=<state.totalTokens> (<durationMs>ms)`
   - `status=<code> NO USAGE stream=<bool> (<durationMs>ms)`
