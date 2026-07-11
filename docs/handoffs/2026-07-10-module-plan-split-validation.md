# Handoff: Module plan / split — external validation (Codex)

**Date:** 2026-07-10  
**Audience:** Codex (or any independent reviewer)  
**Mode:** **Validate the plan only** — do **not** implement, commit, push, or spend paid LLM tokens on a full bootstrap unless the human explicitly asks after this review.  
**Language:** This document is English (repo durable-artifact policy). Conversation with maintainer Eduardo may be PT-BR.

---

## 1. Your job (acceptance of *this* handoff)

Produce a **written validation report** that answers:

1. Is the **diagnosis** of the v2 over-split correct?
2. Is the proposed **rule-ordered module plan** (map folders → apply rules → validate → execute) sound relative to `SPEC.md` and the existing 4-stage batch pipeline?
3. Are the **proposed rules** complete enough, contradictory, or missing edge cases?
4. Is the **fix strategy** (especially unit cases that currently pass under the buggy behavior) adequate?
5. What should ship **first** (minimal fix vs full planner) before another MiniMax full clean bootstrap for OpenWiki A/B?

**Do not** claim livewiki “beats” OpenWiki. Quality review is separate and blocked until a non-contaminated full clean run exists.

**Deliverable format (suggested):**

```markdown
## Verdict
PASS | PASS-WITH-CHANGES | FAIL

## Diagnosis accuracy
...

## Plan / rules review
- Rule N: ok | change | reject — reason

## Spec alignment
...

## Test gaps
...

## Recommended ship order
1. ...
2. ...

## Open questions for Eduardo
...
```

---

## 2. Product context (short)

livewiki = agent-first technical wiki: batch pipeline documents a repo into Markdown pages with anchors, then MCP/skills keep it current.

**Two content layers (SPEC / product frame):**

| Layer | Intent | Who |
|-------|--------|-----|
| **A — structural** | dirs, symbols, imports, anchors — verifiable | batch today |
| **B — human narrative** | product story synthesized from A | later / optional |

Bootstrap A/B vs OpenWiki is a **stress test of layer A**, not the daily workflow (daily = same coding agent pays debt via MCP after commits).

Fair comparison requires:

- clean `livewiki/` before `init --batch` (no Sonnet dogfooding mix)
- same model route (MiniMax-M3, thinking off for livewiki stage 4)
- **module structure that is intentional**, not accidental one-file pages

---

## 3. Pipeline where planning lives today

Normative text: `SPEC.md` § “Batch pipeline (4 stages, resumable)”.

```
1. Scan (index)
2. Module identification (heuristic ± LLM refine)
   + oversized split (maxModuleFiles / maxModuleSymbols)
   + unique deterministic IDs
3. Prioritization
4. Coordinated documentation (LLM page per module)
```

**Config defaults** (`packages/core/src/config.ts` / `MODULE_SPLIT_DEFAULTS`):

| Key | Default | Meaning |
|-----|---------|---------|
| `maxModuleFiles` | 12 | split if more files |
| `maxModuleSymbols` | 80 | split if more symbols |
| `stage4MaxOutputTokens` | 8192 | stage-4 completion budget |
| thinking (MiniMax) | disabled / omit-on | avoid reasoning-only “done” pages |

**Code map (read these):**

| Concern | Path |
|---------|------|
| Heuristic modules, unique IDs, **split** | `packages/core/src/modules.ts` |
| Split + unique order in batch | `packages/core/src/batch.ts` (~W gate, after stage 2) |
| Same order on init (non-batch layout) | `packages/core/src/init.ts` |
| Config knobs | `packages/core/src/config.ts` |
| Unit tests | `packages/core/src/modules.test.ts` (`splitOversizedModules`, W unique ids) |
| Spec | `SPEC.md` lines ~194–211 (split + layers A/B) |
| Bench runbook | `docs/benchmarks/2026-07-10-minimax-m3/RERUN.md` |

---

## 4. What went wrong (facts)

### 4.1 Git / tree state (as of this handoff)

- **HEAD:** `1462a10` — `feat(core): provider thinking defaults + structural module split`
- **Remote:** `main` tracking `origin/main` (confirm with `git status` / `git log`)
- **Uncommitted (partial fix only):**
  - `packages/core/src/batch.ts` — order `makeUniqueDeterministicIds` → `splitOversizedModules` → `makeUniqueDeterministicIds`
  - `packages/core/src/init.ts` — same order
- **Not fixed in tree:** structural vs leaf distinction inside `splitOneModule` / `groupPathsByNextSegment` in `modules.ts`
- **Untracked artifacts:** `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v2/` (contaminated run — keep as evidence, do not treat as A/B winner)

Never run `git clean -fdx`. Do not revert unrelated uncommitted markdown.

### 4.2 Benchmark runs (interpret carefully)

| Run | Path | Role |
|-----|------|------|
| Immutable baseline | `docs/benchmarks/2026-07-10-minimax-m3/raw/` | Frozen evidence; do not edit |
| Clean v1 | `.../rerun-clean/` | Clean bootstrap **before** structural split feature matured; still had `core-src` fat module completion issues in earlier narrative; module IDs look coherent (`core-src`, `cli-src`, …) |
| Clean v2 | `.../rerun-clean-v2/` | **Contaminated for A/B** — over-split into many `src-*` one-file modules; ~40 done / 7 failed; higher token spend; **discard for fair OpenWiki comparison** |

v2 symptom pattern:

- many pages: `src-batch-ts.md`, `src-safe-io-ts.md`, …
- few coherent package-level modules
- tasksFailed > 0 → exit 1 / `completed_with_failures`

### 4.3 Root cause (two layers)

**A. Order bug (partially fixed in working tree, not necessarily pushed)**

If `splitOversizedModules` runs **before** `makeUniqueDeterministicIds`:

- several packages have leaf id `src`
- split prefixes IDs with `src-…`
- uniqueness never expands to `core-src` / `cli-src` first
- result: global `src-<file>` explosion across packages

Intended order (now in dirty `batch.ts` / `init.ts`):

```text
modules = makeUniqueDeterministicIds(modules);
modules = splitOversizedModules(modules, { maxFiles, maxSymbols, symbolCountByPath });
modules = makeUniqueDeterministicIds(modules);
assertUniqueModuleIds(modules);
```

**B. Structural grouping treats files as “structure” (still present in `modules.ts`)**

`splitOneModule` (oversized):

1. If `paths.length <= maxFiles` AND symbols <= maxSymbols → keep.
2. Else `groupPathsByNextSegment(paths)`:
   - longest common **directory** prefix
   - group by **next path segment**
3. If `bySeg.size > 1` → **always** recursive structural split, id = `{parent}-{slug(segment)}`.
4. Else → flat chunk by `maxFiles` (sorted paths).

For a flat dir of many files under `packages/core/src/*.ts`:

- next segments are `batch.ts`, `config.ts`, `llm`, …
- `bySeg.size > 1` → **one group per file name**
- never reaches flat chunking of 12
- produces ~1 module per file (still “correct” for path coverage, **wrong** for product/plan)

SPEC wording: split “by **subdirectory**, else stable file chunks”.  
Implementation: “by **next path segment** (file or dir)”.

### 4.4 Why unit tests did not catch B

`modules.test.ts` → `"chunks a flat oversized directory by maxFiles with stable stems"`:

- 25 files under `packages/core/src/f00.ts` …
- asserts: `out.length > 1`, every module `paths.length <= 12`, full path coverage, ids start with `core-src-`

A **25× one-file** split also satisfies those asserts (`paths.length === 1 <= 12`).  
**Missing asserts:** e.g. `out.length === 3` (ceil(25/12)), or `some(m => m.paths.length > 1)`, or max chunk size near `maxFiles` when pure-flat.

---

## 5. Proposal under review (not yet implemented)

### 5.1 Architectural intent

**Map folders → apply ordered rules → emit inspectable plan → validate plan → execute stage 4.**

Do **not** invent structure inside the LLM call. Stage-2 LLM refine (optional) may **rename/regroup** only after a deterministic structural map, with existing rejection guards (empty modules, coverage, etc.).

This matches:

- layer A first (structural, verifiable)
- cheap external validation (`--plan` / JSON dump of modules)
- stable A/B vs OpenWiki

### 5.2 Proposed rule list (ordered; please critique)

Assume input = set of indexed source paths (post-scan), after heuristic directory grouping **or** as a pure path forest — reviewer should say which input is cleaner.

| # | Rule | Intent |
|---|------|--------|
| R1 | **Never create a module whose sole reason is “filename is a path segment”** when siblings are peer files in the same directory | Fixes bug B |
| R2 | **True subdirectory** = next segment under common prefix where at least one path has **depth > prefix+1** (i.e. segment is a directory, not only a leaf file) | Structural split only for dirs |
| R3 | **Peer leaf files** in the same directory form **one flat bucket** under the parent module id | “map folders”, not “map files” |
| R4 | If a module (or bucket) exceeds `maxModuleFiles` or `maxModuleSymbols` → **stable chunks**: sort paths, slice by `maxFiles`, ids `{parent}-{stem-of-first}` or preferably `{parent}-{NN}` for clarity | Budget / completion |
| R5 | **Unique IDs before first split and after** (`core-src` not `src`) | Fixes bug A |
| R6 | Optional: tests (`*.test.ts`) / fixtures as sibling module or attached by config flag — **default TBD** | Avoid polluting domain pages |
| R7 | Optional stage-2 LLM refine only on the **post-rules** module list; must preserve coverage and uniqueness | Soft semantics, hard structure |
| R8 | **Plan must be dumpable** without LLM (CLI or core API): list `{ id, paths[], symbolCount, reason: heuristic\|subdir\|chunk }` | External validation / Codex / human |

### 5.3 Minimal fix vs full planner

| Tier | Scope | When |
|------|--------|------|
| **T0 — minimal** | R1–R5 only inside `splitOneModule` + order unique→split→unique + tests that fail on one-file explosion | Required before any full clean v3 |
| **T1 — plan surface** | Export plan JSON; `livewiki batch --plan` / init plan already exists partially — ensure post-split modules appear | Nice for external validation loop |
| **T2 — first-class planner** | Separate pure function `planModules(paths, opts) → Plan` used by batch+init; rules table documented in SPEC | After T0 proven |

**Maintainer preference expressed in chat:** validate plan externally first (this handoff). Prefer not to burn MiniMax full run until T0 is correct and **offline module inventory** looks sane.

### 5.4 Expected offline inventory (livewiki monorepo, illustrative)

After T0, a sane shape for `packages/core/src` (dozens of `.ts` + `llm/`):

- `core-src` chunks of ≤12 files for flat leaves, **or** one chunk series `core-src-…`
- `core-src-llm` (or `llm` uniqued) for the subdirectory as a unit (further split only if still oversized)
- **Not** `src-hashes-ts`, `src-config-ts`, … for every leaf

Exact IDs depend on unique-id algorithm; **shape** matters more than exact slugs for this review.

---

## 6. What we want Codex to pressure-test

### 6.1 Diagnosis

- [ ] Confirm A + B from code reading (not only this doc)
- [ ] Confirm v2 artifacts match B (sample page names under `rerun-clean-v2/livewiki/`)
- [ ] Confirm tests can pass under buggy B

### 6.2 Rules

- [ ] Any rule contradicts SPEC or VISION?
- [ ] Mixed tree: many leaves + one subdir (`llm/`) — what should R2–R4 produce? (proposed: subdir module(s) + flat bucket of leaves, each then size-limited)
- [ ] Single-file module that is the whole package — allowed?
- [ ] `maxModuleFiles: 0` / `maxModuleSymbols: 0` means disable that threshold (batch already maps 0 → MAX_SAFE_INTEGER) — still correct under planner?
- [ ] Windows paths: modules use `/` in repo — any risk?

### 6.3 Ship order

- [ ] Is T0 enough for fair OpenWiki full clean v3?
- [ ] Should full clean wait for T1 plan dump?
- [ ] Is “core-src only LLM smoke” useful after T0, or is offline inventory enough?

### 6.4 Non-goals for this review

- Phase 6 export / Phase 7 viewer
- Declaring A/B winner vs OpenWiki
- Rewriting stage-4 prompts
- Changing pricing / providers beyond existing thinking defaults

---

## 7. Suggested validation procedure (no paid batch)

```powershell
# 1) Read contract + implementation
#    SPEC.md (batch pipeline), VISION.md (if needed), AGENTS.md
#    packages/core/src/modules.ts  (splitOneModule, groupPathsByNextSegment)
#    packages/core/src/batch.ts    (W gate order — working tree may differ from HEAD)
#    packages/core/src/modules.test.ts

# 2) Prove bug B with a tiny Node/vitest thought experiment or temporary test:
#    25 files packages/core/src/fXX.ts, id core-src, maxFiles 12
#    Buggy: 25 modules of 1 file
#    Desired: 3 modules (12+12+1)

# 3) Inspect contaminated evidence (read-only)
#    docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v2/livewiki/
#    docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v2/metrics/batch-status.json

# 4) Write validation report (section 1 format)
#    Prefer: docs/handoffs/2026-07-10-module-plan-split-validation-REPORT.md
#    or paste into chat for Eduardo
```

Optional local unit run (no API key needed):

```powershell
pnpm --filter @livewiki/core test -- src/modules.test.ts
```

Do **not** start `init --batch` or MiniMax proxy for this validation task.

---

## 8. Decision log (chat, condensed)

| Topic | Position |
|-------|----------|
| Full clean vs only `core-src` for OpenWiki compare | **Full clean** required for A/B; core-src only = optional smoke after fix |
| v2 usable for A/B? | **No** — over-split contaminated |
| Smarter design | Map folders → rules → plan → execute; yes, preferred direction |
| LLM chooses split boundaries? | **No** for structural map; optional refine after rules |
| Next engineering | T0 fix + tests that fail on one-file explosion; then offline inventory; then full clean v3 |

---

## 9. Open questions for the human (if Codex cannot decide)

1. Preferred chunk id style: `core-src-batch` (stem of first file) vs `core-src-01` (ordinal)?
2. Should `*.test.ts` always split out of production modules by default?
3. After T0, is offline module list enough to greenlight MiniMax full clean, or require one `--only core-src` smoke?

---

## 10. Related documents

| Doc | Role |
|-----|------|
| `docs/handoffs/2026-07-10-batch-resilience.md` | Prior U–X handoff |
| `docs/benchmarks/2026-07-10-minimax-m3/RERUN.md` | Rerun hygiene / proxy |
| `SPEC.md` | Normative behavior |
| `AGENTS.md` | Agent conventions + live state |

---

## 11. One-paragraph brief for Codex system prompt

> Validate livewiki’s module-planning design after a failed MiniMax clean bootstrap (v2) that over-split flat directories into one-file modules. Root causes: (A) split before unique IDs; (B) “next path segment” treats filenames as structural groups, contradicting SPEC “subdirectory else file chunks”. Working tree partially fixes A only. Propose/critique ordered deterministic rules (map dirs → rules → inspectable plan → stage 4). Do not implement or run paid batch; write a PASS / PASS-WITH-CHANGES / FAIL report with ship order T0/T1/T2 and test gaps (current flat-dir test accepts one-file explosion).

---

*End of handoff. Maintainer: Eduardo. Author: Grok session (livewiki). For external validation only.*
