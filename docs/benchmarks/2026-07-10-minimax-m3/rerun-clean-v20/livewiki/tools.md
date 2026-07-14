---
title: "Benchmark tools: acceptance analysis and token proxy"
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

# Benchmark tools: acceptance analysis and token proxy

This page documents the two offline Node.js helpers shipped under `docs/benchmarks/2026-07-10-minimax-m3/tools/` that support a benchmark run: an offline acceptance analyzer and a local token-metering proxy.

## When to use this page

- **Audit** a benchmark artifact root with `node acceptance-analysis.mjs <artifactRoot>` to confirm the run completed and every planned module page exists.
- **Re-mirror** upstream token usage during a rerun by pointing a tool at the local `token-proxy.mjs` on `LIVEWIKI_PROXY_PORT` instead of the upstream base URL.
- **Investigate** a `verify.json` issue or a `cross_section_duplicate` / `frontmatter_duplicate` finding by reading the analyzer's page-scan logic.
- **Triage** a `NO USAGE` line in the proxy log by tracing the usage extraction path for non-streaming and SSE responses.

## How it fits

These two scripts are sibling tooling inside the same benchmark run folder. `token-proxy.mjs` is the transport-time instrumentation: it sits between a tool's HTTP client and the upstream OpenAI-compatible endpoint, forwards the `Authorization` header untouched, and writes per-call usage records to a JSON summary plus a JSONL append log. `acceptance-analysis.mjs` is the post-run auditor: it reads `metrics/batch-status.json`, `metrics/verify.json`, a proxy JSON (default name `token-proxy-livewiki-clean-v5.json`), and the generated `livewiki/` pages, then folds those into a single `acceptance-analysis.json` plus a console verdict. The analyzer's coverage gate is intentionally stricter than `>= planned`: it requires exact equality between the declared anchor count and the planned symbol count from the architecture overview, and only when an overview is present and every planned module page exists.

The page is divided into the analyzer's helpers, the analyzer's coverage logic, the proxy's persistence helpers, and the proxy's per-call processing pipeline.

## Analyzer: filesystem and JSON helpers

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk -->

The analyzer loads its inputs through small, fail-soft helpers before any gating runs. `readJson` is a thin wrapper around `JSON.parse(fs.readFileSync(p, "utf8"))` that returns `null` on any thrown error rather than letting the whole run crash, so a malformed `batch-status.json` or `verify.json` does not abort the audit. `walk` recurses a directory and returns Markdown files in argument order; it pre-checks the root with `fs.existsSync(d)` and returns the accumulator unchanged on a missing directory, which lets callers pass a non-existent `livewiki/` path without guarding it themselves.

```js
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function walk(d, a = []) {
  if (!fs.existsSync(d)) return a;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, a);
    else if (e.name.endsWith(".md")) a.push(p);
  }
  return a;
}
```

The excerpt does not establish exhaustive behavior for `walk` (for example, symlink handling or hidden files), and the caller filters out `architecture/` and `quickstart.md` after collection, so the normal path is the recursive Markdown walk shown above.

## Analyzer: per-page declaration scan

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage -->

`scanPage` is the validator-aligned declaration reader for a single Markdown page. It pulls the YAML frontmatter block with `/^---\r?\n([\s\S]*?)\r?\n---/`, then extracts every `anchors:` list entry into `fmKeys`. It walks the page with `/<!--\s*lw:anchors\s+([^>]*?)\s*-->/g` and splits each marker's captured payload on whitespace to record `sectionKeys` in marker order.

```js
function scanPage(filePath) {
  // ...returns { declared, realDups }
}
```

The duplicate semantics inside `scanPage` mirror the product validator exactly:

- A repeat of the same key inside the frontmatter list is reported as `frontmatter_duplicate`.
- A repeat of the same key inside a single marker is reported as `same_marker_duplicate` (it does not also become `cross_section_duplicate`, because the per-marker `inMarker` set guards against double reporting within the same marker).
- A repeat of the same key across two different markers is reported as `cross_section_duplicate`.

The returned `declared` set is the union of frontmatter keys and section-marker keys — a same key in both locations is intentional and is not considered a duplicate. Pages that contain no frontmatter or no markers contribute an empty `declared` set and no `realDups`.

## Analyzer: planned symbol extraction

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview -->

The coverage gate needs a planned total, not just a declared total. `plannedSymbolsFromOverview` reads the architecture overview text and tries the header pattern `indexed and **N** symbols` first, then the alternate `**N** symbols extracted`, and only falls back to summing per-module `<a id="MODULE"></a> ... **N** symbols` matches if neither header is present.

```js
function plannedSymbolsFromOverview(overviewText, plannedIds) {
  // ...returns Number(header) | Number(extracted) | sum | null
}
```

The fallback sum is guarded by `found > 0`; if no per-module pattern matches, the function returns `null` so the caller can leave `fullSymbolCoverage` unset rather than reporting a zero. The excerpt does not cover what happens when `plannedIds` is empty besides `found` remaining `0`.

## Analyzer: overall verdict (composition only)

The final `out` object composes the gates listed below; it is not anchored separately because no single closed-list key owns it. The hard-gate list is `[statusCompleted, zeroFailed, allModulePages, noExplosion, noDupPageIds, verifyZero, noRealDuplicateAnchors]`, with `fullSymbolCoverage` appended only when the coverage gate could be evaluated (i.e. when no module page is missing and `plannedSymbols` is not `null`). The console summary prints `overallGate` as `PASS` when every hard gate is `true`, otherwise `FAIL`. Coverage is intentionally an exact-equality check (`covered === plannedSymbols`), not a `>=` check.

## Proxy: output directory and persistence

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

The proxy persists to two files under `OUT_DIR` (default `process.env.TEMP || process.env.TMP || "."`): a JSON summary at `token-proxy-<label>.json` and a JSONL per-call log at `token-proxy-<label>.jsonl`. `ensureOutDir` is a one-line `fs.mkdirSync(OUT_DIR, { recursive: true })` call, used both at startup and before each append. `save` is the summary writer: it stamps `state.updatedAt`, builds a `summary` object that keeps the legacy 2026-07-10 field names (`calls`, `promptTokens`, `completionTokens`, `totalTokens`) alongside cache/reasoning/error counters and the full `callLog`, then writes the pretty-printed JSON to `OUT_JSON`.

```js
function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function save() {
  ensureOutDir();
  state.updatedAt = new Date().toISOString();
  const summary = {
    label: state.label,
    calls: state.calls,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    totalTokens: state.totalTokens,
    cachedPromptTokens: state.cachedPromptTokens,
    reasoningTokens: state.reasoningTokens,
    callsWithoutUsage: state.callsWithoutUsage,
    callsWithError: state.callsWithError,
    updatedAt: state.updatedAt,
    callLog: state.callLog,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
}
```

The proxy startup sequence calls `ensureOutDir()`, then `save()` (to materialise an empty summary), then truncates the JSONL with `fs.writeFileSync(OUT_JSONL, "")` so a fresh label run starts clean.

## Proxy: usage normalization

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage -->

The proxy normalises provider-specific usage shapes into a stable `NormalizedUsage` record. `num` is the defensive numeric helper: it returns the value unchanged when it is a finite `number` and `null` otherwise, so a `string` or `NaN` from a provider never poisons the totals.

```js
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  // ...
}
```

`normalizeUsage` first rejects non-objects with `null`. For each numeric field it tries several provider spellings with `num(...) ?? num(...) ?? 0` (or `?? null` for the optional cache/reasoning fields) and falls back to a derived value for `totalTokens` (`promptTokens + completionTokens`) when the provider omits it. The optional fields use a richer chain — for example, cached prompt tokens are read from `prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, `cached_tokens`, or `prompt_cache_hit_tokens`, in that order. The original provider object is preserved on `raw` for downstream inspection. The excerpt does not exhaustively cover all field paths the function tolerates, so other provider spellings are possible.

## Proxy: body inspection helpers

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

The proxy pulls `usage` and any embedded error from a fully buffered upstream response. `extractUsageFromBody` switches on the `isStream` flag: in the non-streaming branch it `JSON.parse`s the whole body and returns `{ usage, parseError, bodyError }`; in the streaming branch it splits on newlines, matches `^data:\s*(\{.*\})\s*$`, parses each chunk, and accumulates the last non-null `usage` plus the first `bodyError` it finds. Parsing errors on individual SSE chunks are swallowed silently (the comment in the source reads `/* ignore partial SSE chunks */`); a top-level `JSON.parse` failure on a non-streaming body sets `parseError` to `String(e?.message ?? e)` and leaves `usage` and `bodyError` as `null`.

```js
function extractUsageFromBody(buf, isStream) {
  const text = buf.toString("utf8");
  try {
    if (!isStream) {
      const j = JSON.parse(text);
      return { usage: j.usage ?? null, parseError: null, bodyError: extractBodyError(j) };
    }
    // ...SSE branch returns { usage, parseError: null, bodyError }
  } catch (e) {
    return { usage: null, parseError: String(e?.message ?? e), bodyError: null };
  }
}
```

`extractBodyError` pulls a human-readable error string from a parsed JSON object: a bare `j.error` string is returned as-is, an object `j.error` is reduced to `j.error.message ?? j.error.code ?? JSON.stringify(j.error)`, and `{ message, type: "error" }` is recognised as an OpenAI-style error envelope. Anything else returns `null`.

`peekRequestMeta` runs on the inbound request body. When the body is non-empty and parses, it returns `{ model, stream, bodyBuf: <rewritten or original>, isStream }`. If the caller set `stream: true`, the function rewrites the body to add `stream_options.include_usage = true` (a request-side flag that asks the provider to emit a final usage-bearing SSE chunk), and returns the rewritten buffer so the upstream sees the modified payload. An empty body or a `JSON.parse` failure both fall through to `{ model: null, stream: false, bodyBuf, isStream: false }`.

## Proxy: per-call recording

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`recordCall` is the single mutator that advances `state` for a finished upstream call. It increments `state.calls`, appends to `state.callLog`, bumps `state.callsWithError` when `record.error` is set, and when `record.usage` is present it adds `promptTokens`/`completionTokens`/`totalTokens` to the cumulative totals and adds the cache/reasoning tokens only when the per-call values are not `null`. The "missing usage" counter has an explicit exception path: when `record.usage` is `null` but the call also has no error, `state.callsWithoutUsage` is only incremented if `record.ok` is truthy, so a transport error with a missing `usage` does not double-count as a no-usage call.

```js
function recordCall(record) {
  state.calls += 1;
  state.callLog.push(record);
  if (record.error) state.callsWithError += 1;
  if (record.usage) {
    // ...adds to cumulative totals
  } else if (!record.error || record.ok) {
    if (record.ok) state.callsWithoutUsage += 1;
  }
  ensureOutDir();
  fs.appendFileSync(OUT_JSONL, JSON.stringify(record) + "\n");
  save();
  // ...logs a one-line summary
}
```

After mutating state, the function appends a single JSON line to `OUT_JSONL`, calls `save()` to refresh the summary JSON, and prints a one-line console summary in one of three shapes: an `ERROR` line when `record.error` is set, a usage line with optional `cache=` / `reasoning=` suffixes when `record.usage` is present, or a `NO USAGE` line otherwise. The excerpt does not show the `extractUsageFromBody` return-shape handling inside the HTTP handler, but the visible `recordCall` invocation passes `error = bodyError ?? parseError ?? (!transportOk ? "upstream HTTP N" : null)`, which makes `bodyError` and `parseError` the documented error sources on the normal path.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
