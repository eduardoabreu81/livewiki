# Qualitative offline review — Livewiki clean v3 vs OpenWiki frozen baseline

**Date:** 2026-07-11  
**Mode:** Offline only — no API, no OpenWiki re-run, no batch, no artifact mutation of `raw/` or `rerun-clean-v3/` outputs.  
**Inputs:**

| Side | Path | Role |
|------|------|------|
| Livewiki (candidate) | `rerun-clean-v3/livewiki/` | Valid MiniMax clean bootstrap (`init --batch --no-refine`) |
| OpenWiki (baseline) | `raw/openwiki/` | Frozen competitor output from original A/B harness |

**Verdict frame:** comparative **quality evidence**, not a public winner claim. No general or tool-level “winner.”

---

## 1. Scope and comparability

### Snapshot / commit alignment

| Artifact | Code snapshot under documentation |
|----------|-----------------------------------|
| Livewiki clean v3 | **`4e62536`** (`fix(cli): honor no-refine in batch execution`) — see `rerun-clean-v3/metrics/run-meta.txt` |
| OpenWiki raw | Target described as git snapshot **`02436b0`** of livewiki **`04d6198`** (RERUN.md / handoff) |

**These are not the same commit.** Between `04d6198` and `4e62536` the product gained (at least) batch resilience U–X, structural module split (T0), and thinking defaults. Timeout policy changes landed **after** the v3 wiki was generated (`fff5cbe`). OpenWiki describes an **older** codebase; livewiki v3 describes a **newer** one.

### Methodological implication

- **Direct head-to-head “same code, same day” comparison is not valid.**
- Comparison is still useful as **cross-tool documentation style and coverage philosophy** (agent-loop narrative wiki vs batch symbol-chunk wiki), with explicit **temporal skew**.
- Token/cost numbers must not be treated as fair A/B either:
  - Livewiki **baseline** (raw failed pack): **102 207** total tokens / **8** calls (`raw/metrics/livewiki.json`).
  - OpenWiki raw: **13 706 788** total tokens / **157** calls (`raw/metrics/openwiki.json`).
  - Livewiki clean v3 wire (proxy): ~**265k** prompt + **68k** completion / **18** calls — different code, different run.

### Reading methodology (honesty)

| Pass | What was done |
|------|----------------|
| **Structure / completeness** | **All** Markdown pages on both sides were opened and inventoried (paths, roles, presence/absence of planned modules, navigation hubs). |
| **Factual accuracy** | **Spot-check**, not exhaustive validation of every sentence against the AST. Spot-checks targeted closed-key contracts, exception types, refine thresholds vs historical `batch.ts`, and timeout defaults vs commit-under-test. |
| **Style** | Style differences are not scored as factual errors. |

### What this review does and does not claim

| Does | Does not |
|------|----------|
| Score structure, usefulness, anchors, factual spots, completeness of each wiki *on its own terms* | Declare a winner (general or per-tool) |
| Count missing `core-src-01` against livewiki completeness | Treat `verify` zero issues as completeness |
| Note editorial IA qualities of the frozen OpenWiki sample | Treat OpenWiki as current-spec accurate or “leading overall” |

---

## 2. Inventory

### Livewiki clean v3

| Kind | Count / notes |
|------|----------------|
| Module Markdown pages | **11** (`cli-src`, `commands`, `core-src-02..04`, `fase2-repo-src`, `llm`, `mcp-src`, `sample-ts-repo-src`, `scripts`, `tools`) |
| Missing planned module page | **`core-src-01.md`** (overview still lists the module; diagram only) |
| Entry / architecture | `quickstart.md`, `architecture/overview.md`, Mermaid structure/modules + class diagrams |
| Unique anchors in frontmatter `anchors:` | **258** |
| Unique anchors (frontmatter **+** `lw:anchors` sections) | **292** |
| Relation to index | **292 = 366 total symbols − 74** symbols on the missing **`core-src-01`** module (per overview / plan accounting) |
| Run outcome | `completed_with_failures`; verify **0** issues on **emitted** pages |
| Wire usage (proxy, authoritative for that run’s cost) | 18 calls; stage 2 = 0 tokens (`--no-refine`) |

### OpenWiki raw

| Kind | Count / notes |
|------|----------------|
| Narrative Markdown pages | **11** under topic folders (`architecture/`, `workflows/`, `integrations/`, `operations/`) + `quickstart.md` |
| Extra | `.last-update.json` |
| Structure | Hierarchical IA with cross-links; little/no livewiki-style `lw:anchors` frontmatter |
| Harness | Agent loop, **157** calls, **13 706 788** total tokens |

### Shared “topics” (loose mapping only)

| Concern | Livewiki v3 | OpenWiki |
|---------|-------------|----------|
| Entry | `quickstart.md` (index-ish, symbol-heavy “key concepts”) | `quickstart.md` (product pitch + phase table + link hub) |
| Architecture | Deterministic overview + Mermaid + module pages | `architecture/overview.md` + `data-model.md` |
| Batch | Scattered across `commands`, `core-src-*`, `llm` | `workflows/batch-pipeline.md` (single narrative) |
| MCP | `mcp-src.md` | `integrations/mcp-server.md` |
| Rules / ops | Thin / via code modules | Dedicated `operations/*` |

---

## 3. Criteria table

Scores are **relative rubrics** (Strong / Mixed / Weak), not absolute grades, and assume the comparability limits above.

| Criterion | Livewiki clean v3 | OpenWiki raw | Notes |
|-----------|-------------------|--------------|--------|
| **1. Completude** | **Weak–Mixed** | **Mixed–Strong** (for its era) | Livewiki: missing **`core-src-01`** (74 symbols; **292/366** anchored) is a hard completeness miss. OpenWiki: full narrative map of product surfaces; may omit later code. |
| **2. Precisão factual vs código** | **Mixed** | **Mixed** | Livewiki: anchors usually real; some prose wrong vs **its** generation-era code. OpenWiki: **factual error vs own snapshot** on refine coverage (below), plus **drift** vs later commits. |
| **3. Estrutura e navegabilidade** | **Mixed** | **Strong** (editorial IA of the frozen sample) | Frozen OpenWiki sample has stronger editorial information architecture (hubs, “where next”). Livewiki is machine-oriented; quickstart over-weights bench tools/tests. Not a general tool ranking. |
| **4. Redundância** | **Weak–Mixed** | **Mixed** | Livewiki repeats “section → anchors → API list”; OpenWiki repeats inviolable rules across ops pages (often intentional). |
| **5. Utilidade agent/dev** | **Mixed–Strong** for code surgery | **Strong** for onboarding (frozen sample) | Livewiki closed keys help “open this file.” OpenWiki mental model of phases/workflows is faster for a new agent *in this sample*. |
| **6. Rastreabilidade símbolos/arquivos** | **Strong** (where pages exist) | **Weak–Mixed** | Livewiki: frontmatter + `lw:anchors`. OpenWiki: prose paths/tables. |
| **7. Problemas graves / enganoso** | **Present but localized** | **Present (snapshot-factual + drift)** | Livewiki: false throw claim; incomplete plan. OpenWiki: claims 100% refine coverage while **04d6198** code accepted ≥80%. |

---

## 4. Defects — two classes

Defects are split so **snapshot-factual errors** are not confused with **post-snapshot product drift**.

### A. Factual errors against the **documented snapshot**

#### Livewiki clean v3 (vs code behavior at **`4e62536`** / modules API as generated)

1. **`core-src-03.md` — wrong exception for peer fragmentation**  
   Prose claims `assertExactPathPartition` **and** `refinePeerDirectoryFragmentationError` both **throw `ExactPartitionError`**.  
   Code: `refinePeerDirectoryFragmentationError` returns **`string | null`** and does not throw.  
   **Class:** factual error vs generation-era code. **Severity:** high.

2. **Missing page vs planned module set**  
   Overview lists `core-src-01` (74 symbols / 9 files) without a page. Anchors cover **292** of **366** symbols.  
   **Class:** completeness failure of the run (not a false sentence about a throw). **Severity:** high for completeness.

3. **TODO-laden CLI page**  
   `cli-src.md` leaves multiple `TODO:` stubs (createProgram, run exit, resolveRepoRoot, …).  
   **Class:** unfinished generated content vs a finished reference. **Severity:** medium.

4. **Quickstart “key concepts” skew**  
   Lists token-proxy / E2E stub symbols as top concepts rather than product entry points.  
   **Class:** navigability / usefulness (symbols exist; ranking is poor). **Severity:** medium.

#### OpenWiki raw (vs code at **`04d6198`**, the snapshot it documents)

1. **Refine coverage claim vs actual threshold**  
   File: `raw/openwiki/workflows/batch-pipeline.md` (stage 2 validation):  
   - States **“Coverage must be 100% of heuristic files”** while also noting `` `< 80%` is rejected ``.  
   Historical code at **`04d6198`** (`packages/core/src/batch.ts`, comments ~644 and implementation ~732–742) accepted refined modules when coverage was **≥ 80%** (`coverage < 0.8` rejected).  
   Claiming **100%** as the acceptance bar is therefore a **factual error against the snapshot’s own code**, not merely “later product moved to exact 100%.”  
   **Severity:** high for anyone trusting that page as the 04d6198 contract.

2. **No machine-checkable anchors**  
   Not a falsehood about the code; agents cannot run livewiki-style `verify` on OpenWiki prose.  
   **Class:** tooling limit of the format. **Severity:** medium for agent workflows.

### B. Drift caused by **commits after** the wiki’s snapshot

These are **not** scored as lies about the snapshot; they matter for modern readers only.

| Item | Snapshot truth | Later product |
|------|----------------|---------------|
| Livewiki `llm.md` timeout default **60 000** ms | Correct at **`4e62536`** | **`fff5cbe`**: default **300 000**, no adapter/batch retry on timeout, unknown usage |
| OpenWiki silence on unique module IDs / structural split | Accurate that those were not the story at **04d6198** | **`59e313d` / T0** and related work reshaped modules |
| OpenWiki phase tables / test counts | Reflect AGENTS-era baseline | Counts and phase close-outs moved on |

---

## 5. Completeness gaps

### Livewiki

| Gap | Impact |
|-----|--------|
| No `core-src-01.md` | **Primary:** 1/12 modules; **74** symbols without a page; anchors **292/366** |
| Chunked core without a synthesis page | Reader must stitch config/db vs modules/parser vs rest of core |
| Benchmark/fixture modules in the index | Dilute product signal if the goal is “understand livewiki product” |
| No dedicated ops / rules chapter | Rules appear only if a chunk covers `safe-io` / pointer |

### OpenWiki

| Gap | Impact |
|-----|--------|
| No per-file/symbol closed lists | Harder for surgical edits |
| Snapshot lag vs `4e62536` | Misses no-refine wiring, T0 split, later timeout policy (**drift**, not necessarily snapshot-false) |
| High token cost of production | Completeness bought with agent-loop spend (method cost) |

---

## 6. Strengths and weaknesses

### Livewiki clean v3

**Strengths**

- **Traceability:** dense `anchors` + section markers; verify-clean on written pages; **258** frontmatter-unique / **292** all-section unique keys.
- **Deterministic architecture diagrams.**
- **Honest failure surface:** overview shows `core-src-01` without a fake page link.
- **Protocol:** stage-2 zero tokens under `--no-refine`; no `src-*-ts` explosion.

**Weaknesses**

- **Incomplete plan execution** (missing core chunk → 74 symbols undocumented).
- **Prose quality uneven:** TODOs, at least one false API contract, repetition.
- **IA is module-chunk first**, not “product journey” first.

### OpenWiki raw

**Strengths**

- **Editorial information architecture** of the frozen sample: clear quickstart → architecture → workflows → ops.
- **Cohesive narrative** of rules, phases, and CLI/MCP surfaces.
- **Readable for humans** without module slug conventions.

**Weaknesses**

- **Weaker symbol-level traceability** / no verify contract.
- **Factual error on refine coverage** vs **04d6198** code (≥80% vs claimed 100%).
- **Unsafe as sole source for current `main`** without re-generation (**drift**).
- Heavy generation cost model.

---

## 7. Methodological limitations

1. **Different commits** (`04d6198` family vs `4e62536`) — largest threat to fairness.
2. **Different generators** (agent-loop OpenWiki vs 4-stage batch livewiki).
3. **Different completeness criteria** (topic coverage vs module-page coverage).
4. **Livewiki verify** only checks pages on disk — missing module is not a verify failure.
5. **Structure/completeness:** all pages inventoried; **factual accuracy: spot-check only**, not exhaustive.
6. **OpenWiki facts** often rest on AGENTS/SPEC prose plus code reading, not closed-key lists.
7. **Historical livewiki batch vs proxy token gaps** affect cost narratives, not prose quality scores here.

---

## 8. Neutral conclusion

- **Livewiki clean v3** is strong as a **verifiable, symbol-anchored, structural** pack for the post-U–X / T0 code shape, but **fails completeness** on **`core-src-01`** (**292/366** symbols anchored) and shows **localized factual prose bugs**.
- **The frozen OpenWiki sample** has **stronger editorial IA** and a clearer onboarding story for the **baseline-era** product, with **weaker anchors** and at least one **snapshot-factual** refine-coverage error, plus **temporal mismatch** to the v3 code under test.
- **Neither pairing supports a clean public “better docs tool” claim.** Supported, careful claims: after planner fixes, livewiki can emit non-exploded module pages with dense anchors; the frozen OpenWiki sample remains a useful narrative baseline; completeness and same-commit A/B remain open.

---

## 9. What is still required before any public claim

1. **Same-commit documentation** of both tools (or permanently label multi-commit comparison).
2. **Livewiki plan completeness** (e.g. **`core-src-01`** as a **separate** retry artifact under current timeout policy).
3. **Factual scrub** of known livewiki defects and TODO prose.
4. **Third-party rubric** after (1)–(3), including completeness **and** verify.
5. **Cost reporting** that labels proxy vs batch and OpenWiki’s **13.7M** total vs livewiki baseline **102 207** / v3 wire totals separately.
6. Explicit **non-goals** (style ≠ correctness; no tool-level winner language).

---

## 10. Actions not taken

- No OpenWiki execution  
- No livewiki batch / paid LLM / `core-src-01` retry  
- No edits to `raw/`, `rerun-clean-v3/livewiki/`, or `BENCHMARK.md`  
- No winner declaration  
- No commit/push of this review file unless a later session versions it  

---

*End of offline quality review (revised). For Codex / human sign-off.*
