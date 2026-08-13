---
title: Testing
owner: generated
kind: topic
order: 0
intent: Explains how 5 related modules coordinate testing (Cargo.toml, Handler.java, Item.java, Main.java).
modules:
  - cli-src
  - commands
  - core-src
  - llm
  - mcp-src
flows:
  - cli-src-to-llm
  - mcp-src-to-llm
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/cli/src/commands/batch.ts#setExitCode
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/install.ts#formatDetectionHuman
  - packages/cli/src/commands/install.ts#formatResultsHuman
  - packages/cli/src/commands/view.ts#openBrowser
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/core/src/db.ts#openIndex
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/modules.ts#normalizeRepoPath
updated: 2026-08-12
---

# Testing

You want to change livewiki's parsing, CLI output, or failure reporting and need to know which deterministic guarantees the test suites will hold you to.

## Purpose

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/hashes.ts#sha256 packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#normalizeRepoPath -->

Livewiki's testing story rests on a small set of deterministic primitives whose exact behavior the suites pin down, because every higher-level guarantee (anchor validation, debt detection, hallucination rejection) is built on top of them. The frontmatter parser `packages/core/src/frontmatter.ts#parseFrontmatter` implements the deliberate YAML subset every wiki page is checked against — top-level keys, block string lists, and single-level flow-style lists — and its documented limitations (no nested maps, no multi-line strings) are themselves part of the tested contract. The content-hash helper `packages/core/src/hashes.ts#sha256` gives the indexer and the anchor ledger a stable identity for file bytes and symbol slices, including the EOL-insensitive normalization that keeps CRLF checkouts from producing phantom changes. The masking utility `packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength` lets validators scan prose while ignoring fenced code and inline spans, and its length-preserving variant keeps diagnostic offsets byte-for-byte equal to the original document — the property several regression suites assert with exact line numbers. Finally, the role classifier `packages/core/src/modules.ts#classifyModuleRole` decides whether an indexed path is product or auxiliary surface, and `packages/core/src/modules.ts#normalizeRepoPath` canonicalizes repo-relative paths so anchors and ledger entries stay stable across operating systems. Together these five functions define what "correct" means for everything the integration tests exercise above them.

## When to use this page

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

Read this page when a change touches any surface the suites pin exactly — a validator message, a CLI rendering, an exit code — or when a test failure suggests the contract moved rather than the test. It is also the right starting point before extending coverage into a new area, because the existing suites show the established patterns: unit tests for the primitives, end-to-end suites that run the CLI as a subprocess against stub LLM servers, and MCP tests that connect client and server over an in-memory transport. State for all of these flows begins at the index opener `packages/core/src/db.ts#openIndex`, which opens the derived SQLite cache and applies schema migrations idempotently; tests that exercise debt, ledger, or status behavior all pass through it, so its migration discipline (check columns before altering, never assume) is a recurring subject of the persistence tests.

## Behavioral contract

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The CLI's observable behavior funnels through a deliberately small surface, and the suites treat that surface as the contract. Program construction in `packages/cli/src/cli.ts#createProgram` wires every command and the global flags, so command-registration tests catch a command that silently stops being exposed. Version reporting through `packages/cli/src/cli.ts#readVersion` resolves the version from the package's own manifest with a defined fallback, and repository rooting through `packages/cli/src/cli.ts#resolveRepoRoot` turns the `--repo` flag into the absolute root every command agrees on. All user-facing output passes through the dual-channel emitter: `packages/cli/src/output.ts#emit` selects machine or human rendering, while `packages/cli/src/output.ts#emitJson` and `packages/cli/src/output.ts#emitHuman` produce the two forms. Because tests assert both the JSON shape and the human wording, a change to one channel without the other shows up as a suite failure rather than drifting documentation.

## Failure and recovery

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/index-cmd.ts#formatLedgerHuman packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatResultsHuman -->

Failure presentation is pinned as strictly as success. The exit-code mapper `packages/cli/src/commands/batch.ts#setExitCode` translates batch outcomes into the documented 0/1/2 codes and assigns `process.exitCode` instead of calling `process.exit`, a discipline the suites protect because terminating early can corrupt pending asynchronous cleanup. Run listings come from `packages/cli/src/commands/batch.ts#formatListHuman`, the index and debt ledger rendering from `packages/cli/src/commands/index-cmd.ts#formatLedgerHuman`, and the installer's agent-detection and apply reports from `packages/cli/src/commands/install.ts#formatDetectionHuman` and `packages/cli/src/commands/install.ts#formatResultsHuman`. Each of these renderers has tests that assert exact wording on both the happy path and the failure paths, so error text is reviewed contract, not afterthought.

## Change map

<!-- lw:anchors packages/cli/src/commands/view.ts#openBrowser -->

When you change any symbol cited here, update its module page in the same change and expect the corresponding suite to fail until the new behavior is pinned. The viewer's browser launcher `packages/cli/src/commands/view.ts#openBrowser` illustrates the pattern: it opens the built site cross-platform through a shell-free spawn, and its tests pin that discipline per operating system, so a platform change lands in code, page, and test together.

## Related pages

- [Topics hub](index.md)
- [cli-src module](../cli-src/index.md)
- [commands module](../commands/index.md)
- [core-src module](../core-src/index.md)
- [llm module](../llm/index.md)
- [mcp-src module](../mcp-src/index.md)
- [cli-src-to-llm flow](../flows/cli-src-to-llm.md)
- [mcp-src-to-llm flow](../flows/mcp-src-to-llm.md)
- [cli-src-to-llm diagram](../diagrams/flow-cli-src-to-llm.mmd)
- [mcp-src-to-llm diagram](../diagrams/flow-mcp-src-to-llm.mmd)
