---
title: Architecture overview
owner: generated
---

# Architecture overview

This repository has **240 files** documented and **1442 code symbols** indexed, organized into **31 folders** with **9 documented dependencies** between them.

The diagrams below are rebuilt by `livewiki init`; the folder pages they link to are written by `livewiki init --batch` or by hand.

Folders are listed most-important first and link only to pages that exist. Tests and tooling live in a separate inventory.

## Concept topics

How the product behaves across the code: [Concept topics](../topics/index.md)

## Flows

End-to-end behavior across the codebase: [How it works](../flows/index.md)

## Product folders

<a id="llm"></a>

### packages/core/src/llm

**10** files, **30** documented code symbols

Representative paths:

- `packages/core/src/llm/adapters.test.ts`
- `packages/core/src/llm/anthropic.ts`
- `packages/core/src/llm/base.ts`

Pages: [folder page](../llm/index.md) · [class diagram](../diagrams/llm.classes.mmd)

Depends on: [packages/core/src](../core-src/index.md)

Used by: [packages/cli/src/commands](../commands/index.md), [packages/core/src](../core-src/index.md)

<a id="commands"></a>

### packages/cli/src/commands

**13** files, **52** documented code symbols

Representative paths:

- `packages/cli/src/commands/baseline.ts`
- `packages/cli/src/commands/batch.ts`
- `packages/cli/src/commands/config.ts`

Pages: [folder page](../commands/index.md)

Depends on: [packages/core/src/llm](../llm/index.md), [packages/mcp/src](../mcp-src/index.md), [packages/core/src](../core-src/index.md), [packages/cli/src](../cli-src/index.md)

Used by: [packages/cli/src](../cli-src/index.md)

<a id="mcp-src"></a>

### packages/mcp/src

**8** files, **45** documented code symbols

Representative paths:

- `packages/mcp/src/agent-bootstrap-e2e.test.ts`
- `packages/mcp/src/index.ts`
- `packages/mcp/src/phase5-e2e.test.ts`

Pages: [folder page](../mcp-src/index.md)

Depends on: [packages/core/src](../core-src/index.md)

Used by: [packages/cli/src/commands](../commands/index.md)

<a id="bootstrap-wiki"></a>

### Bootstrap wiki folder

**1** file, **0** documented code symbols

Representative paths:

- `packages/cli/skills/bootstrap-wiki/SKILL.md`

Depends on: none

Used by: none

<a id="claude-code"></a>

### packages/cli/templates/claude-code

**1** file, **0** documented code symbols

Representative paths:

- `packages/cli/templates/claude-code/settings.local.json`

Pages: [folder page](../claude-code/index.md)

Depends on: none

Used by: none

<a id="cli"></a>

### packages/cli

**4** files, **0** documented code symbols

Representative paths:

- `packages/cli/README.md`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`

Pages: [folder page](../cli/index.md)

Depends on: none

Used by: none

<a id="core"></a>

### packages/core

**4** files, **0** documented code symbols

Representative paths:

- `packages/core/README.md`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

Pages: [folder page](../core/index.md)

Depends on: none

Used by: none

<a id="document-as-you-go"></a>

### packages/cli/skills/document-as-you-go

**1** file, **0** documented code symbols

Representative paths:

- `packages/cli/skills/document-as-you-go/SKILL.md`

Pages: [folder page](../document-as-you-go/index.md)

Depends on: none

Used by: none

<a id="github-actions"></a>

### packages/cli/templates/github-actions

**1** file, **0** documented code symbols

Representative paths:

- `packages/cli/templates/github-actions/docs-debt.yml`

Pages: [folder page](../github-actions/index.md)

Depends on: none

Used by: none

<a id="mcp"></a>

### packages/mcp

**4** files, **0** documented code symbols

Representative paths:

- `packages/mcp/README.md`
- `packages/mcp/package.json`
- `packages/mcp/tsconfig.json`

Pages: [folder page](../mcp/index.md)

Depends on: none

Used by: none

<a id="root"></a>

### (repository root)

**6** files, **0** documented code symbols

Representative paths:

- `README.md`
- `SPEC.md`
- `VISION.md`

Pages: [folder page](../root/index.md)

Depends on: none

Used by: none

<a id="templates"></a>

### packages/cli/templates

**1** file, **0** documented code symbols

Representative paths:

- `packages/cli/templates/README.md`

Pages: [folder page](../templates/index.md)

Depends on: none

Used by: none

<a id="workflows"></a>

### .github/workflows

**2** files, **0** documented code symbols

Representative paths:

- `.github/workflows/cross-platform-ci.yml`
- `.github/workflows/docs-debt.yml`

Pages: [folder page](../workflows/index.md)

Depends on: none

Used by: none

## Auxiliary areas

This repository has **18 auxiliary areas** for tests, fixtures, tooling, benchmarks, or repository documentation. Open the complete [Auxiliary areas](../auxiliary/index.md) inventory.

## Diagrams

### Structure

Map of the repository's folders and files.

```mermaid
%% livewiki/architecture/structure.mmd
```

Open the raw file: [structure.mmd](structure.mmd)

### Folder dependencies

Import graph between folders.

```mermaid
%% livewiki/architecture/modules.mmd
```

Open the raw file: [modules.mmd](modules.mmd)

---

Generated by `livewiki init`. Refresh with `livewiki index` + manual edits, or run `livewiki init --batch` to generate the folder and file pages.
