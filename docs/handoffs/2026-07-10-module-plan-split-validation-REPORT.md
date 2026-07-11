# Module plan / split validation report

**Date:** 2026-07-10  
**Scope:** Independent plan validation only. No implementation, commit, push, or paid batch was performed.

## Verdict

**PASS-WITH-CHANGES**

The two-part diagnosis is correct and the deterministic folder-map-first direction is consistent with the product and the four-stage pipeline. T0 should not ship exactly as currently worded, however. The rules need to define mixed directory handling, both size axes, unsplittable files, refinement guardrails, and plan invariants more precisely. The current dirty changes fix the ordering problem (A) but do not fix the direct cause of the one-file explosion (B).

## Diagnosis accuracy

### Finding A — split before global ID uniqueness

Confirmed. At HEAD, splitting a set of colliding `src` modules before global uniqueness gives every child the generic `src-*` prefix. The dirty changes in `batch.ts` and `init.ts` now apply:

1. `makeUniqueDeterministicIds`
2. `splitOversizedModules`
3. `makeUniqueDeterministicIds`
4. `assertUniqueModuleIds`

This is the correct identity order. It makes split prefixes package-aware (`core-src-*`, `cli-src-*`, and so on) and preserves the W uniqueness barrier.

The causal wording should be slightly tightened: A explains the bad global `src-*` identities and aggravates collisions; it does not by itself explain why each peer file became a module. With only A fixed, `packages/core/src` still becomes many `core-src-<filename>` modules.

### Finding B — a filename is treated as structural hierarchy

Confirmed. `splitOneModule` calls `groupPathsByNextSegment`, and every distinct next segment triggers structural recursion. In a flat directory, those segments are leaf filenames, so 25 peer files form 25 groups of one file. The flat chunk branch is reached only when the map has at most one entry, which is the opposite of the common flat-directory case.

This directly contradicts the normative SPEC order: split oversized modules "by subdirectory, else stable file chunks."

### Benchmark evidence

The contaminated v2 artifacts match B:

- 42 Markdown files were present in the sampled `livewiki/` tree.
- Page names include `src-batch-ts.md`, `src-config-ts.md`, `src-hashes-ts.md`, `src-modules-ts.md`, and many `src-*-test-ts.md` pages.
- The status records 47 stage-4 module tasks: 40 done and 7 failed, with run status `completed_with_failures`.
- Stage-2 refinement was rejected for insufficient coverage, so the accepted one-file layout was not an LLM-refined semantic plan; it came from the deterministic path/split path.

This run is useful as failure evidence only. It is not a fair livewiki/OpenWiki quality result and supports no winner claim.

### Why the tests stayed green

Confirmed. The current flat-directory test asserts only:

- more than one result;
- every result has at most 12 files;
- complete path coverage;
- distinct IDs with the expected prefix.

Twenty-five one-file modules satisfy all four assertions. The local test command was green (`modules.test.ts`: 34 tests; the package invocation ran the full core suite: 29 files, 462 passed, 8 skipped), while B remains in the source.

## Plan / rules review

### R1 — never use a peer filename as the sole structural reason

**OK, with an explicit exception.** This is the essential invariant that fixes B. A genuine one-file package/directory module remains valid; what is forbidden is manufacturing a one-file module merely because a leaf filename was returned as a "next segment."

### R2 — identify true subdirectories by remaining depth

**CHANGE.** The intent is correct, but the planner should define this in terms of path components, not filename extensions or names. Under a common directory prefix, a next component is structural only when at least one member has another component after it. Components with no remainder are peer leaf files and belong to the flat bucket.

The rule must also define the one-subdirectory case. If an oversized module contains only one nested directory, the planner should descend without inventing a meaningless sibling split; if it contains that directory plus peer leaf files, it should emit the directory bucket and the flat-leaf bucket.

### R3 — peer leaf files form one flat bucket

**OK.** The bucket should be scoped to one parent directory, sorted by normalized repository path, and then passed through the two-axis size limiter. In a mixed tree such as flat `packages/core/src/*.ts` plus `packages/core/src/llm/*`, the expected result is:

- one `llm` structural bucket, recursively limited if necessary; and
- one flat peer-file bucket, chunked if necessary.

No leaf filename should first become its own structural group.

### R4 — stable chunks for oversized buckets

**CHANGE.** Sorting and slicing only by `maxFiles` is insufficient because `maxModuleSymbols` is an independent trigger. A flat module can have fewer than `maxFiles` but more than `maxSymbols`; slicing only by file count can return one still-oversized chunk. The rule should require deterministic packing that respects both enabled limits where possible.

Required semantics:

- `0` disables only that axis and must be normalized before any loop or chunk calculation.
- A chunk closes before adding a file that would exceed either enabled limit, unless the chunk is empty.
- A single file whose symbol count alone exceeds `maxModuleSymbols` is atomic and cannot be solved by path-level splitting. The plan must retain it as one module and mark it explicitly as `unsplittable`/over-limit (or fail planning by an intentional policy); it must not loop, silently claim the cap was met, or drop the file.
- Every non-atomic emitted chunk must satisfy both enabled limits.

The ID choice (`parent-01` versus first-file stem) is a product decision. Either can be deterministic, but tests must cover insertion/reordering behavior and exact path-to-ID mapping, not only uniqueness.

### R5 — unique IDs before and after splitting

**OK.** This is the correct order and should be shared by init planning and batch. The pre-split pass gives the parent a globally meaningful identity; the post-split pass resolves child collisions; the assertion remains the terminal defense before task creation or writes.

### R6 — tests/fixtures as separate modules

**CHANGE / DEFER.** This is not required to fix A or B and is not specified by the current SPEC. Filename-pattern semantics are a separate content-policy decision, particularly for colocated tests that explain production behavior. Keep tests and fixtures governed by the same structural rules in T0. If separation is later added, make it explicit and configurable, define fixtures independently from tests, and do not make it an implicit filename heuristic inside the structural splitter.

### R7 — optional LLM refinement on the post-rules list

**CHANGE.** As written, coverage and ID uniqueness are not enough. A refinement can preserve 100% coverage while splitting every deterministic flat bucket into one-file modules, or merge chunks back over the hard limits.

The safer stage-2 order is:

1. build the deterministic folder map / atomic structural buckets;
2. optionally let the LLM rename or regroup legal structural units;
3. validate an exact path partition, legal boundaries, non-empty modules, and refinement anti-fragmentation constraints;
4. apply global uniqueness;
5. apply the final hard subdirectory/chunk limiter;
6. reapply uniqueness and assert all plan invariants;
7. prioritize and execute stage 4.

If refinement is intentionally placed after final chunking, the hard validation and limiter must run again afterward. "Soft semantics, hard structure" should be the rule: refinement must not recreate filename-derived units or bypass completion budgets.

### R8 — dumpable no-LLM plan with reasons

**CHANGE, building on the existing surface.** `livewiki init --plan` already exposes `modules`, `edges`, `ordered`, totals, paths in JSON, and per-module file/symbol counts. T1 should extend this surface rather than introduce a competing command.

Current gaps:

- no `reason`/provenance is recorded;
- a single reason enum is too weak for a subdirectory that is later chunked; use provenance such as `origin`, `splitReasons[]`, and parent ID;
- init planning uses its private `buildPlan` and default split options, while batch resolves config and can accept LLM refinement, so the displayed plan is not necessarily the plan batch will execute;
- the command is documented as "no writes," but `runInit` creates directories, updates `.gitignore`, and indexes before returning the plan. Decide whether derived `.livewiki/` scan writes are allowed, but do not claim a fully non-mutating plan while product files or `.gitignore` can change.

The final plan validator should assert at least:

- every indexed input path appears exactly once (unless overlap becomes an explicit future feature);
- no unknown, missing, or duplicate path exists;
- modules are non-empty and IDs are normalized and globally unique;
- paths use the canonical forward-slash form and are deterministically sorted;
- symbol/file totals are recomputed rather than trusted from refinement;
- every enabled cap is met, except explicitly reported atomic unsplittable cases;
- identical logical input produces the same path-to-module mapping regardless of input enumeration order.

## Spec alignment

The proposal is aligned with the central SPEC and VISION constraints:

- Stage 2 is deterministic directory/import-graph identification with optional LLM refinement.
- Oversized modules are split by true subdirectory, otherwise stable file chunks.
- IDs are deterministic, stable, globally unique slugs.
- Stage 4 receives bounded structural units for verifiable layer-A pages.
- An inspectable no-LLM plan supports the agent-first, economical design.

The main alignment correction is R7: the current SPEC places optional refinement inside module identification and requires oversized splitting before stage 4. Refinement cannot be the last authority over hard structure. A final deterministic limiter and validator must remain between refinement and prioritization/execution.

The cleanest T0 input is the existing module list after heuristic identification and optional accepted refinement, because it minimizes change to the established pipeline. The splitter should treat each module's paths as a path forest and enforce the folder/leaf rules. A repository-wide pure `planModules(paths, options)` can become the T2 architecture once T0 behavior is proven and can be shared without changing semantics.

## Test gaps

At minimum, T0 needs regressions for:

1. **Pure flat directory:** 25 files, `maxFiles=12` produces exactly 3 modules with sizes `12, 12, 1`, full exact coverage, and no filename-per-module explosion.
2. **Mixed leaves plus subdirectory:** peer leaves become chunk(s), `llm/*` becomes a structural module, and all paths appear exactly once.
3. **Multiple true subdirectories:** grouping is by directory, with recursive limiting inside an oversized directory.
4. **Symbol-only overflow:** fewer than `maxFiles` but more than `maxSymbols` produces multiple deterministic chunks that respect the symbol cap.
5. **Atomic symbol overflow:** one file over `maxSymbols` follows the documented unsplittable/error policy without looping or pretending the cap is met.
6. **Disabled axes:** `maxFiles=0`, `maxSymbols=0`, and each axis disabled independently. The exported splitter/planner must normalize zero too, not only the batch caller.
7. **One-file legitimate module:** a package/directory containing one file remains valid and is not rejected by R1.
8. **Determinism:** shuffled input yields the same path-to-ID mapping, chunk membership, counts, and provenance.
9. **Identity order:** colliding `src` parents become `core-src`/`cli-src` before child IDs are created, and the post-split set remains unique.
10. **Chunk ID collisions:** equal first stems/different extensions and normalized-slug collisions remain deterministic and unique.
11. **Partition validation:** missing, unknown, and duplicated/overlapping paths are rejected; aggregate file and symbol counts match the source inventory.
12. **Canonical paths:** forward-slash paths work on Windows; backslashes are either normalized at one declared boundary or rejected clearly.
13. **Refinement guardrails:** full-coverage one-file explosion and a merge over hard caps cannot become the executable plan.
14. **Init/batch parity:** with defaults, custom limits, and disabled limits, the offline final deterministic plan matches the plan batch uses after the same accepted/rejected refinement state.
15. **Repository-shape fixture:** the livewiki-like `packages/core/src` inventory has a bounded number of flat chunks plus `llm`, not one page per `.ts` file.

The existing test named "chunks a flat oversized directory" must assert exact chunk count and sizes; its current inequalities explicitly permit the bug.

## Recommended ship order

### T0 — required before any paid clean v3

1. Land the unique → split → unique order in both batch and init.
2. Fix true-directory versus peer-leaf classification and mixed-tree bucketing.
3. Define and implement dual-axis chunking, disabled-axis normalization, and the atomic over-symbol policy.
4. Add the targeted regressions above, especially exact `12/12/1`, mixed tree, symbol-only overflow, zero thresholds, determinism, and exact partition validation.
5. Run focused tests, the full repository validation workflow, and an offline livewiki repository inventory.
6. Inspect the offline inventory for exact coverage, unique IDs, bounded sizes, and absence of systematic filename-derived one-file modules.

T0 plus a sane offline inventory is sufficient to authorize a full clean v3. A paid `--only core-src` smoke is optional and is not a substitute for the deterministic tests; it need not block the full run.

### T1 — plan surface hardening

Extend the existing `init --plan --json` output with provenance, validation results, cap/unsplittable fields, and resolved options. Make it use the same final deterministic planning path and configuration as batch. Clarify or fix its mutation semantics.

T1 is highly desirable before general release, but the CLI polish itself need not block the paid v3 if T0 tests and an offline inventory obtained from the same planner are reviewed first.

### T2 — first-class planner

Extract a pure, shared planner and validator used by init, batch, diagrams/overview, and plan output. Document its ordered rules in SPEC after T0 behavior is empirically accepted. Preserve the optional refinement boundary without allowing refinement to violate hard structural invariants.

Do not mix R6 test/fixture policy into T0 or broaden this work into Phases 6/7.

## Open questions for Eduardo

1. Which chunk-ID policy should be normative: ordinal (`core-src-01`) or content-derived (`core-src-batch`/first stem)? Should stability be defined as deterministic output for a snapshot, or minimal ID churn after inserting an early-sorting file?
2. What should happen when one source file alone exceeds `maxModuleSymbols`: emit a marked atomic over-limit module and let bounded context handle it, fail planning, or introduce future symbol-range modules?
3. Should colocated `*.test.*` files remain with production peers by default in T0 (recommended), or should a later explicit config create a separate tests layer? How should fixtures differ?
4. For the clean v3 benchmark, should stage-2 refinement remain enabled as the product default, or should `--no-refine` be used once to isolate and validate the deterministic structural planner? If enabled, what anti-fragmentation rule should reject an otherwise full-coverage one-file refinement?
5. Does "plan without writes" permit rebuilding the derived `.livewiki/index.db`, or must plan become fully read-only after a separate scan? In either case, may it ever modify `.gitignore` or create `livewiki/` directories? The current behavior and documentation disagree.
6. Must a file belong to exactly one module? This report recommends an exact partition because duplicate coverage increases cost and creates ambiguous ownership, but the invariant should be made explicit in SPEC.
7. Is T0 offline inventory enough to authorize the paid full clean v3 (recommended), or do you want the optional `core-src` LLM smoke first?

## Validation performed

- Read `AGENTS.md`, `VISION.md`, the normative batch section of `SPEC.md`, the module-plan handoff, the earlier Batch Resilience U-X handoff, and the U-X plan.
- Inspected `modules.ts`, the batch/init planning order and dirty diff, config threshold semantics, `modules.test.ts`, and the existing init plan surface.
- Sampled the v2 generated page inventory and parsed its batch status.
- Ran `pnpm --filter @livewiki/core test -- src/modules.test.ts` with no API/network LLM call. Due the package's Vitest argument handling, this ran the full core suite: 29 test files passed, 462 tests passed, 8 skipped; `modules.test.ts` itself passed all 34 tests.
- Did not implement code, run a paid batch, access secrets, commit, push, or compare a winner against OpenWiki.
