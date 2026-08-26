## What's changed since 0.3.1

A distribution-only release. **No code changed** — `@livewiki/core`,
`@livewiki/mcp` and `@livewiki/cli` behave exactly as they did in 0.3.1.

The version exists because the official MCP Registry proves ownership of an
npm-backed server by reading the *published* `package.json`: the `mcpName`
field there must equal the `name` in `server.json`. 0.3.1 shipped without that
field and npm does not allow republishing a version, so registry publication
required a new one.

- **`packages/mcp/package.json` now carries
  `"mcpName": "io.github.eduardoabreu81/livewiki"`.** It is metadata only —
  nothing in the server reads it. The registry does, at publish time.
- **`server.json` at the repository root** declares the server for the
  registry: the npm package, its stdio transport, and the single `--repo`
  argument that `packages/mcp/README.md` already documents. It is the one file
  in the monorepo that states, in a machine-readable form a crawler can find
  from the root, that the MCP server lives in `packages/mcp` and ships as
  `@livewiki/mcp`.

The only other commit in this window touches
`packages/mcp/src/watcher-retry-e2e.test.ts`, which is not part of any
tarball: it waited for `search.db` as a proxy for "the server is watching"
and lost its single event when that write landed before `startWatcher`. That
race had been attributed to the Windows CI harness and skipped there; it
reached Linux with ubuntu image 20260823.283 on unchanged code. The test now
waits for a warm-up write to reach the index, and the Windows skip is gone.

## Compatibility

- **No behaviour change**, no schema change (index schema stays at v10), no
  migration.
- **Upgrading is optional.** 0.3.1 remains correct; there is no fix here to
  pick up. Upgrade only to stay on the released set.
- If you do upgrade, take `@livewiki/core`, `@livewiki/mcp` and
  `@livewiki/cli` together — they are released as a set and the 0.3.2 packages
  depend on `@livewiki/core@0.3.2` exactly.
