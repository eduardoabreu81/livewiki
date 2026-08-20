## What's new since 0.2.1

A correctness release. Every item below is a case where livewiki could lose
data, hand back a wrong answer with a confident face, or fail to converge —
found by an adversarial pass over the concurrency, persistence, and failure
paths, and each one reproduced before it was fixed.

### Nothing is destroyed on the way to being written

- **Atomic credential store** — `~/.livewiki/credentials.json` was written with
  a truncating `writeFile`. An interruption mid-write left it unparseable, and
  the reader is strict: every provider stopped resolving until the file was
  repaired by hand, and the bytes destroyed were API keys. The store now lands
  in a sibling temp file and replaces the target by rename, so any failure
  before the swap leaves the previous file byte-for-byte intact. A new store is
  born `0600`; an existing one keeps its mode. On POSIX the parent directory is
  flushed after the rename.
- **Update-metrics preservation and recovery** — an unparseable metrics ledger
  used to be silently replaced by an empty one, deleting the only record of
  accumulated cost. The corrupt bytes are now copied to a `.bak` sibling
  *before* the replacement is written, and nothing is reconstructed from them.
- **Atomic ledger reconciliation** — `orchestrate` interleaved filesystem reads,
  Markdown writes, and SQLite mutations with no enclosing transaction, so a
  crash mid-run left `doc_pages`, `anchors`, `debt`, and `undocumented`
  describing different snapshots. Reconciliation now runs as plan → revalidate →
  apply, with the whole apply phase inside a single transaction that re-reads
  its inputs. A page that cannot be read or parsed invalidates the entire plan
  instead of being skipped while the wiki is reconciled destructively around it.

### Safe concurrent access to the index

- **Safe concurrent index writers** — a CLI invocation, an editor hook, and the
  MCP watcher all index the same `index.db`. The write decision was taken from a
  snapshot read *before* the 0.5–15s read+parse phase and consumed after it, so
  with 2, 3, or 5 concurrent processes exactly one writer won and the rest died
  on `UNIQUE constraint failed: files.path`. The write phase now runs under an
  `IMMEDIATE` transaction and re-reads its decisive state inside the lock;
  writers queue at `BEGIN` instead of discovering the conflict halfway through
  their own mutation. `busy_timeout` is stated explicitly at 30s, and a genuine
  timeout surfaces as `WriteContentionError` naming the blocked phase, not a raw
  `SQLITE_BUSY`. Verified across 2/3/5 writers × 10 trials — 100 processes, all
  exit 0, final state identical to a single writer's, later runs a fixpoint.
- **Watcher retry and convergence** — the MCP watcher logged one line and
  dropped the batch when a sync failed. The comment said "the next event
  retries", which was true for every batch except the last one of a sequence:
  the index then stayed behind the working tree silently. Pending work is now
  kept until a run actually succeeds and retried with backoff — unbounded for
  write contention, which is transient by definition, and five attempts with an
  explicit give-up line for anything else. Teardown disarms the queue first, so
  no retry can fire during shutdown.
- **Read-only index access** — `verify`, `status`, `change-impact`,
  `batch-status`, and `livewiki_impact` now open the index through
  `openIndexReadOnly`, which creates nothing, runs no DDL, applies no
  migration, and never writes `schema_version`. Beyond the downgrade risk,
  routing reads through the writer path turned every read into a write waiting
  on the write lock while a pending migration existed: measured as
  `SQLITE_BUSY` after the full busy timeout, where a plain read-only
  connection answered in 2ms. `status` keeps one documented exception — a
  repository that was never indexed is a state it exists to report, so it is
  served from an empty in-memory index rather than by creating
  `.livewiki/index.db`.
- **Schema downgrade protection** — `openIndex` gated its migration branch on
  "stored version differs from current", so a database written by a *newer*
  build entered that branch, selected zero migrations, and still wrote a lower
  version back. Two guards now run as the second statement of `openIndex` —
  before `journal_mode`, before `SCHEMA_SQL`, before any migration — rejecting
  an index from a newer build and an existing index whose version cannot be
  determined. Placement is the property: refusing later still re-journalled the
  file and recreated dropped objects.

### Wrong answers become errors

- **FTS5 failures are no longer reported as empty results** — the search path
  caught every exception and answered `[]`. A closed handle, a corrupt file, and
  a dropped table all looked exactly like a healthy wiki with no matches, which
  is the worst possible answer to give an agent: "I found nothing" reads as a
  fact about the repository, not as a broken tool. Only genuine query faults —
  FTS5 syntax errors, unterminated strings, unknown special queries, and a
  `no such column` naming a column the caller invented — are now treated as
  empty results. Everything else, including corruption and unrecognized
  failures, raises `SearchIndexUnavailableError`.
- **Indexer convergence and reactivation** — `files.status` was written but
  never read back. The deletion loop re-marked already-deleted rows on every
  run, so `removed` never converged, and a file that returned with
  byte-identical content took the unchanged fast path and stayed `deleted` —
  invisible to status, debt, anchors, and baseline, with nothing in the output
  to say so. A returning file now takes the full parse path and is reported on
  its own `filesReactivated` axis; `filesDeleted` counts only real
  active → deleted transitions.

### Agent task claims

- **Transactional task claims — schema v10** — two agents pointed at the same
  repo were handed the same task: the queue offered running tasks first by
  design, and the one guarded `UPDATE` it did run never had its result checked.
  Schema v10 adds `claim_id` and `lease_expires_at`. A claim is an opaque token
  livewiki generates per *execution* — never an identity supplied by the client
  — and the compare-and-swap lives entirely in the `WHERE` clause, so exactly
  one concurrent caller wins. Leases run 30 minutes and are renewable through
  the new `livewiki_renew_task_claim` tool; expiry is evaluated when someone
  asks for work, renews, or submits — no heartbeat, no background timer. A
  submission with a stale claim writes nothing and does not burn a retry
  belonging to whoever holds the task now.

### Packaging

- **`livewiki-mcp` is executable on Linux and macOS** — `@livewiki/mcp` has
  declared a `bin` since 0.1.0, but its entry point shipped with no
  `#!/usr/bin/env node`. On Windows npm writes `.cmd`/`.ps1` shims that name
  node explicitly, so nothing ever broke there; on POSIX npm creates a bare
  symlink and the shebang is the only thing that names an interpreter, so the
  shell took the file and died on `syntax error near unexpected token`. That
  is the documented invocation path — `livewiki install` writes
  `npx -y @livewiki/mcp --repo …` into every agent config — and it was broken
  on every POSIX install from 0.1.0 through 0.2.1.
- **The MCP handshake reports the real version** — `serverInfo.version` was
  the literal `"0.0.0"` in server.ts and no release ever touched it, so every
  client was told the wrong version of the server it had just started. It is
  now read from the package's own package.json, the same mechanism the CLI
  already uses for `--version`.

### Harness

- **E2E hardening** — the MCP phase-5 and watcher suites now clean up their
  subprocesses deterministically and carry retry budgets that survive a slow
  CI runner; the subprocess watcher E2E is skipped on the Windows runner, where
  the timing it measures is not meaningful.
- **CI type-check gate** — `pnpm lint:tsc`, the gate already run before every
  local commit, now runs on all three platforms in `cross-platform-ci`.
- **Publish safety** — each package rebuilds its own `dist/` on
  `prepublishOnly`, so a publish can no longer ship a stale build.

## Compatibility and upgrade notes

**v0.3.0 migrates the index schema from v9 to v10.** The migration runs
automatically on the first 0.3.0 command that opens the index and preserves
existing data.

- **Upgrade `@livewiki/core`, `@livewiki/mcp`, and `@livewiki/cli` together.**
  They are released and version-locked as a set; the 0.3.0 packages depend on
  `@livewiki/core@0.3.0` exactly.
- **New MCP tool: `livewiki_renew_task_claim`.** Executors that hold a task for
  longer than the 30-minute lease must renew it; the eight 0.2.1 tools are
  unchanged.
- **POSIX users who worked around the broken `livewiki-mcp` bin can drop the
  workaround.** An agent config pointing at `node …/@livewiki/mcp/dist/index.js`
  still works, but `npx -y @livewiki/mcp` now does too.
- **Restart long-lived MCP servers after upgrading.** A server started before
  the upgrade keeps running the old code against the migrated index.
- **Do not deliberately run 0.2.1 processes against a repository already opened
  by 0.3.0.** Mixed versions are not a supported configuration.
- **A 0.2.1 process can rewrite the `schema_version` marker back to v9.** This
  is the exact defect the v0.3.0 downgrade guard fixes, and 0.2.1 does not have
  that guard: it sees a version it does not recognize, selects zero migrations,
  and writes the lower number back while leaving the v10 tables in place.
- **Returning to 0.3.0 repairs the situation.** The migration is detected and
  reapplied over the mislabelled index, and in the observed case no data was
  lost. This is a recovery path, not a supported workflow.
