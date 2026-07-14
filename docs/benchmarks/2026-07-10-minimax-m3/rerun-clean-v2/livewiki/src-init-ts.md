---
title: init.ts (core)
owner: generated
anchors:
  - packages/core/src/init.ts#runInit
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#generateQuickstartDeterministic
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#escapeHtmlId
---

# `init.ts` — `livewiki init` entry point

Implements the Fase 3 `init` command. Without flags, indexes the repo and writes a deterministic layout (no LLM). With `--plan`, prints a heuristic module plan and exits without writing files. With `--batch`, triggers the full LLM pipeline after the base init.

Behavior matrix:

| Mode | Indexes | Writes layout | Runs LLM | Writes manifest |
|------|---------|---------------|----------|-----------------|
| `init` | yes | yes | no | yes (idempotent) |
| `init --plan` | yes | no | no | no |
| `init --batch` | yes | yes | yes | yes (with `pendingBatch` on failure) |
| `init --batch --no-refine` | yes | yes | yes (skip stage 2 refine) | yes |

`--plan` never requires LLM config. `init` without `--batch` never requires LLM config. `--batch` only requires LLM config when it actually calls the LLM.

## `runInit` — main entry point
<!-- lw:anchors packages/core/src/init.ts#runInit -->

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

`InitOptions`:

- `repoRoot: string` — target repo path (resolved to absolute).
- `batch?: boolean` — `--batch`: triggers full LLM pipeline after base init.
- `plan?: boolean` — `--plan`: prints module plan and exits (no LLM, no writes).
- `noRefine?: boolean` — `--no-refine`: skips LLM stage 2 refine (only with `--batch`).
- `language?: string` — language for plan/report (default: `config.language || "en"`).
- `quiet?: boolean` — suppresses informational notes.

`InitResult`:

- `filesWritten: string[]` — created/updated paths.
- `plan?: InitPlanReport` — populated when `--plan` was passed.
- `batchSummary?: { runId; status; tasksDone; tasksFailed }` — populated when `--batch` was passed.
- `batchExitCode?: 0 | 1 | 2` — POSIX exit code to propagate from the CLI when `--batch` finishes. `0 = completed`, `1 = completed_with_failures`, `2 = aborted`. Absent for non-batch/non-plan runs (CLI uses exit 0). Computed by `core/batch.ts:statusToExitCode` — single source of truth.

Execution sequence inside `runInit`:

1. Create `.livewiki/`, `livewiki/`, `livewiki/architecture/`, `livewiki/diagrams/` via `safe-io`.
2. Ensure `.livewiki/` is in the target repo's `.gitignore` (idempotent — re-init is a no-op if already present).
3. Index the repo via `runIndexer` and `runLedger`.
4. Load symbols + heuristic modules via `buildPlan`.
5. If `--plan`, return the report and exit (no writes).
6. Generate deterministic layout: `structure.mmd`, `modules.mmd`, per-module class diagrams, `quickstart.md`, `architecture/overview.md`.
7. Write `manifest.json` (idempotent — only listed in `filesWritten` if actually rewritten).
8. If `--batch`, dynamically import `batch.ts` to avoid a cycle, call `runBatch` with `skipManifestWrite: true`, and propagate `batchExitCode`. On `completed_with_failures` or `aborted`, update `manifest.json` with `pendingBatch`; on clean completion, clear `pendingBatch`.

## `buildPlan` — symbols, modules, edges
<!-- lw:anchors packages/core/src/init.ts#buildPlan -->

```ts
async function buildPlan(absRoot: string): Promise<{
  symbols: SymbolRow[];
  filePaths: string[];
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
}>
```

Internal helper that derives the plan consumed by both `runInit` and `regenerateArchitectureOverview`. Steps:

1. Open `index.db` (validated path) and select all `status = 'active'` symbols.
2. Deduplicate and sort `filePaths`.
3. Apply the W gate (plan-wide uniqueness) **before** resolving edges: `identifyModulesHeuristic` → `splitOversizedModules` → `makeUniqueDeterministicIds` → `assertUniqueModuleIds`. Module identity is the same across all derived artifacts (`modules.mmd`, `quickstart.md`, `overview.md`, regenerator, `batch_tasks.target`).
4. Read each file and run `collectImports` to build an import map (per-file failures are skipped).
5. Compute `edges` via `resolveModuleEdges` and `ordered` via `prioritizeModules`.

Always closes the DB in a `finally` block.

## `generateQuickstartDeterministic` — `quickstart.md`
<!-- lw:anchors packages/core/src/init.ts#generateQuickstartDeterministic -->

```ts
function generateQuickstartDeterministic(
  modules: Module[],
  ordered: Module[],
  symbols: SymbolRow[],
  totalSymbols: number,
  totalFiles: number,
  language: string = "en",
): string
```

LLM-free entry-point generator. Writes `# Quickstart` with:

- A one-line summary: `${totalFiles} files` / `${totalSymbols} symbols` / `${modules.length} modules`.
- **Top entry points** — first 3 modules from `ordered`, linked as `[id](architecture/overview.md#${m.id})` with `${m.paths.length} files, ${m.symbolCount} symbols`.
- **Key concepts** — first 10 `function` or `class` symbols, listed as `` `${key}` (${kind}) ``.
- Footer: `Generated by livewiki init. Refresh with livewiki index + manual edits.`

Labels are localized via a `Record<string, ...>` keyed by `language`; falls back to `en` when the language key is missing. Only the `en` labels are currently defined.

## `generateArchitectureOverview` — `architecture/overview.md`
<!-- lw:anchors packages/core/src/init.ts#generateArchitectureOverview -->

```ts
async function generateArchitectureOverview(opts: {
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  filePaths: string[];
  totalSymbols: number;
  totalFiles: number;
  edges: Array<{ from: string; to: string }>;
  symbols: SymbolRow[];
}): Promise<string>
```

Produces the target of the `[m.id](architecture/overview.md#${m.id})` links emitted by the quickstart. Without this file, those links break and `verify` emits warnings on a freshly-completed run.

Structure:

- Frontmatter: `title: Architecture overview`, `owner: generated`.
- Summary line: `${totalFiles} files` / `${totalSymbols} symbols` / `${modules.length} modules` / `${edges.length} edges`.
- Note that diagrams are deterministic; module pages are produced by the batch or by hand.
- **Module index** — one block per module in `ordered`:
  - Inline HTML anchor `<a id="${escapeHtmlId(m.id)}"></a>` (guarantees exact match with the quickstart link regardless of how the renderer slugifies headings).
  - Heading `### ${m.id}`.
  - One-liner: `**${symbolCount}** symbols across **${paths.length}** files` · `[class diagram](../diagrams/${slug}.classes.mmd)`.
  - `[page](../${id}.md)` is appended only when `livewiki/${id}.md` exists on disk (`fs.stat` — `ENOENT` is swallowed). `init` runs before the batch creates pages, so the page link is omitted on first run and re-populated by a subsequent `init` after the batch.
- **Diagrams** — two `mermaid` code fences, each prefaced with `%% livewiki/architecture/{structure|modules}.mmd`, plus raw-file links.
- **Top files by symbol count** — first 10 files ranked by symbol count, listed as `` `${path}` (${count} symbols) ``.
- Footer: `Generated by livewiki init. Refresh with livewiki index + manual edits, or run livewiki init --batch to generate per-module documentation.`

Top-files ranking: counts symbols per file from `symbols`, sorts descending, takes 10.

## `regenerateArchitectureOverview` — refresh only the overview
<!-- lw:anchors packages/core/src/init.ts#regenerateArchitectureOverview -->

```ts
export async function regenerateArchitectureOverview(repoRoot: string): Promise<void>
```

Re-derives the plan via `buildPlan` and rewrites `livewiki/architecture/overview.md` only. Used by both `runInit` (after creating the base layout) and `batch` (after creating per-module pages), so the `[page](../${id}.md)` links appear once the pages exist and disappear when they do not — preventing `broken_internal_link` warnings in `verify`. Idempotent.

## `escapeHtmlId` — anchor sanitization
<!-- lw:anchors packages/core/src/init.ts#escapeHtmlId -->

```ts
function escapeHtmlId(s: string): string
```

Replaces every character outside `[A-Za-z0-9._-]` with `_`. Guarantees the value is a valid HTML `id` attribute and is byte-identical to what the quickstart emits inside `[id](overview.md#${id})`, so the two sides of the link always match.