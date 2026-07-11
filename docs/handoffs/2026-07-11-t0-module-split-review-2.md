# T0 module split — independent review, pass 2

**Date:** 2026-07-11  
**Verdict:** **PASS-WITH-CHANGES**

The core T0 production behavior now satisfies the structural and exact-partition requirements. The previous P0 and P1 code findings are closed. Do not authorize clean v3 yet: the claimed full-target offline inventory is still a synthetic partial walk rather than the inventory and symbol counts used by livewiki's real indexer. A few test/API-contract cleanups should also be completed before committing the complete delivery.

## Closed findings

### Exact 100% refinement partition — closed

`validateRefinedModules` now rejects:

- any unknown path (`refine_unknown_path`);
- any duplicate path (`refine_duplicate_path`);
- any missing indexed path (`refine_incomplete_partition`);
- empty/invalid modules and duplicate IDs;
- peer-directory fragmentation.

Rejection keeps the complete heuristic plan and records the stage-2 diagnostic without aborting the batch. The final pre-stage-4 assertion compares executable modules against the original indexed `filePaths`, not a post-refinement subset.

The new batch integration tests verify heuristic fallback for incomplete, duplicate, and unknown refinement results.

### Init malformed-config fallback — closed in code

The broad catch was removed. `loadConfig` returns `{}` for a missing file and propagates malformed/invalid config, restoring fail-closed behavior and batch/init consistency.

Add one init/CLI regression for this exact call path before commit; the existing config unit test proves `loadConfig`, but not that future init planning will continue propagating the error.

### Structural splitter — closed for production path

Confirmed:

- true subdirectories are distinguished from peer filenames;
- flat 25-file input becomes exact `12/12/1` ordinal chunks;
- dual file/symbol caps and independently disabled axes work;
- atomic over-symbol files remain scheduled and marked `unsplittable`;
- exact path partition and global ID uniqueness gates are in batch and init;
- the full production callers provide `symbolCountByPath` from the index.

## Remaining changes

### 1. Offline inventory is not the real full-target inventory

The new script describes itself as a full-target/index-like inventory, but it does not use livewiki's walker, indexer, parser, or indexed symbol table:

- it scans only `packages/` and `scripts/`;
- its extension list omits `.mjs`;
- the repository contains `.mjs` inputs outside those roots, including the benchmark token proxy that appeared as a module in clean v2;
- it assigns a synthetic count of exactly one symbol per file;
- therefore its `maxSymbolsInModule`, `unsplittableCount`, module count, and exact-partition audit apply only to the synthetic 94-file input, not the clean-v3 indexed inventory.

This is useful as a splitter fixture but must not be labeled the clean-v3 gate.

Before authorizing clean v3, generate the plan in a disposable copy of the exact target using the real index/init planning path and resolved config. Capture the actual indexed paths, AST symbol counts, modules, limits, `unsplittable`, exact-partition assertion, and ID uniqueness. No LLM or paid API is needed.

### 2. The claimed 99% integration test is still 80%

Both incomplete-refinement tests use four of five files. The second test is named `~99%`, but its own fixture is again 4/5 = 80%. Either:

- create 100 indexed files and omit exactly one; or
- rename it as another incomplete-partition case and stop claiming 99% coverage.

The implementation is ratio-independent and appears correct; this is an evidence-accuracy problem, not a discovered runtime failure.

### 3. Optional symbol-count map contract remains incomplete for split output

The new fallback preserves `m.symbolCount` only when the module remains intact. If a module is chunked by `maxFiles` without `symbolCountByPath`, every child still receives `symbolCount: 0` because the aggregate cannot be accurately distributed.

Independent reproduction:

```text
input: 25 paths, module symbolCount=42, no per-path map, maxFiles=12
output: 12/12/1 chunks, each symbolCount=0
```

Production batch/init are safe because they supply the complete per-path map. Before commit, make the exported contract truthful: document that accurate symbol counts for split children require `symbolCountByPath` (and test that behavior), or require the map when symbol-aware child counts are expected. Do not claim the aggregate fallback preserves counts through chunking.

### 4. Add the missing init-path regression

Add a focused test that creates malformed `.livewiki/config.json`, invokes init planning, and asserts failure rather than default 12/80 planning. This protects the exact regression fixed in `init.ts`.

## Independent validation

```text
git diff --check -> passed
pnpm -r build     -> passed (core, CLI, MCP)
pnpm -r test      -> passed
  core            -> 480 passed, 8 skipped
  CLI             -> 42 passed
  MCP             -> 19 passed
```

No paid/network LLM call, clean v3, commit, push, or product-code edit was performed during review.

## Recommendation

The executor should make the four scoped cleanups above, regenerate the real offline plan, rerun build/tests, and stop once more. After that, the T0 code can be committed. Clean v3 remains a separate explicitly authorized step, preferably first with `--no-refine` to isolate the deterministic planner.

