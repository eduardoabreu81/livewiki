---
title: Cli Src Tests
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#expectVerifyClean
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#proseTierHandler
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeOpenAiConfig
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#understandingResponse
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
  - packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#understandingResponse
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#git
  - packages/cli/src/cli-e2e.test.ts#gitInitCommit
  - packages/cli/src/cli-e2e.test.ts#readIndexCounts
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#setupAnchoredRepo
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli-export-e2e.test.ts#cliBin
  - packages/cli/src/cli-export-e2e.test.ts#listDest
  - packages/cli/src/cli-export-e2e.test.ts#readDest
  - packages/cli/src/cli-export-e2e.test.ts#readDestAt
  - packages/cli/src/cli-export-e2e.test.ts#runCli
  - packages/cli/src/cli-export-e2e.test.ts#writeWiki
  - packages/cli/src/cli-export-e2e.test.ts#writeWikiAt
  - packages/cli/src/cli-view-e2e.test.ts#cliBin
  - packages/cli/src/cli-view-e2e.test.ts#fileExists
  - packages/cli/src/cli-view-e2e.test.ts#runCli
  - packages/cli/src/cli-view-e2e.test.ts#writeFixtureWiki
  - packages/cli/src/cli-view-e2e.test.ts#writeWiki
  - packages/cli/src/install.test.ts#runCli
  - packages/cli/src/update-format.test.ts#baseImpact
  - packages/cli/src/update-format.test.ts#basePkg
---

# Cli Src Tests

`cli-src-tests` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 12 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### cliBin (cli-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin -->

`function cliBin(): string {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#runCli -->

`function runCli(args: string[]): CliRun {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeCode (cli-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeWiki (cli-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### statusDebt
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#statusDebt -->

`function statusDebt(): { changed: number; moved: number; deleted: number } {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeIgnoresConfig
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig -->

`async function writeIgnoresConfig(ignores: string[]): Promise<void> {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### readIndexCounts
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#readIndexCounts -->

`function readIndexCounts(): { scanned: number; added: number } {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### git
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#git -->

`function git(args: string[]): void {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### gitInitCommit
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#gitInitCommit -->

`function gitInitCommit(): void {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### setupAnchoredRepo
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#setupAnchoredRepo -->

`async function setupAnchoredRepo(): Promise<void> {` is a function defined in `packages/cli/src/cli-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### cliBin (cli-export-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin -->

`function cliBin(): string {` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-export-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#runCli -->

`function runCli(args: string[]): CliRun {` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeWiki (cli-export-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### readDest
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#readDest -->

`async function readDest(target: string, name: string): Promise<string | null> {` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### listDest
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#listDest -->

`async function listDest(target: string): Promise<string[]> {` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeWikiAt
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#writeWikiAt -->

`async function writeWikiAt(` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### readDestAt
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#readDestAt -->

`async function readDestAt(` is a function defined in `packages/cli/src/cli-export-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (install.test.ts)
<!-- lw:anchors packages/cli/src/install.test.ts#runCli -->

`async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {` is a function defined in `packages/cli/src/install.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### basePkg
<!-- lw:anchors packages/cli/src/update-format.test.ts#basePkg -->

`function basePkg(impact: WorkPackage["impact"]): WorkPackage {` is a function defined in `packages/cli/src/update-format.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### baseImpact
<!-- lw:anchors packages/cli/src/update-format.test.ts#baseImpact -->

`function baseImpact(): WorkPackage["impact"] {` is a function defined in `packages/cli/src/update-format.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### cliBin (cli-view-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-view-e2e.test.ts#cliBin -->

`function cliBin(): string {` is a function defined in `packages/cli/src/cli-view-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-view-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-view-e2e.test.ts#runCli -->

`function runCli(args: string[]): CliRun {` is a function defined in `packages/cli/src/cli-view-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeWiki (cli-view-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-view-e2e.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-view-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeFixtureWiki
<!-- lw:anchors packages/cli/src/cli-view-e2e.test.ts#writeFixtureWiki -->

`async function writeFixtureWiki(): Promise<void> {` is a function defined in `packages/cli/src/cli-view-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### fileExists
<!-- lw:anchors packages/cli/src/cli-view-e2e.test.ts#fileExists -->

`async function fileExists(abs: string): Promise<boolean> {` is a function defined in `packages/cli/src/cli-view-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### startStubServer (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#startStubServer -->

`async function startStubServer(): Promise<StubServer> {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### closedKeysFromPrompt (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#closedKeysFromPrompt -->

`function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### proseTierHandler
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#proseTierHandler -->

`function proseTierHandler(req: { system: string; user: string }): StubResponse | null {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#runCli -->

`function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeCode (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeOpenAiConfig (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeOpenAiConfig -->

`async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### expectVerifyClean (cli-batch-e2e-prose-tier.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#expectVerifyClean -->

`async function expectVerifyClean(): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e-prose-tier.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### startStubServer (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer -->

`async function startStubServer(): Promise<StubServer> {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### closedKeysFromPrompt (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt -->

`function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### understandingResponse (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#understandingResponse -->

`function understandingResponse(req: { system: string; user: string }): StubResponse | null {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### defaultHandler (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler -->

`function defaultHandler(req: { system: string; user: string }): StubResponse | null {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### isStage2RefinePrompt
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt -->

`function isStage2RefinePrompt(user: string): boolean {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### makeRefineHandler
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler -->

`function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>) {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli -->

`function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeCode (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeOpenAiConfig (cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e-subdirs.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### startStubServer (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer -->

`async function startStubServer(): Promise<StubServer> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### closedKeysFromPrompt (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt -->

`function closedKeysFromPrompt(user: string): string[] {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### modulePageHandler
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler -->

`function modulePageHandler(req: { system: string; user: string }): StubResponse {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### parseFlowPrompt
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt -->

`function parseFlowPrompt(user: string): FlowPromptCtx {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### makeFlowPage
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage -->

`function makeFlowPage(ctx: FlowPromptCtx, _diagramSource: string): string {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli -->

`function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeFlowRepo
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo -->

`async function writeFlowRepo(): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeCode (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeConfig (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig -->

`async function writeConfig(extra: Record<string, unknown> = {}): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### readWiki
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki -->

`async function readWiki(rel: string): Promise<string> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### pathExists
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists -->

`async function pathExists(rel: string): Promise<boolean> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### expectVerifyClean (cli-batch-stage5-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean -->

`async function expectVerifyClean(): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### readStatus
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus -->

`async function readStatus(): Promise<StatusReport> {` is a function defined in `packages/cli/src/cli-batch-stage5-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### startStubServer (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer -->

`async function startStubServer(): Promise<StubServer> {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### closedKeysFromPrompt (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt -->

`function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### understandingResponse (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#understandingResponse -->

`function understandingResponse(req: { system: string; user: string }): StubResponse | null {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### defaultHandler (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#defaultHandler -->

`function defaultHandler(` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### runCli (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#runCli -->

`function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeCode (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

### writeConfig (cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void> {` is a function defined in `packages/cli/src/cli-batch-e2e.test.ts`, part of the automated tests surface of `cli-src-tests` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [CLI command registry for the livewiki workspace](commands.md) — dependency
- [livewiki CLI entrypoint and output formatting](cli-src.md) — dependency

> Coverage note: this module's source (12 files, ~190k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
