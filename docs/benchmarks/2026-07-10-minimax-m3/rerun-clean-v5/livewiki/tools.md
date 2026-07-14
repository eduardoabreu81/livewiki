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

# tools

Local pass-through proxy to an OpenAI-compatible upstream (default: MiniMax). It
measures token usage at the wire using the same instrument for livewiki and
OpenWiki, and never needs the API key: it forwards the `Authorization` header
untouched.

Per-call log fields (handoff U–X follow-up):

- timestamps (start/end ISO + `durationMs`)
- HTTP status
- `stream` flag
- `promptTokens` / `completionTokens` / `totalTokens`
- `cachedPromptTokens` (when the provider reports them)
- `reasoningTokens` (when reported)
- `error` (upstream, parse, or transport)

Usage:

```
node token-proxy.mjs [label]
LIVEWIKI_PROXY_PORT=8900 LIVEWIKI_PROXY_UPSTREAM=https://api.minimax.io \
  LIVEWIKI_PROXY_OUT_DIR=./out node token-proxy.mjs livewiki-rerun
```

Point a tool's base URL at `http://127.0.0.1:<port>/v1`.

Writes:

- `<outDir>/token-proxy-<label>.json` — summary + all calls
- `<outDir>/token-proxy-<label>.jsonl` — one JSON object per call (append-friendly)

## Output helpers

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir` creates the configured output directory (recursively) if it
does not already exist. It is invoked before every write to the summary file
and the per-call JSONL file, so the proxy is safe to run against a fresh
`OUT_DIR`.

`save` serializes the in-memory `state` object to `OUT_JSON`. The summary
keeps the legacy 2026-07-10 field names (`calls`, `promptTokens`, …) and adds
the `cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`,
`callsWithError`, `updatedAt` counters plus the full `callLog` for reruns.

## Usage normalization

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`normalizeUsage` maps provider-specific usage shapes onto the stable
`NormalizedUsage` record used throughout the rest of the proxy. It supports
OpenAI-style fields and common MiniMax / Anthropic-compat variants:

- prompt → `prompt_tokens` / `input_tokens` / `promptTokens`
- completion → `completion_tokens` / `output_tokens` / `completionTokens`
- total → `total_tokens` / `totalTokens`, falling back to
  `promptTokens + completionTokens`
- cached prompt → `prompt_tokens_details.cached_tokens`,
  `input_tokens_details.cached_tokens`, `cache_read_input_tokens`,
  `cached_tokens`, `prompt_cache_hit_tokens`
- reasoning → `completion_tokens_details.reasoning_tokens`,
  `output_tokens_details.reasoning_tokens`, `reasoning_tokens`,
  `thinking_tokens`

The original `usage` payload is preserved under `raw` for debugging.

`num` is a small coercion helper: it returns `v` when it is a finite number,
otherwise `null`. It is used everywhere numeric usage fields are read so
non-numeric or missing values degrade to `null` (or to the safe fallback in
`normalizeUsage`) rather than poisoning aggregates.

## Response parsing

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractUsageFromBody` parses an upstream response buffer and returns the
last-seen `usage` object, a `parseError` string when the buffer is not valid
JSON, and a `bodyError` string when the provider returned an error payload.
For non-stream responses it parses the body once. For SSE streams it walks
each `data: {…}` line, ignoring partial chunks, and remembers the last
non-null `usage` plus any inline `error` payload it encounters.

`extractBodyError` turns a parsed JSON object into an error string when
present:

- `error: "<string>"` → the string
- `error: { message | code | … }` → `message` / `code` / `JSON.stringify`
- `{ message, type: "error" }` → `message`

Returns `null` when no error shape is recognized.

## Request inspection

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`peekRequestMeta` looks at the incoming request body for `POST
/chat/completions` traffic. It reports the requested `model` and whether
`stream` was set. When streaming is requested it injects
`stream_options.include_usage = true` (merging with any caller-supplied
`stream_options`) and returns the rewritten buffer so the upstream emits a
final SSE chunk containing `usage`. If the body is empty or not valid JSON
it returns `model: null`, `stream: false`, and the original buffer
unchanged.

## Call recording

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`recordCall` appends a `CallRecord` to `state.callLog`, updates the running
counters (`calls`, `promptTokens`, `completionTokens`, `totalTokens`,
`cachedPromptTokens`, `reasoningTokens`, `callsWithError`,
`callsWithoutUsage`), writes the record to the JSONL stream, and calls
`save` to refresh the summary. `callsWithoutUsage` is incremented only when
the call was otherwise successful (`ok === true`) but no usage was parsed,
so transport-level failures are not double-counted as missing-usage.

It also emits a one-line log per call summarizing status, in/out tokens,
optional cache and reasoning tokens, the cumulative `totalTokens`, and
duration, or an `ERROR` line when the call failed.