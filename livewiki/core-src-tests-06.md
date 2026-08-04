---
title: Core Src Tests 06
owner: generated
anchors:
  - packages/core/src/prompts.test.ts#copyableAnchorMarkers
  - packages/core/src/prompts.test.ts#outerFenceFor
  - packages/core/src/readme-export.test.ts#readOrNull
  - packages/core/src/readme-export.test.ts#write
  - packages/core/src/readme-export.test.ts#writeFixtureWiki
  - packages/core/src/repair-contract.test.ts#err
  - packages/core/src/risk.test.ts#fakeSpawnError
  - packages/core/src/risk.test.ts#fakeSpawnOk
  - packages/core/src/risk.test.ts#tsImport
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
  - packages/core/src/status.test.ts#setupChangedDebtOnBoth
  - packages/core/src/status.test.ts#setupDeletedDebt
  - packages/core/src/status.test.ts#writeRepoFile
  - packages/core/src/status.test.ts#writeWikiPage
  - packages/core/src/symbols.test.ts#parse
  - packages/core/src/topics.test.ts#budgetInventory
  - packages/core/src/topics.test.ts#budgetProposal
  - packages/core/src/topics.test.ts#candidate
  - packages/core/src/topics.test.ts#clusterInventory
  - packages/core/src/topics.test.ts#deploymentModules
  - packages/core/src/topics.test.ts#fourGroupInventory
  - packages/core/src/topics.test.ts#inventory
  - packages/core/src/topics.test.ts#mod
  - packages/core/src/topics.test.ts#pairModules
  - packages/core/src/topics.test.ts#proposal
  - packages/core/src/understanding.test.ts#makeEvidence
  - packages/core/src/understanding.test.ts#makeValidPage
  - packages/core/src/update-metrics.test.ts#readLedger
  - packages/core/src/update.test.ts#git
  - packages/core/src/update.test.ts#gitCommitAll
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
---

# Core Src Tests 06

`core-src-tests-06` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 12 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### copyableAnchorMarkers
<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

`function copyableAnchorMarkers(text: string): string[][] {` is a function defined in `packages/core/src/prompts.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### outerFenceFor
<!-- lw:anchors packages/core/src/prompts.test.ts#outerFenceFor -->

`function outerFenceFor(` is a function defined in `packages/core/src/prompts.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### err
<!-- lw:anchors packages/core/src/repair-contract.test.ts#err -->

`function err(` is a function defined in `packages/core/src/repair-contract.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### tsImport
<!-- lw:anchors packages/core/src/risk.test.ts#tsImport -->

`function tsImport(source: string): ExtractedImport {` is a function defined in `packages/core/src/risk.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### fakeSpawnOk
<!-- lw:anchors packages/core/src/risk.test.ts#fakeSpawnOk -->

`function fakeSpawnOk(output: string, code = 0): SpawnImpl {` is a function defined in `packages/core/src/risk.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### fakeSpawnError
<!-- lw:anchors packages/core/src/risk.test.ts#fakeSpawnError -->

`function fakeSpawnError(): SpawnImpl {` is a function defined in `packages/core/src/risk.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### readLedger
<!-- lw:anchors packages/core/src/update-metrics.test.ts#readLedger -->

`async function readLedger(): Promise<UpdateMetricsFile> {` is a function defined in `packages/core/src/update-metrics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### writeCode
<!-- lw:anchors packages/core/src/update.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/update.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### writeWiki
<!-- lw:anchors packages/core/src/update.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/update.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### setupWithAnchor
<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor -->

`async function setupWithAnchor(): Promise<void> {` is a function defined in `packages/core/src/update.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### git
<!-- lw:anchors packages/core/src/update.test.ts#git -->

`function git(args: string[]): void {` is a function defined in `packages/core/src/update.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### gitCommitAll
<!-- lw:anchors packages/core/src/update.test.ts#gitCommitAll -->

`function gitCommitAll(message: string): void {` is a function defined in `packages/core/src/update.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### detectSymlinkSupport
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`async function detectSymlinkSupport(): Promise<boolean> {` is a function defined in `packages/core/src/safe-io.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### writeRepoFile
<!-- lw:anchors packages/core/src/status.test.ts#writeRepoFile -->

`async function writeRepoFile(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/status.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### setupChangedDebtOnBoth
<!-- lw:anchors packages/core/src/status.test.ts#setupChangedDebtOnBoth -->

`async function setupChangedDebtOnBoth(): Promise<void> {` is a function defined in `packages/core/src/status.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### writeWikiPage
<!-- lw:anchors packages/core/src/status.test.ts#writeWikiPage -->

`async function writeWikiPage(rel: string, frontmatter: string): Promise<void> {` is a function defined in `packages/core/src/status.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### setupDeletedDebt
<!-- lw:anchors packages/core/src/status.test.ts#setupDeletedDebt -->

`async function setupDeletedDebt(): Promise<void> {` is a function defined in `packages/core/src/status.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### parse
<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

`async function parse(ext: string, src: string) {` is a function defined in `packages/core/src/symbols.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### write
<!-- lw:anchors packages/core/src/readme-export.test.ts#write -->

`async function write(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/readme-export.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### readOrNull
<!-- lw:anchors packages/core/src/readme-export.test.ts#readOrNull -->

`async function readOrNull(rel: string): Promise<string | null> {` is a function defined in `packages/core/src/readme-export.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### writeFixtureWiki
<!-- lw:anchors packages/core/src/readme-export.test.ts#writeFixtureWiki -->

`async function writeFixtureWiki(): Promise<void> {` is a function defined in `packages/core/src/readme-export.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### makeValidPage
<!-- lw:anchors packages/core/src/understanding.test.ts#makeValidPage -->

`function makeValidPage(): string {` is a function defined in `packages/core/src/understanding.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### makeEvidence
<!-- lw:anchors packages/core/src/understanding.test.ts#makeEvidence -->

`function makeEvidence(): UnderstandingEvidence {` is a function defined in `packages/core/src/understanding.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### inventory
<!-- lw:anchors packages/core/src/topics.test.ts#inventory -->

`function inventory(): TopicPlanningInventory {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### proposal
<!-- lw:anchors packages/core/src/topics.test.ts#proposal -->

`function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### budgetInventory
<!-- lw:anchors packages/core/src/topics.test.ts#budgetInventory -->

`function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### budgetProposal
<!-- lw:anchors packages/core/src/topics.test.ts#budgetProposal -->

`function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### mod
<!-- lw:anchors packages/core/src/topics.test.ts#mod -->

`function mod(overrides: Partial<TopicModuleEvidence> & { id: string }): TopicModuleEvidence {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### clusterInventory
<!-- lw:anchors packages/core/src/topics.test.ts#clusterInventory -->

`function clusterInventory(modules: TopicModuleEvidence[]): TopicPlanningInventory {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### fourGroupInventory
<!-- lw:anchors packages/core/src/topics.test.ts#fourGroupInventory -->

`function fourGroupInventory(): TopicPlanningInventory {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### pairModules
<!-- lw:anchors packages/core/src/topics.test.ts#pairModules -->

`function pairModules(prefix: string, signals: [string[], string[]]): TopicModuleEvidence[] {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### deploymentModules
<!-- lw:anchors packages/core/src/topics.test.ts#deploymentModules -->

`function deploymentModules(): TopicModuleEvidence[] {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

### candidate
<!-- lw:anchors packages/core/src/topics.test.ts#candidate -->

`function candidate(groups: TopicCandidate["groups"]): TopicCandidate {` is a function defined in `packages/core/src/topics.test.ts`, part of the automated tests surface of `core-src-tests-06` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (12 files, ~310k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
