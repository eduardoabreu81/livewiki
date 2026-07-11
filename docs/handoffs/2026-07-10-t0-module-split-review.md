# T0 module split — independent review

**Date:** 2026-07-10  
**Verdict:** **CHANGES REQUIRED — do not commit or authorize clean v3 yet**

## Summary

The structural splitter itself is substantially improved and the original flat-directory explosion is fixed: true subdirectories and peer leaves are distinguished, flat buckets use deterministic ordinal dual-axis chunks, disabled axes do not loop, atomic over-symbol files remain schedulable, and the unique → split → partition → unique order is present in batch and init.

The T0 is not ready to commit because the executable batch can still violate the new exact-indexed-path partition contract after an accepted refinement, and init now masks malformed configuration. The offline inventory is useful shape evidence but is not yet the full reproducible inventory required to authorize the paid clean run.

## Blocking findings

### P0 — accepted refinement can still drop up to 20% of indexed paths

`SPEC.md` now requires an exact partition of **indexed paths**, but `validateRefinedModules` still accepts any refinement with coverage greater than or equal to 80% (`batch.ts:1007-1008`). After acceptance, `pathsBeforeSplit` is built from the already-reduced refined modules (`batch.ts:340`), and `assertExactPathPartition` compares only against that reduced list (`batch.ts:347`).

Concrete case:

- indexed/heuristic inventory: 10 files;
- refinement returns 8 real files in one legal directory module;
- coverage is exactly 80%, so validation accepts it;
- the peer-fragmentation guard sees no split among the 8 returned files;
- the post-split partition assertion checks those same 8 files and passes;
- 2 indexed files never receive a stage-4 task.

This makes the new SPEC claim and the reported "exact partition" stronger than the actual batch behavior.

Required correction:

1. Validate refinement as an exact partition of the original heuristic/indexed inventory before accepting it: no missing, duplicate, or unknown path.
2. Prefer refinement rejection with a specific checkpoint error followed by heuristic fallback; do not abort an otherwise recoverable run for incomplete refinement.
3. Keep the final pre-stage-4 partition assertion against the original indexed `filePaths`, not against a list derived from the accepted refinement.
4. Add an orchestrator regression where a syntactically valid 80% refinement is rejected and every heuristic file remains represented in the executable plan.

### P1 — init silently ignores malformed config and uses defaults

`loadConfig` is explicitly fail-closed for malformed JSON (`config.ts:149-164`). The new init planning code wraps `loadConfig` and `applyDefaults` in a broad `try/catch` and silently falls back to splitter defaults (`init.ts:283-292`). Missing config does not require this catch because `loadConfig` already returns `{}` when the file does not exist.

Consequences:

- batch rejects malformed config;
- init/`init --plan` silently produces a different default plan;
- the stated init–batch threshold parity is false in precisely the configuration-error case where failing closed matters.

Required correction: remove the broad catch and let malformed/invalid config propagate. Add a regression showing init planning rejects malformed config rather than silently using 12/80.

## Non-blocking but required follow-ups before approval

### P2 — splitter loses aggregate symbol count when the optional map is omitted

`SplitOversizedOptions.symbolCountByPath` is documented as optional, but the rewritten splitter recomputes every module count exclusively from the map. With no map, a small input module with `symbolCount: 4` returns `symbolCount: 0`.

Independent reproduction after build:

```text
input:  { id: auth, paths: [src/a.ts, src/b.ts], symbolCount: 4 }
output: { id: auth, paths: [src/a.ts, src/b.ts], symbolCount: 0 }
```

Production batch/init currently pass the per-path map, so this does not invalidate their inventory, but it is a regression in the exported function and can alter prioritization for other callers. Either preserve the aggregate for unchanged modules and define behavior for oversized modules without per-file counts, or make the per-path map a required precondition when the symbol axis is enabled. Add an assertion to the existing "leaves small modules unchanged" test.

### P2 — refine and terminal-gate behavior lacks orchestration coverage

The new tests call `refinePeerDirectoryFragmentationError` and `assertExactPathPartition` directly, but no changed batch test proves that:

- a fragmented refinement is persisted as `refine_fragmented_peers` and the heuristic plan is used;
- incomplete refinement cannot lose tasks;
- a final partition failure leaves the run terminal before stage-4 calls/writes.

At least the first two need an integration-level batch regression because the defect boundary is the sequencing inside `validateRefinedModules` and `orchestrate`, not the helper in isolation.

### P2 — disabled-axis matrix is incomplete

The tests cover both axes disabled together, but not each independently. Add:

- `maxFiles=0`, symbol cap enabled and enforced;
- file cap enabled, `maxSymbols=0` and file cap enforced.

### Evidence gap — offline inventory is not yet the clean-v3 gate

The inventory demonstrates that the `packages/*` shape no longer creates `src-<filename>` modules. It is not yet sufficient to authorize a **full** clean bootstrap:

- scope is only `packages/*`, not the exact repository snapshot and walker/index inventory that clean v3 will document;
- `modules.json` omits `symbolCount` and per-module cap status, so the claimed symbol-axis result cannot be audited;
- no reproducible command/script or recorded input snapshot is included;
- it does not record the exact-partition/unique-ID assertions as machine-readable pass/fail fields.

Regenerate the inventory from the exact clean-v3 target using the same indexed file set and resolved config as batch. Include module IDs, paths, file count, symbol count, `unsplittable`, resolved limits, exact-partition result, and uniqueness result. This remains offline and does not require an LLM.

## Confirmed correct in this pass

- Pure flat 25-file case produces exactly `12/12/1` with ordinal IDs.
- Filenames are no longer structural groups.
- Mixed leaf/subdirectory handling produces a structural subdirectory plus flat peer chunks.
- Dual-axis greedy packing and atomic over-symbol handling are present.
- `makeUniqueDeterministicIds` preserves `unsplittable` metadata.
- Batch and init use unique → split → partition → unique → ID assertion.
- Path normalization handles repository-style forward slashes and Windows backslashes at the declared boundaries.
- `git diff --check` passed.
- No paid/network LLM call, clean v3, commit, or push was performed.

## Independent validation

```text
pnpm -r build  -> passed (core, CLI, MCP)
pnpm -r test   -> passed
  core         -> 473 passed, 8 skipped
  CLI          -> 42 passed
  MCP          -> 19 passed
```

Green tests do not close the findings above because the missing cases are not represented in the suite.

## Required executor return

Before another review:

1. Fix exact refinement coverage and assert final batch partition against indexed paths.
2. Remove init's malformed-config fallback.
3. Resolve/document the optional symbol-count-map contract.
4. Add the focused and orchestration regressions listed above.
5. Regenerate a reproducible full-target offline inventory.
6. Run full build/tests and stop again without clean v3, commit, or push.

