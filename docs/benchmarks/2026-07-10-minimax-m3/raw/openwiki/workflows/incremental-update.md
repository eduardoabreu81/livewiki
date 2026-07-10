# Incremental update workflow (Phase 5 — the heart)

> "Whoever made the change documents best and for free." The incremental mode packages a tiny, focused set of changes for the in-session agent to document, costing a fraction of the tokens of a full repo re-read.

This is the workflow that delivers on VISION's central thesis: LLM cost should only be paid for **writing**, never for **discovering** what is stale. The deterministic indexer does discovery (zero tokens); the agent pays only for the doc itself.

## End-to-end flow

```
   ┌──────────────┐  commit / agent stop / periodic
   │  Hook fires  │
   └──────┬───────┘
          ▼
   ┌──────────────────┐  deterministic, < 2s on 50k LOC
   │ livewiki index   │  re-walk → hash → diff → debt
   │ --quiet          │  (no stdout; only stderr on error)
   └──────┬───────────┘
          │ debt rows (changed/moved/deleted)
          ▼
   ┌──────────────────┐  deterministic, ~0 tokens (estimate)
   │ livewiki update  │  emits WorkPackage: manifest + debt +
   │ --json           │  snippets + validAnchors + tokensEstimated
   └──────┬───────────┘
          │ WorkPackage
          ▼
   ┌──────────────────┐  agent pays debt
   │  Agent (you)     │  preferred path: MCP livewiki_write_doc
   │                  │  fallback: edit markdown + livewiki verify
   └──────┬───────────┘
          │ write succeeded → verify clean
          ▼
   ┌──────────────────┐  records write_received metric
   │ livewiki update  │  feeds efficiencyRatio in status --json
   │ --record-write N │
   └──────────────────┘
```

## Step 1 — Hook fires

Two opt-in templates ship with `@livewiki/cli`:

- **`packages/cli/templates/git/post-commit`** — bash, invoked on every `git commit`. Recommended install via `core.hooksPath` (see `templates/README.md`).
- **`packages/cli/templates/claude-code/settings.local.json`** — Claude Code `Stop` hook, fires when the agent session ends.

Both run `livewiki index --quiet` (deterministic, no LLM) and, if there is new debt, print a one-line summary to stderr / the agent transcript. **They never block the commit / never restart the agent.** Exit is always 0 — even if `livewiki` itself fails (the post-commit script uses `set +e`).

## Step 2 — Index detects debt

`livewiki index` runs the indexer + anchor-ledger:

- Files with the same `content_hash` are skipped (read + hash only).
- New files are parsed.
- Updated files: old symbol rows are soft-deleted (hashes preserved for `moved` detection); new rows are upserted.
- Anchor-ledger diffs the markdown anchors against the symbols table → emits `changed/moved/deleted` debt.

See [indexing-and-debt.md](indexing-and-debt.md) for the full mechanics. The key point: **no LLM token is spent here.**

## Step 3 — `livewiki update` emits the work package

Source: `packages/core/src/update.ts`, `loadWorkPackage(repoRoot, opts)`.

Output (human or `--json`):

```jsonc
{
  "manifest": {
    "lastDocumentedCommit": "<sha>" | null,
    "pendingBatch": null | { runId, done, total }
  },
  "debt": [
    {
      "id": 12,
      "event": "changed" | "moved" | "deleted",
      "assignee": "agent" | "human",
      "symbol_key": "src/auth/login.ts#validateToken",
      "wiki_path": "livewiki/auth.md",
      "detail": null | "<from→to for moved>",
      "detected_at": <epoch_ms>
    }
    // …
  ],
  "snippets": [
    {
      "symbolKey": "src/auth/login.ts#validateToken",
      "snippet": "<source window>",
      "filePath": "src/auth/login.ts",
      "startLine": 42, "endLine": 58
    }
    // …
  ],
  "validAnchors": [
    "src/auth/login.ts#validateToken",
    "src/auth/login.ts#refresh",
    // …
  ],
  "tokensEstimated": <bytes / 4>,
  "bytes": <total bytes>
}
```

Construction notes (`update.ts`):

- `CHARS_PER_TOKEN = 4` — heuristic for EN/code (~4 chars/token for GPT-style tokenizers).
- `SNIPPET_WINDOW = 20` lines centered on the symbol's `start_line`.
- `maxSnippets` defense: caps package size so a 1000-symbol debt doesn't emit 1000 snippets.
- The "economy" estimate the CLI prints (`savedRatio = 1 - pkgTokens / 12500`) is a thesis signal, not a measurement.

## Step 4 — Agent pays the debt

Two paths (see `packages/cli/skills/document-as-you-go/SKILL.md`):

### Path A (preferred) — MCP `livewiki_write_doc`

Per debt item:

1. `livewiki_read` the current page (allowlist-protected; never leaks paths outside `livewiki/`).
2. Update the markdown: refresh the prose around the affected section, distribute the relevant `validAnchors` to the right sections.
3. `livewiki_write_doc(path, content)`:
   - Writes via `safe-io.writeText` (allowlist enforced).
   - Runs `verify` on the whole repo. If any error-level issue touches the page (e.g. a `broken_anchor`), the file is **rolled back** (best-effort `unlink`) and the tool returns an error — agent fixes and retries.
   - On success, incrementally updates the FTS5 `search.db` (`indexPage`).
4. `livewiki_resolve_debt([id, …])` — closes the corresponding debt rows.

### Path B (fallback) — direct edit + verify

If the agent doesn't have MCP configured:

1. Edit `livewiki/<wiki_path>.md` directly.
2. `livewiki verify` — exit 0 **and zero issues** (errors AND warnings, per the skill's acceptance criterion).
3. `livewiki update --record-write <N>` — see step 5.

## Step 5 — Record the write (`update_metrics.json`)

`packages/core/src/update-metrics.ts` writes `.livewiki/update_metrics.json` — an append-only JSON file. The agent (or the human) calls:

```bash
livewiki update --record-write <tokens_estimated>
```

Where `<tokens_estimated>` is roughly `bytes_written / 4`. This appends:

```jsonc
{ "kind": "write_received", "timestamp": ..., "wikiPath": "livewiki/auth.md",
  "bytes": ..., "tokensEstimated": N }
```

`StatusReport.metrics` (in `status.ts`) aggregates:

- `packageEmittedTokens` — total tokens of all `package_emitted` entries.
- `writeReceivedTokens` — total tokens of all `write_received` entries.
- `efficiencyRatio = writeReceivedTokens / packageEmittedTokens`.

This is the **empirical signal of the product thesis**: focused package vs. re-reading the whole repo. If `efficiencyRatio` stays well below 1, the design is working.

## Guardrails (regra #6 surfaced)

The skill file is explicit about three rules the agent must follow:

1. **Human content is untouchable.** If `debt.assignee === "human"`, do **not** write to the page — signal it to the human in the report. This applies to anchors inside `lw:manual` blocks and on `owner: human` pages.
2. **No invented keys.** Only use `validAnchors` from the package. `verify` rejects any anchor whose key is not in the current `symbols` table.
3. **Manual blocks preserved byte-for-byte.** `verify` emits `manual_block_altered` if the agent overwrites any `<!-- lw:manual --> … <!-- /lw:manual -->` region.

## Acceptance criterion (SPEC §Phase 5)

> "End-to-end flow — agent edits code, hook detects, agent pays debt via MCP, verify passes clean, manifest updated."

Covered by `packages/mcp/src/phase5-e2e.test.ts` (7 scenarios: 2 end-to-end + 5 covering `[R]` `init` adds `.livewiki/` to `.gitignore`). The E2E asserts **issue count, not just exit code** — exit 0 is not enough; zero issues of any severity is the bar.

## Privacy

- The hook does not read or send API keys.
- The hook does not call an LLM.
- The hook writes only to `.livewiki/` (the derived cache; gitignored).
- The skill, when it calls MCP, uses the `ANTHROPIC_API_KEY` / etc. env var that the MCP server already has — never asks the human to paste keys into chat.

## CLI

```bash
livewiki update [--repo <path>] [--json] [--record-write <N>] [--snippet-window <lines>]
livewiki verify  # CI-friendly; exit non-zero on error
```

## Where to go next

- [Indexing and anchor-ledger](indexing-and-debt.md)
- [MCP server tools](../integrations/mcp-server.md) — what `livewiki_write_doc` actually does on the inside.
- [Testing and validation](../operations/testing-and-validation.md) — `phase5-e2e.test.ts` is the single source of truth for the acceptance criterion.