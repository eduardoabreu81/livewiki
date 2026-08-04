---
title: Core Src Tests 03
owner: generated
anchors:
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
  - packages/core/src/blast-radius.test.ts#insertAnchor
  - packages/core/src/blast-radius.test.ts#insertFile
  - packages/core/src/blast-radius.test.ts#insertPage
  - packages/core/src/blast-radius.test.ts#insertResolvedCall
  - packages/core/src/call-resolution.test.ts#confidenceOf
  - packages/core/src/call-resolution.test.ts#insertCall
  - packages/core/src/call-resolution.test.ts#insertFile
  - packages/core/src/call-resolution.test.ts#insertResolvedCall
  - packages/core/src/call-resolution.test.ts#insertSymbol
  - packages/core/src/call-resolution.test.ts#resolvedKeyOf
  - packages/core/src/calls.test.ts#parse
  - packages/core/src/change-impact.test.ts#git
  - packages/core/src/change-impact.test.ts#gitCommitAll
  - packages/core/src/change-impact.test.ts#gitInit
  - packages/core/src/change-impact.test.ts#setupBaseline
  - packages/core/src/change-impact.test.ts#writeRepoFile
  - packages/core/src/community.test.ts#edge
  - packages/core/src/diff-preview.test.ts#git
  - packages/core/src/diff-preview.test.ts#gitCommitAll
  - packages/core/src/diff-preview.test.ts#gitInit
  - packages/core/src/diff-preview.test.ts#setupBaseline
  - packages/core/src/diff-preview.test.ts#writeRepoFile
  - packages/core/src/export.test.ts#bodyOf
  - packages/core/src/export.test.ts#detectSymlinkSupport
  - packages/core/src/export.test.ts#listDest
  - packages/core/src/export.test.ts#readDest
  - packages/core/src/export.test.ts#writeWiki
  - packages/core/src/flow-diagram.test.ts#candidate
  - packages/core/src/flow-diagram.test.ts#chainIr
  - packages/core/src/flow-diagram.test.ts#mod
---

# Core Src Tests 03

`core-src-tests-03` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 12 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### insertFile (blast-radius.test.ts)
<!-- lw:anchors packages/core/src/blast-radius.test.ts#insertFile -->

`function insertFile(path: string): number {` is a function defined in `packages/core/src/blast-radius.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertResolvedCall (blast-radius.test.ts)
<!-- lw:anchors packages/core/src/blast-radius.test.ts#insertResolvedCall -->

`function insertResolvedCall(` is a function defined in `packages/core/src/blast-radius.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertPage
<!-- lw:anchors packages/core/src/blast-radius.test.ts#insertPage -->

`function insertPage(wikiPath: string): number {` is a function defined in `packages/core/src/blast-radius.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertAnchor
<!-- lw:anchors packages/core/src/blast-radius.test.ts#insertAnchor -->

`function insertAnchor(docPageId: number, symbolKey: string): void {` is a function defined in `packages/core/src/blast-radius.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertFile (call-resolution.test.ts)
<!-- lw:anchors packages/core/src/call-resolution.test.ts#insertFile -->

`function insertFile(path: string): number {` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertSymbol
<!-- lw:anchors packages/core/src/call-resolution.test.ts#insertSymbol -->

`function insertSymbol(fileId: number, key: string, name: string, kind: string): void {` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertCall
<!-- lw:anchors packages/core/src/call-resolution.test.ts#insertCall -->

`function insertCall(` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### insertResolvedCall (call-resolution.test.ts)
<!-- lw:anchors packages/core/src/call-resolution.test.ts#insertResolvedCall -->

`function insertResolvedCall(` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### resolvedKeyOf
<!-- lw:anchors packages/core/src/call-resolution.test.ts#resolvedKeyOf -->

`function resolvedKeyOf(callId: number): string | null {` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### confidenceOf
<!-- lw:anchors packages/core/src/call-resolution.test.ts#confidenceOf -->

`function confidenceOf(callId: number): string | null {` is a function defined in `packages/core/src/call-resolution.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### git (change-impact.test.ts)
<!-- lw:anchors packages/core/src/change-impact.test.ts#git -->

`function git(args: string[]): void {` is a function defined in `packages/core/src/change-impact.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### gitInit (change-impact.test.ts)
<!-- lw:anchors packages/core/src/change-impact.test.ts#gitInit -->

`function gitInit(): void {` is a function defined in `packages/core/src/change-impact.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### gitCommitAll (change-impact.test.ts)
<!-- lw:anchors packages/core/src/change-impact.test.ts#gitCommitAll -->

`function gitCommitAll(message: string): void {` is a function defined in `packages/core/src/change-impact.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### writeRepoFile (change-impact.test.ts)
<!-- lw:anchors packages/core/src/change-impact.test.ts#writeRepoFile -->

`async function writeRepoFile(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/change-impact.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### setupBaseline (change-impact.test.ts)
<!-- lw:anchors packages/core/src/change-impact.test.ts#setupBaseline -->

`async function setupBaseline(): Promise<void> {` is a function defined in `packages/core/src/change-impact.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### edge
<!-- lw:anchors packages/core/src/community.test.ts#edge -->

`function edge(fromFile: string, toFile: string): ResolvedImportEdge {` is a function defined in `packages/core/src/community.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### git (diff-preview.test.ts)
<!-- lw:anchors packages/core/src/diff-preview.test.ts#git -->

`function git(args: string[]): void {` is a function defined in `packages/core/src/diff-preview.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### gitInit (diff-preview.test.ts)
<!-- lw:anchors packages/core/src/diff-preview.test.ts#gitInit -->

`function gitInit(): void {` is a function defined in `packages/core/src/diff-preview.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### gitCommitAll (diff-preview.test.ts)
<!-- lw:anchors packages/core/src/diff-preview.test.ts#gitCommitAll -->

`function gitCommitAll(message: string): void {` is a function defined in `packages/core/src/diff-preview.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### writeRepoFile (diff-preview.test.ts)
<!-- lw:anchors packages/core/src/diff-preview.test.ts#writeRepoFile -->

`async function writeRepoFile(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/diff-preview.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### setupBaseline (diff-preview.test.ts)
<!-- lw:anchors packages/core/src/diff-preview.test.ts#setupBaseline -->

`async function setupBaseline(): Promise<void> {` is a function defined in `packages/core/src/diff-preview.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### chainIr
<!-- lw:anchors packages/core/src/flow-diagram.test.ts#chainIr -->

`function chainIr(ids: string[]): FlowchartIR {` is a function defined in `packages/core/src/flow-diagram.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### mod
<!-- lw:anchors packages/core/src/flow-diagram.test.ts#mod -->

`function mod(id: string, paths: string[], displayTitle?: string): Module {` is a function defined in `packages/core/src/flow-diagram.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### candidate
<!-- lw:anchors packages/core/src/flow-diagram.test.ts#candidate -->

`function candidate(overrides: Partial<FlowCandidate> & { moduleIds: string[] }): FlowCandidate {` is a function defined in `packages/core/src/flow-diagram.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### detectSymlinkSupport
<!-- lw:anchors packages/core/src/export.test.ts#detectSymlinkSupport -->

`async function detectSymlinkSupport(): Promise<boolean> {` is a function defined in `packages/core/src/export.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### writeWiki
<!-- lw:anchors packages/core/src/export.test.ts#writeWiki -->

`async function writeWiki(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/export.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### readDest
<!-- lw:anchors packages/core/src/export.test.ts#readDest -->

`async function readDest(target: ExportTarget, name: string): Promise<string | null> {` is a function defined in `packages/core/src/export.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### listDest
<!-- lw:anchors packages/core/src/export.test.ts#listDest -->

`async function listDest(target: ExportTarget): Promise<string[]> {` is a function defined in `packages/core/src/export.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### bodyOf
<!-- lw:anchors packages/core/src/export.test.ts#bodyOf -->

`async function bodyOf(transformed: string): Promise<string> {` is a function defined in `packages/core/src/export.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### parse
<!-- lw:anchors packages/core/src/calls.test.ts#parse -->

`async function parse(ext: string, src: string) {` is a function defined in `packages/core/src/calls.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### MockLlm
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm -->

`class MockLlm implements LlmClient {` is a class defined in `packages/core/src/batch.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

### MockLlm.generate
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm.generate -->

`async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {` is a method defined in `packages/core/src/batch.test.ts`, part of the automated tests surface of `core-src-tests-03` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (12 files, ~202k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
