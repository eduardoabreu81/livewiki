# R11-A — Concept navigation and auxiliary prominence plan

Date: 2026-07-20

Status: **implementation in the working tree; validation pending.** On
2026-07-20 the maintainer authorized the R11-A improvements after the bounded
R11-NAV contract. Product code and durable contracts may change in this pass;
tests, paid calls, benchmark evaluation, commit, and push remain separate and
have not been authorized for this implementation pass.

## Objective

Make the generated wiki answer product-level questions through short,
concept-named routes while preserving livewiki's strongest properties:
source-level traceability, mechanical anchor validation, ownership safety,
transactional writes, and exact token accounting.

The target is not to imitate a benchmark corpus or hardcode livewiki-specific
guides. The product outcome is that a new maintainer can start at Quickstart,
choose an intent, and reach a complete behavioral contract without manually
assembling several source-chunk module pages.

## Evidence baseline

The corrected R10.1 evaluation does not establish a stable overall score change,
because the byte-identical control moved materially between single-run
evaluations. It does establish a repeatable product diagnosis:

- navigation/findability remained 5–6 for LiveWiki while concept-oriented
  routes scored 9 in the current pair;
- coverage was reduced when one answer had to be assembled across broad module
  pages;
- clarity was reduced by long code-walkthrough pages and 16 low-prominence
  benchmark/tooling pages;
- module pages remained valuable for exact symbols, signatures, and change
  locations;
- flow pages helped when a task matched one, but four overlapping CLI-rooted
  flows did not provide the missing concept destinations;
- the current raw corpus is mechanically healthy: verify zero, all links
  resolved, and no exact duplicate-paragraph groups.

The plan therefore changes information architecture and presentation. It does
not weaken validation or replace the module reference layer.

## Success model

R11-A adds a bounded synthesis layer above the existing references:

```text
Quickstart
├── Understand the product → concept topic
├── Follow an end-to-end behavior → flow page
├── Work by intent → Topics/Tasks
└── Inspect implementation → Architecture/module reference

Concept topic
├── concise behavioral contract
├── failure/recovery and operational limits
├── exact anchored change map
├── relevant flow page(s)
└── supporting module pages
```

Topic pages answer “what contract spans these components?” Module pages answer
“which exact symbol or implementation seam do I edit?” Flow pages answer “in
what order does this behavior execute?” No layer becomes a competing source of
truth.

## Scope

### A. Concept-topic artifacts

Add these generated artifacts:

- `livewiki/topics/index.md` — deterministic title+link hub;
- `livewiki/topics/<slug>.md` — bounded, anchored topic pages;
- topic links in Quickstart, Tasks, flow pages, and module Navigate blocks.

Proposed frontmatter contract:

```yaml
---
title: <human concept title>
owner: generated
kind: topic
order: <zero-based accepted plan order>
intent: <one action-oriented reader intent>
modules: [<existing module ids>]
flows: [<existing flow slugs, optional>]
anchors: [<closed source keys actually cited>]
updated: YYYY-MM-DD
---
```

Required body order:

1. H1 matching `title`;
2. one sentence stating the reader problem the topic solves;
3. `## Purpose`;
4. `## When to use this page`;
5. `## Behavioral contract`;
6. `## Failure and recovery`;
7. `## Change map`;
8. `## Related pages`.

Topic-page constraints:

- every factual H2 from Purpose through Change map contains at least one valid
  anchor marker, with H3–H6 descendants belonging to their ancestral H2;
- every cited key appears exactly once in frontmatter and exactly once in the
  body; uncited closed keys remain an upper bound, matching the flow contract;
- at least 75% of anchors are non-test product symbols; a test/auxiliary key may
  fill a required evidence role only when no product key exists;
- topic pages contain no source-code signature dump and no non-Mermaid code
  fence; Change map names symbols and links to their module pages instead;
- prompt target is 500–900 prose words; more than 1,400 is a repairable
  `topic_too_long` error. There is no hard minimum: structural/evidence
  completeness, not padding, decides whether a concise page is sufficient;
- absolute language (`only`, `always`, `never`, `sole`, `single`) is permitted
  only when the supplied source span proves the scope and the sentence names
  the controlling guard or exception;
- every selected anchor contributes its complete defining span plus the direct
  guard/constant/callee span needed to establish the claimed behavior. If that
  evidence does not fit the source budget, omit the claim or choose a narrower
  topic; do not replace source evidence with a truncated-excerpt disclaimer;
- an existing relevant flow diagram is linked, not copied. A topic does not
  create a second diagram for the same behavior;
- Related pages uses existing, link-validated topic/flow/module paths only.

### B. Bounded semantic topic planning

Do not hardcode page names such as “Batch pipeline” or “Provider
configuration” in product code. Topic discovery uses one bounded semantic plan
inside stage 5, after stage-4 module pages have passed validation.

#### Deterministic evidence inventory

Build a sorted inventory from accepted artifacts and the structural index:

- product-role module ids and paths;
- accepted page title, responsibility sentence, and exact `When to use` bullets;
- module import neighbors and resolved workspace edges;
- accepted flow candidates and entry/boundary/sink groups;
- closed source keys with product/test/auxiliary classification;
- configuration, persistence, external-boundary, validation, and output signals
  already available to the flow detector/configuration channel.

Auxiliary-only modules are excluded from primary topic discovery. They may be
included as supporting evidence only when directly connected to a product
candidate.

#### One validated planning task

Add one task, `topic-plan`, that receives only the closed inventory and returns
at most `maxTopics` proposals. Proposed default: `maxTopics = 4`; `0` disables
topic generation.

Each proposal contains only:

```text
title
intent
supporting module ids (2–6)
supporting flow slugs (0–2)
closed anchor keys (5–18), grouped as contract/state/output/failure
```

The validator rejects unknown references, auxiliary-only proposals, duplicate
normalized intents, duplicate titles, fewer than two product modules unless an
accepted flow spans at least three, insufficient evidence groups, more than 75%
anchor-set overlap with an already accepted topic, or any out-of-budget field.
Overlap resolution is deterministic: prefer more evidence groups, then more
product modules, then lexical title order.

The accepted plan is persisted in the run checkpoint and reused byte-for-byte
by resume and `--only`; no second planner runs inside the same batch run. An
invalid/exhausted plan produces a visible failed task and no topic links. It
never silently falls back to guessed or repository-specific topic names.
Before creating that task, an inventory with fewer than five active anchors, or
without either two product modules or one accepted flow spanning at least three
modules, is a deterministic no-op: no task, no LLM call, and no failure.

This planner is intentionally LLM-assisted: concept naming is semantic writing,
not staleness detection. The structural inventory, closed references,
validation, persistence, and disk effects remain deterministic.

### C. Topic generation and write safety

Each accepted proposal becomes `topic:<evidence-hash>`. The task hash is
derived from sorted supporting module/flow identities plus the grouped anchor
keys, not from the model's title. The page path uses the accepted semantic title
slug with a short evidence-hash suffix for collision safety. The accepted plan
is persisted, so title/path/task identity stay stable throughout resume and
`--only` within the run while remaining human-readable in the corpus.

Topic generation reuses the stage-4/5 machinery:

- bounded initial generation and repair;
- diagnostic history and monotonic usage accounting;
- page-kind validation with repairable error codes;
- any-severity verify gate for the written topic artifact;
- snapshot, write, verify, and rollback on either exception or issue;
- `rollback_failed` terminates the run;
- generated-only stale cleanup; human/mixed topic pages are reported and never
  overwritten or removed.

Flow validation, flow anchor selection, stage-4 exact partitioning, and the
current repair rules are not relaxed.

### D. Intent-first navigation

Quickstart gains one bounded `## Understand the product` section containing
topic titles as direct links. It appears before implementation-reference routes
and only when at least one accepted topic exists.

`tasks.md` becomes topic-first:

1. topic titles as the primary action routes;
2. accepted flow titles for end-to-end execution paths;
3. product module pages under `Implementation reference`;
4. one link to `auxiliary/index.md`, never an inline list of every auxiliary
   module.

`architecture/overview.md` keeps the product architecture inventory but moves
the complete auxiliary list to `auxiliary/index.md`. The overview reports the
auxiliary count and one link, preserving discoverability without making
auxiliary units peer destinations.

Each generated product module links to at most two topics that list it as
support. Each flow page links to at most two topics that cite the flow. Link
selection is deterministic by accepted topic-plan order and path existence.

No copied intent/responsibility prose appears in an index. Hubs remain
title+link only; semantic text lives on the canonical topic page.

### E. Auxiliary prominence and depth

Auxiliary pages continue to exist, remain anchored, enter the manifest, and are
available through search and the auxiliary hub. Exact inventory coverage is
not reduced.

Add a role-aware compact page contract for benchmark, tooling, fixture, and
test-only modules:

- keep frontmatter, ownership, exact anchor coverage, responsibility, and
  `How it fits`;
- replace full narrative/signature treatment with `## Reference` and one H3 per
  anchored symbol;
- target one grounded sentence per symbol; include a signature only for a real
  exported entry point whose signature changes how the helper is used;
- never claim auxiliary code is a product runtime path;
- preserve manual blocks and all existing validator/rollback guarantees.

This role-aware depth change is limited to already classified auxiliary roles.
Product module and topic contracts do not become shorter by inference.

## Configuration

Proposed public keys:

- `maxTopics: number` — integer `0..8`, default `4`;
- `topicMaxAnchors: number` — integer `5..32`, default `18`;
- `topicMaxSourceChars: number` — bounded positive integer, implementation
  default `40_000`, pending the separately authorized validation pass;
- `topicMaxOutputTokens: number` — bounded positive integer, implementation
  default `4096`, pending the separately authorized validation pass.

The source/output defaults are frozen for implementation but remain unvalidated
until the maintainer authorizes the validation pass. No provider/model default
or repair-attempt default changes in this lot.

## Implementation sequence and stop gates

### Phase 0 — design proof, no product code

1. Build the deterministic evidence inventory for the frozen livewiki snapshot
   and two small existing test fixtures.
2. Demonstrate, in documentation only, that the closed inventory can support
   distinct concept candidates without livewiki-specific names in code.
3. Show proposed topic bundles, evidence groups, overlap, and projected source
   budgets to the maintainer.
4. Freeze the configuration defaults and SPEC amendment only after approval.

Stop if the inventory cannot distinguish concepts from the existing source
chunks. Do not compensate with a hardcoded topic table.

### Phase 1 — types, config, planning, and validation

1. Add topic types/config loading and strict range validation.
2. Implement the deterministic inventory builder.
3. Implement `topic-plan`, its repair contract, closed-reference validator,
   stable candidate ids, and checkpoint persistence.
4. Add deterministic shuffle/overlap/resume tests before any generation task.

Stop if a resumed run can produce a different accepted plan or task identity.

### Phase 2 — topic artifacts

1. Add topic prompt and repair prompt.
2. Add `pageKind: topic` structural and anchor validation.
3. Reuse transactional write/verify/rollback machinery.
4. Add generated-only stale cleanup and owner human/mixed refusal.

Stop if any new path bypasses safe-io, verify, rollback, or monotonic usage.

### Phase 3 — navigation and auxiliary presentation

1. Generate `topics/index.md` and `auxiliary/index.md`.
2. Add topic-first Quickstart/Tasks routes and bounded cross-links.
3. Move auxiliary enumeration out of primary hubs.
4. Add the compact auxiliary page contract without changing product-page
   depth or exact anchor coverage.

Stop if a missing/failed topic or owner-protected hub produces a broken link or
is reported as updated.

### Phase 4 — deterministic validation

Run the full existing workflow plus the smallest new regression set. Required
new scenarios:

- unknown/auxiliary-only/overlapping topic proposals rejected;
- accepted plan and task ids stable under shuffled input and resume;
- topic markers restricted to required H2 ancestors and every factual H2
  backed by at least one closed anchor;
- topic page over the hard maximum rejected and repaired; concise pages pass
  when every required section and evidence rule is satisfied;
- human/mixed topic and both new hubs never overwritten or deleted;
- verify warning on a written topic blocks commit and rolls back;
- second write/verifier exception/rollback failure follow the established
  terminal contract;
- Quickstart → topic is one hop; every topic reaches its flow/module evidence;
- primary hubs expose exactly one auxiliary route and no auxiliary page list;
- compact auxiliary pages retain every closed key exactly once;
- zero topic/planner work when `maxTopics: 0`;
- key-leak, exact accounting, exact module partition, stage 4, flows, export,
  MCP, and CLI E2Es remain green without weakened assertions.

### Phase 5 — one real paid acceptance run

Requires separate at-the-moment authorization. Use a fresh archive of the
frozen comparison source, the approved provider/model/config, and one complete
`init --batch --no-refine` run.

- Do not impose an external kill ceiling when the acceptance question is
  completion; product-level bounded repair/output limits still apply and are
  recorded.
- No `--only`, manual edit, or rerun-to-green loop. If the full run fails,
  preserve and report the failure as reliability evidence.
- Do not start blind scoring unless the run exits 0 with every stage-4, flow,
  planner, and topic task done.

Stop for maintainer and external review before commit/push.

## Acceptance criteria

### Product and mechanical gates

1. Full recursive build/test workflow green; key-leak regression green.
2. Paid run `completed` with exit 0, no recovery/manual edit, and exact
   checkpoint accounting.
3. At least three distinct concept topics on the frozen repo; no pair has more
   than 75% anchor-set overlap.
4. Every topic has 5–18 valid anchors, at least 75% non-test product anchors,
   and source backing in every required factual H2.
5. The fixed ten-task review set has a named topic/flow destination for every
   conceptual task. From Quickstart, median shortest path is at most 1 internal
   transition and worst case at most 2; no filename guessing or full-text
   search is counted as a route.
6. Quickstart, Tasks, Topics, flows, product modules, and auxiliary hub contain
   zero broken/outside links; repository-wide verify reports zero issues.
7. Primary hubs contain no individual auxiliary-page enumeration and exactly
   one route to the complete auxiliary inventory.
8. Raw-corpus duplicate-paragraph groups remain zero. Topic pages contain no
   source-code signature dump; auxiliary median prose volume is materially
   lower than product-module median while exact anchors remain complete.
9. Topic plan + topic generation token use is reported separately and is at
   most 20% of the full run total on the frozen repo. This is a budget guard,
   not permission to omit required evidence.
10. Existing accuracy/traceability safeguards and scores are not traded away:
    no weakened validator, no accepted unknown anchor/link, and no unsupported
    product-winner claim.

### Evaluation target, not a release gate

Because the current evaluator instrument has no measured variance, a single
weighted score is not an acceptance criterion. The product projection is:

- navigation/findability: 5–6 → 8 or better;
- useful coverage: 6–7 → 8 or better;
- clarity: 5–6 → 7 or better;
- factual accuracy: preserve at 8 or better;
- traceability: preserve at 8 or better;
- expected weighted band: approximately 7.8–8.3 if the above dimensions hold.

## Evaluation-instrument revision

Any post-R11 blind comparison is a separate, explicitly authorized evidence
task. It must:

1. record evaluator product, exact model/version when exposed, command/options,
   timestamp, prompt hash, task/rubric hash, corpus manifests, and source hash;
2. counterbalance corpus labels/order across repetitions;
3. run at least three independent repetitions per evaluator or replace
   subjective dimensions with deterministic task-route checks;
4. keep corpus-derived factual claims separate from deliberately false negative
   controls;
5. report per-dimension median and range, paired difference against the frozen
   control, and disagreements — not only one weighted total;
6. preserve every raw evaluator result byte-for-byte and put corrections only
   in the consolidation document;
7. make no regression/improvement or winner claim when the observed margin is
   within the repeated control/evaluator spread.

## Files likely affected during implementation

- `SPEC.md`, `docs/ROADMAP.md`, `AGENTS.md`;
- `packages/core/src/config.ts` and tests;
- new `packages/core/src/topics.ts` and tests;
- `packages/core/src/prompts.ts` and tests;
- `packages/core/src/artifact.ts` and tests;
- `packages/core/src/batch.ts` / batch state/status and focused tests;
- `packages/core/src/navigation.ts` and tests;
- `packages/core/src/init.ts` and stale-artifact tests;
- `packages/cli/src/cli-batch-stage5-e2e.test.ts` or one focused successor.

The exact file list is frozen after Phase 0 review. No new package, database
schema, external dependency, or network surface is expected.

## Non-goals

- no hardcoded livewiki/OpenWiki topic names in shipped code;
- no deletion or loss of auxiliary/module pages or anchors;
- no change to flow candidate ranking, seed tiers, link gate, or repair
  completeness semantics;
- no `maxRepairAttempts` default change;
- no tsconfig.paths expansion, FTS tokenizer work, viewer, export target, CI,
  GitHub workflow, release, or repository-wide language cleanup;
- no second source of truth or external graph/agent dependency;
- no benchmark loop as the implementation debugger;
- no commit or push until implementation, one real run, and external review are
  separately complete and approved.

## Decision requests

Before implementation, the maintainer must explicitly decide:

1. approve the validated one-call topic planner over hardcoded/fuzzy topic
   heuristics;
2. approve the new `livewiki/topics/` and `livewiki/auxiliary/` paths;
3. approve compact role-aware auxiliary pages while retaining exact anchors;
4. approve the provisional topic caps and require Phase 0 evidence before
   freezing source/output budgets;
5. keep strict one-shot paid acceptance and the repeated-evaluation protocol.
