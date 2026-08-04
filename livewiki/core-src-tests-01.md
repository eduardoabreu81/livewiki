---
title: Core Src Tests 01
owner: generated
anchors:
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteExec
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery
  - packages/core/src/anchor-ledger.test.ts#simulateLegacyCrlfDb
  - packages/core/src/anchor-ledger.test.ts#writeCode
  - packages/core/src/anchor-ledger.test.ts#writeWiki
  - packages/core/src/artifact-repair.test.ts#makeFlowPage
  - packages/core/src/artifact-repair.test.ts#makePage
  - packages/core/src/artifact-repair.test.ts#validateFlow
  - packages/core/src/auxiliary-page.test.ts#assertValid
  - packages/core/src/auxiliary-page.test.ts#module
  - packages/core/src/batch-community.test.ts#MockLlm
  - packages/core/src/batch-community.test.ts#MockLlm.generate
  - packages/core/src/batch-community.test.ts#readStage2Checkpoint
  - packages/core/src/batch-community.test.ts#writeDivergentFixture
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm.calledModuleIds
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm.generate
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.calledModuleIds
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.constructor
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-concurrency.test.ts#createRepo
  - packages/core/src/batch-concurrency.test.ts#makeRepo
  - packages/core/src/batch-module-diagrams.test.ts#FifteenNodeLlm
  - packages/core/src/batch-module-diagrams.test.ts#FifteenNodeLlm.generate
  - packages/core/src/batch-module-diagrams.test.ts#ModuleDiagramMockLlm
  - packages/core/src/batch-module-diagrams.test.ts#ModuleDiagramMockLlm.generate
  - packages/core/src/batch-module-diagrams.test.ts#makeModulePage
  - packages/core/src/batch-module-diagrams.test.ts#parseClosedKeys
  - packages/core/src/batch-module-diagrams.test.ts#readFile
  - packages/core/src/batch-module-diagrams.test.ts#readTaskCheckpoint
  - packages/core/src/batch-module-diagrams.test.ts#writeConfig
  - packages/core/src/batch-module-diagrams.test.ts#writeModuleRepo
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeBothFailingPage
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeRelaxedOnlyPage
  - packages/core/src/batch-repair.test.ts#makeStrictFailingPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
---

# Core Src Tests 01

`core-src-tests-01` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 11 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### writeCode
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/anchor-ledger.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### writeWiki
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/anchor-ledger.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### nodeSqliteQuery
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

`function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>> {` is a function defined in `packages/core/src/anchor-ledger.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### nodeSqliteExec
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#nodeSqliteExec -->

`function nodeSqliteExec(repoRoot: string, sql: string): void {` is a function defined in `packages/core/src/anchor-ledger.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### simulateLegacyCrlfDb
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#simulateLegacyCrlfDb -->

`async function simulateLegacyCrlfDb(relPath: string, lfText: string): Promise<void> {` is a function defined in `packages/core/src/anchor-ledger.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeFlowPage
<!-- lw:anchors packages/core/src/artifact-repair.test.ts#makeFlowPage -->

`function makeFlowPage(anchors: string[], modules: string[]): string {` is a function defined in `packages/core/src/artifact-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### validateFlow
<!-- lw:anchors packages/core/src/artifact-repair.test.ts#validateFlow -->

`function validateFlow(content: string, closedKeyList: string[]) {` is a function defined in `packages/core/src/artifact-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makePage
<!-- lw:anchors packages/core/src/artifact-repair.test.ts#makePage -->

`function makePage(): string {` is a function defined in `packages/core/src/artifact-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### MockLlm (batch-community.test.ts)
<!-- lw:anchors packages/core/src/batch-community.test.ts#MockLlm -->

`class MockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-community.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### MockLlm.generate (batch-community.test.ts)
<!-- lw:anchors packages/core/src/batch-community.test.ts#MockLlm.generate -->

`async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-community.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### writeDivergentFixture
<!-- lw:anchors packages/core/src/batch-community.test.ts#writeDivergentFixture -->

`async function writeDivergentFixture(repoRoot: string): Promise<void> {` is a function defined in `packages/core/src/batch-community.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### readStage2Checkpoint
<!-- lw:anchors packages/core/src/batch-community.test.ts#readStage2Checkpoint -->

`async function readStage2Checkpoint(repoRoot: string): Promise<TaskCheckpoint> {` is a function defined in `packages/core/src/batch-community.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ValidMockLlm
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#ValidMockLlm -->

`class ValidMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ValidMockLlm.constructor
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#ValidMockLlm.constructor -->

`constructor(private readonly delayMs = 5) {}` is a method defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ValidMockLlm.generate
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#ValidMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ValidMockLlm.calledModuleIds
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#ValidMockLlm.calledModuleIds -->

`calledModuleIds(): string[] {` is a method defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### FailingMockLlm
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#FailingMockLlm -->

`class FailingMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### FailingMockLlm.generate
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#FailingMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### FailingMockLlm.calledModuleIds
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#FailingMockLlm.calledModuleIds -->

`calledModuleIds(): string[] {` is a method defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### createRepo
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#createRepo -->

`async function createRepo(moduleIds: string[]): Promise<string> {` is a function defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeRepo
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#makeRepo -->

`async function makeRepo(moduleIds: string[]): Promise<string> {` is a function defined in `packages/core/src/batch-concurrency.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ProgrammableMockLlm
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm -->

`class ProgrammableMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ProgrammableMockLlm.generate
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate -->

`async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeValidPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeValidPage -->

`function makeValidPage(closedKeyList: string[]): string {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeInvalidPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeInvalidPage -->

`function makeInvalidPage(uniqueText: string): string {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### readStage4Checkpoint
<!-- lw:anchors packages/core/src/batch-repair.test.ts#readStage4Checkpoint -->

`async function readStage4Checkpoint(` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### expectJoinedAttempts
<!-- lw:anchors packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`function expectJoinedAttempts(checkpoint: TaskCheckpoint): void {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeStrictFailingPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeStrictFailingPage -->

`function makeStrictFailingPage(): string {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeRelaxedOnlyPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeRelaxedOnlyPage -->

`function makeRelaxedOnlyPage(): string {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeBothFailingPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeBothFailingPage -->

`function makeBothFailingPage(): string {` is a function defined in `packages/core/src/batch-repair.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeCompactAuxiliaryPage
<!-- lw:anchors packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage -->

`function makeCompactAuxiliaryPage(closedKeys: string[]): string {` is a function defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### MockLlm (batch-review.test.ts)
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm -->

`class MockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### MockLlm.generate (batch-review.test.ts)
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm.generate -->

`async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### seedFiveFileRepo
<!-- lw:anchors packages/core/src/batch-review.test.ts#seedFiveFileRepo -->

`async function seedFiveFileRepo(): Promise<void> {` is a function defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### stage2ErrorCode
<!-- lw:anchors packages/core/src/batch-review.test.ts#stage2ErrorCode -->

`async function stage2ErrorCode(): Promise<string | undefined> {` is a function defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### executablePlanPaths
<!-- lw:anchors packages/core/src/batch-review.test.ts#executablePlanPaths -->

`async function executablePlanPaths(): Promise<string[]> {` is a function defined in `packages/core/src/batch-review.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### module
<!-- lw:anchors packages/core/src/auxiliary-page.test.ts#module -->

`function module(overrides: Partial<Module> = {}): Module {` is a function defined in `packages/core/src/auxiliary-page.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### assertValid
<!-- lw:anchors packages/core/src/auxiliary-page.test.ts#assertValid -->

`function assertValid(artifact: string, closedKeyList: string[], moduleId: string, moduleRole: "test" | "fixture" | "tooling" | "docs") {` is a function defined in `packages/core/src/auxiliary-page.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### parseClosedKeys
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#parseClosedKeys -->

`function parseClosedKeys(user: string): string[] {` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### makeModulePage
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#makeModulePage -->

`function makeModulePage(closedKeyList: string[], withDiagram: boolean): string {` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ModuleDiagramMockLlm
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#ModuleDiagramMockLlm -->

`class ModuleDiagramMockLlm implements LlmClient {` is a class defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### ModuleDiagramMockLlm.generate
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#ModuleDiagramMockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### writeModuleRepo
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#writeModuleRepo -->

`async function writeModuleRepo(root: string): Promise<void> {` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### writeConfig
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#writeConfig -->

`async function writeConfig(root: string, extra: Record<string, unknown>): Promise<void> {` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### readTaskCheckpoint
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#readTaskCheckpoint -->

`async function readTaskCheckpoint(` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### readFile
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#readFile -->

`async function readFile(root: string, rel: string): Promise<string | null> {` is a function defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### FifteenNodeLlm
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#FifteenNodeLlm -->

`class FifteenNodeLlm extends ModuleDiagramMockLlm {` is a class defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

### FifteenNodeLlm.generate
<!-- lw:anchors packages/core/src/batch-module-diagrams.test.ts#FifteenNodeLlm.generate -->

`override async generate(req: GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch-module-diagrams.test.ts`, part of the automated tests surface of `core-src-tests-01` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (11 files, ~417k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
