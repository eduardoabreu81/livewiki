---
title: Tools
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall
  - docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save
---

# Tools

`tools` is classified as build tooling, scripts, or benchmarks rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are modifying the build, lint, release, or benchmark scripts in this module.
- You need the exact symbols this tooling module exposes to other scripts.
- You are debugging a CI or local tooling failure that touches this module.

## How it fits

This module spans 2 files classified as build tooling, scripts, or benchmarks. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### readJson
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#readJson -->

`function readJson(p) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### walk
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#walk -->

`function walk(d, a = []) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### scanPage
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#scanPage -->

`function scanPage(filePath) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### plannedSymbolsFromOverview
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs#plannedSymbolsFromOverview -->

`function plannedSymbolsFromOverview(overviewText, plannedIds) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### ensureOutDir
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#ensureOutDir -->

`function ensureOutDir() {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### save
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#save -->

`function save() {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### normalizeUsage
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#normalizeUsage -->

`function normalizeUsage(usage) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### num
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#num -->

`function num(v) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### extractUsageFromBody
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractUsageFromBody -->

`function extractUsageFromBody(buf, isStream) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### extractBodyError
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#extractBodyError -->

`function extractBodyError(j) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### peekRequestMeta
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#peekRequestMeta -->

`function peekRequestMeta(bodyBuf) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

### recordCall
<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs#recordCall -->

`function recordCall(record) {` is a function defined in `docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs`, part of the build tooling, scripts, or benchmarks surface of `tools` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
