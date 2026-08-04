---
title: Core Src Tests 07
owner: generated
anchors:
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/view-activity.test.ts#batch
  - packages/core/src/view-activity.test.ts#pkg
  - packages/core/src/view-activity.test.ts#resolved
  - packages/core/src/view-activity.test.ts#write
  - packages/core/src/view.test.ts#extractMain
  - packages/core/src/view.test.ts#fakeGitRouter
  - packages/core/src/view.test.ts#fakeSpawnError
  - packages/core/src/view.test.ts#fakeSpawnOk
  - packages/core/src/view.test.ts#gitLogOutput
  - packages/core/src/view.test.ts#parseSearchIndex
  - packages/core/src/view.test.ts#readSite
  - packages/core/src/view.test.ts#refRoutes
  - packages/core/src/view.test.ts#refSpawn
  - packages/core/src/view.test.ts#siteFileExists
  - packages/core/src/view.test.ts#stampRoutes
  - packages/core/src/view.test.ts#writeDeepLinkWiki
  - packages/core/src/view.test.ts#writeFixtureWiki
  - packages/core/src/view.test.ts#writeWiki
  - packages/core/src/walker.test.ts#write
---

# Core Src Tests 07

`core-src-tests-07` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 4 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### writeCode
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode -->

`async function writeCode(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/verify.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### writeWiki (verify.test.ts)
<!-- lw:anchors packages/core/src/verify.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/verify.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### pkg
<!-- lw:anchors packages/core/src/view-activity.test.ts#pkg -->

`function pkg(ts: number, tokensEstimated: number, debtCount: number): UpdateMetric {` is a function defined in `packages/core/src/view-activity.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### write (view-activity.test.ts)
<!-- lw:anchors packages/core/src/view-activity.test.ts#write -->

`function write(ts: number, wikiPath: string, tokensEstimated: number): UpdateMetric {` is a function defined in `packages/core/src/view-activity.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### resolved
<!-- lw:anchors packages/core/src/view-activity.test.ts#resolved -->

`function resolved(ts: number, count: number): UpdateMetric {` is a function defined in `packages/core/src/view-activity.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### batch
<!-- lw:anchors packages/core/src/view-activity.test.ts#batch -->

`function batch(` is a function defined in `packages/core/src/view-activity.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### writeWiki (view.test.ts)
<!-- lw:anchors packages/core/src/view.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### writeFixtureWiki
<!-- lw:anchors packages/core/src/view.test.ts#writeFixtureWiki -->

`async function writeFixtureWiki(): Promise<void> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### readSite
<!-- lw:anchors packages/core/src/view.test.ts#readSite -->

`async function readSite(outDir: string, rel: string): Promise<string | null> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### siteFileExists
<!-- lw:anchors packages/core/src/view.test.ts#siteFileExists -->

`async function siteFileExists(outDir: string, rel: string): Promise<boolean> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### extractMain
<!-- lw:anchors packages/core/src/view.test.ts#extractMain -->

`function extractMain(html: string): string {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### parseSearchIndex
<!-- lw:anchors packages/core/src/view.test.ts#parseSearchIndex -->

`function parseSearchIndex(js: string): Array<Record<string, unknown>> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### fakeSpawnOk
<!-- lw:anchors packages/core/src/view.test.ts#fakeSpawnOk -->

`function fakeSpawnOk(output: string, code = 0): SpawnImpl {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### fakeSpawnError
<!-- lw:anchors packages/core/src/view.test.ts#fakeSpawnError -->

`function fakeSpawnError(): SpawnImpl {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### gitLogOutput
<!-- lw:anchors packages/core/src/view.test.ts#gitLogOutput -->

`function gitLogOutput(commits: Array<[number, string[]]>): string {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### fakeGitRouter
<!-- lw:anchors packages/core/src/view.test.ts#fakeGitRouter -->

`function fakeGitRouter(routes: FakeGitRoute[], calls?: string[][]): SpawnImpl {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### stampRoutes
<!-- lw:anchors packages/core/src/view.test.ts#stampRoutes -->

`function stampRoutes(remoteUrl = "https://github.com/acme/widgets.git\n"): FakeGitRoute[] {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### writeDeepLinkWiki
<!-- lw:anchors packages/core/src/view.test.ts#writeDeepLinkWiki -->

`async function writeDeepLinkWiki(): Promise<void> {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### refRoutes
<!-- lw:anchors packages/core/src/view.test.ts#refRoutes -->

`function refRoutes(calls?: string[][]): SpawnImpl {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### refSpawn
<!-- lw:anchors packages/core/src/view.test.ts#refSpawn -->

`function refSpawn(calls?: string[][]): SpawnImpl {` is a function defined in `packages/core/src/view.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

### write (walker.test.ts)
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`async function write(rel: string, content = ""): Promise<void> {` is a function defined in `packages/core/src/walker.test.ts`, part of the automated tests surface of `core-src-tests-07` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependency

> Coverage note: this module's source (4 files, ~86k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
