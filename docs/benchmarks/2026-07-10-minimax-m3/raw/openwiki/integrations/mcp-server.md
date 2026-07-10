# MCP server (Phase 4)

> `@livewiki/mcp` exposes the wiki to any MCP client — Claude Code, Cursor, Codex, OpenCode, Goose, Kilo Code, Roo Code, Windsurf, and any other MCP-aware agent — through six tools, all of them allowlist-bounded and verify-guarded.

This is the surface that turns the wiki into **external memory for any LLM**: the agent reads the wiki (`quickstart`, `read`, `search`), learns what is stale (`debt`), writes back (`write_doc`, `resolve_debt`).

## Entry point

Source: `packages/mcp/src/index.ts`. Resolves `--repo <path>` (default `cwd`), creates the server, connects to `StdioServerTransport`. Graceful shutdown closes the FTS5 handle on SIGINT/SIGTERM.

Typical Claude Code configuration:

```jsonc
{
  "mcpServers": {
    "livewiki": {
      "command": "npx",
      "args": ["-y", "@livewiki-mcp", "--repo", "/path/to/repo"]
    }
  }
}
```

(The published name will be `@livewiki/mcp`; the in-repo bin is `livewiki-mcp`.)

## The six tools

Source: `packages/mcp/src/server.ts` (`createServer(opts)`).

| Tool | Purpose | Notes |
|---|---|---|
| `livewiki_quickstart` | Return `livewiki/quickstart.md` | Low-token entry point for the LLM |
| `livewiki_read` | Read a wiki page by path | Allowlist `livewiki/`; symlink-safe |
| `livewiki_search` | Full-text search | SQLite FTS5 in separate `search.db` |
| `livewiki_debt` | Open debt (= `status --json`) | Powered by `core/status` |
| `livewiki_write_doc` | Write/update a wiki page | Allowlist + post-write verify + rollback |
| `livewiki_resolve_debt` | Mark debt rows as paid | `resolved_at = Date.now()` |

Error reporting uses MCP-standard codes (`InvalidParams`, `InvalidRequest`, `InternalError`).

### `livewiki_write_doc` — the most important tool

Two-phase flow (per SPEC §"MCP tools"):

1. **`safe-io.writeText`** — validates the path against `livewiki/` allowlist; symlink-safe.
2. **`verify.run(repoRoot)`** — full-repo fresh-from-disk verify. If any `error`-level issue touches the page (e.g. `broken_anchor`), the file is **rolled back** (`unlink` best-effort) and the tool returns an `isError` result with details.

This is the **anti-hallucination promise**: docs freshly written by an LLM are validatable without running `index` first. The MCP server reuses `livewiki verify`'s implementation so behavior is identical.

`skipVerify` is a documented escape hatch for pages without anchors (e.g. `quickstart.md`). It exists; it should not be the default.

### `livewiki_search` — FTS5 in a separate DB

Source: `packages/mcp/src/search.ts`. The FTS5 index lives in `.livewiki/search.db` (NOT `index.db`) so:

- Schema v4 in `index.db` stays untouched (no v5 migration for FTS5).
- If `search.db` corrupts, `openAndIndex` rebuilds it from the wiki on the next server start.

Tokenizer: Porter (default FTS5) — good for EN/PT without extra normalization.

Indexing strategy:

- **Full rebuild on server startup** — fast (≈1s for 1000 pages), idempotent.
- **Incremental update** in `write_doc` (`indexPage`) — no need to restart the server.

## Tests

`packages/mcp/src/server.test.ts` — **12 E2E scenarios** using `InMemoryTransport` from the MCP SDK (no real stdio or subprocess). Covers all 6 tools + 6 error/rejection paths.

`packages/mcp/src/phase5-e2e.test.ts` — **7 scenarios** for the Phase 5 acceptance criterion:

- 2 end-to-end (agent → debt → write_doc → verify clean → manifest updated)
- 5 covering `[R]` `init` adds `.livewiki/` to `.gitignore`

The E2E asserts **issue count, not just exit code**. Exit 0 is necessary; zero issues (errors AND warnings) is the bar.

### Windows + `search.db`

`better-sqlite3` opens WAL files (`search.db-shm` / `search.db-wal`). E2E tests must close the server (`server.close()`) **before** `afterEach` runs recursive `rm`, or Windows raises `EBUSY`. See the `augmentClose` block in `server.ts` (`server.close` closes the search handle in addition to the default cleanup).

## Privacy / safety properties

- All writes go through `safe-io` (allowlist + symlink-safe).
- `write_doc` re-validates with `verify` — anti-hallucination guarantee.
- The MCP server reads the API key from the **same env var** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `<PRESET>_API_KEY`) that batch uses. The MCP server itself does **not** call the LLM today; it only reads + writes the wiki.
- Error messages never leak absolute paths or repo content outside the allowlist (per `safe-io` policy).

## Architectural principles

- **Single allowlist source of truth.** Writes come through `safe-io.writeText`; reads through `safe-io.readText`. No second path.
- **Verify-after-write is mandatory for anchored pages.** The MCP contract is: if `write_doc` succeeds, the page passes `verify` for that page.
- **Tools as data.** All six tool definitions live in `server.ts`; new tools are added by adding another `server.tool(name, desc, schema, handler)` block — there is no plugin system yet (and there does not need to be).
- **Tests over subprocess.** `InMemoryTransport` is the canonical test transport — no flake from stdio timing, no port allocation, no zombie processes.

## Adding a tool

1. Add `server.tool(name, description, zodSchema, async (args) => { ... })` in `server.ts`.
2. If it needs new core logic, add it under `packages/core/src/<area>.ts` and export via `package.json` subpath exports.
3. Add an E2E scenario in `server.test.ts` that:
   - Calls the tool with a valid input.
   - Asserts on the returned payload.
   - For mutating tools: asserts the side effect on disk + the verify status.
4. For error paths: assert the `McpError.code` and the message does not leak the allowlist-absent path.

## Where to go next

- [Incremental update workflow](../workflows/incremental-update.md) — the in-session agent's main consumer of these tools.
- [LLM providers & presets](llm-providers.md) — the LLM layer that `write_doc` results typically end up invoking (via batch / MCP).
- [Inviolable rules](../operations/inviolable-rules.md) — what `safe-io` enforces.
- [Testing and validation](../operations/testing-and-validation.md) — what `phase5-e2e.test.ts` proves.