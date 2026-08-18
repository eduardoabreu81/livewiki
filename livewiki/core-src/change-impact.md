---
title: Change Impact Computation
owner: generated
anchors:
  - packages/core/src/change-impact.ts#IMPACT_BUDGETS
  - packages/core/src/change-impact.ts#computeChangeImpact
  - packages/core/src/change-impact.ts#computeDirectImporters
  - packages/core/src/change-impact.ts#emptyImpact
  - packages/core/src/change-impact.ts#indexDbExists
  - packages/core/src/change-impact.ts#seedFromDebt
---

# Change Impact Computation

Computes a bounded, documentation-focused snapshot of what a code change touches — changed symbols, the wiki pages that cite them, the files that import them, and source snippets for the most important symbols — without mutating any persisted state.

## When to use this page

- **Wire change-impact output into a docs preview or review tool** by calling `computeChangeImpact` and rendering its bounded sections.
- **Tune the per-section caps** by overriding values from `IMPACT_BUDGETS` via `ChangeImpactOptions`.
- **Diagnose a "no impact" result** by checking `notGitRepo`, the presence of `.livewiki/index.db`, and the `totals` block.
- **Trace the dependency signal** by understanding `computeDirectImporters` and the on-demand `resolveImportEdges` path.

## How it fits

`packages/core/src/change-impact.ts` lives in `packages/core/src/` alongside the other deterministic, read-only signals it composes: `diff-preview.ts` for working-tree deltas, `status.ts` for the open debt rows, `import-resolution.ts` for resolved import edges, and `update.ts` for the snippet window. It is the orchestration point that packages those signals into one bounded `ChangeImpact` value — never an LLM call, never an index mutation, and never a throw on infrastructure gaps. Its role is composition with strict caps, not new analysis; the underlying signals already know how to compute themselves.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-change-impact.mmd
```

## Budget caps and option defaults

Every cap on the impact package is declared once, here, and the option object consumed by `computeChangeImpact` resolves missing values against these defaults. Centralizing the caps keeps the "truncated" flag honest: any section that binds a cap contributes to the top-level `truncated: true` signal and to a pre-cap count in `totals`.

<!-- lw:anchors packages/core/src/change-impact.ts#IMPACT_BUDGETS -->

```ts
export const IMPACT_BUDGETS = {
  maxSymbols: 50,
  maxPages: 20,
  maxSnippets: 10,
  maxImporters: 25,
} as const;
```

`IMPACT_BUDGETS` is a frozen object literal: four numeric caps that act as the single source of truth for section sizes in the impact view. Callers override via `ChangeImpactOptions`; the orchestrator reads these defaults when an override is absent.

## Seeding the changed-symbol set

The orchestrator needs two things before it can compose the impact package: a list of changed files and a per-wiki-page grouping of the symbol keys they touch. There are two seed paths — one driven by the working tree, one driven by the open debt ledger — and a single helper that decides whether the index DB is even readable on disk.

### Working-tree vs debt mode

`computeChangeImpact` selects the seed based on `opts.mode ?? "working-tree"`. In `working-tree` mode it delegates to `previewWorkingTreeDebt` (from `diff-preview.ts`); if the preview reports `notGitRepo`, the orchestrator returns `emptyImpact(mode, true)` and stops — the rest of the impact is deliberately left empty so the call is a clean degrade rather than an error. In `debt` mode it delegates to `seedFromDebt`, which reads the open debt rows through `runStatus` from `status.ts` and groups them by `wiki_path` to mirror the preview's page shape. Debt items lacking a `symbol_key` or `wiki_path` cannot seed the impact view and are skipped.

<!-- lw:anchors packages/core/src/change-impact.ts#seedFromDebt -->

```ts
async function seedFromDebt(
  absRoot: string,
): Promise<{ changedFiles: string[]; pages: ImpactPage[] }>
```

`seedFromDebt` takes an absolute repository root and returns the changed files plus the per-wiki-page symbol groupings used downstream. It returns empty arrays when no index DB exists, and otherwise reuses `runStatus` as the single source of truth for open debt.

### Read-only index existence check

The orchestrator touches the index DB in two places — the debt seed and the importer computation — and in both cases the touch is conditional on the DB already existing on disk. This is the read-only guarantee: nothing is created or migrated, only consulted.

<!-- lw:anchors packages/core/src/change-impact.ts#indexDbExists -->

```ts
async function indexDbExists(absRoot: string): Promise<boolean>
```

`indexDbExists` takes an absolute repository root and returns `true` only when `.livewiki/index.db` is already present. It returns `false` (never throws) when the path is missing or unreadable, which is what lets the rest of the pipeline degrade cleanly.

## Building the bounded output

With the seed in hand, the orchestrator flattens and dedupes the changed symbols, applies the section caps, decides whether to compute the importer view, attaches snippets for the highest-priority symbols, and finally assembles a `ChangeImpact` value whose `truncated` flag and `totals` block make any binding cap visible.

### Flattening, capping, and assembling the package

```ts
export async function computeChangeImpact(
  repoRoot: string,
  opts: ChangeImpactOptions = {},
): Promise<ChangeImpact>
```

`computeChangeImpact` takes a repository root and an optional `ChangeImpactOptions` and returns a bounded `ChangeImpact`. Internally it resolves the path, applies `IMPACT_BUDGETS` defaults to any missing caps, picks a seed, flattens symbol keys into a `Map` (first event per symbol wins, ties resolved by sorted key order), slices each list to its cap, gates the importer computation behind `indexDbExists`, asks `snippetForSymbol` (from `update.ts`) for a window per top-priority symbol, and finally returns the package with `truncated` set whenever any pre-cap list exceeded its post-cap slice.

<!-- lw:anchors packages/core/src/change-impact.ts#computeChangeImpact -->

The `notGitRepo` flag is set only in `working-tree` mode when the git diff cannot be computed; in `debt` mode it is always `false` because the seed path does not touch git. Snippet candidates are drawn from the post-symbol-cap list, so a bound on `maxSymbols` propagates into a smaller snippet candidate set — and that propagation is itself one of the four conditions that can flip `truncated` to `true`.

### Empty-package factory

The not-a-git-repo degrade and any other "nothing to report" exit need a structurally complete `ChangeImpact` — every section present, every `totals` field zero, `truncated` `false` — so callers can render without special-casing.

<!-- lw:anchors packages/core/src/change-impact.ts#emptyImpact -->

```ts
function emptyImpact(mode: "working-tree" | "debt", notGitRepo: boolean): ChangeImpact
```

`emptyImpact` takes the active mode and the `notGitRepo` flag and returns a `ChangeImpact` whose lists are empty, whose `totals` are all zero, and whose `truncated` is `false`. It exists so the working-tree / not-a-git-repo branch can return without a throw and without leaving any field undefined.

## Direct importer computation

The dependency signal answers "which files import a changed file", not "which files are unchanged". It is recomputed on demand from the live index — never persisted, never cached — because the same strictness applies here as in `risk.ts`: the workspace map is empty, relative edges carry the signal, and only anchored-tier languages are parsed for imports.

<!-- lw:anchors packages/core/src/change-impact.ts#computeDirectImporters -->

```ts
async function computeDirectImporters(
  absRoot: string,
  changedFiles: ReadonlySet<string>,
): Promise<string[]>
```

`computeDirectImporters` takes an absolute repository root and the set of changed files, opens the existing index DB through `openIndexReadOnly` (read-only: no schema work, no migration, and it never creates the file), collects imports for the anchored-tier files (using the same `EXTENSION_LANG` tier projection as `status.ts`), resolves the edges through `resolveImportEdges` with an empty `workspacePackages` list, and returns the distinct `fromFile` values for edges whose `toFile` is in the changed set — sorted, deduped, and ready for the section cap. The `try/finally` closes the DB even on any resolution error.

## Tests

Covered by `packages/core/src/change-impact.test.ts` (same-name test file on disk).
