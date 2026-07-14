---
title: token-proxy
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

# token-proxy

Local pass-through HTTP proxy to an OpenAI-compatible upstream (default: `https://api.minimax.io`). It measures token usage at the wire and writes both a JSON summary and a JSONL per-call log. The proxy never reads the API key — it forwards the `Authorization` header untouched. Point a tool's base URL at `http://127.0.0.1:<port>/v1`.

Run with `node token-proxy.mjs [label]`. Override via `LIVEWIKI_PROXY_PORT`, `LIVEWIKI_PROXY_UPSTREAM`, `LIVEWIKI_PROXY_OUT_DIR`.

## Output directory

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir -->

`ensureOutDir()` creates the configured output directory recursively before any write occurs. It is invoked at startup, inside `save()` on every summary rewrite, and from `recordCall()` before each JSONL append, so the proxy tolerates a freshly deleted `OUT_DIR` mid-run.

## Summary persistence

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`save()` serialises the in-memory `state` (label, call counters, token totals, cache/reasoning/error counts, and the full `callLog`) to `<outDir>/token-proxy-<label>.json`. It refreshes `updatedAt` on every call. Field names preserve the legacy 2026-07-10 vocabulary (`calls`, `promptTokens`, `completionTokens`, `totalTokens`) and add the cache/reasoning/error counters plus `callLog` for reruns.

## Usage normalization

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`normalizeUsage(usage)` reshapes provider-specific usage objects into a stable `NormalizedUsage` record with `promptTokens`, `completionTokens`, `totalTokens`, `cachedPromptTokens`, `reasoningTokens`, and the original `raw` payload. It accepts OpenAI-style fields (`prompt_tokens`, `completion_tokens`, `total_tokens`) and common MiniMax / Anthropic-compat variants (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `thinking_tokens`, etc.). `totalTokens` falls back to `promptTokens + completionTokens` when absent.

`num(v)` is the helper used throughout normalisation: it returns `v` only when it is a finite number, otherwise `null`. This keeps absent provider fields out of aggregates instead of silently zeroing them.

## Response parsing

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractUsageFromBody(buf, isStream)` decodes a buffered upstream response. For non-streaming calls it parses the body as JSON and returns `usage` plus any `bodyError`. For streaming calls it scans `data: {...}` SSE lines, captures the last `usage` object seen, and collects the first body-level error it encounters — partial SSE chunks are tolerated and ignored.

`extractBodyError(j)` extracts a human-readable error message from a parsed JSON body: a string `error`, an object `error.message` or `error.code`, or a top-level `{ message, type: "error" }` shape. Returns `null` when no error is present.

## Request inspection

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`peekRequestMeta(bodyBuf)` parses the inbound request body to recover the `model` name and the `stream` flag for `/chat/completions` requests. When streaming is requested, it injects `stream_options.include_usage = true` so the upstream emits a final chunk carrying `usage`, then re-serialises the buffer for forwarding. On parse failure it returns `{ model: null, stream: false }` with the original buffer untouched.

## Per-call recording

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`recordCall(record)` appends a `CallRecord` to `state.callLog`, increments aggregate counters (prompt/completion/total tokens, cached prompt tokens, reasoning tokens), tracks `callsWithError` and `callsWithoutUsage`, writes a JSONL line to `<outDir>/token-proxy-<label>.jsonl`, and triggers a summary `save()`. It also emits a one-line status report to stdout showing the call id, HTTP status, token counts, and duration. Missing-usage counter is incremented only when the call otherwise looked successful (`record.ok` true and no explicit error).