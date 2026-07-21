# Semantic product-flow handoff

Date: 2026-07-18

Status: comparison complete; roadmap decision recorded; implementation not
started

Next owner: a fresh external executor working uncommitted and unpushed

## Objective

Continue from the completed LiveWiki R9 hardening and the blind OpenWiki
comparison. The next quality objective is to preserve LiveWiki's factual
accuracy, validation, efficiency, and source traceability while adding a clear
semantic explanation of how a product/application/repository works across
components.

This is not a request for more file trees, import graphs, or automatic class
diagrams. Agents now, and humans through Phase 7 later, must be able to see the
principal workflow, communication boundaries, state movement, outputs, and
failure/recovery behavior.

## Read first

1. `AGENTS.md`
2. `VISION.md`, especially the two-content-layer direction
3. `SPEC.md`, especially deterministic diagrams and Phase 7
4. `docs/ROADMAP.md`, section "Required product-flow visibility"
5. `docs/benchmarks/2026-07-10-minimax-m3/QUALITY-COMPARISON-R9-OPENWIKI-R1.md`
6. this handoff

All durable work is English. PT-BR is conversation-only. Do not commit or push.

## Work completed

### Stage-4 hardening through R9

The current uncommitted patch contains the R2–R9 repair/validation hardening:

- length-preserving TODO/TBD diagnostics with correct CRLF line offsets and
  bounded offending excerpts;
- actionable unclosed-Markdown diagnostics with construct type, opening line,
  exact delimiter length, and distinct CommonMark closing rules for fences and
  inline code;
- neutralization of copyable untrusted `lw:*` control comments in repair
  prompts, including message and action branches;
- bounded safe-fence handling for pathological backtick/tilde runs;
- removal of the copyable zero-key fake anchor marker;
- explicit global repair-attempt context and final-slot detection;
- a validated deterministic mechanical fallback only after the final configured
  LLM repair slot, with applied repairs recorded in diagnostics;
- page-opening parsing that permits H2/H3 implementation sections after the
  required opening;
- the narrow `TODO/TBD prose` category-reference exemption without allowing
  real TODO/TBD placeholders; and
- synchronization/removal of stale generated class diagrams before repository-
  wide verification.

The patch adds `packages/core/src/artifact-repair.ts` and extends the closest
artifact, prompt, Markdown-mask, batch-repair, init-overview, and state tests.

### Paid LiveWiki R9 product run

The frozen comparison source was commit
`895d49e258106256c4197a0aa3cdb3d2cc88063f`, using MiniMax-M3 with Stage 2
disabled. R9 completed:

- batch status `completed`;
- 35/35 Stage-4 tasks done, 0 failed, 0 pending;
- 567,518 input + 132,829 output = 700,347 total tokens;
- 57 provider calls, all with usage; two transient 529 responses recovered;
- 38 Markdown pages verified with zero issues;
- the same 38 pages verified with zero issues after re-indexing;
- 148 source files and 578 symbols;
- 1,156 anchors upserted after re-indexing; and
- 0 undocumented symbols after re-indexing.

External local evidence is under:

```text
C:\tmp\livewiki-official-ab-20260716\evidence\livewiki-c1-r9
```

### Blind OpenWiki comparison

LiveWiki R9 and OpenWiki R1 documented the exact same source commit with the
same model. The blind mapping was revealed only after scores were locked:

- Corpus A = OpenWiki R1
- Corpus B = LiveWiki R9

Evaluator A produced the original report and corrected four coordinator-found
method defects. Evaluator B independently audited all twenty tasks and all
twenty-four adversarial claims, corrected five additional reporting errors,
and preserved the corrected result:

| Dimension | OpenWiki R1 | LiveWiki R9 |
|---|---:|---:|
| Factual accuracy | 7 | 8 |
| Useful coverage | 8 | 6 |
| Navigation/findability | 8 | 7 |
| Clarity/non-redundancy | 8 | 4 |
| Traceability | 9 | 9 |
| **Weighted total** | **7.75** | **7.00** |

LiveWiki had zero false claims and zero broken internal links. OpenWiki had one
false claim and three malformed internal links. OpenWiki's 0.75-point advantage
came from topic organization and low duplication, not superior factuality.

Evaluator B's result is outside the repository at:

```text
C:\tmp\livewiki-official-ab-20260716\comparison-r9-openwiki-evaluator\evaluator\EVALUATION-RESULT-V2.md
```

### Roadmap update

`docs/ROADMAP.md` now records a required semantic product-flow layer before
Phase 7. It requires one canonical agent-first artifact set that the human
viewer later renders, including bounded component/data-flow and selected
sequence/state diagrams plus textual fallback.

The roadmap also records that `SPEC.md` currently conflicts with the original
`VISION.md` direction: its blanket exclusion of function-call/sequence diagrams
must be narrowed so automatic mega-call-graphs remain out while bounded,
source-grounded semantic flows are allowed.

## Current validation

Validation run on the current dirty working tree on 2026-07-18, with no provider
or network call:

| Command | Result |
|---|---|
| `pnpm --filter @livewiki/core test -- --run` | 38 files passed; 779 passed, 12 skipped |
| `pnpm --filter @livewiki/cli test -- --run` | 7 files passed; 78 passed |
| `pnpm --filter @livewiki/mcp test -- --run` | 2 files passed; 21 passed |
| `pnpm -r build` | core, CLI, and MCP built successfully |

Total isolated validation: 47 test files, 878 passed, 12 skipped. The skips are
the expected Windows symlink cases on a host without Developer Mode/admin.

An initial `pnpm -r test` coordinator invocation hit its 120-second command
timeout without returning output. This was not recorded as a pass or test
failure. The isolated suites then proved all packages green; CLI alone required
145.4 seconds, explaining why a 120-second aggregate timeout was insufficient.
Use at least a 240-second command timeout for the aggregate suite.

## Problems found and still relevant

### Product/documentation quality

1. Structural output does not yet explain end-to-end behavior. The 11 Mermaid
   files are mostly structure/import/class inventory.
2. Cross-cutting topics are fragmented across module pages instead of collected
   into task-oriented guides.
3. `tasks.md` duplicates 36 prose groups from module pages.
4. Product modules, fixtures, benchmark harnesses, and tooling compete for
   attention in the primary generated surface.
5. Dense graph-neighbor navigation does not guarantee the destination page
   contains the complete answer.
6. The real MCP package works through `@livewiki/mcp`, but the CLI
   `livewiki serve` command remains a stub; documentation must state that
   accurately until the command is implemented.

### Product state

1. Eight legacy deleted-debt rows persisted through the R9 run. Before
   re-indexing they retained old symbol/page values; after re-indexing the same
   open rows remained with `symbol_key` and `wiki_path` null. This did not break
   verify or undocumented coverage, but it is unresolved ledger-state debt.
2. Remote cross-platform CI is still deferred and is not green. Do not start CI
   repair as part of the semantic-flow task.
3. The comparison source is a frozen commit. Do not describe its result as a
   test of future semantic-flow implementation.

### Evaluation process

Evaluator B observed Evaluator A's result file changing during review and froze
a stable snapshot. Future independent evaluators must receive separate immutable
directories and write separate result files from the start.

## Current working tree

The tree is intentionally dirty and shared. Preserve all existing work. At this
handoff the known tracked modifications are:

```text
AGENTS.md
docs/ROADMAP.md
packages/core/src/artifact.test.ts
packages/core/src/artifact.ts
packages/core/src/batch-repair.test.ts
packages/core/src/batch-state.ts
packages/core/src/batch.ts
packages/core/src/init-overview.test.ts
packages/core/src/init.ts
packages/core/src/markdown-mask.test.ts
packages/core/src/markdown-mask.ts
packages/core/src/prompts.test.ts
packages/core/src/prompts.ts
```

Known untracked work includes:

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v21/metrics/
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v21/notes.md
docs/tasks/2026-07-15-local-product-e2e/
packages/core/src/artifact-repair.ts
```

This report and handoff are also new files. Do not revert, clean, commit, or push
anything. Never run `git clean -fdx`.

## Roadmap state

The current order in `docs/ROADMAP.md` is:

1. local agent-assisted product E2E;
2. remaining Phase 6 Lot 6A export-target validation;
3. standalone-provider E2E only with explicit paid-call authorization;
4. cross-platform/GitHub validation after local product flows;
5. semantic product-flow layer for agents before the human viewer; and
6. Phase 7 local viewer and templates rendering the same semantic artifacts.

The quality comparison makes item 5 the necessary product-quality bridge into
item 6.

## Next executor assignment

The next bounded assignment is specification and design alignment, not coding.

1. Re-read the original two-layer direction in `VISION.md` and the current
   deterministic-diagram/Phase-7 wording in `SPEC.md`.
2. Propose the smallest `SPEC.md` amendment that distinguishes:
   - deterministic structural source maps;
   - rejected automatic mega-call-graphs; and
   - approved bounded semantic product flows.
3. Define a generic flow-candidate contract using entry points, commands/routes,
   module/import relationships, configuration, persistence, and external
   boundaries. Do not hardcode LiveWiki topics.
4. Define canonical output paths and how Quickstart, CLI, MCP, export, and Phase
   7 consume the same artifacts.
5. Define Mermaid and prose acceptance: bounded/readable diagram, source-linked
   claims, parser validation, textual fallback, principal flow and critical
   failure/recovery path.
6. Define how `tasks.md` becomes a compact index without duplicating module
   prose and how auxiliary modules are de-emphasized without losing coverage.
7. Stop for maintainer review before changing product code, prompts, tests, or
   generated output.

## Acceptance for the next handoff

- one reviewed design contract, in English;
- explicit resolution of the `VISION.md`/`SPEC.md` diagram-scope conflict;
- no hardcoded repository-specific flows;
- no product code, test, benchmark, provider, CI, commit, or push change;
- existing dirty work preserved byte-for-byte outside the approved docs; and
- a concrete implementation lot that can be assigned separately after
  maintainer approval.
