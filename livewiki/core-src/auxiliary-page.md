---
title: Auxiliary module page generator
owner: generated
anchors:
  - packages/core/src/auxiliary-page.ts#disambiguateHeadings
  - packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage
  - packages/core/src/auxiliary-page.ts#howItFitsParagraph
  - packages/core/src/auxiliary-page.ts#humanizeModuleId
  - packages/core/src/auxiliary-page.ts#referenceParagraph
---

# Auxiliary module page generator

This page documents the auxiliary page generator — a deterministic Markdown builder for non-product module pages (fixtures, tooling, docs, tests).

## When to use this page

- **Read** this page when you want to understand how auxiliary (non-product) module pages are assembled in the livewiki pipeline.
- **Modify** this page's code when the auxiliary page contract changes (for example the H2 set, the per-symbol H3 shape, or the role bullet text).
- **Debug** an `auxiliary_page_not_compact` validator failure or a stage-4 circuit-breaker trip that may be caused by auxiliary pages.
- **Compare** this generator's output against the legacy LLM stage-4 path to confirm both produce the same auxiliary contract.

## How it fits

This module lives in `packages/core/src/auxiliary-page.ts` inside the livewiki core package. It is invoked from the stage-4 artifact pipeline for any module that `classifyModuleRole` resolves to a non-product role (`fixture`, `tooling`, `docs`, or `test`); product modules still go through the LLM stage-4 loop.

The generator consumes a `Module` value, an `AuxiliaryRole`, the indexed symbol rows for that module, and the closed canonical key list the orchestrator has already minted. It emits a complete Markdown page that satisfies the same compact auxiliary contract the LLM prompt used to describe (the H2 set, the one-H3-plus-marker-plus-paragraph shape per symbol, and the frontmatter anchor list). Because every auxiliary page is built mechanically here, no LLM call is spent on fixtures, tooling, or docs, and the resulting artifact always passes `validateStage4Artifact`'s auxiliary checks. Downstream consumers in the orchestrator treat the output identically to an LLM-generated product page once it leaves this function.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-auxiliary-page.mmd
```

## Building the page envelope

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#humanizeModuleId -->

The first responsibility is to assemble the top-of-page scaffolding — frontmatter, the H1 title, the `When to use this page` bullets, and the `How it fits` paragraph — so the downstream stages of the pipeline see a shape they can validate. `generateAuxiliaryModulePage` is the only entry point exposed to callers; it takes the resolved `Module`, the `AuxiliaryRole` decided upstream, the indexed symbol rows, and the orchestrator-supplied closed key list:

```ts
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string
```

The function takes a module descriptor, a role classification, the symbol rows for that module, and the closed key list, and it returns a complete Markdown page as a single string.

The function chooses the page title by preferring `module.displayTitle` and falling back to a derived title via `humanizeModuleId`:

```ts
function humanizeModuleId(id: string): string
```

`humanizeModuleId` takes a dotted or slashed module identifier and returns a Title-Cased human label, splitting on `/`, `-`, and `_` and joining the resulting words. It exists as the deterministic fallback so that auxiliary pages still get a readable H1 when stage-2 did not accept a `displayTitle`. With an empty input it returns the original `id` verbatim, which only happens when the source string had no usable delimiters.

Back in `generateAuxiliaryModulePage`, the frontmatter block is written first: `title` and the mandatory `owner: generated` line, followed by an `anchors:` YAML list that mirrors the closed key list exactly when it is non-empty. The H1 then repeats the title, followed by a one-sentence responsibility statement that names the role label (`ROLE_LABEL[role]`) so a reader can tell at a glance that they are looking at reference material rather than product code.

The `When to use this page` section reads three pre-authored bullets from `ROLE_BULLETS[role]`, one per role. These bullets are deliberately phrased as developer tasks (debugging, adding coverage, modifying scripts, editing docs) so the page reads as instructions for the right audience rather than as a generic placeholder.

The `How it fits` paragraph is delegated to `howItFitsParagraph` (covered below) so the wording can stay in sync with how the page is positioned in the pipeline.

## Writing the per-symbol reference section

<!-- lw:anchors packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#referenceParagraph -->

After the envelope, the function loops over the symbol list and emits one H3 per symbol, each followed by a single short paragraph that the LLM stage used to produce. To prevent two symbols with identical names from producing duplicate H3 anchors, `generateAuxiliaryModulePage` first rewrites the heading text via `disambiguateHeadings`:

```ts
function disambiguateHeadings(
  symbols: AuxiliarySymbolRow[],
): Array<{ symbol: AuxiliarySymbolRow; heading: string }>
```

`disambiguateHeadings` takes the list of symbol rows and returns the same rows paired with a heading string, suffixing duplicate names with the file basename in parentheses (for example `foo (bar.ts)`) so each H3 stays unique. Symbols whose name appears only once keep their bare name as the heading, which keeps the common case clean.

The body under each H3 is produced by `referenceParagraph`:

```ts
function referenceParagraph(
  module: Module,
  roleLabel: string,
  symbol: AuxiliarySymbolRow,
): string
```

`referenceParagraph` takes the module descriptor, the human role label, and one symbol row, and returns a one-sentence Markdown paragraph. The sentence is a fixed template — `` `<signature>` is a `<kind> defined in `<path>`, part of this area's <roleLabel> — not part of the product's runtime behavior. `` — where the signature defaults to the symbol name when none was captured, and the path defaults to the first module path when the symbol key has no `#` separator.

Because the prompt contract caps the paragraph length, `referenceParagraph` also enforces an upper bound: the signature (not the finished sentence) is sliced so the wrapped output stays under `MAX_REFERENCE_PARAGRAPH_CHARS`, and the slice is truncated with a `…` ellipsis when it runs over budget. The bound is applied only on the upper side: the source visibly clamps over-long signatures but does not pad or validate shorter ones. Truncating the signature before the backtick wrap keeps the Markdown fence balanced — slicing the assembled sentence could land inside `` ` `` and leak an `unclosed_markdown` artifact to the validator.

Finally, `generateAuxiliaryModulePage` joins the accumulated lines, collapses runs of three or more blank lines down to two, trims trailing whitespace, and appends a single trailing newline so the artifact is byte-stable across runs.

## Filling the role-aware prose

<!-- lw:anchors packages/core/src/auxiliary-page.ts#howItFitsParagraph -->

The role-aware prose pieces are centralized in module-level lookup tables so the contract stays uniform across roles. `ROLE_LABEL` maps each `AuxiliaryRole` to a short noun phrase ("automated tests", "test fixtures and supporting test data", "build tooling, scripts, or benchmarks", "repository documentation"); this phrase is interpolated into both the responsibility sentence after the H1 and every per-symbol reference paragraph.

`ROLE_BULLETS` maps the same roles to a fixed three-element tuple of `When to use this page` bullets. Because the tuple is fixed at three entries, the H2 bullet list always has exactly three items regardless of how many symbols the module exposes.

The `How it fits` paragraph itself is delegated to `howItFitsParagraph`:

```ts
function howItFitsParagraph(module: Module, roleLabel: string): string
```

`howItFitsParagraph` takes the module descriptor and the role label, and returns a single sentence describing how many files the module spans and reaffirming that the area is reference material rather than product runtime. It pluralizes "file" versus "files" based on `module.paths.length` so the sentence reads naturally whether the module is a single file or a multi-file area, and it explicitly notes that these pages are not linked from the main product pages — a deliberate cue that auxiliary pages are reference-only and not part of the documented product surface.

## Tests

Covered by `packages/core/src/auxiliary-page.test.ts` (same-name test file on disk).
