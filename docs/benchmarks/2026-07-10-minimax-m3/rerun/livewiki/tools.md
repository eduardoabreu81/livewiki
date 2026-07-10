---
title: tools/token-proxy.mjs
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save
---

# `tools/token-proxy.mjs`

Local pass-through HTTP proxy that fronts an OpenAI-compatible upstream (default: `https://api.minimax.io`) and records per-call token usage at the wire. The Authorization header is forwarded untouched, so the proxy never needs the API key.

Run with:

```
node token-proxy.mjs [label]
LIVEWIKI_PROXY_PORT=8900 LIVEWIKI_PROXY_UPSTREAM=https://api.minimax.io \
  LIVEWIKI_PROXY_OUT_DIR=./out node token-proxy.mjs livewiki-rerun
```

Point a tool's base URL at `http://127.0.0.1:<port>/v1`. Output:

- `<outDir>/token-proxy-<label>.json` — summary + full `callLog`.
- `<outDir>/token-proxy-<label>.jsonl` — one JSON object per call (append-friendly).

Configuration is read from `LIVEWIKI_PROXY_PORT` / `PORT`, `LIVEWIKI_PROXY_UPSTREAM`, `LIVEWIKI_PROXY_OUT_DIR` / `TEMP` / `TMP`, and the first CLI positional argument as `LABEL`.

## Filesystem helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir` creates the configured output directory recursively via `fs.mkdirSync`. `save` calls `ensureOutDir`, stamps `state.updatedAt`, serializes the current aggregate counters plus the full `callLog` to `OUT_JSON`, and overwrites that file atomically with `fs.writeFileSync`. The summary preserves the legacy 2026-07-10 field names (`calls`, `promptTokens`, `completionTokens`, `totalTokens`) alongside cache / reasoning / error counters and the per-call record array.

## Usage normalization
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`num` returns `v` only when it is a finite `number`, otherwise `null`. `normalizeUsage` maps provider-specific usage payloads into the stable `NormalizedUsage` shape used by the proxy and downstream tooling:

- `promptTokens` — OpenAI `prompt_tokens`, MiniMax `input_tokens`, or `promptTokens`.
- `completionTokens` — `completion_tokens`, `output_tokens`, or `completionTokens`.
- `totalTokens` — `total_tokens` / `totalTokens`, or `promptTokens + completionTokens` when the provider omits it.
- `cachedPromptTokens` — `prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, `cached_tokens`, or `prompt_cache_hit_tokens` (nullable).
- `reasoningTokens` — `completion_tokens_details.reasoning_tokens`, `output_tokens_details.reasoning_tokens`, `reasoning_tokens`, or `thinking_tokens` (nullable).
- `raw` — the original usage object, kept for audit.

`normalizeUsage` returns `null` for non-object inputs.

## Response parsing
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractBodyError` pulls a human-readable error string out of a parsed JSON body — supporting top-level `error` strings or objects (preferring `message`, then `code`), and `{ type: "error", message }` envelopes. Returns `null` when nothing error-shaped is present.

`extractUsageFromBody(buf, isStream)` decodes the buffered upstream response:

- Non-stream responses: a single `JSON.parse`; returns `{ usage: j.usage ?? null, parseError: null, bodyError }`.
- Stream (SSE) responses: scans line-by-line for `data: {...}` chunks, accumulating the last non-null `usage` and the first `bodyError`. Partial chunks are tolerated silently.

On `JSON.parse` failure of a non-stream body, returns `{ usage: null, parseError, bodyError: null }`.

## Request handling
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`peekRequestMeta(bodyBuf)` inspects the inbound `POST /chat/completions` body:

- Empty body → `{ model: null, stream: false, bodyBuf, isStream: false }`.
- Non-JSON body → same shape with all-null defaults.
- Valid JSON → returns `{ model, stream, isStream, bodyBuf }`. When `stream === true`, it sets `stream_options.include_usage = true` and re-serializes the buffer so the upstream emits a final usage chunk (when supported).

`recordCall(record)` updates the aggregate `state` (counters for `calls`, `promptTokens`, `completionTokens`, `totalTokens`, `cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`, `callsWithError`), appends the record to `OUT_JSONL`, persists the updated summary via `save`, and prints a one-line trace to stdout. Missing usage is counted only when the call otherwise succeeded (`ok`).

## Wire-level behavior

- Forwards the client's `Authorization` header verbatim — the proxy never sees the upstream key.
- Strips inbound `content-length` and `accept-encoding` so the upstream response is uncompressed and parseable.
- Strips outbound `content-encoding` / `transfer-encoding` and re-emits `content-length` to match the fully buffered body passed to the client.
- Transport-level failures (e.g. upstream connection errors) are recorded as `error: "transport: <message>"` with `statusCode: null` and surfaced to the client as `502`.
