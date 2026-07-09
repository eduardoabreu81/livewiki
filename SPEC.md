# livewiki — MVP Specification

> Executable spec, phase by phase. Each phase is functional on its own and has an
> acceptance criterion. The vision and the rationale behind decisions are in
> [VISION.md](VISION.md).
>
> **For the executing LLM**: follow the phases in order. Do not implement anything
> from future phases early. Do not invent features outside this spec — a design
> question goes to Eduardo, it's not your call. Respect the
> [Inviolable rules](#inviolable-rules).

## Inviolable rules

1. **Restricted writes**: all code that writes to disk goes through a single I/O
   module (`src/core/safe-io.ts`) that validates the path against the allowlist:
   `livewiki/` and `.livewiki/` of the target repo (plus the pointer exception,
   rule 2). Writing outside that = throw an error. No exceptions, not even in tests.
2. **Pointer in AGENTS.md/CLAUDE.md**: only with an explicit flag
   (`--write-pointer`) or interactive confirmation. Never automatic. The
   modification is an append of a delimited block
   (`<!-- livewiki:start -->` ... `<!-- livewiki:end -->`), idempotent.
3. **The DB is derived**: no information may exist ONLY in SQLite. Everything that
   matters for handoff lives in versioned markdown/manifest.
4. **No telemetry, no network** except: LLM calls in batch mode (opt-in, user's
   key) and a one-time download of WASM grammars on first use.
5. **Tests**: vitest; 80% minimum coverage in core (indexer, anchors, debt,
   safe-io). CLI/MCP may have lower coverage, but the main flows have integration
   tests.
6. **Human content is untouchable**: `owner: human` pages and `lw:manual` blocks
   are never modified by automated writes (LLM or tool). `verify` compares manual
   blocks byte for byte after each update; a change = rejected write. Debt on a
   human-content anchor does not trigger a rewrite — it generates a "human review"
   item in `status`.

## Stack

- **Runtime**: Node ≥ 20, strict TypeScript, ESM
- **Monorepo**: pnpm workspaces — `packages/core`, `packages/cli`, `packages/mcp`
  (if it simplifies things, starting single-package and extracting later is
  acceptable; document the choice)
- **Parsing**: `web-tree-sitter` (WASM). MVP grammars: TypeScript/JavaScript (tsx
  included), Python
- **Database**: `better-sqlite3` (synchronous, fast; WAL mode)
- **MCP**: `@modelcontextprotocol/sdk`
- **CLI**: `commander` (or a minimalist equivalent); human-readable AND parseable
  output (`--json` on every command)
- **LLM (batch mode)**: own thin HTTP client, providers: Anthropic +
  OpenAI-compatible (configurable base URL covers OpenRouter/LiteLLM/Ollama). No
  agent framework.
  **No hardcoded default model**: batch without config fails with a clear message
  asking for provider/model (or prompts interactively). API key ONLY via env var
  (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`); never in config.json, checkpoint_json,
  logs, or errors — with a test guaranteeing it.
  **Provider presets** (data, not code): built-in table of known providers —
  anthropic, openai, openrouter, deepseek, kimi, minimax, gemini, nvidia (NIM),
  ollama, and lmstudio (local) — with baseUrl, adapter, env var name, and default
  pricing filled in. `config.json` references the preset and can override any
  field. **Adapter rule**: when a provider offers an Anthropic-compatible endpoint
  (e.g. minimax), the preset uses the Anthropic adapter — optimized cache reads
  (prompt caching). Agent tools (Codex, Cursor, Roo Code, Kilo Code, VS Code,
  etc.) are NOT presets — they are consumers via MCP/skills (integration roadmap).

## Layout generated in the target repo

```
target-repo/
├── livewiki/
│   ├── .manifest.json
│   ├── quickstart.md
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── structure.mmd          # Mermaid org chart of directories/modules
│   │   └── modules.mmd            # Mermaid dependency graph (imports)
│   ├── diagrams/
│   │   └── <module>.classes.mmd   # per-module classDiagram (when classes exist)
│   ├── files/<path-slug>.md       # e.g. src-auth-login.md
│   └── decisions/<date>-<slug>.md
└── .livewiki/
    ├── index.db
    └── config.json                # local config (provider, languages, ignores,
                                   # language: generated-doc language — 1 per repo,
                                   # default "en"; affects only prompts/skills, never
                                   # keys/anchors/diagrams)
```

### `.manifest.json` (versioned — this is what makes cross-machine handoff work)

```json
{
  "version": 1,
  "lastDocumentedCommit": "<sha>",
  "snapshotHash": "<sha256 of livewiki/ content excluding the manifest itself>",
  "updatedAt": "<ISO 8601>",
  "pendingBatch": { "runId": "...", "stage": 4, "done": 23, "total": 61 } // or null
}
```

`snapshotHash` follows the OpenWiki pattern: only rewrite the manifest if content
changed (avoids CI loops).

### Doc page frontmatter

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

- **Page** anchor: frontmatter. **Section** anchor: HTML comment
  `<!-- lw:anchors ... -->` right after the heading.
- Symbol key format: `relative/path.ext#SymbolName` (a file with no `#symbol` = an
  anchor on the whole file). Ambiguity (overloads, nested symbols) is resolved
  with a qualified path: `#Class.method`.

## SQLite schema (`.livewiki/index.db`)

```sql
files(id, path UNIQUE, lang, content_hash, size, mtime, indexed_at)
symbols(id, file_id→files, key UNIQUE, name, kind, signature,
        start_line, end_line, content_hash, status)         -- status: active|deleted
doc_pages(id, wiki_path UNIQUE, owner,                        -- generated|human|mixed
          content_hash, updated_at)
anchors(id, doc_page_id→doc_pages, section_slug NULL,        -- NULL = page
        symbol_key, symbol_hash_at_doc, in_manual_block, created_at)
debt(id, anchor_id→anchors, event,                           -- changed|moved|deleted
     assignee,                                                -- agent|human (derived from owner/manual)
     detail, detected_at, resolved_at NULL)
undocumented(id, symbol_key, detected_at, dismissed)          -- new symbols with no docs
batch_runs(id, started_at, stage, config_json, status)
batch_tasks(id, run_id→batch_runs, stage, target, status,    -- pending|done|failed
            checkpoint_json, updated_at)
meta(key PRIMARY KEY, value)                                  -- schema_version, etc.
```

**Moved** detection: a symbol disappears from file A and appears in file B with
the same `content_hash` (or the same name+signature) → `moved` event, anchors are
automatically updated to the new key, and the debt records `detail` with the
from/to. **Prerequisite**: symbols that disappear from an *updated* file also
become `status='deleted'` (never hard-delete) — without the old row there's no
hash to match the move against. This applies to file updates, not just file
deletions. **Supersession ≠ moved**: a pair with `oldKey === newKey` is a re-index
of the same symbol, never generates an event. After the ledger, `deleted` rows
whose key has an `active` row are purged (otherwise the table grows one dead row
per symbol per edit). **Where the anchor is updated**: in the **markdown**
(frontmatter + markers), via safe-io — the DB is derived (rule 3), updating only
the DB loses it on rebuild. Order: rewrite markdown → update DB → create debt.
Exception (rule 6): an anchor in an `lw:manual` block or an `owner: human` page is
NOT rewritten — it becomes `moved` debt with assignee=`human`.

**Debt dedup**: don't create new debt if OPEN debt already exists
(`resolved_at IS NULL`) for the same anchor + same event — otherwise every
`index` re-flags the same items and the ledger becomes noise. Debt must also
carry the `symbol_key` (in a column or in `detail`), so it isn't orphaned if the
anchor is removed later.

## CLI commands

| Command | Behavior |
|---|---|
| `livewiki init` | creates `livewiki/` + `.livewiki/`, indexes the repo, generates a minimal `quickstart.md` + `structure.mmd` (no LLM). With `--batch` it triggers the full documentation pipeline |
| `livewiki index` | (re)indexes: scans files (respects `.gitignore` + config ignores), extracts symbols, updates hashes, generates debt events. Idempotent. A missing `.livewiki/` is auto-created **silently** (it's a derived cache; rebuilding it is the normal post-clone/handoff flow — never require `init`). If the `livewiki/` wiki also doesn't exist, it indexes anyway and emits an informational note suggesting `init` (exit 0) |
| `livewiki status` | shows: open debt (by page/section/event), new undocumented symbols, pending batch. `--json` for agent consumption |
| `livewiki update` | incremental mode: given the diff since `lastDocumentedCommit`, lists the debt and (a) emits the "work package" for the in-session agent to document, or (b) with `--llm` calls the configured API to pay off the debt |
| `livewiki verify` | validates the wiki: do anchors point to existing symbols? do cited signatures match? are internal links ok? Exits with a nonzero code on failure (CI-friendly). **Parses the wiki fresh from disk** — an anchor in a never-indexed page MUST be caught (that's the anti-hallucination promise: docs freshly written by an LLM are verifiable without running `index` first) |
| `livewiki serve` | starts the MCP server (stdio) |
| `livewiki batch <run>` | continues/inspects a full documentation run (resumes per task). `--only <task-id\|module>` re-runs 1 task (the same interface the in-session mode uses to work the queue); regeneration preserves `lw:manual` blocks byte for byte, refuses `owner: human` pages, and adds the new `usage` to the checkpoint (retries cost tokens and show up in the report) |
| `livewiki export <target>` | (phase 6) exports the wiki to a repository-wiki format: `github-wiki`, `gitlab-wiki`, `generic` (flattened md directory). `--push <remote>` optional |
| `livewiki view` | (phase 7) generates a self-contained static site in `.livewiki/site/` and opens it in the browser. `--template <agent\|docs>`, `--out <dir>` to publish |

All commands: `--json`, `--repo <path>` (default cwd), consistent exit codes.

## MCP tools (phase 4)

| Tool | Action |
|---|---|
| `livewiki_quickstart` | returns quickstart.md (low-token entry point) |
| `livewiki_read` | reads a wiki page by path |
| `livewiki_search` | full-text search over the wiki (SQLite FTS5) |
| `livewiki_debt` | open debt (equivalent to `status --json`) |
| `livewiki_write_doc` | writes/updates a page (path validated by the allowlist; runs `verify` on the content before accepting) |
| `livewiki_resolve_debt` | marks debt as paid (tied to a write) |

## Batch pipeline (4 stages, resumable)

1. **Scan**: full `index`; symbol snapshot.
2. **Module identification**: grouping by directory + import graph (deterministic
   heuristic; an LLM may refine module names/boundaries — 1 call).
3. **Prioritization**: orders modules by centrality (how many others depend on
   them) and size; the user can reorder/exclude (`--plan` shows the plan before
   running).
4. **Coordinated documentation**: for each module (task): context = symbols +
   relevant code (bounded by a configurable token budget) → LLM generates a page
   with anchors → `verify` → write → checkpoint. Failed/interrupted? the task
   stays `pending`, resumes later.

**Run failure policy**: a task that fails post-write verify → marks `failed` with
the reason in the checkpoint and MOVES ON to the next one (an isolated failure
doesn't cost the run; surgical retry via `--only`). **Circuit breaker**: 3
consecutive failures or >50% failure in the run → aborts with a diagnostic (serial
failure = systemic problem; continuing burns tokens). Run finished with failures:
status `completed_with_failures`, exit ≠ 0, the report lists each failed task with
the reason + a ready retry command.

At the end: generates/updates `quickstart.md` and `architecture/overview.md`,
writes the manifest.

### Token accounting (Phase 3)

Economy is the product's central thesis — so it is measured, not estimated. **The
primary metric is TOKENS, not money**: the token is a measured fact; USD is an
interpretation that varies by route (the same model costs differently direct vs
via OpenRouter) and by the user's credits. Every report leads with tokens; USD
appears as a secondary estimate, always marked "estimated, table of <date>", and
dropped without drama when there's no price.
- **Batch**: each task records the real API `usage` in the checkpoint
  (input/output tokens + model). `livewiki batch <run>` reports tokens per
  module/stage and cumulative; USD as a secondary line. Goal: reproducible
  comparison with OpenWiki and similar tools.
- **Incremental**: `update` records the size (tokenizer-estimated tokens) of the
  work package emitted to the agent and of the docs written back. Metrics in a
  dedicated table under `.livewiki/`, exposed via `status --json`.
- The anchor instruction in the batch prompt is closed: the LLM receives the list
  of canonical keys of the module (from the index) and **distributes** those keys
  across the sections — never invents a key. `verify` rejects a key not in the
  index.

## Skills and hooks (phase 5)

- **"document-as-you-go" skill** (markdown, Claude Code skills format): instructs
  the agent to run `livewiki status --json` when closing a task/commit and pay off
  the debt via `livewiki_write_doc` (MCP) or direct edit + `verify`.
- **git post-commit hook** (template, opt-in install via `core.hooksPath`): runs
  `livewiki index --quiet`; on new debt, prints a summary to the terminal (does
  not block the commit).
- **Claude Code Stop hook** (template in `templates/`): same, in the hooks JSON
  format.

## Implementation phases

### Phase 0 — Scaffold ✅ criterion: `pnpm build && pnpm exec livewiki --help` works at the workspace root
(Note: zero-friction `npx livewiki` refers to the package published on npm, in the
distribution phase — not the development repo.)
Repo structure, TS/ESM/pnpm, vitest, local CI (`pnpm test && pnpm build`), CLI
skeleton with all commands registered (stubs), `safe-io` implemented **first and
with tests** (it's rule 1).

### Phase 1 — Indexer ✅ criterion: `livewiki index && livewiki status` on a real TS repo lists the correct files/symbols
web-tree-sitter + TS/JS/Python grammars, symbol extraction (functions, classes,
methods, exports), hashes, SQLite schema, `.gitignore` respect. Performance
target: a 50k LOC repo indexed in < 30s on the first run, < 2s incremental.

### Phase 2 — Anchors and debt ✅ criterion: editing an anchored function generates `changed` debt; moving generates `moved`; running `verify` catches a broken anchor
Frontmatter + `lw:anchors` marker parser, anchors/debt/undocumented tables, index
diff → events, complete `livewiki status`, `livewiki verify`. **This phase is the
product.** Exhaustive tests here.

### Phase 3 — Init and batch ✅ criterion: `livewiki init --batch` on a medium repo generates a complete wiki; interrupting midway and running `batch resume` continues from the right task
Wiki structure, quickstart/structure.mmd without LLM, LLM client (Anthropic +
OpenAI-compat), 4-stage pipeline with checkpoints, manifest + snapshot hash.

**Deterministic diagrams (no LLM, regenerated on every `index`/`init`)**:
`structure.mmd` (org chart of directories/modules), `modules.mmd` (dependency
graph by imports — a byproduct of pipeline stage 2), and
`diagrams/<module>.classes.mmd` (Mermaid classDiagram: classes/methods/inheritance,
straight from the `symbols` table). These are pure `owner: generated`: they never
age, never enter debt — the generator is what changes. Large graphs: one diagram
per module, never a mega-diagram of the whole repo. Function call-graph and
sequence diagrams are OUT (see "Out of designed scope" in VISION).

### Phase 4 — MCP server ✅ criterion: connected to Claude Code, the 6 tools work; `livewiki_write_doc` rejects a path outside `livewiki/` and content that fails verify
FTS5 for search, stdio server, integration tests with the MCP inspector.

### Phase 5 — Skills, hooks, and complete incremental mode ✅ criterion: end-to-end flow — agent changes code, hook detects, agent pays off the debt via MCP, `verify` passes, manifest updated
Hook templates, document-as-you-go skill, `livewiki update`, opt-in pointer in
AGENTS.md/CLAUDE.md.

---

*Phases 6 and 7 are post-MVP: they only start after the agent-first loop (phases
0–5) is validated. They're specified here to avoid redesigning later.*

### Phase 6 — Export to repository wikis ✅ criterion: `livewiki export github-wiki --push` publishes a navigable wiki on GitHub with working links; re-export is idempotent
One-way, lossy transformation, `livewiki/` → repo-wiki format:
- **Namespace flattening**: `architecture/overview.md` → `architecture-overview.md`;
  `quickstart.md` → `Home.md` (GitHub) / equivalent landing page (GitLab)
- **Link rewriting** of internal links to the target's format; **removal** of
  anchor frontmatter and `lw:anchors` markers
- **Notice on each page**: "generated by livewiki from `livewiki/` — do not edit
  here" + a link to the source
- **Overwrite guard**: if the page at the target lacks the livewiki marker (it was
  hand-edited or created by a third party), warn and require `--force`
- MVP targets: `github-wiki`, `gitlab-wiki`, `generic`. Push via git (the wiki
  repo is a normal git clone); no proprietary API calls

### Phase 7 — Local viewer + templates ✅ criterion: `livewiki view` opens a navigable site in the browser with search working offline; switching `--template` changes the look without regenerating content
Self-contained static site generated in `.livewiki/site/` (gitignored; `--out` to
publish wherever, e.g. GitHub Pages):
- **Zero build step, zero server**: static HTML+CSS+JS, works via `file://`
- **Client-side search**: JSON index pre-built at generation (title, headings,
  body); no network
- **Rendered Mermaid** (lib embedded in the generated site, not a CDN)
- **Templates as data**: HTML layout + CSS + `template.json` (name, version,
  slots). NEVER template JS executed in the generator — the site's JS is
  livewiki's, the template only styles. MVP templates: `agent` and `docs`
- Template resolvable from `.livewiki/templates/<name>/` (local custom) or built-in

## Validation ("ready to consider open source" criterion)

1. Runs on 3+ of Eduardo's real repos + 1 large external repo without crashing.
2. Debt correctly detected in scenarios: edit, move, delete, file rename.
3. Real handoff exercised: LLM A documents partially (interrupted batch), LLM B
   (a different tool/vendor) resumes and finishes using only the wiki + manifest.
4. `verify` catches at least one real doc-hallucination case.
5. Measured cost: incremental mode with zero API cost; batch with predictable,
   reported per-module cost.
