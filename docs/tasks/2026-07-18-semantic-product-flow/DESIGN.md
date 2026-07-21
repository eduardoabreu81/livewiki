# Semantic product-flow layer — design contract

Date: 2026-07-18

Status: implemented 2026-07-18 (lots S1–S5, R10 corpus + dual blind
evaluation). Amended 2026-07-19: closed list is an upper bound with
explicit anchor groups, indexes are title+link only — see amendments in
§6 and §8. Acceptance-closure follow-up (defects found by external
review): `docs/tasks/2026-07-19-r10-1-acceptance-fixes/CONTRACT.md`.

Requested by: `docs/tasks/2026-07-18-semantic-product-flow/HANDOFF.md`
("specification and design alignment, not coding").

Evidence base: `docs/benchmarks/2026-07-10-minimax-m3/QUALITY-COMPARISON-R9-OPENWIKI-R1.md`
(LiveWiki 7.00 vs OpenWiki 7.75: accuracy 8/7 won, traceability 9/9 tied;
coverage 6/8, navigation 7/8, clarity 4/8 lost).

## 1. Problem statement

The R2–R9 series made stage-4 output mechanically reliable. The blind
comparison shows the remaining gap is editorial and semantic, not structural:

- **Useful coverage (6 vs 8):** cross-cutting behavior (how a workflow runs
  end to end across modules) is fragmented over per-module pages. OpenWiki
  collects it into topic pages.
- **Clarity (4 vs 8):** 36 exact duplicate prose groups, mainly `tasks.md`
  copying module-page bullets verbatim; auxiliary modules (fixtures,
  benchmarks, tooling) compete with product modules on primary surfaces.
- **Navigation (7 vs 8):** same median hop count (2), but the destination
  page less often contains the complete answer.

Root cause: `VISION.md` always specified two layers — structural map for
agents, then a narrative ("map first, then a story") — and the
implementation delivered the map but not the story. `SPEC.md` Phase 3
currently says "Function call-graph and sequence diagrams are OUT", a
blanket exclusion that blocks the narrative layer and conflicts with
`VISION.md` ("sequence diagrams … remain an optional batch extra" and
"documentation-focused impact neighborhoods may be implemented natively").

This contract resolves the conflict and specifies the smallest mechanism
that closes the three gaps without weakening any existing strength
(validation, anchors, repair, accounting, bounded context, traceability).

## 2. Resolution of the VISION↔SPEC diagram conflict

Three artifact classes are distinguished from now on:

1. **Deterministic structural source maps** — `structure.mmd`,
   `modules.mmd`, `diagrams/<slug>.classes.mmd`. Generated without LLM from
   the index; `owner: generated`; never age; retained unchanged. They answer
   *what exists* and *what depends on what*. They do **not** count as
   semantic-flow coverage.
2. **Rejected automatic mega-call-graphs** — whole-repository function
   call-graphs, edge-dense graphs, dead-code analysis, graph query
   languages. Still OUT (unchanged, per VISION "Out of designed scope").
3. **Approved bounded semantic product flows** — a small, capped set of
   cross-module flow artifacts (page + Mermaid diagram + companion prose),
   LLM-synthesized as batch artifacts from bounded, source-anchored context,
   passing the same artifact/repair/verify gates as module pages.

`VISION.md` needs **no change**: its out-of-scope text already admits
bounded sequence diagrams as batch extras. The conflict is SPEC-side only.

### Proposed SPEC.md amendments (verbatim)

**A. Phase 3 "Deterministic diagrams" paragraph — replace the sentence:**

> Function call-graph and sequence diagrams are OUT (see "Out of designed
> scope" in VISION).

**with:**

> These deterministic diagrams are structural source maps: they answer what
> exists and what depends on what, and by themselves they do not explain
> behavior. Automatic whole-repository function call-graphs and edge-dense
> mega-diagrams remain OUT (see "Out of designed scope" in VISION). A small
> number of bounded, source-anchored semantic product-flow artifacts —
> including component/data-flow, sequence, or state diagrams synthesized as
> gated batch artifacts — are IN when they satisfy §"Semantic product-flow
> layer".

**B. New SPEC section "Semantic product-flow layer"** (insert after
§"Deterministic navigation layer") — full text in §3–§9 of this document;
the SPEC version is the condensed contract in §10.

**C. Quickstart outline, item 2 — replace:**

> 2. `## Choose a path`, linking to `architecture/overview.md` and
>    `tasks.md`;

**with:**

> 2. `## Choose a path`, linking to `architecture/overview.md`, `tasks.md`,
>    and — when at least one accepted flow page exists — `flows/index.md`;

**D. `tasks.md` paragraph — replace:**

> When an accepted module page has a `When to use this page` bullet list,
> Tasks reuses those bullets verbatim. Otherwise it shows the deterministic
> module display title.

**with:**

> When an accepted module page exists, Tasks shows its linked display title
> followed by the page's responsibility sentence (the first prose paragraph
> after the H1). Tasks never copies the `When to use this page` bullet list
> or any other module-page prose. Otherwise it shows the deterministic
> module display title. Auxiliary sections (fixtures, tooling/benchmarks,
> docs) list compact entries — title and link only, no purpose sentence.

**E. Batch pipeline heading and end-of-run list** — "4 stages" becomes
"5 stages"; the "At the end" list gains `flows/index.md`. Stage 5 is
specified in §5.

**F. Target-repo layout** — the layout tree gains:

```text
│   ├── flows/
│   │   ├── index.md                # deterministic "How it works" hub
│   │   └── <slug>.md               # one bounded flow page per candidate
│   ├── diagrams/
│   │   └── flow-<slug>.mmd         # companion diagram per flow page
```

`VISION.md` "Out of designed scope" keeps its current wording; no edit.

## 3. Artifact model and canonical layout

One canonical artifact set, agent-first, human-next. No separate truths.

| Artifact | Path | Author | Owner | Anchors |
|---|---|---|---|---|
| Flow page | `livewiki/flows/<slug>.md` | LLM (stage 5, gated) | `generated` | yes (closed list, §6) |
| Flow diagram | `livewiki/diagrams/flow-<slug>.mmd` | LLM (same task) | `generated` | no (Mermaid) |
| Flows hub | `livewiki/flows/index.md` | deterministic | `generated` | no |

Rules:

- `<slug>` is `moduleSlug(flowTitleSeed)` — the existing deterministic
  slugifier; slugs are unique per run (assert like module IDs).
- Flow diagrams live under `livewiki/diagrams/` with the `flow-` prefix so
  `syncClassDiagrams` (which owns `*.classes.mmd` and preserves other files)
  never removes them, and export flattening
  (`flows/x.md → flows-x.md`, `diagrams/flow-x.mmd → diagrams-flow-x.md`)
  cannot collide.
- The flow page references its diagram with the existing placeholder
  convention: a ` ```mermaid ` fence containing exactly
  `%% livewiki/diagrams/flow-<slug>.mmd`. Export already rewrites this
  pattern (`replaceMermaidPlaceholder`); `verify` already link-checks it.
- `flows/index.md` is generated deterministically after stage 5
  (existence-gated links, same mechanism as `tasks.md`) and is regenerated
  by `init` (empty state: hub absent, quickstart omits the link) and by the
  post-stage-5 navigation pass.
- Every artifact is under `livewiki/` → safe-io allowlist, manifest
  snapshot hash, export discovery, verify walk, and MCP search/read all
  work with **zero consumer changes**.

## 4. Flow-candidate contract (generic detection)

Candidates are detected **deterministically** from index facts. No
repository-specific names anywhere in the product; the same rules applied
to the livewiki repo itself must produce its flows (dogfood property).

### Signals

All signals are computed per module from existing data (`files`, `symbols`,
`imports` extraction, `ModuleGraphEdge`, `classifyModuleRole`):

- **Entry** — the module has in-degree 0 in the module import graph, or
  contains a file matching entry patterns (gitignore-style, configurable;
  generic defaults: `bin/**`, `cmd/**`, `**/cli.*`, `**/main.*`,
  `**/server.*`, `**/app.*`).
- **Persistence** — either evidence channel is sufficient: (G1) a file path
  matches persistence patterns (defaults: `**/db.*`, `**/database/**`,
  `**/store/**`, `**/state/**`, `**/persistence/**`, `**/repository/**`),
  or (G2) any still-external import specifier of the module's files matches
  `flowSignals.persistenceImportPatterns` (gitignore-style patterns over
  specifier strings, combined semantics, matched patterns recorded as
  candidate evidence; default empty — no built-in package-name guessing).
- **External boundary** — the module has non-relative, non-`node:` imports
  (third-party packages: provider APIs, protocols, frameworks). The
  synthesis step names the actual boundary from source evidence.
- **Sink/output** — out-degree 0 in the module graph.
- **Product role** — `classifyModuleRole === "product"`.

Pattern sets live in config as `flowSignals?: { entryPatterns?,
persistencePatterns?, persistenceImportPatterns? }` following the exact
`PathRoleConfig` precedent (defaults replace per category). This is
configuration, not hardcoding: the defaults name no product, and any repo
can override them.

### Candidate construction

A candidate is a bounded root→sink walk in the module import graph that
starts at an entry module and crosses ≥1 persistence or external-boundary
module. Deterministic enumeration (sorted module IDs, sorted edges),
ranked by: product-role module count in path, then path centrality (how
many root→sink paths cross it), then slug. The top `maxFlows` candidates
(default 4; `0` disables stage 5) survive. A repo with no qualifying walk
produces zero candidates — stage 5 completes with zero tasks, no `flows/`
directory, and no quickstart link. That is a valid outcome, not a failure.

Each candidate carries a **seed key set**: the active symbol keys of the
entry symbols, the boundary-crossing symbols, and the sink symbols along
its walk, capped at `flowMaxAnchors` (default 25). The seed set is the
closed key list for synthesis; the model may use fewer keys, never more —
identical discipline to stage 4.

## 5. Generation pipeline integration (stage 5)

The batch pipeline gains a stage 5, **flows**, reusing the stage-4
machinery shape end to end:

- **Task model**: one task per candidate, `batch_tasks.stage = 5`,
  `target = "flow:<slug>"`. `runOnly` accepts `flow:<slug>`. Resumable via
  the same checkpoint (`usageHistory`, `diagnosticHistory`, append-only,
  monotonic across resume/`--only`).
- **Context builder** (new, mirrors `buildModuleDocContext`): participating
  modules' accepted-page responsibility sentences and `How it fits`
  paragraphs (bounded), the seed symbols table, and fair-share truncated
  source of the boundary files — never the whole repository. Context is
  neutralized with the same `neutralizeUntrustedControlMarkers` rules.
- **Prompt builders**: `buildStage5Prompt` / `buildStage5RepairPrompt` in
  `prompts.ts`, same system-prompt discipline (closed keys, literal
  signatures, exception-branch honesty, explicit rejection list) plus the
  flow opening contract (§6) and the diagram budget. Repair prompts embed
  the prior candidate under the same char budget and per-code ACTION
  directives.
- **Attempt loop**: identical budget semantics — `1 + maxRepairAttempts`
  consuming slots, `maxIncompleteRetries` non-consuming, stop-reason gate
  (`length`/`incomplete` → fresh initial), timeout terminal for the task.
- **Write**: `tryWriteAndVerify` as-is — transactional, rollback on verify
  error, `rollback_failed` aborts the run, manual blocks in a previously
  human-edited flow page preserved (`owner: mixed` honored; `owner: human`
  refused before any LLM call).
- **Failure policy**: a failed flow task marks `failed` once and the run
  continues; flow failures feed the same circuit breaker but never undo
  stage-4 module work. Run with failed flows ends
  `completed_with_failures` (exit 1).
- **Order**: stage 5 runs after stage 4 and before
  `regenerateArchitectureOverview`; the navigation pass is extended to also
  emit `flows/index.md` and the gated quickstart link (§7).
- **Empty pipeline guard**: extended — `ordered.length > 0` with all tasks
  (stage 4 + 5) undone is still `completed_with_failures`; zero flow
  candidates is explicitly *not* an empty pipeline.
- **Accounting**: tokens-first reporting includes stage 5 per task; no new
  accounting code, the checkpoint shape is reused.

## 6. Validation and acceptance rules

### Flow page structure (validator-enforced)

```markdown
---
title: <human-meaningful flow title>
owner: generated
anchors: [<closed-list keys, each exactly once>]
updated: <date>
---
# <flow title>

<One sentence: what end-to-end behavior this page explains.>

## Purpose
<short prose: what starts the flow and what it produces>

## Ordered flow
1. <step> — ...   (numbered steps; the textual fallback of the diagram)

## Diagram
```mermaid
%% livewiki/diagrams/flow-<slug>.mmd
```

## Invariants
<bullets or prose: what must hold at each stage>

## Failure and recovery
<prose: retry/rollback/recovery visible in the cited source; if the
supplied source shows no failure path, the page must say so explicitly>

## Related pages
<links to participating module pages and flows/index.md>
```

Section `lw:anchors` markers appear in `Purpose`, `Ordered flow`, and
`Failure and recovery`. **Amendment (2026-07-18, R10 evidence):** the flow
closed list is an **upper bound, not an assignment** — a flow page cites
only the keys it actually uses ("may use fewer, never more", §4). Every
cited key still appears exactly once in frontmatter and exactly once
across section markers (a key on only one side is `missing_closed_key`);
`anchor_outside_closed_list` and `duplicate_anchor` are unchanged. The
original text here required full dual completeness against the seed set,
but the first real MiniMax-M3 stage-5 run showed a 25-key cross-module
flow could not converge within the bounded slots; the relaxed rule keeps
the anti-hallucination guarantee (every citation is a real, listed key)
without forcing padding citations. The opening (H1 → responsibility
sentence → `## Purpose`) is checked by the same `missing_page_opening`
mechanism, parameterized by page kind.

### Validator generalization

`validateStage4Artifact` is generalized to
`validateArtifact(content, closedKeyList, kind, context)` where
`kind: "module" | "flow"` selects the opening contract and per-kind rules;
all kind-agnostic checks (frontmatter, owner, closed list, duplicates,
empty sections, unclosed markdown, TODO ban, manual-block ban) are shared.
New codes: `invalid_flow_diagram` (companion `.mmd` fails the Mermaid
parser pre-write) and `flow_diagram_too_large` (budget exceeded). Both are
repairable by prompt; the mechanical fallback stays fail-closed on unknown
codes (returns `null` → ordinary bounded-loop behavior), so no
`artifact-repair.ts` change is required initially.

### Diagram budget and honesty

- Per diagram: ≤ `flowMaxDiagramNodes` (default 12) nodes and ≤
  `flowMaxDiagramEdges` (default 20) edges. Several focused flows over one
  mega-diagram — enforced, not advised.
- The diagram is parsed with the real Mermaid parser before write
  (`validateMermaidSyntax` at artifact level, not only at verify level).
- The `Ordered flow` numbered list restates the diagram in prose — the
  required textual fallback for agents and humans without Mermaid.
- Every behavioral claim cites the closed-key anchors of the symbols whose
  source supports it; the existing literal-signature and exception-branch
  prompt rules apply unchanged.
- New config keys follow the `LivewikiConfig` pattern (optional field,
  `CONFIG_DEFAULTS`, `applyDefaults`, strict `validateConfigShape`):
  `maxFlows` (4), `flowMaxAnchors` (25), `flowMaxDiagramNodes` (12),
  `flowMaxDiagramEdges` (20), `flowSignals` (pattern overrides).

### Verify (repository-wide)

No change needed: flow pages are `.md` under `livewiki/` (anchors, internal
links, manual blocks checked) and flow diagrams are `.mmd`
(`invalid_mermaid_diagram`). `flows/index.md` and `tasks.md` carry no
anchors and stay out of the closed-key denominator.

## 7. Consumption contract (one artifact set, all surfaces)

| Surface | Consumption | Change required |
|---|---|---|
| Quickstart | `## Choose a path` links `flows/index.md` when ≥1 flow page exists (existence-gated, like module links) | `generateQuickstart` gains the gated link |
| `flows/index.md` | "How it works" hub: one entry per existing flow page — flow title, one-sentence purpose (first paragraph), link | new deterministic generator (mirrors `generateTasksPage`) |
| `tasks.md` | stays a module index; flows are **not** listed there (avoids re-bloating) | §8 only |
| Architecture overview | module cards unchanged; overview gains one link to `flows/index.md` when present | `generateArchitectureOverview` gated link |
| Module `## Navigate` | block gains at most one "Flow: <title>" link when the module participates in an existing flow page | `buildNavigateBlock` extension (still ≤3 related modules) |
| CLI | no new command; flows appear in `batch status` as stage-5 tasks; `verify` covers them | none beyond stage 5 |
| MCP | `livewiki_read` / `livewiki_search` see flow pages automatically; `livewiki_quickstart` returns the updated quickstart | none |
| Export | `.md`/`.mmd` discovery, flattening, placeholder rewrite, link rewrite — all existing | smoke-check only |
| Phase 7 viewer | renders `flows/` pages and `.mmd` like any other artifact | none (consumes same files) |
| Manifest | snapshot hash covers `flows/` automatically | none |

## 8. `tasks.md` deduplication and auxiliary de-emphasis

Mechanism (deterministic, no LLM):

- ~~`loadModulePresentations` gains extraction of the page's **responsibility
  sentence**~~ **Amendment (2026-07-18, R10 audit):** the responsibility
  sentence was dropped again before the corpus was frozen — see below.
- `generateTasksPage` emits, per module, `### [Display title](<id>.md)`
  **and nothing more** — no bullets, no sentence, no copied prose. The R10
  masked-corpus audit (same ≥120-char methodology as the R9 audit) showed
  the 36 groups reduced to 14, but 12 of those 14 were exactly the copied
  responsibility/purpose sentences this section had introduced; verbatim
  copies are duplicate prose under any wording. Auxiliary sections are
  compact link lists. `flows/index.md` follows the same rule (title + link,
  no purpose sentence). Final R10 count: **1** residual group (a shared
  `## Navigate` boilerplate line between two module pages — inherent
  wayfinding, not content duplication).
- Unavailable pages keep the current "Page unavailable" honest behavior.

This is a regeneration-behavior change; the next `init`/batch navigation
pass rewrites `tasks.md` in the new shape. No migration of user content is
involved (`tasks.md` is pure `owner: generated`).

## 9. Debt, ownership, idempotence

- Flow-page anchors enter the anchor ledger like any page: a code change
  to an anchored symbol raises `changed|moved|deleted` debt on the flow
  page — **semantic artifacts get deterministic staleness detection for
  free**, payable via `update`/MCP or the next batch run. This is the key
  property competitors do not have for narrative content.
- `owner: human` edits inside flow pages are preserved by the existing
  manual-block multiset mechanism; a human can adopt a flow page
  (`owner: human`) and stage 5 will refuse it.
- Re-running batch regenerates flow pages for current candidates; stale
  flow pages whose candidate no longer exists are removed in the same pass
  (mirroring `syncClassDiagrams` ownership of its prefix) — with the same
  safety: only `owner: generated` flow pages with the livewiki shape are
  removed, never human content.
- Determinism: candidate detection, slugs, hub, quickstart link, and
  navigate links are deterministic under input reordering.

## 10. Condensed SPEC text for the new section

(The full contract is §3–§9 above; this is the text proposed for SPEC.md
§"Semantic product-flow layer".)

> Stage 5 (flows) synthesizes a bounded set of cross-module semantic
> product-flow artifacts after stage 4: one flow page
> (`livewiki/flows/<slug>.md`) and one companion Mermaid diagram
> (`livewiki/diagrams/flow-<slug>.mmd`) per candidate, plus a deterministic
> hub (`livewiki/flows/index.md`). Candidates are detected
> deterministically from the index — entry modules, module-graph walks,
> persistence and external-boundary signals (gitignore-style pattern
> overrides in `config.flowSignals`) — never from repository-specific
> names. Detection, slugs, hub, and links are deterministic under input
> reordering. The set is capped by `maxFlows` (default 4; 0 disables).
> Synthesis is an ordinary gated batch task kind (stage 5, target
> `flow:<slug>`): closed key list (≤ `flowMaxAnchors`, default 25), the
> shared artifact validator parameterized by page kind, bounded repair,
> transactional write with rollback, token accounting, and the run failure
> policy — all identical to stage 4. Diagrams are parsed pre-write and
> bounded (`flowMaxDiagramNodes` 12 / `flowMaxDiagramEdges` 20); every
> diagram has a numbered-step textual fallback in the page. Flow claims
> cite only closed-list anchors, so flow pages enter the debt ledger like
> any page. Structural source maps (structure/import/class diagrams) are
> retained and do not count as flow coverage; automatic whole-repository
> call-graphs remain out of scope. Quickstart links the hub when at least
> one flow page exists; CLI, MCP, export, and the Phase 7 viewer consume
> the same files with no separate agent/human truths.

## 11. Implementation lots (assignable after approval)

Each lot is one bounded executor assignment: uncommitted, unpushed,
reviewed separately. Tests follow the existing suites.

- **Lot S1 — SPEC alignment + validator generalization.** Apply §2
  amendments to `SPEC.md`; generalize `validateStage4Artifact` →
  `validateArtifact(kind)` in `artifact.ts` (module behavior byte-identical);
  add `invalid_flow_diagram` / `flow_diagram_too_large` codes; config keys
  in `config.ts`. Tests: `artifact.test.ts`, `config` tests. No behavior
  change for module pages (regression: full suite green).
- **Lot S2 — candidate detector.** `packages/core/src/flows.ts`:
  signal computation, walk enumeration, ranking, seed key sets,
  determinism. Unit tests on synthetic module graphs (including the
  dogfood shape: cli→core→llm/db). No LLM, no writes.
- **Lot S3 — stage 5 orchestration.** `batch.ts` stage-5 tasks,
  `prompts.ts` stage-5 builders, context builder, `tryWriteAndVerify`
  reuse, checkpoint/reporting, `--only flow:<slug>`, stale-flow removal.
  E2E with the stub server pattern of `cli-batch-e2e.test.ts`.
- **Lot S4 — navigation + dedup.** `flows/index.md` generator, gated
  quickstart/overview/navigate links, `tasks.md` responsibility-sentence
  switch + auxiliary compact sections. Tests: `navigation`/`init-overview`
  suites; export smoke check.
- **Lot S5 — local product E2E.** Run the combined pipeline on one small
  real TypeScript repo with the development LLM (no paid call without
  approval); record the acceptance evidence (§12); maintainer reviews the
  generated flows by reading them.

## 12. Acceptance evidence (per ROADMAP)

On a real repository, from the low-token entry path
(`quickstart → flows/index.md → flow page`) and later from the Phase 7
viewer, a reader answers without assembling module pages manually:

1. What starts the principal workflow? (Purpose + entry anchor)
2. Which components participate, and how do they communicate? (diagram +
   Ordered flow)
3. Where does state move or persist? (persistence anchors + Invariants)
4. What is produced at the end? (Purpose + sink)
5. What happens on the critical failure/recovery path? (Failure and
   recovery, or an explicit honesty statement)

Process acceptance: `verify` zero issues; zero duplicate prose groups
between `tasks.md` and module pages (repeat the R9 clarity check); flows
detected on the livewiki repo itself from generic signals only.

## 13. Decisions requested from the maintainer — RESOLVED 2026-07-18

1. SPEC amendments A–F: **approved** and applied.
2. Stage 5 as a separate stage: **approved** (implemented as stage 5).
3. Directory name: **`flows/`** (implemented).
4. `tasks.md` dedup: responsibility sentence **approved then amended**
   (2026-07-18, R10 audit) — indexes are title + link only, no copied
   prose; see §8 amendment.
5. Defaults `maxFlows` 4, `flowMaxAnchors` 25, diagram budget 12/20:
   **kept as defaults**; observed overrides (4 / 15) stay per-run until
   more evidence exists.
6. SPEC edited only after review: **confirmed**; subsequent amendments
   (upper-bound closed list, index dedup) were evidence-driven and are
   recorded in §6/§8.
