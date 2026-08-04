---
title: livewiki repository root
owner: generated
anchors: []
---

# livewiki repository root

The repository root ties together the monorepo, runtime, and product-level governance documents that define what livewiki is and how the package set is wired together.

## When to use this page

- **Inspect** the workspace wiring in `package.json` and `pnpm-workspace.yaml` when you need to add a new package or change the build/test fan-out.
- **Read** `SPEC.md` for the phase-by-phase behavioral contract and the inviolable rules every contributor must respect.
- **Read** `VISION.md` for the product rationale, positioning, and the non-negotiable design principles.
- **Confirm** the TypeScript baseline in `tsconfig.base.json` when configuring a new workspace package or debugging strictness inheritance.

## How it fits

This module is the monorepo entry point. `package.json` declares the `livewiki` private root, pins `pnpm@10.34.0` as the package manager, requires Node `>=24`, and fans `build`, `test`, `test:watch`, `test:coverage`, and `lint:tsc` across all workspaces via `pnpm -r`. The only declared runtime dependency at the root is `@livewiki/cli` (a `workspace:*` reference), and the devDependencies set lists `typescript ^5.6.0`, `vitest ^2.1.0`, and `@types/node ^22.0.0`. Two `pnpm.overrides` entries pin `fast-uri ^3.1.5` and `@hono/node-server ^2.0.12`.

`pnpm-workspace.yaml` scopes packages to `packages/*` and grants `allowBuilds` to `better-sqlite3`, `esbuild`, and the `tree-sitter-*` tools, which is the mechanism that lets the native and WASM-based build steps run inside the workspaces. An inline comment restricts Phase 0 to `core` and `cli`, deferring `packages/mcp` to Phase 4.

`tsconfig.base.json` is the shared strict-mode baseline: `ES2022` target, `NodeNext` module and moduleResolution, full `strict` plus `noImplicitOverride`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, declaration/source maps emitted to `dist`, and `rootDir: src`. Per-package configs inherit this and only loosen or specialize what their own entry shape needs.

`SPEC.md` is the executable source of truth for behavior. It opens with an ordered phase plan and an explicit instruction to the executing LLM, then enumerates eight inviolable rules covering restricted writes through a single I/O module, the pointer exception for `AGENTS.md`/`CLAUDE.md`, the "DB is derived" rule (no SQLite-only information), the no-telemetry/no-network default (with two explicit exceptions), vitest with an 80% coverage floor on core, human-content untouchability for `owner: human` pages and `lw:manual` blocks, English as the product artifact language, and the no-external-product-dependency rule. It then defines the stack — Node ≥ 20, pnpm workspaces, `web-tree-sitter` WASM parsing with MVP grammars for TypeScript/JavaScript/Python, a two-tier grammar coverage ladder, `better-sqlite3` for storage, `@modelcontextprotocol/sdk` for MCP, `commander` for the CLI with `--json` everywhere, and an own thin HTTP LLM client with a preset table covering Anthropic, OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax, Gemini, NVIDIA NIM, Ollama, and LM Studio. The spec also fixes a cross-platform product contract covering Node ≥ 20 on Windows/Linux/macOS, PowerShell/CMD/Bash/Zsh terminal surfaces, `node:path` usage with `path.posix` for durable keys, LF/CRLF preservation, Unicode and spaces in paths, identical CLI JSON shapes and exit codes across OSes, and the no-shell-invocation rule for product logic.

`VISION.md` is the founding rationale. It positions livewiki in an "empty quadrant" that combines AST structure, content, real-time detection, publishing, and handoff, names four problems (docs rotting, LLM handoff losing context, hallucination, token cost), and lists six non-negotiable principles: safe-by-architecture path allowlisting, economical staleness detection without LLM tokens, tool-agnostic plain markdown, local-first operation, rebuildable derived index, and self-contained capabilities (no required external agent framework, MCP server, code-intelligence service, or hosted orchestrator). It then describes the three-layer architecture (`livewiki/` wiki, `.livewiki/` derived index, `AGENTS.md`/`CLAUDE.md` pointer), the incremental and batch operating modes, the four surfaces (CLI, MCP, skills, hooks), and the native capability boundary that keeps livewiki from becoming a general-purpose code-graph database.

## Diagram

```mermaid
%% livewiki/diagrams/root.mmd
```

## Repository configuration

`package.json` is the root manifest for the monorepo. It declares `"name": "livewiki"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`, the MIT license, and the repository URL `https://github.com/eduardoabreu81/livewiki.git`. The `engines.node` constraint is `">=24"`, matching the README's Node 24 requirement and the CI matrix. Scripts are workspace-recursive: `build`, `test`, `test:watch`, and `lint:tsc` all use `pnpm -r`; `test:coverage` is scoped to `@livewiki/core` via `pnpm --filter`. The only declared `dependencies` entry is `"@livewiki/cli": "workspace:*"`, which makes the CLI a workspace package rather than an external install. DevDependencies are `typescript ^5.6.0`, `vitest ^2.1.0`, and `@types/node ^22.0.0`.

`pnpm-workspace.yaml` declares a single glob — `packages/*` — and an `allowBuilds` list admitting `better-sqlite3`, `esbuild`, `tree-sitter-cli`, `tree-sitter-javascript`, `tree-sitter-python`, and `tree-sitter-typescript`. The inline comment in the file explicitly defers `packages/mcp` to Phase 4 and frames the `core`+`cli` Phase 0 choice as aligned with SPEC.md's "start single-package, extract later is acceptable" guidance.

`tsconfig.base.json` defines the compiler options every workspace package extends. The language target is `ES2022` with `lib: ["ES2022"]`, modules are `NodeNext` for both `module` and `moduleResolution`, and strictness is turned up with `strict: true` plus `noImplicitOverride`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, and `exactOptionalPropertyTypes`. Interop flags (`esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `isolatedModules`) and output flags (`declaration`, `declarationMap`, `sourceMap`, `outDir: dist`, `rootDir: src`) are all on; `skipLibCheck` is enabled. There is no `paths`, `baseUrl`, or `composite` setting here — each package owns its own `tsconfig.json` extending this base.

## Governance documents

`SPEC.md` opens with a phase-ordered execution note directed at the LLM that will read it ("follow the phases in order … a design question goes to Eduardo, it's not your call"), then states the eight inviolable rules verbatim. The stack section is a contract: Node ≥ 20 (the README and `package.json` tighten this to 24), pnpm workspaces, `web-tree-sitter` WASM with MVP grammars for TypeScript/JavaScript/Python and a post-MVP roadmap for Go/Rust/Java, the two-tier coverage ladder (tier 1 anchored, tier 2 unanchored prose with `symbolCount: 0`), `better-sqlite3` with WAL mode, `@modelcontextprotocol/sdk`, `commander` with `--json` everywhere, and an own thin LLM HTTP client. The LLM section further pins the no-hardcoded-default-model rule, env-var-only API keys (with a dedicated test guaranteeing no leak), and a preset table that includes Anthropic, OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax, Gemini, NVIDIA NIM, Ollama, and LM Studio — the comment specifies that for providers with an Anthropic-compatible endpoint (the file's own example, if visible, would need to be re-read from the untruncated source) the preset reuses the Anthropic adapter for cache-read economics. Agent tools (Codex, Cursor, Roo Code, Kilo Code, VS Code) are explicitly NOT presets — they are MCP/skill consumers. The cross-platform product contract section enumerates the supported runtime, supported shells, the no-`bash -c` rule for product logic (with a `child_process.spawn` + `shell: false` escape hatch), `node:path` usage, LF/CRLF handling, Unicode-and-spaces path support, identical CLI JSON and exit codes, and the matrix-skip rule (a Unix host that skips symlink coverage is treated as a contract violation rather than a harmless skip).

`VISION.md` opens with a language note mirroring SPEC.md rule 7: durable product artifacts are English; maintainer conversation may be PT-BR; existing PT-BR artifacts are migration debt. It states the elevator pitch ("documentation anchored to the code, verifiable and always current — written by whoever made the change, at the moment they made it"), the two content layers (A: structural wiki for agents; B: human/product narrative), and the ordering ("layer B is the destination; layer A is the means"). The four named problems are documentation rot, LLM handoff loss, hallucination, and token cost. The positioning table compares livewiki to codegraph, OpenWiki, CodeWiki, DeepWiki, and agentmemory across structure, content, real-time, publishing, and handoff — the technical differentiator is "staleness detected at the section level, without spending an LLM token." The six non-negotiable principles are safe-by-architecture path allowlisting, economical debt detection, tool-agnostic plain markdown, local-first operation, rebuildable derived index, and self-contained capabilities. The key concepts section defines anchors (the symbol hash at documentation time), documentation debt (changed/moved/deleted/new events emitted by the deterministic indexer), anti-hallucination verification (anchors must resolve; signatures must match), human content as first-class ownership (`owner: generated | human | mixed`, `lw:manual` blocks), and handoff (wiki + manifest as the state that travels in git). The three-layer architecture diagram appears inline: `livewiki/` wiki, `.livewiki/` derived SQLite index, and an `AGENTS.md`/`CLAUDE.md` pointer added only with explicit consent. The two operating modes are incremental (heart) and batch (4-stage pipeline with checkpoints). The four surfaces are CLI, MCP, skills, and hooks. The native capability boundary is stated as a constraint: structural intelligence must live in livewiki itself, and external projects are design references only — they are reproduced inside the product, not consumed as dependencies.

## Product positioning and surfaces

`README.md` states the agent-first positioning and the cost-thesis ("detecting what went stale costs nothing … writing is the only thing that costs tokens") and lists the surfaces: CLI, MCP server (search, read, validated write, debt), deterministic exports, and `livewiki view` (self-contained offline site with search, Mermaid, version stamp, `view --ref <tag>`). The Quick start block shows `npm install -g @livewiki/cli`, `livewiki init`, `livewiki init --batch`, `livewiki status`, `livewiki verify`, and the agent hand-off via `npx @livewiki/mcp --repo /path/to/repo` or `livewiki install`. The "Results so far" section cites a blind dual-evaluator comparison against OpenWiki at ~6–8% of token cost, a self-hosting dogfood run of 138 tasks with 0 failures and zero verify issues, cross-platform CI green on Node 24, and zero-token debt detection on every merge via `packages/cli/templates/github-actions/docs-debt.yml`. It points readers to `SPEC.md`, `VISION.md`, `docs/ROADMAP.md`, and `livewiki/quickstart.md`, restates the Node 24 requirement (and notes that `better-sqlite3` ships prebuilt Windows binaries for it), and reaffirms the MIT license.

<!-- livewiki:navigate:start -->
## Navigate


> Coverage note: this module's source (6 files, ~105k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
