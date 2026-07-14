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

This module covers two harness helpers used during clean MiniMax runs:

- `acceptance-analysis.mjs` — offline acceptance checker aligned with the stage-4 product validator (gate logic, coverage math, real-duplicate detection).
- `token-proxy.mjs` — local pass-through proxy that measures wire-level token usage against an OpenAI-compatible upstream.

## Acceptance analysis: I/O and discovery

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk -->

The acceptance script loads three JSON files from `<artifactRoot>/metrics`: `batch-status.json`, `verify.json`, and a proxy log whose basename defaults to `token-proxy-livewiki-clean-v5.json`. Page discovery happens in two places: the top-level `wiki/` directory is scanned for module page ids (excluding `quickstart.md` and any dotfiles), and a recursive `walk` collects every `.md` file under `wiki/` so individual page frontmatter can be parsed.

`readJson(p)` wraps `JSON.parse(fs.readFileSync(...))` and returns `null` on any failure, so missing or malformed inputs collapse gracefully into downstream defaults rather than aborting the run. `walk(d, a = [])` recurses into subdirectories and pushes `.md` paths into the accumulator; if `d` does not exist it returns the accumulator unchanged.

## Acceptance analysis: validator-aligned page scan

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage -->

`scanPage(filePath)` reproduces the stage-4 product validator's view of a generated page. It first extracts the `anchors:` list from the YAML frontmatter (between the leading and trailing `---` fences), collecting each key in `fmKeys`. It then scans the body for every `<!-- lw:anchors ... -->` HTML comment, splitting the inner whitespace-separated list into ordered keys. Duplicates detected within one marker are reported as `same_marker_duplicate`; duplicates seen across markers in the same page are reported as `cross_section_duplicate`. Frontmatter entries that repeat are flagged as `frontmatter_duplicate`. The function returns a `declared` set (union of unique frontmatter and section keys) and the `realDups` list — the same semantics the validator uses, so the analyzer only fails pages the validator would also fail.

## Acceptance analysis: planned-symbol budget

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview -->

`plannedSymbolsFromOverview(overviewText, plannedIds)` derives the expected total symbol count for the run from `architecture/overview.md`. It prefers the explicit header form `indexed and **N** symbols` (or the variant `**N** symbols extracted`). When neither header is present, it falls back to summing each module's per-section `**N** symbols` figure, matching against `<a id="<moduleId>"></a>`. If no header and no per-module matches are found, it returns `null` so the caller can leave the coverage gate unset rather than silently accept zero.

## Token proxy: output lifecycle

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`ensureOutDir()` creates the output directory (defaulting to `process.env.TEMP`, `TMP`, or `"."`) with `recursive: true`. `save()` rewrites the summary JSON (`token-proxy-<label>.json`) with the legacy 2026-07-10 field names (`calls`, `promptTokens`, `completionTokens`, `totalTokens`, `cachedPromptTokens`, `reasoningTokens`, `callsWithoutUsage`, `callsWithError`, `updatedAt`) plus the full `callLog`. `recordCall(record)` is the central accumulator: it bumps `state.calls`, pushes the record onto `callLog`, increments `callsWithError` when the record has an error, sums prompt/completion/total/cached/reasoning tokens when usage is present, counts `callsWithoutUsage` only for successful-looking calls that lack usage, appends one JSON line to `token-proxy-<label>.jsonl`, then calls `save()` and prints a one-line status with cache and reasoning subtotals when present.

## Token proxy: usage normalization

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage -->

`num(v)` returns `v` when it is a finite number, otherwise `null`. `normalizeUsage(usage)` returns `null` for non-object input and otherwise maps provider-specific fields to a stable `NormalizedUsage` record: `prompt_tokens` / `input_tokens` / `promptTokens` → `promptTokens` (falling through to `0`), the analogous completion fields → `completionTokens`, with `total_tokens` defaulted to `promptTokens + completionTokens` when missing. Cached prompt tokens are read from `prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, `cached_tokens`, or `prompt_cache_hit_tokens`. Reasoning tokens are read from `completion_tokens_details.reasoning_tokens`, `output_tokens_details.reasoning_tokens`, `reasoning_tokens`, or `thinking_tokens`. The original `usage` object is preserved on `raw`.

## Token proxy: body inspection

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`extractUsageFromBody(buf, isStream)` parses the response buffer as UTF-8. For non-stream responses it returns `{ usage: j.usage ?? null, parseError, bodyError: extractBodyError(j) }`. For stream responses it walks every `data: { ... }` SSE line, retains the last observed `usage`, and surfaces the first `bodyError` seen. Whole-buffer JSON parse failures populate `parseError` instead of throwing. `extractBodyError(j)` returns a string error message when the body has a top-level `error` (string or object), an OpenAI-style `{ type: "error", message }`, and `null` otherwise. `peekRequestMeta(bodyBuf)` parses the inbound JSON body to extract `model` and `stream`; when `stream === true`, it sets `stream_options.include_usage = true` and returns a re-serialized `bodyBuf` so the upstream emits the final usage chunk.
