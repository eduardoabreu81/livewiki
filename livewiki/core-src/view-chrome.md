---
title: Viewer chrome string tables and language resolution
owner: generated
anchors:
  - packages/core/src/view-chrome.ts#GROUP_ORDER
  - packages/core/src/view-chrome.ts#resolveViewerChrome
---

# Viewer chrome string tables and language resolution

This page covers the module that supplies the localized UI strings shown around every wiki page (the "chrome"), and the small resolver that picks the right string table for a given viewer language.

## When to use this page

- **Add a new language** to the wiki by dropping one more entry into the chrome tables.
- **Trace how a locale string ends up on screen** by following the resolver from `language` to a chrome table.

## How it fits

`packages/core/src/view-chrome.ts` lives under `packages/core/src/`, the core package that the viewer's rendering pipeline consumes. The surrounding codebase already writes page CONTENT in the configured wiki language during the generation step, but every string a reader *touches* on every page — sidebar group labels, the search box, the theme toggle, the version stamp, freshness badges, diagram titles and captions, and the Mermaid fallback note — comes from this module. The Activity dashboard's body strings are intentionally not in scope here; they remain English for now.

The module's two responsibilities are tightly linked: it defines a stable ordering for the sidebar's group identity, and it owns the chrome string tables plus a resolver that picks a table by the BCP-47 base subtag (so `pt-BR` resolves to the Portuguese table) and falls back to English byte-for-byte when the language is unknown. That fallback guarantees the pre-#30 English output is unchanged for any caller that has not yet threaded a language through.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-view-chrome.mmd
```

## Sidebar group ordering

<!-- lw:anchors packages/core/src/view-chrome.ts#GROUP_ORDER -->

The sidebar is grouped by *identity*, not by display label: the keys are English (`"Quickstart"`, `"Concept topics"`, `"Flows"`, `"Implementation reference"`, `"Auxiliary areas"`, `"Diagrams"`, `"Indexes & overviews"`, `"Activity"`), and only the rendered label is localized through each chrome table's `groupLabels` record. That separation is what lets one constant describe the *order* of groups regardless of which language the reader has selected.

```ts
export const GROUP_ORDER: readonly SiteGroup[] = [
  "Quickstart",
  "Concept topics",
  "Flows",
  "Implementation reference",
  "Auxiliary areas",
  "Diagrams",
  "Indexes & overviews",
  "Activity",
];
```

`GROUP_ORDER` is the canonical sequence the sidebar walks when laying itself out; the per-language `groupLabels` table maps each `SiteGroup` key to its human label, so reordering happens in one place.

## Chrome string tables and language resolution

<!-- lw:anchors packages/core/src/view-chrome.ts#resolveViewerChrome -->

The chrome tables are plain `ViewerChrome` records: one for English (`EN`) and one for Portuguese (`PT`), each providing localized strings for the search box, theme toggle, version stamp, freshness badges, diagram titles/captions, and the Mermaid fallback note, plus a `groupLabels` map that localizes the sidebar group keys. A `CHROME_TABLES` map keyed by base subtag (`en`, `pt`) holds both, and adding a language is a data-only change: append one more entry.

```ts
export function resolveViewerChrome(language: string | undefined): ViewerChrome
```

The function takes the configured wiki `language` (a BCP-47 tag such as `pt-BR`, or `undefined` when none is set) and returns a `ViewerChrome` table the renderer can read directly.

`resolveViewerChrome` normalizes the input by splitting on `-`, lowercasing, and taking the first segment, defaulting to `"en"` when `language` is `undefined` or yields an empty base. It then indexes `CHROME_TABLES` by that base; on any miss, it returns `EN` byte-for-byte. The visible behavior is therefore: configured language → localized table; any unknown or absent language → English with no string rewrites. The same English fallback is used whether the input is `undefined`, an empty string after splitting, or an unconfigured BCP-47 tag, so callers do not need to defend against missing translations.

## Tests

Covered by `packages/core/src/view-chrome.test.ts` (same-name test file on disk).
