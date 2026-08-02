---
title: livewiki repository root
owner: generated
anchors: []
---

# livewiki repository root

This module is the workspace-level configuration and authoritative documentation surface for the livewiki monorepo itself, defining stack, scripts, monorepo layout, and the inviolable product rules.

## When to use this page

- **Read** `AGENTS.md`, `SPEC.md`, and `VISION.md` before contributing any change so you respect the inviolable rules and the product-first execution discipline.
- **Consult** `package.json` and `pnpm-workspace.yaml` to understand the Node ≥ 20 runtime, pnpm workspaces, and the recursive `build`/`test`/`lint:tsc` scripts that drive the monorepo.
- **Verify** the cross-platform product contract by checking `tsconfig.base.json` (strict NodeNext ESM) and the shell/line-ending/Unicode guarantees documented in `SPEC.md` when adapting CLI or MCP code.
- **Resolve** design questions (out-of-scope features, durable English-only artifacts, pointer-in-`AGENTS.md` semantics) against the explicit rules listed in `SPEC.md` instead of inferring intent from code.

## How it fits

The `root` module is the polyrepo-level companion of the `@livewiki/core`, `@livewiki/cli`, and `@livewiki/mcp` packages: `pnpm-workspace.yaml` declares the `packages/*` glob that turns each subdirectory into a workspace, while `package.json` exposes the top-level `pnpm -r build`, `pnpm -r test`, and `pnpm -r lint:tsc` scripts that fan out to them. The `allowBuilds` section in `pnpm-workspace.yaml` whitelists `better-sqlite3`, `esbuild`, `tree-sitter-cli`, `tree-sitter-cli` companions, and the three tree-sitter language packages so the native/WASM toolchain can be installed inside CI. The `packageManager: pnpm@10.34.0` pin in `package.json` is consumed by `pnpm/action-setup` so workflows do not repeat the version.

The documentation half of the module is the durable source of truth that every contributor, agent, and reviewer is expected to follow before touching code. `SPEC.md` enumerates eight inviolable rules (restricted writes through `safe-io`, optional pointer in `AGENTS.md`/`CLAUDE.md`, derived DB, no telemetry, vitest coverage ladder, immutable human content, English-only product artifacts, and no external product dependency) plus the cross-platform product contract. `VISION.md` states the product positioning, the empty quadrant that livewiki fills, and the non-negotiable principles (safe by architecture, economical, tool-agnostic, local-first, rebuildable, self-contained). `AGENTS.md` records the live phase status, language policy, and product-first execution discipline that constrain day-to-day work.

Together these files form the contract that the per-package code in `packages/core`, `packages/cli`, and `packages/mcp` is measured against. `tsconfig.base.json` enforces strict TypeScript, `NodeNext` modules, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `isolatedModules`; that baseline is what every package extends, which is why a single one-line `strict: true` change here can move the entire monorepo.

## Stack and tooling baseline

```json
{
  "engines": { "node": ">=20" },
  "type": "module",
  "packageManager": "pnpm@10.34.0"
}
```

`package.json` fixes the supported runtime to Node ≥ 20 and locks the package manager so contributors and CI resolve identical dependency graphs. The dev-dependencies — `typescript ^5.6.0`, `vitest ^2.1.0`, `@types/node ^22.0.0` — align with `tsconfig.base.json` (target ES2022, module NodeNext, lib ES2022) and with the SPEC's mandate that tests use vitest. The runtime dependency on `@livewiki/cli` (workspace reference) makes the CLI the canonical entry point when running the monorepo locally.

```yaml
packages:
  - "packages/*"

allowBuilds:
  better-sqlite3: true
  esbuild: true
  tree-sitter-cli: true
  tree-sitter-javascript: true
  tree-sitter-python: true
  tree-sitter-typescript: true
```

`pnpm-workspace.yaml` declares a single glob (`packages/*`) and pins the build permissions for the native/WASM toolchain. The trailing comment makes it explicit that only `core` and `cli` exist for Fase 0 and that `packages/mcp` is gated to Fase 4 — implementers must not anticipate later phases.

## TypeScript baseline

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`tsconfig.base.json` is the single source of TypeScript truth that every package extends. Notable flags: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` raise the floor for index access and optional members, which is consistent with SPEC's emphasis on deterministic, verifiable indexing. `outDir: dist` and `rootDir: src` define the canonical build output naming, so build artifact cleanup (the explicit `Remove-Item` recipe in `AGENTS.md` for `packages/*/dist`) matches the layout the compiler actually emits.

## Inviolable rules and product contract

The eight rules in `SPEC.md` are non-negotiable and frame every package:

- **Restricted writes** through `packages/core/src/safe-io.ts`, with the allowlist covering `livewiki/` and `.livewiki/` plus the pointer exception for `AGENTS.md`/`CLAUDE.md` (only with `--write-pointer` or interactive confirmation, via an idempotent `<!-- livewiki:start -->` … `<!-- livewiki:end -->` append).
- **Derived DB**: SQLite is an index, never the source of truth; everything that matters for handoff lives in versioned markdown and the manifest.
- **No telemetry, no network** except opt-in LLM calls in batch mode and a one-time WASM grammar download.
- **English-only** durable artifacts (source, comments, tests, CLI/UI text, templates, internal and user-facing docs); PT-BR is restricted to maintainer conversation and existing PT-BR artifacts are explicit migration debt.
- **Native capability boundary**: livewiki must not require another agent framework, MCP server, code-intelligence service, hosted orchestrator, or third-party app to run its core workflow; LLM providers, MCP clients, Git hosts, and editors are optional user-selected surfaces.

The cross-platform product contract further constrains the CLI, MCP server, and core library: Node ≥ 20 on Windows, Linux, and macOS; PowerShell/CMD on Windows, Bash on Linux, Bash/Zsh on macOS; no `bash -c`/`cmd /c`/`sh -c` for product logic (future subprocesses must use `child_process.spawn` with explicit argument arrays and `shell: false`); durable keys use forward slashes (`path.posix`), native separators only at the I/O boundary; LF and CRLF inputs are both supported and the export's CRLF tests must detect stray bare CR or LF characters; paths with spaces and non-ASCII characters must work everywhere; identical `--json` shape and exit codes across operating systems. Symlink tests may skip on Windows when the host cannot create symlinks, but they must run and pass on at least one Linux and one macOS host, enforced by an in-test guard so a Unix skip cannot silently pass.

## Layout and operating modes

`SPEC.md` defines what `livewiki init` produces in a target repository: a `livewiki/` tree holding `.manifest.json`, `quickstart.md`, `tasks.md`, `architecture/`, `diagrams/`, `flows/`, `topics/`, `auxiliary/`, `files/`, and `decisions/`; a gitignored `.livewiki/index.db`; and an opt-in pointer paragraph in `AGENTS.md`/`CLAUDE.md`. Coverage is two-tier: tree-sitter-grammar files are tier 1 (anchored symbols, debt applies) and every other indexed text file is tier 2 (unanchored prose, `symbolCount: 0`), so the wiki never finishes empty because the target language has no grammar yet.

`VISION.md` describes two operating modes built on top of this layout: incremental mode (a hook runs the deterministic staleness check after each commit/task; if there is debt, the in-session agent is notified and documents what it just did — fresh context, zero extra API cost) and batch mode (`livewiki init` runs a four-stage pipeline — scan → module identification → prioritization → coordinated documentation — with checkpoints so an interrupted run can resume from task N/M). Both modes rely on the same anchor + debt + verify machinery and never bypass `safe-io`.

## Live state and execution discipline

`AGENTS.md` records the live phase status, which an implementer must consult before scoping work: Phase 0–5 are on main; batch-resilience lots U–X are approved pending push (unique module IDs + taken set, `owner:mixed` retention, multiple manual blocks, `rollback_failed` aborts the run, monotonic usage attempts, stage-4 artifact normalize/repair, English-only new U–X text); a benchmark rerun against commit `572b8a3` reported 13/13 modules with zero verify issues, 427/427 symbols and exact accounting under `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/`. Phase 6 Lot 6A (deterministic export) is on main (`75cd004`) and the `generic` target passed a manual Windows happy-path and idempotence check on 2026-07-15; Git-host targets are not yet manually validated. R11-NAV intent-first navigation and R11-A concept topics are implemented in the working tree but uncommitted; validation evidence (topic planner + topic page generated, verify zero issues on 2026-07-26) exists for R11-A.

Product-first execution discipline is enforced explicitly: GitHub integration, remote CI, release automation, and broad platform matrices are final validation steps, not prerequisites for local product work; benchmark/proxy/orchestrator harnesses are reserved for explicit benchmark or publication evidence and are not part of the normal fix-and-retest loop; internal test evidence stays LOCAL and untracked; paid/provider calls require explicit maintainer approval; an external executor receives one bounded task, leaves changes uncommitted and unpushed, and the coordinator reviews before any commit/push authorization; do not add durable tests for exploratory work or a passing manual check, and for a confirmed product defect keep at most the smallest regression test that prevents that exact defect; do not combine unrelated cleanup with the active product flow; after one flow passes, stop, document the result, and let the maintainer choose the next flow. The current handoff and next E2E contract live in `docs/tasks/2026-07-15-local-product-e2e/HANDOFF.md`.

Working-tree hygiene is part of the contract: `git clean -fdx` is forbidden because the tree is shared with the reviewer and the command has destroyed uncommitted work before; build artifacts must be removed explicitly via the `Remove-Item -Recurse -Force packages/core/dist, packages/cli/dist, packages/mcp/dist` (and matching `*.tsbuildinfo`) recipe quoted in `AGENTS.md`, never via `-fdx`. Uncommitted `.md` files in the working tree must not be reverted — they may be reviewer's work and, if in doubt, the implementer must ask.

<!-- livewiki:navigate:start -->
## Navigate


> Coverage note: this module's source (6 files, ~176k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
