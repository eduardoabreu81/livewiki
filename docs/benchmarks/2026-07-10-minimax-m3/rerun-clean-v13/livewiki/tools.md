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

## acceptance-analysis.mjs helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview -->

`readJson(p)` reads a JSON file at path `p` and returns the parsed value, or `null` on any read/parse failure (errors are swallowed).

`walk(d, a = [])` recursively collects `.md` file paths under directory `d`. It returns the accumulator unchanged when `d` does not exist, descends into subdirectories, and pushes leaf `.md` files into the flat list.

`scanPage(filePath)` is the validator-aligned declaration scan for a single page. It parses the YAML frontmatter, extracts `anchors:` list entries, and walks every `                       ` comment marker. The function returns `{ declared, realDups }` where `declared` is the union of frontmatter and section keys, and `realDups` contains three kinds of true duplicate errors: `frontmatter_duplicate`, `cross_section_duplicate` (the same key in two different section markers), and `same_marker_duplicate` (a key listed twice within a single marker). Per-occurrence repeats inside one marker are not double-reported as cross-section duplicates.

`plannedSymbolsFromOverview(overviewText, plannedIds)` prefers the repo-wide total from the overview header matching `indexed and **N** symbols` (or the alternate `**N** symbols extracted` form). When the header is missing it falls back to summing the per-module `**N** symbols` lines for each id in `plannedIds`, returning that sum only if at least one module matched; otherwise it returns `null`.

## token-proxy.mjs filesystem helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`ensureOutDir()` synchronously creates the configured `OUT_DIR` with `recursive: true` so the summary and per-call JSONL paths are always writable.

`save()` stamps `state.updatedAt`, then writes the full summary JSON (legacy field names `calls`, `promptTokens`, `completionTokens`, `totalTokens` plus `cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`, `callsWithError`, `updatedAt`, and the complete `callLog`) to `OUT_JSON`. It does not touch the JSONL file — appends happen in `recordCall`.

## token-proxy.mjs parsing helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`num(v)` returns the number `v` when it is a finite `number`, otherwise `null`. It is the coercion gate for every numeric field read off a provider response.

`normalizeUsage(usage)` maps provider-specific usage shapes into the stable `NormalizedUsage` record. It picks `prompt_tokens` / `input_tokens` / `promptTokens` (defaulting to `0`), then `completion_tokens` / `output_tokens` / `completionTokens` (defaulting to `0`), and `total_tokens` / `totalTokens` — falling back to `prompt + completion` when the upstream omits a total. It also resolves cached prompt tokens (`prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, `cached_tokens`, `prompt_cache_hit_tokens`) and reasoning tokens (`completion_tokens_details.reasoning_tokens`, `output_tokens_details.reasoning_tokens`, `reasoning_tokens`, `thinking_tokens`) to a number or `null`, and always preserves the original `usage` object under `raw`.

`extractUsageFromBody(buf, isStream)` parses a fully-buffered response. For non-stream responses it JSON-parses the buffer once, returning `{ usage, parseError: null, bodyError }`. For SSE streams it scans line-by-line for `data: {...}` payloads, taking the last non-empty `usage` object and collecting any non-null `extractBodyError(j)` result. JSON parse failures inside individual SSE lines are ignored (partial chunks). Top-level JSON parse failures return `{ usage: null, parseError: String(e), bodyError: null }`.

`extractBodyError(j)` returns a string message when the JSON payload represents an error: a top-level string `j.error`, an `j.error` object (using `message`, then `code`, then `JSON.stringify`), or a `j.type === "error"` plus `j.message` shape. It returns `null` for any non-object input or when no error field is present.

## token-proxy.mjs request-side helpers
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`peekRequestMeta(bodyBuf)` returns `{ model, stream, bodyBuf, isStream }` for the inbound request body. When the buffer is empty or unparseable, it returns `model: null`, `stream: false`, the original buffer, and `isStream: false`. When the body is valid JSON, it copies the parsed object, sets `stream_options.include_usage = true` so the upstream emits a final usage chunk on SSE responses, re-serializes the buffer, and exposes the model name string (or `null`) and the `stream` boolean.

`recordCall(record)` is the per-call sink. It increments `state.calls`, pushes the record onto `state.callLog`, bumps `callsWithError` when an error is set, and aggregates `promptTokens` / `completionTokens` / `totalTokens` from `record.usage`. It adds `cachedPromptTokens` and `reasoningTokens` only when those fields are non-null on the record. When the call is otherwise OK but has no usage object, it increments `callsWithoutUsage`. After updating counters, it appends a single JSON line to `OUT_JSONL`, calls `save()` to rewrite the summary file, and prints a one-line status message — including cached/reasoning token suffixes when available, an `ERROR` line for failures, and a `NO USAGE` line when a successful call returned no usage data.