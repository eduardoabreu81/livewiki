---
title: init command entry point
owner: generated
anchors:
  - packages/core/src/init.ts#runInit
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#syncClassDiagrams
  - packages/core/src/init.ts#syncStaleFlowArtifacts
  - packages/core/src/init.ts#syncStaleTopicArtifacts
  - packages/core/src/init.ts#syncStaleModulePages
  - packages/core/src/init.ts#readFlowPageOwner
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#formatNeighbors
  - packages/core/src/init.ts#escapeHtmlId
---

# init command entry point

This page is responsible for the `livewiki init` CLI command: it indexes the repository, writes the deterministic `livewiki/` surface (quickstart, structure diagram, modules graph, class diagrams, navigation hubs), and optionally hands off to the LLM batch pipeline.

## When to use this page

- **Read** when you need to understand what `livewiki init` actually does — the order it writes files in, which surfaces are deterministic and which require an LLM, and how ownership is enforced on the wiki pages it touches.
- **Read** when you are touching any of the stale-sync paths (class diagrams, flow artifacts, topic artifacts, module pages) and need the ownership contract for "may I delete this file?".
- **Modify** when you add a new deterministic surface to `init` (a new artifact that should always exist on a clean repo), or when you change how `init --batch` propagates batch status into the manifest and POSIX exit code.
- **Modify** when you change the flow between `init` and `batch.ts` — for example, what `init` pre-creates versus what the batch hook (`regenerateArchitectureOverview`) re-creates at the end of a run.

## How it fits

`packages/core/src/init.ts` is the `livewiki init` orchestrator in the `packages/core` library. It sits in front of the indexer (`./indexer.js`), the SQLite symbol DB (`./db.js`), the anchor ledger (`./anchor-ledger.js`), the module planner (`./modules.js`, `./page-units.js`), the diagram generator (`./diagrams.js`), the navigation and manifest helpers (`./navigation.js`, `./manifest.js`), and — only when `opts.batch` is set — the batch pipeline (`./batch.js`, dynamically imported to avoid a cycle).

`runInit` is the public entry point. It guarantees the `.livewiki/` and `livewiki/` directories exist, runs the deterministic layout pass, and conditionally delegates the LLM-driven doc generation to `runBatch`. Its companions are `syncClassDiagrams`, `syncStaleFlowArtifacts`, `syncStaleTopicArtifacts`, and `syncStaleModulePages` for keeping generated surfaces in sync with the current plan; `regenerateArchitectureOverview` as the deterministic regeneration hook the batch calls at the end of a run; `readFlowPageOwner` as the single owner-probe used by every stale-sync path; and the small Markdown helpers `generateArchitectureOverview`, `formatNeighbors`, and `escapeHtmlId`.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-init.mmd
```

## Repository scaffolding and indexer warm-up

WHY: before any planning or rendering can happen, the file system must contain the directories the layout pass expects, the `.livewiki/` SQLite cache must be `.gitignore`d (it is derived state, never committed), and the symbol index plus anchor ledger must reflect the current tree. `runInit` also has to load config exactly once so the indexer and the private planner agree on `ignores` and split thresholds.

`runInit` resolves the absolute repo root, creates `.livewiki/`, `livewiki/`, `livewiki/architecture/`, and `livewiki/diagrams/` via the safe I/O wrapper, and calls `ensureGitignoreEntries(absRoot, [".livewiki/"])` — idempotent, so re-init is a no-op when the entry already exists. It then loads `livewiki.config.json` once and resolves extra ignores; `loadConfig` throws on malformed JSON (intentional T0 fail-closed — never silently apply defaults). With that config it runs the indexer (forwarding `extraIgnores` only when non-empty) and the anchor ledger, both with `quiet` honored when set.

If `--plan` is on, `runInit` short-circuits here: it returns `InitPlanReport` containing the planned `modules`, `edges`, `ordered`, `totalSymbols`, and `totalFiles` with no file writes and no LLM. Otherwise it proceeds to the deterministic layout pass below.

<!-- packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan -->

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

`runInit` takes the `InitOptions` flags (`batch`, `plan`, `noRefine`, `batchConcurrency`, `language`, `quiet`, plus the repo root) and returns the `InitResult` whose `filesWritten`, optional `plan`/`batchSummary`/`batchExitCode`, and optional skipped-hub and skipped-candidate fields the CLI uses to render its output.

```ts
async function buildPlan(
  absRoot: string,
  rawConfig: LivewikiConfig,
): Promise<{
  symbols: SymbolRow[];
  filePaths: string[];
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
  pathRoleConfig?: PathRoleConfig;
}>
```

`buildPlan` opens `.livewiki/index.db`, reads the active symbols and active files (every active symbol points at an active file by construction of the indexer), runs `planPageUnits` to derive folder modules (`applyDefaults` provides the file-split threshold), then asserts `assertExactPathPartition` and `assertUniqueModuleIds` and applies `makeUniqueDeterministicIds`. It collects imports per file, runs `resolveImportEdges` with the same one-resolver wiring the batch uses (relative AND workspace specifiers), and produces `edges` via `resolveModuleEdges`. The returned `pathRoleConfig` is passed forward to the navigation and overview helpers so role classification is consistent across every rendered surface.

## Deterministic layout pass

WHY: after planning, the init surface that any user can read on a fresh repo must be produced without calling an LLM — quickstart, structure diagram, modules graph, class diagrams, the navigation hubs, and the architecture overview. This is the pass that makes `init` (without `--batch`) useful on its own.

`runInit` emits `livewiki/architecture/structure.mmd` from `generateStructure(filePaths)`, then `livewiki/architecture/modules.mmd` from `generateModulesGraph(edges)`, then calls `syncClassDiagrams` to align `livewiki/diagrams/<slug>.classes.mmd` with the current module plan. After that it loads `ModulePresentation`s, `loadFlowPresentations`, and `loadTopicPresentations`, then runs the three hub syncs (`syncFlowsIndexHub`, `syncTopicsIndexHub`, `syncAuxiliaryIndexHub`) — recording `skippedFlowsHub`, `skippedAuxiliaryHub`, and `skippedTopicsHub` whenever a hub is preserved because its frontmatter owner is human, mixed, or unparseable (R10.1 C / R11-NAV / R11-A — never a silent skip).

It then renders `livewiki/quickstart.md` (using `generateQuickstart` with `loadModuleDigests`, `extractRepoOrientation`, and `loadUnderstandingSynthesis`), `livewiki/tasks.md` (via `generateTasksPage`), and `livewiki/architecture/overview.md` (via the internal `generateArchitectureOverview`). `updateModuleNavigateBlocks` and `updateFlowTopicLinks` apply final cross-link fixes. The manifest is written via `writeManifestIfChanged` — and only listed in `filesWritten` when it actually changed, to avoid fake-write entries that would confuse the anti-loop CI snapshot rule.

<!-- packages/core/src/init.ts#syncClassDiagrams -->

```ts
export async function syncClassDiagrams(
  repoRoot: string,
  modules: Module[],
  symbols: SymbolRow[],
): Promise<ClassDiagramSyncResult>
```

`syncClassDiagrams` regenerates every desired `livewiki/diagrams/<slug>.classes.mmd` for modules whose `generateClassDiagram` yields content, then walks the directory and removes any `.classes.mmd` file that is not in the desired set. Files without the `.classes.mmd` suffix are preserved — the deterministic generator owns only that suffix.

## Handing off to the batch pipeline

WHY: `init --batch` exists precisely to layer LLM-driven doc generation on top of the deterministic surface. The hand-off must not re-create the index (the deterministic pass already did that), must not double-write the manifest, and must propagate the batch's real status out as `batchExitCode` so the CLI can exit `0`/`1`/`2` instead of always `0`.

When `opts.batch` is set, `runInit` dynamically imports `./batch.js` to avoid a cycle and calls `runBatch` with `noRefine`, `language`, and `concurrency` forwarded, `skipManifestWrite: true`, and no programmatic `extraIgnores` (the on-disk config is the single source of truth). It then stores `result.tasksDone` and `result.tasksFailed` (the authoritative per-task counters from `cb.done` and `cb.fails`) in `batchSummary`, maps `result.status` to a POSIX exit code via `statusToExitCode`, and forwards any `skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`, `skippedFlowCandidates`, or `skippedTopicPlan` the batch surfaced — these are reported in CLI output but never persisted for status queries (R10.1 C, R10.1 K, R11-NAV, R11-A, and the v25 priority-0 topic-plan ceiling fix).

Finally `runInit` refreshes the manifest handoff state: when the batch ended in `completed_with_failures` or `aborted`, it writes `pendingBatch: { runId, stage: 4, done, total }` so a later run can resume the open work; otherwise it writes `pendingBatch: null`.

## Regeneration hook for the batch end-of-run

WHY: after the LLM batch finishes, every deterministic surface it touched (quickstart, overview, navigation blocks, flow and topic links) must be rebuilt so it points at the freshly accepted pages. The batch cannot import init directly without a cycle, so this hook is the public regeneration entry point with the same guarantees as the deterministic pass.

<!-- packages/core/src/init.ts#regenerateArchitectureOverview -->

```ts
export async function regenerateArchitectureOverview(
  repoRoot: string,
  opts: { acceptedTopicSlugs?: ReadonlySet<string> } = {},
): Promise<{ flowsHub: FlowsHubSyncResult; topicsHub: TopicsHubSyncResult; auxiliaryHub: AuxiliaryHubSyncResult }>
```

`regenerateArchitectureOverview` re-loads the config (the batch caller does not pass it through — this hook is its own entry point), runs `buildPlan` for the current plan, then re-runs the three hub syncs, `generateQuickstart` (now with `loadModuleDigests` from the accepted module pages), `generateTasksPage`, `generateArchitectureOverview`, `updateModuleNavigateBlocks`, and `updateFlowTopicLinks`. It returns the three hub outcomes so the caller can surface protected hubs that were preserved. As a last step it refreshes the manifest snapshot hash while preserving `lastDocumentedCommit` and the batch handoff state, so navigation updates do not invalidate the anti-loop CI rule.

## Stale-page synchronization

WHY: when the module plan or candidate set changes between runs, files that were generated last time may no longer be valid (for example, a folder unit disappeared, a flow no longer matches a function, a topic was retired). Removing them silently is unsafe — a human-edited page that happens to live at the same path must never be deleted by automation. Every stale-sync path therefore funnels through the same ownership probe so the rule stays consistent across class, flow, topic, and module surfaces.

<!-- packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#syncStaleModulePages -->

```ts
function readFlowPageOwner(content: string): "generated" | "other"
```

`readFlowPageOwner` strips an optional UTF-8 BOM, requires the content to start with a `---\n` or `---\r\n` frontmatter delimiter (returning `"other"` otherwise — this covers missing, invalid, and unparseable cases), normalizes CRLF to LF, then parses the frontmatter and returns `"generated"` only when `owner === "generated"` exactly. Any other value (human, mixed, missing key, unparseable YAML) returns `"other"` and the caller preserves the file byte-for-byte.

```ts
export async function syncStaleFlowArtifacts(
  repoRoot: string,
  candidates: FlowCandidate[],
): Promise<StaleFlowSyncResult>
```

`syncStaleFlowArtifacts` walks `livewiki/flows/*.md` (excluding `index.md`) and removes each one whose slug is not in the candidate set AND whose frontmatter declares `owner: generated`. Companion `livewiki/diagrams/flow-<slug>.mmd` files are removed only when the corresponding page is absent or was just removed above — a preserved human or mixed page keeps its diagram. `flows/index.md` and any non-matching file are never touched.

```ts
export async function syncStaleTopicArtifacts(
  repoRoot: string,
  candidates: ReadonlyArray<TopicCandidate>,
): Promise<string[]>
```

`syncStaleTopicArtifacts` applies the same contract to `livewiki/topics/*.md` (excluding `index.md`): a page is removed only when its slug is not in the candidate set AND its frontmatter says `owner: generated`. Returns the sorted list of removed paths.

```ts
export async function syncStaleModulePages(
  repoRoot: string,
  keepPagePaths: ReadonlySet<string>,
): Promise<StaleModulePageSyncResult>
```

`syncStaleModulePages` walks `livewiki/` recursively (skipping the reserved hubs `topics/`, `flows/`, `architecture/`, `diagrams/`, `auxiliary/` and the deterministic root pages `quickstart.md`, `tasks.md`, `understanding.md`) and removes a `.md` file only when its full `livewiki/...` path is not in `keepPagePaths` AND `readFlowPageOwner` says `"generated"`. The keep-set must be the set of resolved page paths (e.g. `livewiki/<folder>/<file>.md`), never module ids — the pre-#29 `${module.id}.md` keep-set would have deleted the whole wiki the moment page paths stopped being module ids, and since the affected pages are `owner: generated` the ownership guard would not have saved them. Empty folders left behind are removed; empty-dir cleanup is best-effort. Callers must pass an effective keep-set and must NOT invoke this from a plain init or `--only` run — those derive a plan that may differ from a previously accepted one and would make valid pages look stale.

## Architecture overview rendering

WHY: `livewiki/architecture/overview.md` is the deterministic narrative that explains the repository shape (folder counts, product folders with their dependencies and dependents, link to the auxiliary inventory, link to flows and topics when their hubs exist) without calling an LLM. The helpers below are the small pieces used to emit stable HTML anchors and to format neighbor lists consistently with the rest of the navigation surfaces.

<!-- packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

```ts
async function generateArchitectureOverview(opts: {
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
  edges: Array<{ from: string; to: string }>;
  presentations: Map<string, ModulePresentation>;
  hasTopics: boolean;
  pathRoleConfig?: PathRoleConfig;
}): Promise<string>
```

`generateArchitectureOverview` emits a single Markdown page with `owner: generated` frontmatter, the headline counts, and existence-gated links to the concept-topic and flows hubs. It then lists the product folders (filtered via `classifyModuleRole`) most-important first, with an `<a id="${escapeHtmlId(m.id)}"></a>` anchor (so the quickstart's `#${m.id}` link is guaranteed valid), representative paths, and existence-gated artifact links to the folder page and class diagram. Each product folder shows its dependencies and dependents via `formatNeighbors`, and the page closes with Mermaid embeds for `structure.mmd` and `modules.mmd`.

```ts
function formatNeighbors(
  related: Array<{ moduleId: string }>,
  presentations: Map<string, ModulePresentation>,
): string
```

`formatNeighbors` returns `"none"` when the list is empty, otherwise a comma-separated string where each neighbor is either a Markdown link to `../<id>/index.md` (when `presentation.pageExists`) or the display title followed by `(page not written yet)`.

```ts
function escapeHtmlId(s: string): string
```

`escapeHtmlId` replaces every character that is not `A-Z`, `a-z`, `0-9`, `.`, `-`, or `_` with `_`. This keeps `<a id="...">` values valid HTML attributes and byte-identical to the `#<id>` links the quickstart emits.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleModulePages packages/core/src/init.ts#syncStaleTopicArtifacts -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Likely also exercised by `packages/core/src/init-config.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/init-overview.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/init-stale-module-pages.test.ts` (name-prefix match, not verified).
