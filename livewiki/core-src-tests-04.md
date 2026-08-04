---
title: Core Src Tests 04
owner: generated
anchors:
  - packages/core/src/flows.test.ts#mod
  - packages/core/src/flows.test.ts#overlapFixture
  - packages/core/src/flows.test.ts#shuffled
  - packages/core/src/flows.test.ts#shuffledMap
  - packages/core/src/ignores-propagation.test.ts#FullMockLlm
  - packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate
  - packages/core/src/ignores-propagation.test.ts#activeFilePaths
  - packages/core/src/ignores-propagation.test.ts#writeIgnores
  - packages/core/src/import-resolution.test.ts#edgesOf
  - packages/core/src/import-resolution.test.ts#imp
  - packages/core/src/import-resolution.test.ts#rsEdges
  - packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest
  - packages/core/src/import-resolution.test.ts#writeFile
  - packages/core/src/indexer.test.ts#activeSymbolsForKey
  - packages/core/src/indexer.test.ts#activeSymbolsForKeyIn
  - packages/core/src/indexer.test.ts#mutateStoredGrammarState
  - packages/core/src/indexer.test.ts#rationalesForFile
  - packages/core/src/indexer.test.ts#simulatePreGrammarIndex
  - packages/core/src/init-stale-module-pages.test.ts#exists
  - packages/core/src/init-stale-module-pages.test.ts#page
  - packages/core/src/init-stale-module-pages.test.ts#write
  - packages/core/src/install.test.ts#writeHome
---

# Core Src Tests 04

`core-src-tests-04` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 12 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### mod
<!-- lw:anchors packages/core/src/flows.test.ts#mod -->

`function mod(id: string, paths: string[], displayTitle?: string): Module {` is a function defined in `packages/core/src/flows.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### shuffled
<!-- lw:anchors packages/core/src/flows.test.ts#shuffled -->

`function shuffled<T>(arr: readonly T[], seed: number): T[] {` is a function defined in `packages/core/src/flows.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### shuffledMap
<!-- lw:anchors packages/core/src/flows.test.ts#shuffledMap -->

`function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V> {` is a function defined in `packages/core/src/flows.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### overlapFixture
<!-- lw:anchors packages/core/src/flows.test.ts#overlapFixture -->

`function overlapFixture() {` is a function defined in `packages/core/src/flows.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### writeHome
<!-- lw:anchors packages/core/src/install.test.ts#writeHome -->

`async function writeHome(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/install.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### imp
<!-- lw:anchors packages/core/src/import-resolution.test.ts#imp -->

`function imp(source: string): ExtractedImport {` is a function defined in `packages/core/src/import-resolution.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### edgesOf
<!-- lw:anchors packages/core/src/import-resolution.test.ts#edgesOf -->

`function edgesOf(` is a function defined in `packages/core/src/import-resolution.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### writeFile
<!-- lw:anchors packages/core/src/import-resolution.test.ts#writeFile -->

`async function writeFile(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/import-resolution.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### writeAcmeCoreManifest
<!-- lw:anchors packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest -->

`async function writeAcmeCoreManifest(): Promise<void> {` is a function defined in `packages/core/src/import-resolution.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### rsEdges
<!-- lw:anchors packages/core/src/import-resolution.test.ts#rsEdges -->

`function rsEdges(` is a function defined in `packages/core/src/import-resolution.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### FullMockLlm
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm -->

`class FullMockLlm implements LlmClient {` is a class defined in `packages/core/src/ignores-propagation.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### FullMockLlm.generate
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/ignores-propagation.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### writeIgnores
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#writeIgnores -->

`async function writeIgnores(ignores: string[]): Promise<void> {` is a function defined in `packages/core/src/ignores-propagation.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### activeFilePaths
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#activeFilePaths -->

`async function activeFilePaths(root: string): Promise<string[]> {` is a function defined in `packages/core/src/ignores-propagation.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### activeSymbolsForKey
<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKey -->

`async function activeSymbolsForKey(key: string): Promise<ActiveSymbolRow[]> {` is a function defined in `packages/core/src/indexer.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### activeSymbolsForKeyIn
<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKeyIn -->

`async function activeSymbolsForKeyIn(root: string, key: string): Promise<ActiveSymbolRow[]> {` is a function defined in `packages/core/src/indexer.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### rationalesForFile
<!-- lw:anchors packages/core/src/indexer.test.ts#rationalesForFile -->

`async function rationalesForFile(path: string): Promise<RationaleQueryRow[]> {` is a function defined in `packages/core/src/indexer.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### simulatePreGrammarIndex
<!-- lw:anchors packages/core/src/indexer.test.ts#simulatePreGrammarIndex -->

`async function simulatePreGrammarIndex(): Promise<void> {` is a function defined in `packages/core/src/indexer.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### mutateStoredGrammarState
<!-- lw:anchors packages/core/src/indexer.test.ts#mutateStoredGrammarState -->

`async function mutateStoredGrammarState(` is a function defined in `packages/core/src/indexer.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### page
<!-- lw:anchors packages/core/src/init-stale-module-pages.test.ts#page -->

`function page(owner: string): string {` is a function defined in `packages/core/src/init-stale-module-pages.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### write
<!-- lw:anchors packages/core/src/init-stale-module-pages.test.ts#write -->

`async function write(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/init-stale-module-pages.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

### exists
<!-- lw:anchors packages/core/src/init-stale-module-pages.test.ts#exists -->

`async function exists(rel: string): Promise<boolean> {` is a function defined in `packages/core/src/init-stale-module-pages.test.ts`, part of the automated tests surface of `core-src-tests-04` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependency

> Coverage note: this module's source (12 files, ~232k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
