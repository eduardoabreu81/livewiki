---
title: CLI output formatters and update-format fixtures
owner: generated
anchors:
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/update-format.test.ts#baseImpact
  - packages/cli/src/update-format.test.ts#basePkg
---

# CLI output formatters and update-format fixtures

This page documents the three CLI output helpers in `packages/cli/src/output.ts` and the two fixture helpers used by `packages/cli/src/update-format.test.ts` to exercise the human formatter of the `livewiki update` command.

## When to use this page

- Call **`emit`** when a CLI command needs to print either a human block or a JSON payload, never both.
- Call **`emitHuman`** or **`emitJson`** directly only when a caller has already decided on the output shape and wants to bypass the JSON-or-human branch.
- Use **`basePkg`** and **`baseImpact`** as the canonical fixture builders when writing or extending `update-format.test.ts` cases that exercise `formatHuman` for the `livewiki update` work package.
- Reach for the `update-format.test.ts` cases when you need an executable reference for how the additive `impact` block is rendered in human output (top affected pages, truncation marker, non-git-repo fallback).

## How it fits

`packages/cli/src/output.ts` is the central write surface for every CLI command: every line of stdout (human or JSON) flows through one of these three helpers, so terminal rendering and the `--json` parsing contract stay consistent across commands. `packages/cli/src/update-format.test.ts` lives next to the formatter for `livewiki update` and builds deterministic work-package fixtures on top of `formatHuman` to assert that the human output surfaces the additive `impact` block (top pages, budget truncation, non-git-repo message). `packages/cli/src/templates.test.ts` is included in the file inventory but is not documented by this page — it covers the Phase-5 hook templates and the simulated `livewiki index --quiet` run, and is independent of the output and update-format symbols below.

## Output dispatch and human/JSON writers

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The three helpers form a small two-layer dispatcher: `emitHuman` and `emitJson` are the concrete writers, and `emit` is the single entry point a CLI command should use when both a human string and a JSON value are available.

`export function emitHuman(text: string): void` writes `text` to `process.stdout`, appending a trailing newline only when `text` does not already end in `"\n"`. It does not validate or sanitize `text`, and there is no try/catch around `process.stdout.write`; a write failure surfaces as an uncaught exception to the caller.

`export function emitJson(data: unknown): void` writes `JSON.stringify(data) + "\n"` to `process.stdout`. The contract is one line of valid JSON followed by exactly one newline, which keeps `JSON.parse` safe when consumers parse the output line-by-line. There is no fallback when `JSON.stringify` throws (for example, on circular references) — that error propagates to the caller.

`export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void` selects exactly one writer based on `json`: when `json` is true it forwards `data` to `emitJson`, otherwise it forwards `human` to `emitHuman`. The helper's own docstring states "Use um ou outro — nunca os dois" (use one or the other — never both), which is enforced here by the `if (json) … else …` branch and by the fact that only one of `data` or `human` is ever consumed on a given call. Whichever branch is not taken has no effect on stdout, so a caller must not rely on `emit` to print both shapes.

## Update-format test fixtures

<!-- lw:anchors packages/cli/src/update-format.test.ts#basePkg packages/cli/src/update-format.test.ts#baseImpact -->

These two helpers are the only constructors the `update-format.test.ts` suite uses to assemble a `WorkPackage` before passing it to `formatHuman`. They exist so each `it` block varies one field at a time instead of restating the full work-package shape.

`function basePkg(impact: WorkPackage["impact"]): WorkPackage` returns a `WorkPackage` with `manifest: null`, empty `debt`, `snippets`, and `validAnchors` arrays, fixed counts (`tokensEstimated: 100`, `bytes: 400`), `language: "en"`, and the supplied `impact`. The visible source does not deep-clone the `impact` argument, so callers that mutate fields on the returned work package will observe the mutation on their original object.

`function baseImpact(): WorkPackage["impact"]` returns a deterministic impact fixture with `mode: "working-tree"`, `notGitRepo: false`, one changed file (`"src/a.ts"`), one changed symbol (`"src/a.ts#alpha"`), two pages under `livewiki/`, one importer, `truncated: false`, and totals of `{ symbols: 1, pages: 2, importers: 1, snippetCandidates: 1 }`. Individual tests override fields on this object — for example, the truncation test sets `truncated: true`, and the non-git-repo test replaces `changedFiles`, `changedSymbols`, `pages`, `importers`, and `totals` with empty values alongside `notGitRepo: true`. Per the file-level rationale, these fixtures exist to exercise backlog #2: listing the top affected pages from the additive `impact` block in `formatHuman`, and explicitly surfacing the unavailable (not a git repository) and truncated (budget-bound) cases.

<!-- livewiki:navigate:start -->
## Navigate

- [CLI command handlers](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
