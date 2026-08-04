---
title: Core Src Tests 05
owner: generated
anchors:
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/key-leak.test.ts#generate
  - packages/core/src/manifest.test.ts#writeLivewikiFile
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/orientation.test.ts#write
---

# Core Src Tests 05

`core-src-tests-05` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 12 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### writeLivewikiFile
<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile -->

`async function writeLivewikiFile(relPath: string, content: string): Promise<void> {` is a function defined in `packages/core/src/manifest.test.ts`, part of the automated tests surface of `core-src-tests-05` — not part of the product's runtime behavior.

### write
<!-- lw:anchors packages/core/src/orientation.test.ts#write -->

`async function write(rel: string, content: string): Promise<void> {` is a function defined in `packages/core/src/orientation.test.ts`, part of the automated tests surface of `core-src-tests-05` — not part of the product's runtime behavior.

### assertCanaryNotPresent
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent -->

`function assertCanaryNotPresent(value: string, context: string): void {` is a function defined in `packages/core/src/key-leak.test.ts`, part of the automated tests surface of `core-src-tests-05` — not part of the product's runtime behavior.

### generate
<!-- lw:anchors packages/core/src/key-leak.test.ts#generate -->

`async generate() {` is a method defined in `packages/core/src/key-leak.test.ts`, part of the automated tests surface of `core-src-tests-05` — not part of the product's runtime behavior.

### idFor
<!-- lw:anchors packages/core/src/modules.test.ts#idFor -->

`function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string {` is a function defined in `packages/core/src/modules.test.ts`, part of the automated tests surface of `core-src-tests-05` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (12 files, ~183k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
