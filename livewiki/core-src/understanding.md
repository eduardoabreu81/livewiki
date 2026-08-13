---
title: "Understanding — Repository Orientation Synthesis Layer"
owner: generated
anchors:
  - packages/core/src/understanding.ts#UNDERSTANDING_EVIDENCE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_MAX_OUTPUT_TOKENS
  - packages/core/src/understanding.ts#UNDERSTANDING_MAX_SURFACES
  - packages/core/src/understanding.ts#UNDERSTANDING_ONLY_TARGET
  - packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MIN_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_REL_PATH
  - packages/core/src/understanding.ts#UNDERSTANDING_SURFACE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_TASK_PREFIX
  - packages/core/src/understanding.ts#buildUnderstandingEvidence
  - packages/core/src/understanding.ts#clipAtClauseBoundary
  - packages/core/src/understanding.ts#computeUnderstandingEvidenceHash
  - packages/core/src/understanding.ts#hasUnderstandingBasis
  - packages/core/src/understanding.ts#loadUnderstandingSynthesis
  - packages/core/src/understanding.ts#parseUnderstandingPage
  - packages/core/src/understanding.ts#renderUnderstandingEvidence
  - packages/core/src/understanding.ts#salvageUnderstandingCandidate
  - packages/core/src/understanding.ts#validateUnderstandingArtifact
---

# Understanding — Repository Orientation Synthesis Layer

The repository-understanding layer turns a closed, verify-gated inventory of wiki pages plus the README into a single small generated page (`livewiki/understanding.md`) that answers "what is this repository, for whom, and where to look first" without ever relying on the README as authority.

## When to use this page

- **Generate the orientation synthesis** by gathering accepted module/flow/topic pages and rendering them as bounded prompt evidence for a one-shot LLM call.
- **Validate or salvage a candidate** understanding page against the strict contract (owner, no anchors, one H1, one purpose paragraph, one optional surfaces list).
- **Read the synthesis** in the tolerant reader path used by quickstart regeneration and README export, with safe fallback when the page is missing or malformed.
- **Inspect the bounded constants** (`UNDERSTANDING_MAX_SURFACES`, `UNDERSTANDING_PURPOSE_MIN_CHARS`, `UNDERSTANDING_EVIDENCE_MAX_CHARS`, etc.) to reason about prompt size and contract enforcement.

## How it fits

The file lives in `packages/core/src/understanding.ts` and is consumed by the batch pipeline's stage 5: a single bounded task named `understanding:<evidenceHash>` whose output is a regenerable wiki page inside the rule-#1 allowlist. The layer sits between the existing navigation/orientation modules (`loadModulePresentations`, `loadModuleDigests`, `loadFlowPresentations`, `loadTopicPresentations`, `extractRepoOrientation`) and the downstream readers (`generateQuickstart` and the README export), which prefer the synthesis when present and otherwise fall back to the pre-existing orientation chain byte-for-byte. It deliberately does not extend `ArtifactPageKind` or the anchor-centric validator — the synthesis carries no anchors, so it gets its own strict contract and a tolerant parser for sticky legacy pages.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-understanding.mmd
```

## Constants and identifiers

<!-- lw:anchors packages/core/src/understanding.ts#UNDERSTANDING_REL_PATH packages/core/src/understanding.ts#UNDERSTANDING_ONLY_TARGET packages/core/src/understanding.ts#UNDERSTANDING_TASK_PREFIX packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MIN_CHARS packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_MAX_SURFACES packages/core/src/understanding.ts#UNDERSTANDING_SURFACE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_EVIDENCE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_MAX_OUTPUT_TOKENS -->

This section pins every external surface a batch caller, a quickstart reader, or the README exporter depends on. The file path identifies the regenerable wiki page; the `--only` target and the task prefix identify the batch-task namespace; the remaining constants cap the prompt evidence, the output length, the purpose length, and the surfaces list so the artifact stays small and the prompt stays bounded. A new `UNDERSTANDING_*` constant means a new contract knob — its docstring is the authoritative source for the meaning, and its value is referenced from one or more functions below.

```ts
export const UNDERSTANDING_REL_PATH = "livewiki/understanding.md";
export const UNDERSTANDING_ONLY_TARGET = "understanding";
export const UNDERSTANDING_TASK_PREFIX = "understanding:";
export const UNDERSTANDING_PURPOSE_MIN_CHARS = 40;
export const UNDERSTANDING_PURPOSE_MAX_CHARS = PURPOSE_MAX_CHARS;
export const UNDERSTANDING_MAX_SURFACES = 10;
export const UNDERSTANDING_SURFACE_MAX_CHARS = 160;
export const UNDERSTANDING_EVIDENCE_MAX_CHARS = 20_000;
export const UNDERSTANDING_MAX_OUTPUT_TOKENS = 2_048;
```

`UNDERSTANDING_REL_PATH` declares where the synthesis is persisted on disk; `UNDERSTANDING_ONLY_TARGET` is the CLI rerun selector; `UNDERSTANDING_TASK_PREFIX` namespaces batch tasks so a full target is `understanding:<evidenceHash>`. The four numeric caps bound the prompt evidence, the output budget, the purpose paragraph (with the max mirroring orientation's `PURPOSE_MAX_CHARS`), and the surfaces list (both item count and per-item length). None of these are validated against a range — each is enforced on the upper bound, and the purpose length is also enforced on the lower bound by the validator below.

## Evidence inventory

<!-- lw:anchors packages/core/src/understanding.ts#hasUnderstandingBasis packages/core/src/understanding.ts#buildUnderstandingEvidence packages/core/src/understanding.ts#computeUnderstandingEvidenceHash packages/core/src/understanding.ts#renderUnderstandingEvidence -->

This section turns the on-disk wiki plus the repo orientation into a single deterministic `UnderstandingEvidence` object that the batch pipeline hashes, gates, and feeds to the LLM as bounded prompt evidence. The flow is: load every accepted page kind through the navigation helpers, project each into a small evidence record, hash the whole thing for cheap idempotence, and render a textual block that the prompt builder can wrap. The README purpose and README title appear as ordinary evidence fields, never as authority — the validation and parsing paths tolerate their absence.

```ts
export function hasUnderstandingBasis(evidence: UnderstandingEvidence): boolean
export async function buildUnderstandingEvidence(opts: {
  repoRoot: string;
  modules: Module[];
  ordered: Module[];
  pathRoleConfig?: PathRoleConfig | undefined;
}): Promise<UnderstandingEvidence>
export function computeUnderstandingEvidenceHash(evidence: UnderstandingEvidence): string
export function renderUnderstandingEvidence(
  evidence: UnderstandingEvidence,
  maxChars: number = UNDERSTANDING_EVIDENCE_MAX_CHARS,
): string
```

`hasUnderstandingBasis` takes a built `UnderstandingEvidence` and returns true when the inventory carries enough verified signal — at least one accepted wiki page (module, flow, or topic) or a README purpose excerpt — for the synthesis to be meaningful; otherwise the batch stage is a deterministic no-op, mirroring the topics' small-repo guard.

`buildUnderstandingEvidence` takes the repo root plus the final and prioritized module plans and returns a `Promise<UnderstandingEvidence>` by composing `loadModulePresentations`, `loadModuleDigests` (capped at 24 modules via `UNDERSTANDING_MODULE_DIGEST_CAP`), `loadFlowPresentations`, `loadTopicPresentations`, and `extractRepoOrientation`. The function does not throw on missing wiki kinds — it emits empty arrays for them and still surfaces the README fields if orientation found them.

`computeUnderstandingEvidenceHash` takes the built evidence and returns a `sha256` JSON digest; the batch task embeds this hash so unchanged evidence finds its done task and makes zero LLM calls on resume.

`renderUnderstandingEvidence` takes the evidence and an optional `maxChars` (defaulting to `UNDERSTANDING_EVIDENCE_MAX_CHARS`) and returns the prompt text. The render is deterministic (prioritized module order, then slug order for flows and topics, then orientation surfaces, then README fields) and truncates by appending an explicit `(evidence truncated to the character budget)` marker when the rendered length exceeds the cap; the function itself enforces only the upper bound.

## Strict validation contract

<!-- lw:anchors packages/core/src/understanding.ts#validateUnderstandingArtifact -->

The validator is the closed contract that gates every understanding page before it lands on disk. It is intentionally NOT a new `ArtifactPageKind` — the synthesis carries no anchors, so it gets its own strict check that fails fast on the first structural problem and returns the full list of `UnderstandingValidationError` records at the end. An empty list is the only signal of success.

```ts
export function validateUnderstandingArtifact(content: string): UnderstandingValidationError[]
```

`validateUnderstandingArtifact` takes the raw page string and returns the array of `UnderstandingValidationError`s the content violates; an empty array means valid. The check runs in five passes: (1) frontmatter existence and parse; (2) `owner: generated` requirement and the `anchors`/`lw:anchors`/`lw:manual` bans; (3) whole-body lexical bans against backtick code spans, fenced blocks, Markdown links/images, and `TODO`/`TBD`/`FIXME`/`XXX`/`PLACEHOLDER` tokens; (4) H1 presence and uniqueness; (5) the `H1 → one purpose paragraph → optional "## Where to look in the code" bullet list` structural contract with purpose-length bounds (`UNDERSTANDING_PURPOSE_MIN_CHARS` lower bound, `UNDERSTANDING_PURPOSE_MAX_CHARS` upper bound), bullet-count cap (`UNDERSTANDING_MAX_SURFACES`), and per-bullet cap (`UNDERSTANDING_SURFACE_MAX_CHARS`). The section heading must be `## Where to look in the code`; the legacy `## Key surfaces` heading is accepted only by the tolerant reader, not by this strict check.

The function returns early after the missing-frontmatter and unparseable-frontmatter checks so subsequent rules can assume a valid frontmatter block. The whole-body lexical scans do not short-circuit — they collect every violation so the repair loop can act on them all at once.

## Deterministic salvage

<!-- lw:anchors packages/core/src/understanding.ts#salvageUnderstandingCandidate packages/core/src/understanding.ts#clipAtClauseBoundary -->

When the model output fails only mechanically (purpose too long, surface bullet too long, or stray inline-code backticks around prose), this salvage path is the deterministic last resort. The intent is to delete-only repair — no rewriting, no rephrasing, no new content — and to fail closed by returning `null` when the repaired page still violates the contract.

```ts
export function salvageUnderstandingCandidate(raw: string): string | null
function clipAtClauseBoundary(text: string, max: number, min: number): string | null
```

`salvageUnderstandingCandidate` takes the raw candidate text and returns either the repaired page string or `null`. The pipeline: normalize CRLF, peel off the existing frontmatter block verbatim, refuse the candidate if any fenced code block (` ``` ` or `~~~`) is present, unwrap every inline backtick span (` ``text`` ` → `text`) without rewriting the prose, locate the H1, walk the immediate purpose paragraph and clip it with `clipAtClauseBoundary`, walk the optional surfaces section heading and bullets (clipping each bullet via the same helper), reassemble the page, and re-validate it through `validateUnderstandingArtifact`. Any residual violation or any non-bullet content inside the surfaces section returns `null`, preserving the `repair_exhausted` failure class.

`clipAtClauseBoundary` takes the text plus `max` (upper bound) and `min` (lower bound) and returns either the clipped string or `null`. It scans sentence terminators (`[.!?。！？]` optionally followed by closing quotes/brackets) and clause separators (`—`, `;`, `,` followed by whitespace), picks the last match whose end index is ≤ `max`, then trims trailing whitespace and separators. It returns `null` when the latest in-budget boundary is still below `min`, enforcing the lower bound by failing closed. It enforces only the upper bound on the result, with the lower bound acting as a feasibility floor for clipping.

## Tolerant reader and disk loader

<!-- lw:anchors packages/core/src/understanding.ts#parseUnderstandingPage packages/core/src/understanding.ts#loadUnderstandingSynthesis -->

The tolerant reader exists because wiki pages are sticky: pre-#30 pages keep the old `## Key surfaces` heading forever, and human-edited pages may carry any `owner`. The reader accepts both headings, accepts any owner value, and degrades gracefully when the shape is not recognizable so downstream callers can fall back to the pre-existing orientation chain byte-for-byte.

```ts
export function parseUnderstandingPage(content: string): UnderstandingSynthesis | null
export async function loadUnderstandingSynthesis(
  repoRoot: string,
): Promise<UnderstandingSynthesis | null>
```

`parseUnderstandingPage` takes the raw page text and returns `{ title, purpose, surfaces }` or `null`. It tries `parseFrontmatter` first and falls back to reading the raw body if frontmatter parsing throws; locates the first H1 as `title`; collects the paragraph block immediately after it as `purpose`; then locates the surfaces section by matching either `SURFACES_HEADING_RE` (`## Where to look in the code`) or `LEGACY_SURFACES_HEADING_RE` (`## Key surfaces`), and collects only lines beginning with `- `. Any frontmatter parse error, missing H1, or empty purpose yields `null`.

`loadUnderstandingSynthesis` takes the repo root and returns `Promise<UnderstandingSynthesis | null>`. It checks `safeIo.exists(repoRoot, UNDERSTANDING_REL_PATH)`, reads the file via `safeIo.readText`, hands the content to `parseUnderstandingPage`, and swallows every error so quickstart regeneration always degrades to the orientation fallback. It never throws.

## Tests

Covered by `packages/core/src/understanding.test.ts` (same-name test file on disk).
