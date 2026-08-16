---
title: Closed Repair Contract for Artifact Validation Codes
owner: generated
anchors:
- packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES
- packages/core/src/repair-contract.ts#PAGE_KINDS
- packages/core/src/repair-contract.ts#SUPPORTED_FIXES
- packages/core/src/repair-contract.ts#UNCLASSIFIED
- packages/core/src/repair-contract.ts#collectUnclassified
- packages/core/src/repair-contract.ts#formatUnrepairableMessage
- packages/core/src/repair-contract.ts#isUnrepairableErrorSet
- packages/core/src/repair-contract.ts#renderActionDirective
- packages/core/src/repair-contract.ts#renderReportOnlyBlock
---

# Closed Repair Contract for Artifact Validation Codes

This module is the single source of truth that maps every artifact validation code to a repair directive or a report-only classification.

## When to use this page

- Understand how the system decides whether a validation failure can be repaired by the model or must be reported for human review.
- Trace how a specific validation code translates into the exact ACTION text presented to the repair prompt.
- Learn why certain codes (such as human-authored manual blocks) are never repaired automatically.

## How it fits

This file lives in `packages/core/src/` and defines the contract between the validation layer and the repair orchestration. It imports the mechanical repair code sets from `artifact-repair.ts` to avoid drift, and it exports the directive maps and helper functions that the three repair-prompt builders (for module, flow, and topic pages) and the orchestrator consume. The file also exposes the runtime mirror of the `ArtifactValidationCode` union so the exhaustiveness test can verify that every code receives exactly one disposition.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-repair-contract.mmd
```

## Validation Code Enumeration

<!-- lw:anchors packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES packages/core/src/repair-contract.ts#PAGE_KINDS -->

This section defines the complete set of validation codes and the page kinds for which those codes are evaluated.

`ALL_ARTIFACT_VALIDATION_CODES` is a runtime list of every `ArtifactValidationCode` value, including the five verify issue codes (`broken_anchor`, `broken_internal_link`, `invalid_mermaid_diagram`, `manual_block_altered`, and `missing_wiki_path`). The list uses a `satisfies` clause to ensure every entry is a valid code, and the `AssertExact` type below it forces the list and the union to be identical at compile time. A missing or extra entry fails the build, and the exhaustiveness test walks this list at runtime to confirm each code has exactly one disposition.

`PAGE_KINDS` is a constant array of the three page kinds — `module`, `flow`, and `topic` — declared with `as const satisfies readonly PageKind[]` so the union type and the runtime list stay in sync. The page kind determines which directive map and which unclassified map apply to a given error.

## Supported Fix Directives

<!-- lw:anchors packages/core/src/repair-contract.ts#SUPPORTED_FIXES packages/core/src/repair-contract.ts#renderActionDirective -->

This section describes how the system selects and renders the exact repair instruction for a validation error that has a known fix.

`SUPPORTED_FIXES` is a two-level record: the outer key is the page kind, and the inner key is the validation code. Each value is a `FixDirective` — a function that takes the error context and returns the ACTION text to include in the repair prompt, or an empty string when the directive does not apply to this exact instance (for example, a directive that names the offending key renders nothing when the error carries none). The maps are populated from the historical if-chains in `prompts.ts`, so the prompt text is ported verbatim.

`renderActionDirective` is the function that reads the directive for a given error:

```ts
export function renderActionDirective(
  kind: PageKind,
  error: ArtifactValidationError,
  ctx: {
    messageSafe: string;
    offendingSafe?: string | undefined;
    assignedSectionLabel?: (key: string) => string | undefined;
  },
): string
```

It takes a page kind, an error, and a context holding the neutralized message and optional offending text, and it returns the directive text or an empty string. The function looks up `SUPPORTED_FIXES[kind][error.code]`; if no directive exists, it returns `""`. Otherwise, it builds a `FixContext` from the error's location, section slug, and the caller-supplied safe values, then invokes the directive. The caller must already have neutralized `messageSafe` and `offendingSafe`, because the directive text embeds those values directly into the prompt.

## Unclassified Report-Only Codes

<!-- lw:anchors packages/core/src/repair-contract.ts#UNCLASSIFIED packages/core/src/repair-contract.ts#collectUnclassified packages/core/src/repair-contract.ts#renderReportOnlyBlock packages/core/src/repair-contract.ts#formatUnrepairableMessage -->

This section covers the codes that have no supported repair and how the system surfaces them to the operator or the repair prompt.

`UNCLASSIFIED` is a two-level record mapping each page kind to a map of codes that are report-only, with a one-line reason for each. These codes must never be repaired by guessing — for example, `manual_block_altered` refers to human content protected by rule #6, and `missing_wiki_path` is repository state rather than page prose. The map also records codes that belong to a different page kind's contract (for instance, a topic-only code appearing on a module page), with a note that the module validator never emits it.

`collectUnclassified` is the function that extracts the distinct unclassified codes from a set of errors:

```ts
export function collectUnclassified(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): UnclassifiedRepairError[]
```

It takes a page kind and an error list, and it returns an array of `UnclassifiedRepairError` objects — each holding a code and its reason — in first-seen order. The function skips any error whose code already appeared, and it skips codes that have a supported directive. A code absent from both maps is treated as unclassified with a generic reason, so a legacy checkpoint code can never crash the loop.

`renderReportOnlyBlock` formats the unclassified entries into a prompt block for a mixed error set:

```ts
export function renderReportOnlyBlock(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): string[]
```

It takes a page kind and an error list, and it returns an array of prompt lines. When every error has a directive, it returns an empty array. Otherwise, it returns a heading line instructing the model NOT to guess a fix, followed by one bullet per unclassified code with its reason.

`formatUnrepairableMessage` builds a failure message for a task that cannot be repaired:

```ts
export function formatUnrepairableMessage(
  kind: PageKind,
  target: string,
  errors: readonly ArtifactValidationError[],
): string
```

It takes a page kind, a target name, and an error list, and it returns a single string naming the target, stating that every reported error is unrepairable, and listing each unclassified code with its reason. This message is used by `batch status` (both human and JSON output) as the failure reason, distinct from `repair_exhausted`.

## Early Abort Detection

<!-- lw:anchors packages/core/src/repair-contract.ts#isUnrepairableErrorSet -->

This section explains how the orchestrator avoids spending a paid repair call on a task that no repair can fix.

`isUnrepairableErrorSet` is the early-abort check:

```ts
export function isUnrepairableErrorSet(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): boolean
```

It takes a page kind and an error list, and it returns `true` when the set is non-empty and every distinct error code is unclassified, otherwise `false`. The function compares the number of distinct unclassified codes from `collectUnclassified` with the total number of distinct codes in the error set; when they are equal, every error is report-only. In that situation the orchestrator aborts the task before burning a repair attempt, because no directive exists that could change the outcome.

## Tests

Covered by `packages/core/src/repair-contract.test.ts` (same-name test file on disk).
