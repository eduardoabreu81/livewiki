# Data model

> Three persisted shapes coexist: SQLite (`.livewiki/index.db`, `.livewiki/search.db`), versioned JSON (`.livewiki/.manifest.json`, `.livewiki/config.json`, `.livewiki/update_metrics.json`), and versioned Markdown (`livewiki/*.md` with frontmatter). Together they cover everything that must survive a `git push`, while keeping the index rebuildable from disk.

## SQLite — `.livewiki/index.db`

Schema version: **v4** (`CURRENT_SCHEMA_VERSION` in `packages/core/src/db.ts`). Migrations are JS functions in `postV3Migrations()` (SQLite has no `ADD COLUMN IF NOT EXISTS`; the function checks `PRAGMA table_info` before each `ADD`).

### Tables

```sql
files(id, path UNIQUE, lang, content_hash, size, mtime, indexed_at, status)
-- status: active | deleted

symbols(id, file_id→files, key UNIQUE, name, kind, signature,
        start_line, end_line, content_hash, status)
-- status: active | deleted
-- UNIQUE only on active rows: idx_symbols_active_key (partial index)
-- "supersession" (same key, different hash) = re-index of same symbol; no event.

doc_pages(id, wiki_path UNIQUE, owner, content_hash, updated_at)
-- owner: generated | human | mixed

anchors(id, doc_page_id→doc_pages, section_slug NULL,
        symbol_key, symbol_hash_at_doc, in_manual_block, created_at)
-- section_slug NULL = page anchor (from frontmatter)
-- in_manual_block = 1 ⇒ protect from automated rewrites (regra #6)

debt(id, anchor_id→anchors, event, assignee, symbol_key,
     detail, detected_at, resolved_at NULL)
-- event: changed | moved | deleted
-- assignee: agent | human (derived from page owner + manual block flag)
-- symbol_key column survives anchor removal — no orphans
-- idx_debt_open (partial) deduplicates open debt per (anchor_id, event)

undocumented(id, symbol_key, detected_at, dismissed)
-- new symbols with no docs; surfaced via status --json

batch_runs(id, started_at, finished_at NULL, started_by,
           stage, config_json, status, summary_json)
-- status: running | completed | completed_with_failures | aborted
-- summary_json.modulesRefined: stage-2 refined modules (Fix J rev2)

batch_tasks(id, run_id→batch_runs, stage, target,
            status, checkpoint_json, updated_at)
-- status: pending | running | done | failed | skipped
-- checkpoint_json: { stage, status, attempt, usageHistory[], error?, artifacts? }
-- usageHistory: [{ attempt, usage: {inputTokens, outputTokens, model},
--                  costUsd: {input, output, total, refDate}|null,
--                  finishedAt }]

manual_blocks(id, doc_page_id→doc_pages,
              start_offset, end_offset, content_hash, updated_at)
-- tracked by anchor-ledger; verify compares byte-for-byte

meta(key PRIMARY KEY, value)
-- schema_version, etc.
```

### Invariants baked into the schema

- **Soft-delete on update** (`symbols.status='deleted'`): when a file changes, the old `symbols` rows are soft-deleted so their `content_hash` can still be matched against new rows for `moved` detection. After the ledger pass, `deleted` rows whose key has a new active row are purged.
- **Partial unique index on active symbols** (`idx_symbols_active_key`): lets a key be soft-deleted and re-inserted without UNIQUE conflict.
- **Partial index `idx_debt_open`**: lightweight dedup of open debt per `(anchor_id, event)`. Without this, every `index` would re-flag the same items.
- **`debt.symbol_key`** (schema v3): survives anchor removal — orphan debt still references the symbol it referred to.
- **`batch_tasks.checkpoint_json`** is TEXT; schema v4 keeps refined modules in `batch_runs.summary_json.modulesRefined` (Fix J rev2) so task JSON stays a single typed payload.

### Migrations

`packages/core/src/db.ts`:

- `CURRENT_SCHEMA_VERSION = 4`
- `SCHEMA_SQL` runs all `CREATE TABLE IF NOT EXISTS` + indexes (idempotent for fresh installs).
- `postV3Migrations()` is invoked after opening a v3-or-older DB; each migration checks `PRAGMA table_info(<table>)` for a column before issuing `ALTER TABLE … ADD COLUMN …`.
- v3 → v4 adds `batch_runs.started_by`, `batch_runs.finished_at`, `batch_runs.summary_json` (auditing) and `debt.symbol_key` is already there.
- v3 itself added `idx_debt_open` and `debt.symbol_key` (Fixes A + D).

## SQLite — `.livewiki/search.db`

Separate file (decided in Phase 4) so the FTS5 virtual table doesn't disturb `index.db` schema v4. See `packages/mcp/src/search.ts`.

- Built with `db.pragma("journal_mode = WAL")`.
- Rebuilt fully on MCP server startup (`openAndIndex`); incrementally updated via `indexPage()` on every successful `write_doc`.
- Default FTS5 tokenizer is Porter; sufficient for EN/PT in the MVP.
- If search.db corrupts, restart the MCP server to rebuild.

## Versioned JSON

### `.livewiki/.manifest.json` (SPEC §".manifest.json")

```json
{
  "version": 1,
  "lastDocumentedCommit": "<sha>",
  "snapshotHash": "<sha256 of livewiki/ excluding the manifest itself>",
  "updatedAt": "<ISO 8601>",
  "pendingBatch": { "runId": 1, "stage": 4, "done": 23, "total": 61 } | null
}
```

- **Anti-loop CI:** `manifestsEqual` ignores `updatedAt` (it's a timestamp, not content) — otherwise every `Date.now()` would force a rewrite and CI would always see a diff.
- **`snapshotHash` is over `livewiki/` excluding the manifest** — following the OpenWiki convention.
- **`pendingBatch`** enables cross-machine handoff of an interrupted batch run: another machine reads the manifest, sees the run, calls `livewiki batch resume <runId>`.

Source: `packages/core/src/manifest.ts`. Path: `livewiki/.manifest.json` (so it travels in git).

### `.livewiki/config.json` (local, can be versioned)

```json
{
  "preset": "anthropic",
  "model": "claude-sonnet-5",
  "language": "en",
  "languages": ["ts","tsx","js","jsx","py"],
  "ignores": [],
  "baseUrl": null,
  "pricing": { "claude-opus-4-5": { "input": 15, "output": 75 } }
}
```

- `preset` (Phase 5) replaces `provider` (Phase 3 legacy). Adding a provider = adding an entry to `PRESET_TABLE`. No new code.
- **API keys never go here.** API keys live ONLY in env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MINIMAX_API_KEY`, etc.). Regression: `packages/core/src/key-leak.test.ts`.
- **No hardcoded default model.** `validateConfigForBatch()` throws `MissingProviderConfigError` if `preset`/`provider` or `model` are absent when batch needs an LLM.

### `.livewiki/update_metrics.json` (gitignored)

Append-only JSON; lives outside `livewiki/` because it is a derived cache (rule #3). Each entry is one of:

```ts
{ kind: "package_emitted", timestamp, tokensEstimated, bytes, debtCount }
{ kind: "write_received",  timestamp, wikiPath, bytes, tokensEstimated }
```

`status --json` aggregates these into an `efficiencyRatio = writeReceivedTokens / packageEmittedTokens`. This is the empirical signal of the product thesis ("focused package vs. re-reading the repo").

## Versioned Markdown

### Doc page frontmatter (subset)

```markdown
---
title: Auth — login and session
owner: generated                 # generated | human | mixed (default: generated)
anchors:
  - src/auth/login.ts            # file anchor (whole page)
  - src/auth/login.ts#validateToken
updated: 2026-07-08
---

## Validation flow
<!-- lw:anchors src/auth/login.ts#validateToken src/auth/session.ts#refresh -->
The token is validated by `validateToken(...)`, which ...
```

- **Page anchor:** `anchors:` list in frontmatter.
- **Section anchor:** `<!-- lw:anchors … -->` HTML marker right after a heading.
- **Manual block:** `<!-- lw:manual --> … <!-- /lw:manual -->` — byte-stable; `verify` rejects `manual_block_altered`.
- **Owner semantics:** `generated` ⇒ machine-managed; `human` ⇒ never rewritten; `mixed` ⇒ the generated portions are rewritten but `lw:manual` blocks stay byte-stable.

Symbol key format: `relative/path.ext#SymbolName`. Methods use `relative/path.ext#Class.method`. Ambiguity is resolved with the qualified path.

### Parser constraints (intentional)

`packages/core/src/frontmatter.ts` is a YAML-subset parser (no nested lists/maps, no multi-line strings, no `\"` escapes). The MVP fields from SPEC fit the subset; if richer YAML is ever needed, swap in a real `yaml` lib.

### Deterministic diagrams (no LLM)

- `livewiki/architecture/structure.mmd` — directory org-chart (`graph TD`).
- `livewiki/architecture/modules.mmd` — module dependency graph (import edges).
- `livewiki/diagrams/<module-slug>.classes.mmd` — per-module `classDiagram` from the `symbols` table (only when classes exist).

All three are `owner: generated`. They never age; the generator changes, not the output. One diagram per module, never a mega-diagram of the whole repo.

## Where to go next

- [Indexing and anchor-ledger](../workflows/indexing-and-debt.md)
- [Inviolable rules](../operations/inviolable-rules.md) — safe-io, pointer, human content
- [Testing and validation](../operations/testing-and-validation.md) — schema migration tests