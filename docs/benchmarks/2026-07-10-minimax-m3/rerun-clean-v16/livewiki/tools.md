---
title: tools
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save
---

# tools

Two harness helpers used during benchmark runs: an offline acceptance analyzer that validates livewiki output, and a local pass-through proxy that records per-call token usage for OpenAI-compatible upstreams.

## acceptance-analysis.mjs — filesystem helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk -->

`readJson(p)` parses a JSON file from disk and returns `null` on any failure (file missing or invalid JSON), so callers can treat optional inputs uniformly.

`walk(d, a = [])` recursively collects every `*.md` file under directory `d`. Missing directories yield an empty array; the `a` accumulator lets callers reuse a single array across recursive calls.

## acceptance-analysis.mjs — page scanner and plan parser
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview -->

`scanPage(filePath)` reads a Markdown page and extracts its declared anchor set with validator-aligned semantics: it captures frontmatter `anchors:` keys in order and section keys in marker order, then distinguishes three duplicate kinds:

- `frontmatter_duplicate` — same key listed twice in the YAML anchors list.
- `same_marker_duplicate` — key repeated inside a single `lw:anchors` marker.
- `cross_section_duplicate` — same key spread across two different section markers.

A key that appears once in frontmatter and once in one section marker is **not** flagged. The function returns `{ declared, realDups }` where `declared` is the union set of all keys seen.

`plannedSymbolsFromOverview(overviewText, plannedIds)` derives the planned symbol count for an entire run from the `architecture/overview.md` page. It first looks for the `indexed and **N** symbols` header, then falls back to `**N** symbols extracted`. If neither header is present, it sums per-module `**N** symbols` matches under `<a id="...">` anchors for each planned module id; it returns `null` when nothing matches.

## token-proxy.mjs — output and persistence
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir()` creates the proxy output directory (path taken from `LIVEWIKI_PROXY_OUT_DIR`, then `TEMP`/`TMP`, then `.`) with `recursive: true` so first-write never fails on a missing parent.

`save()` refreshes `state.updatedAt` and writes the JSON summary to `<outDir>/token-proxy-<label>.json`. The summary keeps the legacy field names (`calls`, `promptTokens`, `completionTokens`, `totalTokens`) for downstream consumers and adds `cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`, `callsWithError`, `updatedAt`, and the full `callLog` array so a rerun can replay history without losing per-call detail.

## token-proxy.mjs — usage normalization
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`num(v)` is a tiny finite-number guard: it returns `v` when it is a finite `number`, otherwise `null`. Every numeric extraction in the proxy routes through it so a missing field is distinguishable from a literal `0`.

`normalizeUsage(usage)` maps provider-specific usage objects onto a stable `NormalizedUsage` shape (`promptTokens`, `completionTokens`, `totalTokens`, `cachedPromptTokens`, `reasoningTokens`, `raw`). It accepts both OpenAI-style (`prompt_tokens`, `completion_tokens`) and common compatibility variants (`input_tokens`, `output_tokens`, camelCase forms). `totalTokens` defaults to `prompt + completion` when absent. Cache reads are pulled from `prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, `cached_tokens`, or `prompt_cache_hit_tokens`. Reasoning tokens come from `completion_tokens_details.reasoning_tokens`, `output_tokens_details.reasoning_tokens`, `reasoning_tokens`, or `thinking_tokens`. The original object is preserved under `raw` for forensic inspection.

## token-proxy.mjs — body parsing and request inspection
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`extractBodyError(j)` digs an error message out of a response JSON. It returns a string when the body has `error` (scalar or object with `message`/`code`), or `message` paired with `type === "error"`; otherwise `null`.

`extractUsageFromBody(buf, isStream)` turns a buffered upstream response into `{ usage, parseError, bodyError }`. For non-stream bodies it parses JSON once and grabs `j.usage` plus any body-level error. For SSE streams it scans `data: {...}` lines, taking the **last** `usage` block seen (which providers typically send in the terminating chunk) and aggregating the first error encountered; partial chunks that fail to parse are silently ignored. A top-level JSON parse failure surfaces as `parseError`.

## token-proxy.mjs — request peek and call recording
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`peekRequestMeta(bodyBuf)` reads a chat-completions request body and returns `{ model, stream, bodyBuf, isStream }`. When the body is empty or unparseable it returns safe defaults with `stream: false` and the original buffer untouched. When `stream` is `true`, it rewrites the body to set `stream_options.include_usage = true` so the upstream emits a final usage chunk, and returns the rewritten buffer for forwarding.

`recordCall(record)` appends a `CallRecord` to `state.callLog`, updates running totals (calls, prompt/completion/total tokens, cached prompt tokens, reasoning tokens), bumps `callsWithError` when the record carries an `error`, and bumps `callsWithoutUsage` only when the call otherwise succeeded but produced no usage object. It appends one JSON line to `<outDir>/token-proxy-<label>.jsonl` and then calls `save()` so the summary stays in sync. Finally it prints a one-line status to stdout showing either an error, a usage breakdown (with optional `cache=` and `reasoning=` annotations and the cumulative total), or a `NO USAGE` marker for successful stream calls that did not report tokens.