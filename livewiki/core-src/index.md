---
title: packages/core/src
owner: generated
---

# packages/core/src

This directory holds automated tests with no co-located product code.

## Files

- [anchor-ledger.ts](anchor-ledger.md) — Anchor ledger · Tests: `anchor-ledger.test.ts`
- [anchors.ts](anchors.md) — Anchor and manual-block extractor · Tests: `anchors.test.ts`
- [artifact-repair.ts](artifact-repair.md) — Mechanical artifact repair · Tests: `artifact-repair.test.ts`
- [artifact.ts](artifact.md) — Stage-4 artifact normalization and validation · Tests: `artifact.test.ts`
- [auxiliary-page.ts](auxiliary-page.md) — Auxiliary module page generator · Tests: `auxiliary-page.test.ts`
- [batch-state.ts](batch-state.md) — Batch state shape and diagnostic bounds
- [batch-status.ts](batch-status.md) — Batch status aggregation · Tests: `batch-status.test.ts`
- `batch.ts` · page not written yet · Tests: `batch.test.ts`
- [blast-radius.ts](blast-radius.md) — Computing the change-impact blast radius for a symbol · Tests: `blast-radius.test.ts`
- [call-resolution.ts](call-resolution.md) — Call Resolution · Tests: `call-resolution.test.ts`
- [change-impact.ts](change-impact.md) — Change Impact Computation · Tests: `change-impact.test.ts`
- [community.ts](community.md) — Community detection cross-check · Tests: `community.test.ts`
- [config.ts](config.md) — livewiki core config — repository-scoped `.livewiki/config.json` lifecycle · Tests: `config.test.ts`
- [db.ts](db.md) — SQLite schema and migrations for the livewiki index · Tests: `db.test.ts`
- [diagrams.ts](diagrams.md) — Mermaid diagram generation for architecture and class pages · Tests: `diagrams.test.ts`
- [diff-preview.ts](diff-preview.md) — Working-tree diff preview of anchor debt · Tests: `diff-preview.test.ts`
- [export.ts](export.md) — Livewiki exporter · Tests: `export.test.ts`
- [file-page-plan.ts](file-page-plan.md) — file-page-plan · Tests: `file-page-plan.test.ts`
- [flow-diagram.ts](flow-diagram.md) — flow-diagram.ts — deterministic Mermaid renderer for stage-5 flow pages · Tests: `flow-diagram.test.ts`
- [flows.ts](flows.md) — Flow candidate detection (stage 5) · Tests: `flows.test.ts`
- [folder-page.ts](folder-page.md) — Folder page unit (deterministic skeleton + bounded LLM purpose paragraph) · Tests: `folder-page.test.ts`
- [frontmatter.ts](frontmatter.md) — Frontmatter parser · Tests: `frontmatter.test.ts`
- [gitignore.ts](gitignore.md) — Gitignore entry manager · Tests: `gitignore.test.ts`
- [hashes.ts](hashes.md) — Content hashing utilities · Tests: `hashes.test.ts`
- [import-resolution.ts](import-resolution.md) — Import resolution — one resolver, one edge type · Tests: `import-resolution.test.ts`
- [imports.ts](imports.md) — Extract imports from a parsed source file · Tests: `imports.test.ts`
- `index.ts` — not documented (re-export, configuration, or plain-text file)
- [indexer.ts](indexer.md) — Indexer pipeline — walking, hashing, and persisting symbols · Tests: `indexer.test.ts`
- [init.ts](init.md) — init command entry point
- [install.ts](install.md) — install — agent auto-detection and merge adapters · Tests: `install.test.ts`
- [manifest.ts](manifest.md) — Livewiki manifest read/write pipeline · Tests: `manifest.test.ts`
- [markdown-mask.ts](markdown-mask.md) — markdown-mask · Tests: `markdown-mask.test.ts`
- [mermaid-validator.ts](mermaid-validator.md) — Mermaid syntax validator
- [modules.ts](modules.md) — Module graph primitives for the livewiki batch pipeline · Tests: `modules.test.ts`
- [navigation.ts](navigation.md) — Navigation hubs and per-page navigate blocks · Tests: `navigation.test.ts`
- [orientation.ts](orientation.md) — Repo orientation extraction · Tests: `orientation.test.ts`
- [output-budget.ts](output-budget.md) — Output token budget computation · Tests: `output-budget.test.ts`
- [page-units.ts](page-units.md) — Planning repository page units · Tests: `page-units.test.ts`
- [parser.ts](parser.md) — parser — language bootstrap and per-extension grammar resolution · Tests: `parser.test.ts`
- [pointer.ts](pointer.md) — livewiki pointer block insertion · Tests: `pointer.test.ts`
- [presets.ts](presets.md) — Provider presets and config expansion · Tests: `presets.test.ts`
- [pricing.ts](pricing.md) — pricing — token-cost lookup and USD formatting · Tests: `pricing.test.ts`
- `prompts.ts` · page not written yet · Tests: `prompts.test.ts`
- [rationale-evidence.ts](rationale-evidence.md) — Rationale evidence renderer
- [readme-export.ts](readme-export.md) — README export — deterministic README.md synthesis from the wiki · Tests: `readme-export.test.ts`
- [repair-contract.ts](repair-contract.md) — Repair contract — dispositions, directives, and early-abort helpers · Tests: `repair-contract.test.ts`
- [risk.ts](risk.md) — Risk-weighted debt prioritization · Tests: `risk.test.ts`
- [safe-io.ts](safe-io.md) — safe-io — the only module allowed to touch disk · Tests: `safe-io.test.ts`
- [section-guard.ts](section-guard.md) — H2-section machinery for surgical repair · Tests: `section-guard.test.ts`
- [status.ts](status.md) — "core: status — wiki + index health report" · Tests: `status.test.ts`
- [symbols.ts](symbols.md) — Symbol extraction from tree-sitter ASTs · Tests: `symbols.test.ts`
- [topics.ts](topics.md) — Topic planning · Tests: `topics.test.ts`
- [understanding.ts](understanding.md) — "Understanding — Repository Orientation Synthesis Layer" · Tests: `understanding.test.ts`
- [update-metrics.ts](update-metrics.md) — Update metrics ledger · Tests: `update-metrics.test.ts`
- [update.ts](update.md) — "Incremental update command: emit work packages and record write-backs" · Tests: `update.test.ts`
- [verify.ts](verify.md) — Verifying the wiki against the code index · Tests: `verify.test.ts`
- [view-activity.ts](view-activity.md) — Activity dashboard aggregation and rendering · Tests: `view-activity.test.ts`
- [view-chrome.ts](view-chrome.md) — Viewer chrome string tables and language resolution · Tests: `view-chrome.test.ts`
- [view.ts](view.md) — Building the Offline Wiki Viewer · Tests: `view.test.ts`
- [walker.ts](walker.md) — Repo file walker (gitignore-aware) · Tests: `walker.test.ts`

### Test files without a same-name counterpart

- `batch-community.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-concurrency.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-context.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-module-diagrams.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-repair.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-review.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-stage5.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-surgical-repair.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-test-role.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `batch-understanding.test.ts` — test file, probably covers `batch` (guessed from the file name)
- `calls.test.ts` — no product file in this repository matches this test
- `ignores-propagation.test.ts` — no product file in this repository matches this test
- `init-config.test.ts` — test file, probably covers `init` (guessed from the file name)
- `init-overview.test.ts` — test file, probably covers `init` (guessed from the file name)
- `init-stale-module-pages.test.ts` — test file, probably covers `init` (guessed from the file name)
- `key-leak.test.ts` — no product file in this repository matches this test
- `module-diagram-format.test.ts` — no product file in this repository matches this test

55 of the 59 documented files in this folder have a test file named after them.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [From CLI command to LLM provider — the request path livewiki walks](../flows/cli-src-to-llm.md)
- Topic: [Testing](../topics/testing-f41eeea7.md)
- [packages/cli/src/commands](../commands/index.md) — depends on this folder
- [packages/mcp/src](../mcp-src/index.md) — depends on this folder
- [packages/core/src/llm](../llm/index.md) — used both ways

> Coverage note: this folder's source (132 files, ~3258k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
