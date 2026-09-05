---
title: Versioned Documentation Baseline
owner: generated
anchors:
  - packages/core/src/baseline.ts#BASELINE_REL_PATH
  - packages/core/src/baseline.ts#BASELINE_SCHEMA_VERSION
  - packages/core/src/baseline.ts#SUPPORTED_EXTRACTION_VERSIONS
  - packages/core/src/baseline.ts#available
  - packages/core/src/baseline.ts#baselineEntryIdentity
  - packages/core/src/baseline.ts#collectBaselineDocumentationInventory
  - packages/core/src/baseline.ts#collectMarkdownPaths
  - packages/core/src/baseline.ts#compareBaselineEntries
  - packages/core/src/baseline.ts#compareCodePoints
  - packages/core/src/baseline.ts#emptyBaseline
  - packages/core/src/baseline.ts#evaluateBaseline
  - packages/core/src/baseline.ts#extractionVersionForSymbolKey
  - packages/core/src/baseline.ts#hasExactKeys
  - packages/core/src/baseline.ts#incompatible
  - packages/core/src/baseline.ts#isRecord
  - packages/core/src/baseline.ts#logicalNameFromSymbolKey
  - packages/core/src/baseline.ts#mergeObligation
  - packages/core/src/baseline.ts#parseBaseline
  - packages/core/src/baseline.ts#readBaseline
  - packages/core/src/baseline.ts#serializeBaseline
  - packages/core/src/baseline.ts#sourcePathForSymbolKey
  - packages/core/src/baseline.ts#splitSymbolKey
  - packages/core/src/baseline.ts#validateDurablePath
  - packages/core/src/baseline.ts#validateSymbolKey
  - packages/core/src/baseline.ts#validateWikiPath
  - packages/core/src/baseline.ts#writeBaseline
  - packages/core/src/baseline.ts#writeBaselineCompareAndSwap
---

# Versioned Documentation Baseline

This page documents the repository authority that ties each wiki page to the symbol version it currently describes.

## When to use this page

- **Read this page** to understand the on-disk baseline contract, its validation rules, and the exact file path it uses.
- **Use this page** to learn how baseline entries are loaded, parsed, serialized, and committed without a database.
- **Refer to this page** when working with documentation inventory collection or repository-health evaluation.
- **Consult this page** when debugging baseline validation errors, move detection, or canonical serialization mismatches.

## How it fits

The baseline module owns the durable file `livewiki/.baseline.json` and the pure validation and evaluation logic around it. It is a leaf dependency for repository-health tooling: it reads Markdown pages and symbol lists, compares them against the stored baseline, and reports obligations, moves, and malformed pages. The module deliberately has no database dependency, so a clean clone can load and validate the same evidence as a deployed system.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-baseline.mmd
```

## Baseline Constants and Shape

<!-- lw:anchors packages/core/src/baseline.ts#BASELINE_REL_PATH packages/core/src/baseline.ts#BASELINE_SCHEMA_VERSION packages/core/src/baseline.ts#SUPPORTED_EXTRACTION_VERSIONS packages/core/src/baseline.ts#emptyBaseline -->

The baseline file's identity is fixed by `BASELINE_REL_PATH`, and its shape is fixed by `BASELINE_SCHEMA_VERSION` plus the extraction versions accepted by `SUPPORTED_EXTRACTION_VERSIONS`. `emptyBaseline` provides the starting shape for a repository that has no baseline yet.

`export const BASELINE_REL_PATH = "livewiki/.baseline.json";` is a constant naming the repository-relative path to the baseline file. It is the single location every read and write in this module uses.

`export const BASELINE_SCHEMA_VERSION = 1;` is a constant declaring the current schema version. Parsing reports `unsupported_schema` whenever a file's `schemaVersion` differs from this value.

`export const SUPPORTED_EXTRACTION_VERSIONS = new Set([` is a set of language-and-version identities, such as `ts-v1` and `py-v1`, that the baseline accepts for an entry's `extraction` field. The visible source shows a truncated opening for this constant; entries accepted include extension-based identities from the extraction mapping.

`export function emptyBaseline(): DocumentationBaseline {` takes no arguments and returns a fresh `DocumentationBaseline` whose `schemaVersion` is `BASELINE_SCHEMA_VERSION` and whose `entries` array is empty. It seeds a new repository baseline with a valid but blank shape.

Together these exports define the on-disk contract: a JSON object with a numeric `schemaVersion` and an array of `entries`, where each entry binds one wiki page path to one symbol key along with a content hash, an extraction version, and a provenance of `accepted` or `inferred`.

## Field Validation

<!-- lw:anchors packages/core/src/baseline.ts#validateWikiPath packages/core/src/baseline.ts#validateSymbolKey packages/core/src/baseline.ts#validateDurablePath packages/core/src/baseline.ts#splitSymbolKey packages/core/src/baseline.ts#sourcePathForSymbolKey packages/core/src/baseline.ts#extractionVersionForSymbolKey packages/core/src/baseline.ts#logicalNameFromSymbolKey -->

This group establishes what a well-formed wiki path and symbol key look like before any value is trusted. `validateDurablePath` is the shared lower-level check, while `validateWikiPath` and `validateSymbolKey` layer domain-specific rules on top of it. `splitSymbolKey`, `sourcePathForSymbolKey`, `extractionVersionForSymbolKey`, and `logicalNameFromSymbolKey` derive useful pieces from an already-shaped key.

`export function validateWikiPath(value: unknown): string | null {` takes any value and returns `null` when it is a durable path inside `livewiki/` ending in `.md`, or a descriptive error string otherwise. It runs `validateDurablePath` first, then enforces the `livewiki/` prefix and `.md` suffix.

`export function validateSymbolKey(value: unknown): string | null {` takes any value and returns `null` when it is a string matching `source/path.ext#SymbolName`, or a descriptive error string otherwise. It splits the key with `splitSymbolKey`, validates the source-path portion with `validateDurablePath`, and rejects symbol names containing ASCII control characters.

`function validateDurablePath(value: unknown): string | null {` takes any value and returns `null` when the value is a non-empty NFC-normalized string using forward slashes, with no `./` prefix, no absolute path or drive-letter prefix, and no empty, `.`, or `..` segment. A violation returns the specific message rather than `null`.

`function splitSymbolKey(symbolKey: string): { sourcePath: string; symbolName: string } | null {` takes a symbol key and returns the source path and symbol name split at the final `#`, or `null` when there is no `#`, when it appears at the start, or when it appears at the very end.

`export function sourcePathForSymbolKey(symbolKey: string): string | null {` takes a symbol key and returns its source-path portion, or `null` when the key cannot be split.

`export function extractionVersionForSymbolKey(symbolKey: string): string | null {` takes a symbol key and returns the stable extraction identity for its source file extension. For example, `.ts` yields `ts-v1`; unknown extensions and un-splittable keys return `null`.

`function logicalNameFromSymbolKey(symbolKey: string): string {` takes a symbol key and returns the final segment after the last dot in its symbol-name portion. It is used during move detection to recognize the same logical symbol name under a different source path.

## Baseline Parsing and Loading

<!-- lw:anchors packages/core/src/baseline.ts#parseBaseline packages/core/src/baseline.ts#readBaseline packages/core/src/baseline.ts#available packages/core/src/baseline.ts#incompatible packages/core/src/baseline.ts#isRecord packages/core/src/baseline.ts#hasExactKeys -->

Loading is fail-closed: the moment the root structure or an entry field violates the contract, the result is `incompatible` with structured issue codes. `parseBaseline` owns the in-memory interpretation, `readBaseline` owns the disk access, and `available` and `incompatible` are the two result constructors. `isRecord` and `hasExactKeys` enforce the strict object shapes that make the interpretation safe.

`export function parseBaseline(raw: string): BaselineLoadResult {` takes raw JSON text and returns either an `available` or `incompatible` load result. It first attempts JSON parsing; invalid JSON becomes `invalid_json`. The root must be a record with exactly `schemaVersion` and `entries`, `schemaVersion` must be an integer, and `entries` must be an array. Each entry must have exactly the five expected keys, each field is validated, and invalid entries are skipped while their issues are recorded. Duplicate page-plus-symbol identities are rejected. When no field issues remain, the parser compares the raw input against `serializeBaseline` and records `noncanonical_serialization` when they differ.

`export async function readBaseline(repoRoot: string): Promise<BaselineLoadResult> {` takes a repository root and returns `unavailable` when the baseline file does not exist, or the result of `parseBaseline` when the file can be read. A read failure is reported as `incompatible` with code `invalid_json` and detail `baseline could not be read`.

`function available(baseline: DocumentationBaseline): BaselineLoadResult {` takes a successfully parsed baseline and returns it in the `available` state with no issues. This is the only path that produces a usable baseline.

`function incompatible(` takes a list of issues and an optional partially parsed baseline, and returns the `incompatible` state with both attached.

`function isRecord(value: unknown): value is Record<string, unknown> {` takes any value and returns true only for non-null, non-array objects. It separates object-shaped JSON values from arrays and primitives before key inspection.

`function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {` takes a record and an expected key list, and returns true only when the record has exactly those keys, no more and no fewer. It enforces the strict shape contract for the baseline root and each entry.

## Baseline Serialization and Writing

<!-- lw:anchors packages/core/src/baseline.ts#serializeBaseline packages/core/src/baseline.ts#writeBaseline packages/core/src/baseline.ts#writeBaselineCompareAndSwap packages/core/src/baseline.ts#baselineEntryIdentity packages/core/src/baseline.ts#compareBaselineEntries packages/core/src/baseline.ts#compareCodePoints -->

Persistence is canonical and race-aware. `serializeBaseline` defines the exact bytes, `compareBaselineEntries` and `compareCodePoints` define deterministic ordering, and `baselineEntryIdentity` defines the stable identity used for duplicate detection. `writeBaseline` and `writeBaselineCompareAndSwap` commit those bytes atomically without clobbering concurrent changes.

`export function serializeBaseline(baseline: DocumentationBaseline): string {` takes a baseline and returns its canonical one-entry-per-line JSON representation with a trailing newline. Entries are sorted by wiki path and symbol key, and each entry is serialized with exactly the five expected fields. Parsing compares raw input against this output to detect non-canonical files.

`export async function writeBaseline(` takes a repository root and a baseline, serializes and validates the baseline, and writes it atomically to disk. If the canonical bytes already match the existing file, it returns `false` without writing. Validation failure or a write-read race can throw.

`export async function writeBaselineCompareAndSwap(` takes a repository root, an expected baseline or `null`, and a next baseline, and replaces the file only when the current canonical bytes exactly match the supplied expected bytes. It validates the next baseline first and returns `false` when the expected raw bytes equal the next raw bytes. The atomic write uses a lock file at `.livewiki/baseline.lock`.

`export function baselineEntryIdentity(entry: Pick<BaselineEntry, "wikiPath" | "symbolKey">): string {` takes an entry-like value and returns a stable identity string combining its wiki path and symbol key with a `\0` separator. This identity keys duplicate detection and obligation lookups.

`export function compareBaselineEntries(left: BaselineEntry, right: BaselineEntry): number {` takes two baseline entries and returns a comparison number ordered by wiki path first, then by symbol key, using code-point ordering.

`function compareCodePoints(left: string, right: string): number {` takes two strings and returns a code-point-sequence comparison number. It is used wherever deterministic ordering is required, avoiding platform-dependent locale sorting.

## Documentation Inventory Collection

<!-- lw:anchors packages/core/src/baseline.ts#collectBaselineDocumentationInventory packages/core/src/baseline.ts#collectMarkdownPaths packages/core/src/baseline.ts#mergeObligation -->

The inventory reconstructs what the repository currently claims to document from Markdown content only. `collectMarkdownPaths` finds the pages, `collectBaselineDocumentationInventory` extracts obligations from them, and `mergeObligation` keeps human ownership monotonic when the same page-plus-symbol obligation appears more than once.

`export async function collectBaselineDocumentationInventory(` takes a repository root and scans every Markdown path under `livewiki/`, extracting ownership and anchors from each page, and collapsing them into current documentation obligations. Pages that fail frontmatter parsing are recorded as `malformedPages` and never silently treated as having zero obligations. Invalid symbol keys are skipped so they never cause source-path disk reads.

`async function collectMarkdownPaths(repoRoot: string): Promise<string[]> {` takes a repository root, walks the `livewiki/` directory recursively, and returns every `.md` file as a repository-relative path with forward slashes. Dot-prefixed directories are skipped and the result is sorted by code-point order. A directory read error simply omits that subtree.

`function mergeObligation(` takes an obligation map and a new obligation, and preserves the existing entry unless the new one upgrades an `agent` assignee to `human`. Human ownership therefore wins over agent ownership for the same wiki path and symbol key.

## Baseline Evaluation

<!-- lw:anchors packages/core/src/baseline.ts#evaluateBaseline -->

The evaluation step is pure: it derives repository health from a loaded baseline, a current symbol list, and a current inventory, with no file or database access. `evaluateBaseline` compares stored evidence against current facts and reports clean, changed, deleted, inferred, moved, and unbaselined items.

`export function evaluateBaseline(` takes a baseline, a symbol list, and an inventory, and returns a `BaselineHealth` summary. It builds identity-keyed maps, identifies unbaselined obligations and removed anchors, and walks accepted-but-missing baseline entries to propose moves when a single candidate symbol shares the hash, extraction version, and logical name under a different key. Each entry is assigned one of `clean`, `changed`, `deleted`, or `inferred`, and malformed pages are passed through from the inventory so they are reported and never counted as clean.

## Tests

Covered by `packages/core/src/baseline.test.ts` (same-name test file on disk).
