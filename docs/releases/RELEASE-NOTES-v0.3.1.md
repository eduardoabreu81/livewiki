## What's fixed since 0.3.0

A patch release with a single fix.

- **Concurrent indexing no longer surfaces a raw `database is locked`.**
  0.3.0 made lock contention report an actionable error instead of bare SQLite
  text, but only for the indexer and ledger write phases. `openIndex` — which
  sets the journal mode, runs the schema, applies migrations, stamps the
  version and creates the claim index — sat outside that classification, so
  contention *before* the protected write phase still reached the user as
  `database is locked`, with nothing to act on. Two processes running
  `livewiki index` at the same time were enough: a CLI invocation, an editor
  hook, and the MCP server's watcher all reach for the same file.
- **The 30s busy timeout is now installed immediately after the handle opens**,
  before the compatibility gate, before `journal_mode`, and before any DDL. It
  previously sat after `journal_mode`, so everything ahead of it ran on the
  driver's own 5s default — a fifth of the wait the timeout exists to grant.
  The value itself is unchanged.
- **Open-time `SQLITE_BUSY`, `SQLITE_BUSY_SNAPSHOT` and `SQLITE_BUSY_TIMEOUT`
  are classified** as `WriteContentionError` / `INDEX_WRITE_CONTENTION` with
  `phase: "open"`, keeping the original SQLite error as `cause`. Failures that
  are not contention — an incompatible schema, corruption, a constraint —
  propagate exactly as before. A journal-mode change is classified rather than
  retried: SQLite never consults the busy handler for it, so no timeout could
  ever have absorbed that case.

## Compatibility

- **No schema change.** The index schema stays at v10.
- **No migration**, and no rebuild of an existing index.
- **No user action beyond upgrading.** Update `@livewiki/core`,
  `@livewiki/mcp` and `@livewiki/cli` together — they are released as a set and
  the 0.3.1 packages depend on `@livewiki/core@0.3.1` exactly. Restart
  long-lived MCP servers so they pick up the new code.
