---
title: Init, install, manifest, markdown-mask, and mermaid-validator support
owner: generated
anchors:
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#escapeHtmlId
  - packages/core/src/init.ts#formatNeighbors
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#readFlowPageOwner
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#runInit
  - packages/core/src/init.ts#syncClassDiagrams
  - packages/core/src/init.ts#syncStaleFlowArtifacts
  - packages/core/src/init.ts#syncStaleTopicArtifacts
  - packages/core/src/init.ts#syncStaleModulePages
  - packages/core/src/install.ts#AGENT_REGISTRY
  - packages/core/src/install.ts#SHARED_SKILL_TARGET
  - packages/core/src/install.ts#TOML_BLOCK_END
  - packages/core/src/install.ts#TOML_BLOCK_START
  - packages/core/src/install.ts#applyInstall
  - packages/core/src/install.ts#buildLocalCommandEntry
  - packages/core/src/install.ts#buildMcpEntry
  - packages/core/src/install.ts#deepEqual
  - packages/core/src/install.ts#detectAgents
  - packages/core/src/install.ts#getAgentDefinition
  - packages/core/src/install.ts#isPlainObject
  - packages/core/src/install.ts#mergeClaudeCodeSettings
  - packages/core/src/install.ts#mergeMcpServersJson
  - packages/core/src/install.ts#mergeTomlManagedBlock
  - packages/core/src/install.ts#pathExists
  - packages/core/src/install.ts#planAgentHook
  - packages/core/src/install.ts#planGitHook
  - packages/core/src/install.ts#planInstall
  - packages/core/src/install.ts#planMcpConfig
  - packages/core/src/install.ts#planPointer
  - packages/core/src/install.ts#planSkill
  - packages/core/src/install.ts#readIfExists
  - packages/core/src/install.ts#renderTomlManagedBlock
  - packages/core/src/install.ts#renderYamlManagedBlock
  - packages/core/src/install.ts#stopEntryCommands
  - packages/core/src/install.ts#stripJsoncComments
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#writeManifestIfChanged
  - packages/core/src/markdown-mask.ts#boundedExcerpt
  - packages/core/src/markdown-mask.ts#consumeFenceLine
  - packages/core/src/markdown-mask.ts#createFenceState
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength
  - packages/core/src/markdown-mask.ts#maskInlineCode
  - packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic
  - packages/core/src/mermaid-validator.ts#parseWithTemporaryDom
  - packages/core/src/mermaid-validator.ts#restoreGlobal
  - packages/core/src/mermaid-validator.ts#validateMermaidSyntax
---

# Init, install, manifest, markdown-mask, and mermaid-validator support

This page documents the core support layer that backs the `livewiki init` and `livewiki install` commands, the on-disk `livewiki/.manifest.json` snapshot, and the Markdown and Mermaid validation helpers shared across the verification pipeline.

## When to use this page

- Read `init` before changing how `livewiki init` builds the deterministic wiki layout.
- Read `install` before changing agent detection probes, MCP merge adapters, or the opt-in pointer.
- Read `manifest` before changing `livewiki/.manifest.json` schema, hashing, or the anti-loop guard.

## How it fits

The `init` module is the principal entry point of the `livewiki init` command. It ensures `.livewiki/` and `livewiki/` exist (and that `.livewiki/` is gitignored), indexes the repo, computes a deterministic module plan via `buildPlan`, then writes the layout. With `--plan` it stops before any write and returns an `InitPlanReport`; without `--plan` it generates `structure.mmd`, `modules.mmd`, one `diagrams/<slug>.classes.mmd` per module via `syncClassDiagrams`, and the manifest via `manifest.ts`, then reconciles the flows, topics, and auxiliary index hubs with on-disk ownership so human-owned hubs surface as `skippedFlowsHub`, `skippedTopicsHub`, or `skippedAuxiliaryHub` instead of being silently overwritten. With `--batch` it forwards to the batch pipeline (not in this module) and reports the batch summary plus `batchExitCode`.

The `install` module is the registry-and-merger half of `livewiki install`. A pure-data `AGENT_REGISTRY` describes detection probes, MCP config shape, hook templates, and skill consumption; pure helpers (`buildMcpEntry`, `buildLocalCommandEntry`, `stripJsoncComments`) produce the documented MCP entry and prepare JSONC for parsing. The `plan*` family composes detection and adapter results into `InstallAction[]`; `applyInstall` performs them. Home-dir writes deliberately bypass `safe-io` (which only knows repo-internal paths), and refusal semantics keep foreign files, unparseable JSON, or non-equal `livewiki` entries from being clobbered.

The `manifest` module is the read, write, and equality layer for `livewiki/.manifest.json` (schema `MANIFEST_VERSION`, relative path `MANIFEST_REL_PATH`). It exposes a corruption-tolerant `readManifest`, a deterministic `computeSnapshotHash` over `livewiki/` excluding the manifest itself, and `writeManifestIfChanged` which is the anti-loop guard: it only rewrites when content actually changes (ignoring `updatedAt`), keeping CI `git diff` clean.

The `markdown-mask` module provides small, deterministic Markdown masking helpers used by verify, artifact, and anchor pipelines. It distinguishes three masking modes (blank-out, length-preserving blank-out, length-preserving inline-code-only), exposes `hasUnclosedMarkdown` as the structural truncation signal, and produces a deterministic `unclosedMarkdownDiagnostic` with kind, line number, bounded excerpt, and exact delimiter length.

The `mermaid-validator` module is a thin, process-wide isolation layer around Mermaid's parser. It serializes calls behind a single promise queue, swaps `window` and `document` for a temporary `jsdom` instance per parse, and restores the previous globals in `finally` so concurrent or interleaved validations do not corrupt host state.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-05.mmd
```

## Init entry point and plan builder

<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#readFlowPageOwner -->

`runInit` is the principal entry point of `livewiki init`. The full signature shown in the symbol table is `export async function runInit(opts: InitOptions): Promise<InitResult>`. It guarantees `.livewiki/`, `livewiki/`, `livewiki/architecture/`, and `livewiki/diagrams/` exist, ensures `.livewiki/` is gitignored, loads config once, runs the indexer and ledger, then calls `buildPlan` to assemble the module and edge surface.

In `plan` mode it returns immediately with `filesWritten: []` and the `InitPlanReport` (modules, edges, ordered, totalSymbols, totalFiles) — no LLM, no writes. Outside plan mode it generates `structure.mmd`, `modules.mmd`, reconciles class diagrams via `syncClassDiagrams`, then assembles the flows, topics, and auxiliary index hubs. Hubs owned by humans (or unparseable) are preserved and surfaced through `skippedFlowsHub`, `skippedTopicsHub`, and `skippedAuxiliaryHub` rather than silently overwritten.

The visible code never throws on hub ownership mismatch — it converts that into a structured field on `InitResult`. With `--batch`, `runInit` reports the batch runId, status, done, and failed summary and `batchExitCode` (mapped by the batch module, not here).

`buildPlan` is the private module-plan builder consumed by `runInit`. The symbol table lists its signature as `async function buildPlan(`. It produces the same `{ symbols, pathRoleConfig, filePaths, modules, edges, ordered, totalSymbols, totalFiles }` shape used by both `--plan` and the layout-writing branch, so init and batch (when it eventually loads the plan) cannot disagree on the configured `ignores` and split thresholds.

`readFlowPageOwner` inspects a flow page's body and returns `"generated"` when automation owns the file or `"other"` for human, mixed, or unparseable content. The symbol table gives no full signature, so behavior is limited to what is visible: a literal string return narrowed to those two possibilities. This is what allows `runInit` to preserve human-owned hubs and surface them as `skippedFlowsHub` rather than overwrite them.

`escapeHtmlId` and `formatNeighbors` are the small helper pair used when the generated architecture pages render module IDs as HTML anchors and list adjacency strings. They keep the rendered output stable across runs of the same module plan, which is what keeps the manifest `snapshotHash` byte-stable and CI anti-loop clean.

## Diagram generation and stale artifact sync

<!-- lw:anchors packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#syncStaleModulePages -->

`syncClassDiagrams` synchronizes the generated class-diagram surface for one complete module plan: `.classes.mmd` files under `livewiki/diagrams/` are owned by this deterministic generator; other files in that directory are preserved. The same call removes files left behind by an older plan (e.g. `src.classes.mmd` after IDs become `core-src-*`).

`generateArchitectureOverview` is the architecture-page renderer; `regenerateArchitectureOverview` re-runs it against the current index. They share the `formatNeighbors` and `escapeHtmlId` helper pair documented in the previous section.

`syncStaleFlowArtifacts`, `syncStaleTopicArtifacts`, and `syncStaleModulePages` are the deterministic surface trims paired with the corresponding generators: they remove artifacts whose owning plan entry no longer exists, so a re-init never leaves the wiki with pages that reference deleted modules, flows, or topics. Each returns the written paths for `runInit` to record on `filesWritten`.

## Agent registry

<!-- lw:anchors packages/core/src/install.ts#AGENT_REGISTRY packages/core/src/install.ts#getAgentDefinition packages/core/src/install.ts#SHARED_SKILL_TARGET -->

`AGENT_REGISTRY` is the pure-data list of `AgentDefinition`s that `livewiki install` knows how to detect and configure. The visible signature in the symbol table is `export const AGENT_REGISTRY: readonly AgentDefinition[] = [`. Each entry binds `id` and `displayName` to a set of home-relative `configProbes`, PATH `binProbes`, the MCP config location and `shape` (`json-mcpServers`, `json-local-command`, `toml-managed-block`, `yaml-managed-block`), and optional flags such as `hasStopHookTemplate` (claude-code) and `usesSharedSkills`. Agents deliberately omitted from the registry (e.g. mmx/minimax) are documented in the surrounding comment.

`getAgentDefinition` returns the entry for a given `id` or `undefined` when no agent matches. The signature in the symbol table is `export function getAgentDefinition(id: string): AgentDefinition | undefined {`.

`SHARED_SKILL_TARGET` is the home-relative path the shared skill is copied to. The signature in the symbol table is `export const SHARED_SKILL_TARGET = ".agents/skills/document-as-you-go/SKILL.md";`. Agents with `usesSharedSkills: true` consume this directory; others do not see the skill at all.

## Detection

<!-- lw:anchors packages/core/src/install.ts#detectAgents packages/core/src/install.ts#pathExists -->

`detectAgents` probes the filesystem (no `spawn`) for every entry in `AGENT_REGISTRY`. The signature in the symbol table is `export async function detectAgents(opts: { home: string; pathEnv: string; }): Promise<Record<AgentId, AgentDetection>>`. For each agent it records both hits and misses in `evidence` — a `config found: ~/.claude` line or `bin not found on PATH: codex` line — so the CLI can show why an agent was or was not selected.

`pathExists` is the small `node:fs/promises` wrapper behind detection. The signature in the symbol table is `async function pathExists(abs: string): Promise<boolean> {`. It resolves to `true` on a successful `access` and to `false` on any thrown error; nothing in the visible code makes it reject. Binary probing also walks PATH directories and the `BIN_VARIANTS` list (`""`, `.cmd`, `.exe`, `.ps1`) so Windows installations are not falsely reported missing.

## MCP entry builders and merge adapters

<!-- lw:anchors packages/core/src/install.ts#buildMcpEntry packages/core/src/install.ts#buildLocalCommandEntry packages/core/src/install.ts#stripJsoncComments packages/core/src/install.ts#mergeMcpServersJson packages/core/src/install.ts#mergeClaudeCodeSettings packages/core/src/install.ts#renderTomlManagedBlock packages/core/src/install.ts#renderYamlManagedBlock packages/core/src/install.ts#mergeTomlManagedBlock packages/core/src/install.ts#TOML_BLOCK_START packages/core/src/install.ts#TOML_BLOCK_END packages/core/src/install.ts#isPlainObject packages/core/src/install.ts#deepEqual packages/core/src/install.ts#stopEntryCommands -->

`buildMcpEntry` and `buildLocalCommandEntry` produce the documented MCP server entry. The symbol-table signatures are `export function buildMcpEntry(repoRoot: string): McpEntry {` and `export function buildLocalCommandEntry(repoRoot: string): LocalCommandMcpEntry {`. The JSON-shaped entry uses `{ command: "npx", args: ["-y", "@livewiki/mcp", "--repo", "<absolute-repo>"] }`; the local-command entry (`opencode`) wraps the same argv as a single array and sets `enabled: true`.

`stripJsoncComments` removes `//` line and `/* ... */` block comments outside string literals, preserving newlines so line numbers survive. The signature in the symbol table is `export function stripJsoncComments(text: string): string {`. Inside an open string the scanner treats `//`, `*`, and escape sequences as data, so `//` inside a quoted string is never stripped.

`mergeMcpServersJson` and `mergeClaudeCodeSettings` are the JSON-side mergers. They delegate structural equality to `isPlainObject` and `deepEqual`. The symbol table gives only `export function mergeMcpServersJson(` and `export function mergeClaudeCodeSettings(` (both incomplete). Both surface a `MergeResult` with `status: "write" | "skip" | "refuse"` and a `reason`, and refuse — rather than merge — when the existing file is unparseable or already contains a non-equal `livewiki` entry.

`renderTomlManagedBlock` and `renderYamlManagedBlock` produce the exact bytes of the delimited block (`TOML_BLOCK_START = "# livewiki:start"`, `TOML_BLOCK_END = "# livewiki:end"`, signatures `export const TOML_BLOCK_START = "# livewiki:start";` and `export const TOML_BLOCK_END = "# livewiki:end";`) that `mergeTomlManagedBlock` then splices into an existing Codex TOML or Hermes YAML config. There is no TOML or YAML parser in this module: the merge is a pure string splice inside the managed-block delimiters, and files outside the delimiters are never touched.

`isPlainObject` narrows `unknown` to `Record<string, unknown>` and rejects arrays and primitives. `deepEqual` walks arrays and plain objects recursively; the visible code returns `true` when both operands are `===`, when both are arrays of equal length with pairwise equal elements, or when both are plain objects with the same key set and pairwise equal values; otherwise it returns `false`.

`stopEntryCommands` flattens the `Stop` hook entry (claude-code) into a list of command strings used by `mergeClaudeCodeSettings` to detect duplicates. The symbol table gives no full signature; behavior is limited to flattening one hook entry's commands into a `string[]`.

## Plan and apply

<!-- lw:anchors packages/core/src/install.ts#planMcpConfig packages/core/src/install.ts#planAgentHook packages/core/src/install.ts#planSkill packages/core/src/install.ts#planGitHook packages/core/src/install.ts#planPointer packages/core/src/install.ts#planInstall packages/core/src/install.ts#applyInstall packages/core/src/install.ts#readIfExists -->

The `plan*` family composes detection and adapter results into `InstallAction[]`. `planInstall` is the orchestrator (signature `export async function planInstall(opts: PlanInstallOptions): Promise<InstallAction[]>`); `planMcpConfig`, `planAgentHook`, `planSkill`, `planGitHook`, and `planPointer` each cover one target. They share `readIfExists` (signature `async function readIfExists(abs: string): Promise<string | null> {`) which returns the existing file body or `null` when the target is missing, so a plan can distinguish "create new" from "merge into existing" before any write.

The pointer is opt-in: it only appears as a writable action when the caller passes `writePointer: true`. Without that flag it stays `requires-opt-in` and `applyInstall` never writes it — preserving the safety model that everything outside the repo allowlist must be opt-in.

`applyInstall` consumes the `InstallAction[]` produced by `planInstall`. The symbol table gives only `export async function applyInstall(` (signature incomplete). The visible code does not show the body, but the surrounding design guarantees that a `refuse` action never becomes a write and that home-dir writes deliberately bypass `safe-io` (which only knows repo-internal paths).

## Manifest schema, hash, and equality

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest -->

The manifest schema version is `MANIFEST_VERSION = 1` and the relative path is `MANIFEST_REL_PATH = "livewiki/.manifest.json"` (`export const MANIFEST_VERSION = 1;`, `export const MANIFEST_REL_PATH = "livewiki/.manifest.json";`). The on-disk shape is `{ version, lastDocumentedCommit, snapshotHash, updatedAt, pendingBatch }`.

`readManifest` is tolerant of corruption. The signature in the symbol table is `export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null> {`. It returns `null` if the file is missing, if the `exists` probe throws, if JSON parsing throws, or if `version` or `snapshotHash` are not the expected types — instead of propagating the error to the caller.

`computeSnapshotHash` walks `livewiki/` recursively (via `listFiles`), filters out the manifest itself, sorts the relative paths alphabetically, then computes a single `sha256` over `relpath\n<sha256(content)>\n` for each file, concatenated. The signature in the symbol table is `export async function computeSnapshotHash(repoRoot: string): Promise<string> {`. Determinism comes from the explicit sort; `nodeFs.readdir` order is not relied on.

`writeManifestIfChanged` is the anti-loop guard. The signature in the symbol table is `export async function writeManifestIfChanged(`. It reads the current manifest, compares via `manifestsEqual`, and returns `false` without touching the file when content matches. Only on a real change does it `JSON.stringify` and write via `safeIo.writeText`.

`manifestsEqual` deliberately ignores `updatedAt` so a re-compute of the timestamp does not invalidate the equality check; `pendingBatchEqual` compares the four scalar fields of a `PendingBatchRef` (or treats `null === null` as equal). `buildManifest` constructs a fresh manifest with `updatedAt = new Date().toISOString()`.

## Markdown code masking

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#boundedExcerpt -->

The masking layer has three surface helpers: `maskCodeSpans` (signature `export function maskCodeSpans(text: string): string {`) blanks fenced blocks then blanks inline code; `maskCodeSpansPreservingLength` (signature `export function maskCodeSpansPreservingLength(text: string): string {`) replaces the same characters with spaces so byte offsets survive into the masked view; `maskInlineCode` (signature `export function maskInlineCode(text: string): string {`) handles only inline code following the CommonMark rule that the closing delimiter must match the opening run length, leaving unmatched backtick runs literal so `hasUnclosedMarkdown` can detect them.

`maskFencedCodeBlocks` splits on `/\r?\n/` (CRLF-safe) and runs `consumeFenceLine` per line; lines inside a fence become `""`. `maskFencedCodeBlocksPreservingLength` walks the string preserving `\r\n` boundaries and replaces consumed lines with spaces of the same width. The state machine — `createFenceState` returning `{ inFence, fenceChar, fenceLen }` and `consumeFenceLine(line, state): boolean` — is the only piece shared between the blanking and length-preserving variants.

`boundedExcerpt` is the helper that centers the diagnostic excerpt on a delimiter offset, so a 500-character line whose opening fence sits past column 200 still produces an excerpt that visibly contains the delimiter.

## Unclosed-construct detection and diagnostics

<!-- lw:anchors packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic -->

`hasUnclosedFence` (signature `export function hasUnclosedFence(text: string): boolean {`) returns true when the fence state machine ends still inside a fence. `hasUnclosedMarkdown` (signature `export function hasUnclosedMarkdown(text: string): boolean {`) adds the inline-code check: after masking fenced blocks and running `maskInlineCode`, any surviving backtick in the result is an unmatched inline run. The signal is structural, not a length heuristic — a well-formed document ends with zero unmatched backticks.

`unclosedMarkdownDiagnostic` (signature `export function unclosedMarkdownDiagnostic(`) returns `null` on a well-formed body or an `UnclosedMarkdownDiagnostic` with `kind: "fence" | "inline-code"`, a 1-based `lineNumber`, a `boundedExcerpt`, and the exact `delimiterLength`. For the fence case it remembers the line where the opening delimiter was matched; for the inline-code case it uses the length-preserving mask so the surviving backtick index maps 1:1 to the original body (including on CRLF input) and then translates that index back to a line number, an offset within that line, and the run length starting at the offset.

## Mermaid validator isolation

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

`validateMermaidSyntax` (signature `export function validateMermaidSyntax(source: string): Promise<string | null> {`) serializes calls behind a module-level promise queue and always returns a string diagnostic or `null` — it does not throw on a Mermaid parse failure. `parseWithTemporaryDom` (signature `async function parseWithTemporaryDom(source: string): Promise<string | null> {`) installs the shared `parserDom` as `window` and `document` on `globalThis`, lazy-loads `mermaid` and calls `mermaid.parse(source)`, then unconditionally restores prior globals in `finally`.

`restoreGlobal` (signature `function restoreGlobal(`) restores the previous `window` and `document` exactly: if the global existed before the call it is reassigned to its previous value, otherwise it is deleted. This makes nested or interleaved validations safe — the process-wide globals never observe a half-installed DOM.

The visible code contains a single `catch` in `parseWithTemporaryDom` that converts any thrown error into the returned diagnostic string; nothing else in the visible source throws, so the only visible failure shape is `error instanceof Error ? error.message : String(error)`.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (5 files, ~90k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
