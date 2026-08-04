---
title: Mcp Src Tests
owner: generated
anchors:
  - packages/mcp/src/phase5-e2e.test.ts#connectMcp
  - packages/mcp/src/phase5-e2e.test.ts#runCli
  - packages/mcp/src/phase5-e2e.test.ts#runVerify
  - packages/mcp/src/phase5-e2e.test.ts#teardown
  - packages/mcp/src/search.test.ts#indexFixture
  - packages/mcp/src/search.test.ts#writePage
  - packages/mcp/src/server.test.ts#assertWellFormedHints
  - packages/mcp/src/server.test.ts#connect
  - packages/mcp/src/server.test.ts#extractHints
  - packages/mcp/src/server.test.ts#extractText
  - packages/mcp/src/server.test.ts#git
  - packages/mcp/src/server.test.ts#hintTools
  - packages/mcp/src/server.test.ts#pollSnapshot
  - packages/mcp/src/server.test.ts#pollUntil
  - packages/mcp/src/server.test.ts#teardown
---

# Mcp Src Tests

`mcp-src-tests` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 3 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### runCli
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli -->

`function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {` is a function defined in `packages/mcp/src/phase5-e2e.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### connectMcp
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#connectMcp -->

`async function connectMcp(repoRoot: string): Promise<Connected> {` is a function defined in `packages/mcp/src/phase5-e2e.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### teardown (phase5-e2e.test.ts)
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#teardown -->

`async function teardown(c: Connected): Promise<void> {` is a function defined in `packages/mcp/src/phase5-e2e.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### runVerify
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runVerify -->

`async function runVerify(repoRoot: string): Promise<VerifyOutput> {` is a function defined in `packages/mcp/src/phase5-e2e.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### writePage
<!-- lw:anchors packages/mcp/src/search.test.ts#writePage -->

`async function writePage(relPath: string, content: string): Promise<void> {` is a function defined in `packages/mcp/src/search.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### indexFixture
<!-- lw:anchors packages/mcp/src/search.test.ts#indexFixture -->

`async function indexFixture(): Promise<SearchIndex> {` is a function defined in `packages/mcp/src/search.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### connect
<!-- lw:anchors packages/mcp/src/server.test.ts#connect -->

`async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### teardown (server.test.ts)
<!-- lw:anchors packages/mcp/src/server.test.ts#teardown -->

`async function teardown(c: Connected): Promise<void> {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### git
<!-- lw:anchors packages/mcp/src/server.test.ts#git -->

`function git(args: string[]): void {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### pollSnapshot
<!-- lw:anchors packages/mcp/src/server.test.ts#pollSnapshot -->

`async function pollSnapshot(` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### pollUntil
<!-- lw:anchors packages/mcp/src/server.test.ts#pollUntil -->

`async function pollUntil(cond: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### extractHints
<!-- lw:anchors packages/mcp/src/server.test.ts#extractHints -->

`function extractHints(r: unknown): HintEntry[] {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### hintTools
<!-- lw:anchors packages/mcp/src/server.test.ts#hintTools -->

`function hintTools(r: unknown): string[] {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### assertWellFormedHints
<!-- lw:anchors packages/mcp/src/server.test.ts#assertWellFormedHints -->

`function assertWellFormedHints(r: unknown): void {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

### extractText
<!-- lw:anchors packages/mcp/src/server.test.ts#extractText -->

`function extractText(r: unknown): string {` is a function defined in `packages/mcp/src/server.test.ts`, part of the automated tests surface of `mcp-src-tests` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- ["@livewiki/mcp stdio server and search index"](mcp-src.md) — dependency
<!-- livewiki:navigate:end -->
