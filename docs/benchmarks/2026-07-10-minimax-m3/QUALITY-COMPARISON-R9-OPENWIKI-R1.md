# LiveWiki R9 vs OpenWiki R1 — dual-evaluator quality comparison

Date: 2026-07-18

Source snapshot: `895d49e258106256c4197a0aa3cdb3d2cc88063f`

Model: MiniMax-M3 for both generators

Conclusion scope: one repository, one frozen commit, one configuration per
generator; this is not a universal product-winner claim.

## Purpose and method

This comparison asks which generated documentation set better helps a new
maintainer understand and work on the same repository. Operational efficiency
is reported separately from documentation quality.

The two outputs were copied into an identity-masked evaluator package as Corpus
A and Corpus B. Both evaluators received the same relevant source snapshot,
ten fixed maintainer tasks, a five-dimension weighted rubric, and a requirement
to verify exactly twelve adversarial factual claims per corpus. Scores were
locked before unblinding.

After score lock, the mapping was revealed:

- Corpus A: OpenWiki R1
- Corpus B: LiveWiki R9

The weighted dimensions were:

- factual accuracy: 35%;
- useful coverage: 25%;
- navigation and findability: 20%;
- clarity and non-redundancy: 10%; and
- traceability to source: 10%.

## Evaluator A and Evaluator B

### Evaluator A

Evaluator A completed all twenty task reviews and twenty-four adversarial
claims. Its first draft exposed four methodological defects during coordinator
review:

1. one Corpus B adversarial claim was not actually asserted by the corpus;
2. factual accuracy penalized a missing topic, duplicating the coverage score;
3. the weighted-total table disagreed with its own arithmetic; and
4. "hand-curated" inferred human authorship from editorial shape.

After a blind correction request, Evaluator A replaced the invalid claim,
separated factual truth from coverage, corrected the arithmetic, and used
"topically organized." Its corrected scores were OpenWiki 7.75 and LiveWiki
7.00.

### Evaluator B

Evaluator B independently audited the corrected 1,110-line Evaluator A result,
rechecked all twenty task write-ups and twenty-four factual claims against the
source snapshot, and produced a separate V2 result. It confirmed every task
score, truth verdict, dimension score, and weighted total.

It also corrected five remaining reporting defects without changing the
quality result:

1. OpenWiki word count: 13,943, not 11,943;
2. `AGENTS.md` was excluded from the evaluator source snapshot and therefore
   could not be described as available evidence;
3. both corpora have a median navigation cost of two transitions; LiveWiki's
   median was not one;
4. the Corpus B count claim cited the wrong lines; and
5. median/worst-case table rows contained both corpora but were labeled as
   Corpus A only.

The two evaluators therefore converge on the same corrected score and scoped
preference. Evaluator B increases confidence in the result because it found
reporting errors while independently preserving the underlying judgments.

## Final quality result

| Dimension | Weight | OpenWiki R1 | LiveWiki R9 | Finding |
|---|---:|---:|---:|---|
| Factual accuracy | 35% | 7 | **8** | OpenWiki made one substantive false claim; LiveWiki made none in the twelve-claim sample. |
| Useful coverage | 25% | **8** | 6 | OpenWiki collects cross-cutting tasks into topic pages; LiveWiki requires assembly across module pages. |
| Navigation and findability | 20% | **8** | 7 | Both have a median of two transitions; OpenWiki more often collects the complete answer on the destination page. |
| Clarity and non-redundancy | 10% | **8** | 4 | OpenWiki has no exact duplicate prose groups; LiveWiki has 36, mainly between `tasks.md` and module pages. |
| Traceability to source | 10% | 9 | 9 | Both cite source paths strongly; LiveWiki's module pages include detailed source walkthroughs. |
| **Weighted total** | **100%** | **7.75** | **7.00** | Moderate 0.75-point OpenWiki preference on this snapshot. |

Arithmetic:

```text
OpenWiki = 7×0.35 + 8×0.25 + 8×0.20 + 8×0.10 + 9×0.10 = 7.75
LiveWiki = 8×0.35 + 6×0.25 + 7×0.20 + 4×0.10 + 9×0.10 = 7.00
```

## LiveWiki strengths

### Accuracy and source grounding

- Zero false claims in the twelve-claim adversarial sample; OpenWiki had one
  false statement that described the stub `livewiki serve` command as the real
  MCP stdio server.
- Nine out of ten for traceability, tied with OpenWiki.
- All 290 Markdown links within the generated corpus resolved; OpenWiki had
  three malformed internal relative links.
- Per-module pages provide detailed source ownership, code excerpts, and direct
  implementation context.
- R9 passed `verify` with zero issues before and after re-indexing.

### Structural and visual inventory

LiveWiki produced 38 Markdown pages and 11 Mermaid files. Its architecture
overview, import graph, per-module pages, class diagrams, and deterministic
`Navigate` blocks provide a strong structural map. OpenWiki produced 19
Markdown pages and no Mermaid files.

This is a real differentiator, but the evaluators did not reward it enough to
offset the editorial gap: most Mermaid output describes directories, imports,
or classes rather than the behavior of the product across components.

### Operational efficiency

| Metric | OpenWiki R1 | LiveWiki R9 | Relative result |
|---|---:|---:|---|
| Prompt/input tokens | 10,480,921 | 567,518 | OpenWiki used 18.47× more input tokens. |
| Completion/output tokens | 39,608 | 132,829 | LiveWiki produced 3.35× more output tokens. |
| Total tokens | 10,520,529 | 700,347 | LiveWiki used 93.34% fewer total tokens. |
| Provider calls | 106 | 57 | LiveWiki used 46.23% fewer calls. |
| Wall time | 8m43s | 19m24s | LiveWiki took 2.23× as long. |
| Missing usage records | 0 | 0 | Exact accounting for both. |
| Provider errors | 0 | 2 transient 529 responses | LiveWiki recovered and completed. |

OpenWiki's speed advantage and LiveWiki's token advantage are separate facts;
neither is part of the qualitative score.

## LiveWiki quality gaps

### Structural documentation is not product understanding

The central gap is information architecture, not Markdown validation. A file
tree answers what exists. An import graph answers which modules depend on one
another. A class diagram answers which types are declared. None of those alone
answers how a product workflow begins, which responsibilities communicate,
where state moves, what is produced, or how failure and recovery work.

This gap is especially important because `VISION.md` already defines two
content layers: a structural map for agents followed by a human/product
narrative — "map first, then a story." The implementation delivered the map
but not yet the story.

### Missing topic synthesis

LiveWiki documents the relevant facts but scatters them across module pages.
The evaluator could not find single topic-level explanations equivalent to:

- batch pipeline, checkpoints, retries, and circuit breaker;
- provider configuration, API-key boundaries, and no-silent-default behavior;
- safe I/O and pointer exceptions;
- MCP validated write and rollback;
- anchors, debt, and verification;
- export, overwrite protection, and idempotence; and
- CLI command status and exit-code semantics.

### Repetition and auxiliary prominence

- `tasks.md` repeats 36 paragraph groups that already appear in module pages.
- Benchmark harnesses, fixtures, and supporting scripts receive full module
  pages and compete with the product's principal workflows.
- Dense `Navigate` blocks expose graph neighbors but do not replace navigation
  by user intent.

## Improvement plan

### 1. Add a semantic product-flow layer

Before the Phase 7 viewer, generate bounded "How it works" artifacts for agents
that show:

- workflow entry points;
- participating components and responsibility boundaries;
- communication and data/state movement;
- external systems and persistence;
- outputs; and
- critical failure, retry, rollback, or recovery paths.

Phase 7 must render the same canonical artifacts for humans. Agent and human
surfaces must not maintain separate truths.

### 2. Make Mermaid behavioral

Retain deterministic structure, import, and class diagrams as source maps, but
do not count them as semantic-flow coverage. Add a small number of readable
component/data-flow, sequence, or state diagrams where order and interaction
matter. Every diagram needs companion prose and source-linked topic/module
pages. Prefer focused flows over mega-diagrams or edge-dense call graphs.

### 3. Generate topic-oriented synthesis

Infer cross-cutting guide candidates generically from entry points, commands or
routes, module/import relationships, configuration, persistence, and external
boundaries. Do not hardcode LiveWiki-specific guide names. Build each guide from
bounded module documentation and source evidence rather than resending the
whole repository.

### 4. Remove deterministic duplication

Turn `tasks.md` into a compact task index: one concise purpose sentence and a
link per task/module. Do not copy complete `When to use this page` paragraphs
into both surfaces.

### 5. Navigate by intent and role

Quickstart should route readers through "How it works," common workflows,
maintenance tasks, and implementation ownership. Keep the structural graph as
a secondary source map. Product modules should be separated from fixtures,
benchmarks, and tooling in primary navigation.

### 6. Preserve the current advantages

Do not weaken artifact validation, source anchors, link checking, recoverable
repair, exact accounting, bounded context, or per-module traceability. The goal
is LiveWiki accuracy plus OpenWiki-level topic organization, not replacement of
one strength with the other.

If LiveWiki keeps factual accuracy 8, navigation 7, and traceability 9 while
raising coverage from 6 to 8 and clarity from 4 to 7, the same rubric yields
7.80. Raising navigation and clarity to 8 yields 8.10.

## Learned lessons

1. The original two-layer product direction was correct. The implementation
   narrowed Mermaid to tree/import/class inventory and did not complete the
   narrative layer.
2. Mechanical correctness is necessary but does not guarantee useful
   documentation. The long R2–R9 hardening series improved reliability; the
   next quality gain is editorial and semantic.
3. Hop count is not enough to measure navigation. Both corpora require a median
   of two transitions; the difference is whether the destination page contains
   a coherent answer.
4. More output is not automatically better. LiveWiki generated 43,941 words,
   38 Markdown pages, and 11 Mermaid files, but duplication and auxiliary
   prominence reduced clarity.
5. Mermaid creates value when it explains behavior, not merely inventory.
6. Accuracy should not penalize omissions; omissions belong under coverage.
   Keeping rubric dimensions orthogonal materially changed the comparison gap.
7. Evaluator inputs must be immutable. Evaluator B observed Evaluator A's file
   changing, froze a snapshot, and continued safely. Future evaluators must
   receive separate read-only copies and write distinct result files.
8. A blind comparison still needs coordinator review. Independent rechecking
   corrected arithmetic, citations, evidence-scope claims, counts, and labels
   without changing the final preference.

## Product decision recorded

`docs/ROADMAP.md` now places the semantic product-flow layer before Phase 7 and
defines the agent-first/human-next acceptance contract. Before implementation,
`SPEC.md` must distinguish rejected automatic mega-call-graphs from approved,
bounded semantic flows. No implementation should begin until that specification
alignment is reviewed.
