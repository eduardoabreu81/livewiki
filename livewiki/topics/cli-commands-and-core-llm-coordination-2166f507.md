---
title: CLI Commands and Core LLM Coordination
owner: generated
kind: topic
order: 0
intent: Explains how CLI command modules and core LLM modules coordinate configuration and processing.
modules:
  - cli-src
  - commands
  - core-src
  - llm
  - mcp-src
flows:
  - cli-src-to-core-src
  - cli-src-to-llm
anchors:
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/db.ts#openIndex
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#wrapInSafeFence
updated: 2026-09-05
---

# CLI Commands and Core LLM Coordination

This page explains how the livewiki command-line interface (CLI) command modules coordinate with core source and LLM modules to configure, process, and safeguard documentation generation.

## Purpose
<!-- lw:anchors packages/core/src/config.ts#loadConfig -->

The CLI is the user-facing layer that translates command-line invocations into core operations. The `commands` module (in `packages/cli/src/commands`) implements each subcommand—`init`, `config`, `index-cmd`, `baseline`, `status`, `update`, `verify`, `export`, `view`, `serve`, `install`, `pointer`, and `batch`—as a thin adapter that converts Commander options into service calls from `@livewiki/core`. These commands separate report formatting from underlying index and ledger operations.

The configuration file `.livewiki/config.json` holds the repo-local settings that determine how the core and LLM layers behave. The configuration loader function `packages/core/src/config.ts#loadConfig` reads this file from the repository root. When the file is absent, it returns an empty configuration object—no defaults are applied at load time; instead, defaults are resolved later at use time. If the file exists but contains malformed JSON, the loader fails closed by throwing an error with a message that identifies the file path and instructs the user to fix or delete it. The loader does not hard-code any default model or provider; API keys never reside in this repo-local configuration, as they resolve from the process environment or the global credential store.

This configuration drives the coordination between the CLI commands and the LLM layer. For example, when a user runs a batch documentation command, the CLI reads this configuration to determine which provider preset, model, language, and output-token strategy to apply, then hands that configuration to the core processing pipeline.

## When to use this page
<!-- lw:anchors packages/core/src/db.ts#openIndex -->

Use this page when you need to understand how the CLI command modules and core processing modules coordinate their work, particularly around configuration loading, database state, and LLM client creation. The page is relevant when you are debugging a CLI command that reads or writes the symbol index, or when you need to trace how a user's command-line invocation flows from `cli-src` into `core-src`.

The index database is central to this coordination. The database-opening function `packages/core/src/db.ts#openIndex` creates or opens the SQLite index database at a given path. This function does not validate the path—the caller is expected to have already gone through a safe file-I/O layer. It runs idempotent migrations, writes a schema version, and configures a busy timeout as its first operation on the database handle. This busy-timeout placement is deliberate: it must be set before any other statement runs, otherwise queued openers would die while a writer ahead of them does ordinary work. When the database handle cannot be bootstrapped due to write contention, `openIndex` closes the handle before throwing a write-contention error, preventing a Windows file lock from lingering on the `-wal` journal.

## Behavioral contract
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#wrapInSafeFence -->

Several core utility functions enforce behavioral contracts that protect both the integrity of documentation content and the safety of prompt construction.

The hashing function `packages/core/src/hashes.ts#sha256` computes a SHA-256 digest of its input, accepting either a string or a `Uint8Array`, and returns a 64-character lowercase hexadecimal string. The function is deterministic: the same input produces the same output. This hash underpins content fingerprinting—for example, detecting when a source file has changed between indexing runs without comparing full file contents, which is robust to line-ending conversions like CRLF becoming LF.

The masking function `packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength` transforms fenced code blocks and inline-code spans in Markdown text without altering the source length or any line terminator. Characters inside code regions become spaces, so every character position in the masked output corresponds to the same position in the original text. This length-preserving property allows the masker to be used by tools that need to locate or edit content at specific offsets—for instance, when scanning a document for headings or anchors while ignoring code that could contain deceptive text.

For safety when building prompts that include untrusted content, the prompt module exposes two functions. `packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers` replaces any control-marker pattern (such as `lw:anchors` or other internal directives) with an equal number of spaces, preventing untrusted text from injecting live control markers into a generated prompt. `packages/core/src/prompts.ts#wrapInSafeFence` encloses content in a fence that is chosen so that the fence delimiter does not appear inside the content being wrapped; this prevents a closing fence sequence inside the untrusted content from breaking out of the intended code block. Together these two functions ensure that rationale evidence or source snippets—both untrusted—cannot alter the structure of a prompt that instructs a language model.

## Failure and recovery
<!-- lw:anchors packages/core/src/modules.ts#classifyModuleRole -->

When the system processes modules for documentation, it must classify each directory's role—product, docs, tooling, fixture, or test. The classification function `packages/core/src/modules.ts#classifyModuleRole` counts paths within a module and applies a fixed priority order (product first, then docs, tooling, fixture, test). This priority rule governs tie-breaking: a folder mixing product code with an equal number of test files is classified as a product folder, which means its generated page documents the product code rather than treating the folder as test-only.

This deterministic role classification is a guardrail for failure scenarios. If a module is misclassified as a test folder when it actually contains product code, the documentation pipeline would under-document real product symbols. The fixed priority list prevents input order from affecting classification, and it ensures that product modules are never outranked by test fixtures even when a fixture is heavily imported. When role classification fails or yields an unexpected result, recovery depends on re-running the indexing or baseline command with corrected path-role configuration. The classification contract also feeds the ordering of stage-4 processing, where product modules are ranked higher regardless of centrality, so that a heavily imported test fixture does not consume the top entry-point slot that belongs to a real product module.

## Change map
<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter -->

The main change surface in this coordination layer is the frontmatter parser. The function `packages/core/src/frontmatter.ts#parseFrontmatter` parses the YAML frontmatter block that opens every livewiki page. Its contract: if a page does not start with `---`, the parser returns a result with `frontmatter: null`; if the opening delimiter is present but the closing delimiter is missing, it throws a `FrontmatterParseError`. The parser normalizes CRLF line endings to LF before scanning, and it supports inline flow-style lists (for example, `modules: [hooks, services]`) in addition to block-style lists—this matters because large language models often emit the flow-style form, which older parsers handled incorrectly as a single opaque string, breaking anchor checks.

Because the wiki generator itself consumes livewiki pages, and because those pages are frequently produced by an LLM, the frontmatter parser is a boundary where malformed or adversarial output can disrupt the build. A change to this parser therefore affects every downstream consumer: anchor extraction, owner detection, and flow module consumption. When modifying frontmatter handling, the change map extends into the modules that read page metadata for indexing and for flow construction, described in [cli-src-to-core-src](../flows/cli-src-to-core-src.md) and [cli-src-to-llm](../flows/cli-src-to-llm.md).

## Related pages

- [CLI source module](../cli-src/index.md)
- [Commands module](../commands/index.md)
- [Core source module](../core-src/index.md)
- [LLM module](../llm/index.md)
- [MCP source module](../mcp-src/index.md)
- [CLI to core flow](../flows/cli-src-to-core-src.md)
- [CLI to LLM flow](../flows/cli-src-to-llm.md)
- [CLI to core flow diagram](../diagrams/flow-cli-src-to-core-src.mmd)
- [CLI to LLM flow diagram](../diagrams/flow-cli-src-to-llm.mmd)
- [Topics hub](index.md)