---
title: Repair contract — dispositions, directives, and early-abort helpers
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

# Repair contract — disposition map for every validation code

This page owns the single source of truth that tells the repair prompt builder, for a given `ArtifactValidationCode` on a given page kind, whether to emit a directive the model can act on or to leave the code report-only.

## When to use this page

- **Look up** which disposition a given validation code carries on module, flow, or topic pages.
- **Distinguish** a supported repair from a report-only code when triaging an error set.
- **Decide** whether the orchestrator should spend a repair call or fail-fast with `unrepairable`.
- **Extend** the contract when a new `ArtifactValidationCode` is added to the validator union.

## How it fits

`repair-contract.ts` lives in `packages/core/src/` next to `prompts.ts` (which defines the `ArtifactValidationCode` union and `ArtifactValidationError` shape) and `artifact-repair.ts` (which owns the mechanical repair code sets). The validators across the page kinds emit one or more `ArtifactValidationError` instances; the repair prompt builder calls into this file to decide for each error whether to render an ACTION line, drop to a bare error line, or list the code in a report-only block. The orchestrator separately calls `isUnrepairableErrorSet` and `formatUnrepairableMessage` to honor the early-abort rule that preserves repair budget for sets with no actionable code.

The mechanical repair code sets (`MECHANICAL_STAGE4_CODES`, `MECHANICAL_UPPER_BOUND_CODES`) are re-exported here so the exhaustiveness test can assert them against the directive maps without taking a second import.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-repair-contract.mmd
```

## Page kinds and the runtime code mirror

<!-- lw:anchors packages/core/src/repair-contract.ts#PAGE_KINDS packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES -->

The file declares `PageKind` as the union `"module" | "flow" | "topic"` and exposes the runtime tuple `PAGE_KINDS` (`export const PAGE_KINDS = ["module", "flow", "topic"] as const satisfies readonly PageKind[]`) so map keys, lookups, and exhaustiveness checks all share one ordered list. `ALL_ARTIFACT_VALIDATION_CODES` (`export const ALL_ARTIFACT_VALIDATION_CODES = [ ... ] as const satisfies readonly ArtifactValidationCode[]`) is the runtime mirror of the `ArtifactValidationCode` union. The `satisfies` clause plus the `AssertExact` helper below it force a missing or extra entry to fail at COMPILE time; the exhaustiveness test then walks the list at runtime.

## Disposition maps: SUPPORTED_FIXES and UNCLASSIFIED

<!-- lw:anchors packages/core/src/repair-contract.ts#SUPPORTED_FIXES packages/core/src/repair-contract.ts#UNCLASSIFIED -->

Every code is bound to EXACTLY ONE of two per-page-kind maps. A SUPPORTED_FIX directive (`SUPPORTED_FIXES: Record<PageKind, Partial<Record<ArtifactValidationCode, FixDirective>>>`) carries a `FixDirective` that closes over the error context and returns the verbatim ACTION text the prompt renders. An UNCLASSIFIED entry (`UNCLASSIFIED: Record<PageKind, Readonly<Partial<Record<ArtifactValidationCode, string>>>`) carries a one-line reason naming why no supported repair exists (for example `manual_block_altered` is human content under rule #6, and `llm_error` is handled out-of-band by the orchestrator). Codes absent from both maps for a kind are tolerated at runtime by `collectUnclassified` (treated as unclassified with a generic reason), so a legacy checkpoint code can never crash the loop — but the exhaustiveness test still asserts every code appears in exactly one of the two maps for every kind.

## Per-error rendering

<!-- lw:anchors packages/core/src/repair-contract.ts#renderActionDirective -->

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

`renderActionDirective` takes a page kind, one `ArtifactValidationError`, and a context bundle whose `messageSafe`/`offendingSafe` fields MUST already be neutralized by the caller. It looks up the directive in `SUPPORTED_FIXES[kind][error.code]`; when no directive is registered it returns `""` so the caller emits the bare error line as before. When a directive does apply, it forwards the neutralized offending text, location, section slug, message detail, and (topic-only) the caller-supplied `assignedSectionLabel` resolver so the directive can render a deterministic section label.

## Reporting, triage, and the early-abort path

<!-- lw:anchors packages/core/src/repair-contract.ts#collectUnclassified packages/core/src/repair-contract.ts#renderReportOnlyBlock packages/core/src/repair-contract.ts#isUnrepairableErrorSet packages/core/src/repair-contract.ts#formatUnrepairableMessage -->

```ts
export function collectUnclassified(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): UnclassifiedRepairError[]

export function renderReportOnlyBlock(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): string[]

export function isUnrepairableErrorSet(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): boolean

export function formatUnrepairableMessage(
  kind: PageKind,
  target: string,
  errors: readonly ArtifactValidationError[],
): string
```

`collectUnclassified` walks the error set in first-seen order and returns the distinct codes that have no `SUPPORTED_FIXES` entry for the kind, each paired with the per-kind reason from `UNCLASSIFIED` (or a generic fallback when the code is absent from both maps). `renderReportOnlyBlock` turns that list into the prompt's `# Errors with NO supported repair` section, instructing the model not to guess a fix; the function returns an empty array when every error has a directive. `isUnrepairableErrorSet` is the orchestrator's early-abort gate: a non-empty error set where every distinct code is unclassified has no supported repair, so the orchestrator must not burn a paid repair call on it. `formatUnrepairableMessage` renders the matching `unrepairable` task-failure message that names the target and lists every unclassified code with its reason — the message rendered by `batch status` (human and JSON) and distinct from `repair_exhausted`.

## Tests

Covered by `packages/core/src/repair-contract.test.ts` (same-name test file on disk).
