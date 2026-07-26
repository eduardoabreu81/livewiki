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
7. **English product artifacts**: source code and identifiers, comments, tests,
   CLI/UI text, templates, internal documentation, and livewiki's own
   user-facing documentation are written in English. PT-BR is limited to
   maintainer conversation. Existing PT-BR artifacts are migration debt for a
   dedicated final normalization pass. This rule is orthogonal to a target
   repository's `language` setting: generated wiki prose may use the BCP-47
   language explicitly chosen by that repository.
8. **No external product dependency**: capabilities inspired by other tools are
   implemented natively in livewiki. The core CLI/MCP/skills workflow must not
   require a separate agent framework, MCP server, code-intelligence service,
   hosted workflow orchestrator, or third-party app. Provider APIs, MCP clients,
   Git hosts, and editors are optional user-selected interfaces.

## Stack

- **Runtime**: Node ≥ 20, strict TypeScript, ESM
- **Monorepo**: pnpm workspaces — `packages/core`, `packages/cli`, `packages/mcp`
  (if it simplifies things, starting single-package and extracting later is
  acceptable; document the choice)
- **Parsing**: `web-tree-sitter` (WASM). MVP grammars: TypeScript/JavaScript (tsx
  included), Python
- **Coverage ladder (two tiers)**: grammars are a precision upgrade, not a gate.
  Files whose extension maps to a tree-sitter grammar are tier 1 (anchored):
  symbol extraction, anchors, and debt apply. Every other indexed text file is
  tier 2 (prose): it is indexed with `symbolCount: 0` and documented as
  unanchored prose (`anchors: []`, grounded in paths and visible source). The
  prose floor is permanent — the tool never completes successfully with an
  empty wiki just because the repository's language has no grammar yet.
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

## Cross-platform product contract

The CLI, MCP server, and core library must run on the supported matrix hosts
without code paths that are shell-specific, OS-specific, or hardcoded to a
single filesystem layout. The product contract is the source of truth for
what "portable" means; a host can only be declared supported when these
conditions are met on it.

- **Supported runtime**: Node.js ≥ 20 on Windows, Linux, and macOS.
  Architecture-specific support (x64, arm64) is not claimed here; the
  CI matrix must include a runner for any architecture that is
  declared supported. The pnpm version is pinned in `package.json`
  (`packageManager`) and consumed by `pnpm/action-setup`; the workflow
  never repeats the version.
- **Supported terminal surfaces**: PowerShell and CMD on Windows; Bash on
  Linux; Bash and Zsh on macOS. Every command, every flag, and every
  human/JSON output line must work the same way across these shells. The CLI
  never depends on shell-specific syntax in its own output.
- **Core behavior**: no shell-specific syntax. The CLI never invokes `bash -c`,
  `cmd /c`, or `sh -c` to run product logic. If a future subprocess is needed
  (e.g. Lot 6B Git push), it must use `child_process.spawn` with the executable
  plus an argument array and `shell: false`. The CLI never constructs shell
  command strings from user input.
- **Filesystem paths**: use `node:path` (`path.posix` for durable keys,
  `path` for host filesystem operations). Native separators are used only at
  the I/O boundary; durable wiki keys, generated markers, manifest paths, and
  Markdown links always use forward slashes.
- **Line endings**: LF and CRLF inputs are supported. The core reads
  and writes both; transformations preserve the source line-ending
  convention when byte stability is part of the contract (the
  destination file is byte-identical to the source for the unchanged
  lines, including the line terminator); the export's CRLF tests
  detect stray bare CR or LF characters so a mixed-line-ending
  regression cannot pass silently.
- **Paths with spaces and Unicode**: every CLI entry point and every
  filesystem operation must accept paths that contain spaces and non-ASCII
  characters (Portuguese accented letters, CJK, emoji-adjacent code points).
  Tests cover this on every supported OS.
- **CLI JSON shape and exit codes**: identical across operating systems. A
  `livewiki --json export svn-wiki` invocation on Windows, Linux, or macOS
  emits the same JSON shape, the same `code` values, and the same numeric exit
  code.
- **OS-specific skips require equivalent active coverage on another matrix
  host**. The symlink tests in the export suite are allowed to skip on
  Windows when the host cannot create symlinks (no Developer Mode, no admin),
  but they must run (and pass) on at least one Linux and one macOS host. A
  Unix host that accidentally skips the symlink coverage is a CI contract
  violation, not a harmless skip; a guard in the test file makes this
  enforceable.
- **No telemetry, no network** beyond the LLM HTTP calls in batch mode
  (rule 4). Cross-platform CI never runs benchmarks, never exercises paid
  provider calls, never opens a proxy, and never invokes the LLM client.

## Layout generated in the target repo

```
target-repo/
├── livewiki/
│   ├── .manifest.json
│   ├── quickstart.md
│   ├── tasks.md                    # deterministic intent-oriented work index
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── structure.mmd          # Mermaid org chart of directories/modules
│   │   └── modules.mmd            # Mermaid dependency graph (imports)
│   ├── diagrams/
│   │   ├── <module>.classes.mmd   # per-module classDiagram (when classes exist)
│   │   └── flow-<slug>.mmd        # companion diagram per flow page
│   ├── flows/
│   │   ├── index.md               # deterministic "How it works" hub
│   │   └── <slug>.md              # one bounded flow page per candidate
│   ├── topics/
│   │   ├── index.md               # deterministic title+link concept hub
│   │   └── <slug>-<hash>.md        # bounded cross-module behavioral contract
│   ├── auxiliary/
│   │   └── index.md               # deterministic non-product inventory
│   ├── files/<path-slug>.md       # e.g. src-auth-login.md
│   └── decisions/<date>-<slug>.md
└── .livewiki/
    ├── index.db
    └── config.json                # local config (provider, languages, ignores,
                                   # pathRoles: optional gitignore-style path
                                   # classification overrides used for ranking,
                                   # language: wiki prose language — 1 per repo,
                                   # default "en" (en-US). Set when documenting;
                                   # pages keep the language they were written in
                                   # (sticky). Affects only prompts/skills, never
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
- Anchor and section-marker recognition is Markdown-code-aware: marker-shaped
  text inside fenced code blocks or inline-code spans is a syntax example, not
  an anchor. Artifact validation, `verify`, and the anchor ledger all apply this
  same rule; only markers outside Markdown code participate in coverage,
  duplicate detection, heading association, or persisted anchor offsets.
  Migration implication: an existing page whose marker is inside Markdown code
  loses that anchor on its next parse because the marker was never legitimate.
- Symbol key format: `relative/path.ext#SymbolName` (a file with no `#symbol` = an
  anchor on the whole file). Anchor granularity is name-per-file: same-named
  symbols within one file coalesce into one anchor, with the first by source
  order winning (lowest start line, then lowest start byte). Later duplicates
  never reach persistence and never abort indexing.

### Deterministic navigation layer

Navigation is assembled without an LLM call from indexed facts, module roles,
import edges, and existing accepted page metadata. It is regenerated by `init`
and again after batch stage 4 so it can link only to artifacts that exist.

`livewiki/quickstart.md` is the low-token entry point returned unchanged by the
MCP `livewiki_quickstart` tool. Its deterministic outline is, in this exact
order:

1. `# Quickstart` plus one orientation paragraph;
2. optional `## Understand the product`, linking every accepted topic directly
   plus the topic hub; then `## Work by intent`, linking to product work,
   architecture, the auxiliary hub when auxiliary modules exist, and each
   accepted flow page directly;
3. `## Document a repo`, covering `livewiki init` and
   `livewiki init --batch`;
4. `## Query the wiki from an agent`, covering
   `livewiki_quickstart` → `livewiki_search` → `livewiki_read`;
5. `## Pay documentation debt`, covering discovery, write, verify, and
   resolution;
6. `## Repository facts`, containing current deterministic file, symbol, and
   module counts.

Quickstart contains no ranked module list, raw symbol dump, project phase/test
snapshot, or installation syntax. The deterministic English fixture stays at
or below 100 nonblank lines and 700 words. It needs no provider configuration
and constructs no LLM client.

`livewiki/tasks.md` is `owner: generated`, has no code anchors and no
`lw:anchors` markers, and is included in the manifest snapshot. Existing topics
appear first as title-and-link entries, followed by accepted flows under
`## End-to-end behavior`. Product modules follow under
`## Implementation reference`, exactly once each.
When an accepted product module page exists, Tasks shows its linked display
title and nothing more: no `When to use this page` bullets, no responsibility
sentence, and no other module-page prose. Otherwise it shows the deterministic
display title and labels the page unavailable without emitting a dead link.
When any fixture, tooling/benchmark, or repository-documentation module exists,
`## Auxiliary work` contains exactly one link to `auxiliary/index.md`; Tasks
never lists individual auxiliary modules. `verify` checks its internal links
like any other Markdown page, but Tasks never enters the stage-4 closed-key
denominator.

`livewiki/auxiliary/index.md` is the deterministic inventory of every
non-product module, grouped as test fixtures, tooling/benchmarks, and repository
documentation. Existing module pages use their display title and an
existence-gated link; missing pages are labeled unavailable without a link. An
existing human, mixed, ownerless, or unparseable non-empty auxiliary hub is
preserved byte-for-byte. The skipped rewrite is reported with path and owner in
the current init/batch human and JSON result and is not persisted. A generated
hub is removed when no auxiliary modules remain; a protected hub is never
removed.

Every module has a presentation-only `displayTitle`. The deterministic fallback
uses the shortest unique directory context plus any split ordinal (for example,
`Core source — part 3 of 5`) and is never merely the raw module id. An accepted
module page's frontmatter title may replace the fallback for presentation.
Stage 4 must emit a concise, human-meaningful responsibility title and must not
use the stable `Module.id` alone as the product-page title. Stage 2 may suggest
an optional `displayTitle` independently of `id`; a missing, malformed,
duplicate, or low-quality suggestion degrades silently to the deterministic
fallback and never rejects or changes an otherwise exact path partition.
`displayTitle` has **no role** in:

- the page filename (`livewiki/<module.id>.md`);
- the architecture-overview HTML fragment (`#<module.id>`);
- batch task targets or checkpoints;
- diagram filenames or import-graph node identity;
- exact-partition or unique-id validation; or
- symbol keys, frontmatter anchor values, or section markers.

`Module.id` remains the only structural identity for all of those surfaces.

Every generated module page must begin, after frontmatter and before the first
anchored implementation section, with this exact structural contract:

```markdown
# <human-meaningful title>

<One sentence: what responsibility this page covers.>

## When to use this page

- <Verb-led task cue.>
- <Verb-led task cue.>

## How it fits

<One or more short prose paragraphs naming the module's role and its immediate
repository context. No claim of a complete call graph.>
```

The opening contains two to four task bullets, each beginning with an action
verb. The structural validator accepts any non-empty Markdown content after
the bullet marker, including bold text, inline code, and links. The two H2
labels shown above are canonical; validation matches those exact words
case-insensitively while still requiring the `##` level. `How it fits` accepts
one or more prose paragraphs but rejects headings, bullets, and `lw:` markers
inside its block. The opening contains no `lw:anchors` marker; closed keys
remain distributed exactly once among later anchored reference sections. It
does not repeat the full path inventory, symbol table, or frontmatter anchors
in prose, and it does not infer “entry point” status from symbol count. Fixtures,
tooling, benchmarks, and documentation pages use honest auxiliary task context
rather than claiming product prominence.

Architecture overview remains the detailed product inventory. Each product
module card shows the human display title first, a separately labeled module
id, file/symbol counts, up to three deterministic representative paths,
existence-only page/class-diagram links, and direct dependencies/dependents by
display title. Its explicit HTML id remains the stable `Module.id`. Auxiliary
modules do not receive individual cards there; when present, they are
represented by their count and exactly one existence-gated link to
`../auxiliary/index.md`.

After stage 4, every existing `owner: generated` or `owner: mixed` module page
gets a deterministic final `## Navigate` block. The block links to Quickstart,
Tasks, Architecture, and at most three existing direct import-graph neighbors
drawn from dependencies and dependents together. Related modules prefer product
role, then existing prioritization order, and are deterministic under input
reordering. The block has no anchors and no LLM-authored path. Rewriting it
preserves every `lw:manual` block byte-for-byte and retains `owner: mixed`;
`owner: human` pages are never modified.

### Semantic product-flow layer

Stage 5 (flows) synthesizes a bounded set of cross-module semantic
product-flow artifacts after stage 4: one flow page
(`livewiki/flows/<slug>.md`) and one companion Mermaid diagram
(`livewiki/diagrams/flow-<slug>.mmd`) per candidate, plus a deterministic hub
(`livewiki/flows/index.md`). Candidates are detected deterministically from
the index — entry modules, module-graph walks, persistence and
external-boundary signals (gitignore-style pattern overrides in
`config.flowSignals`) — never from repository-specific names. Detection,
slugs, hub, and links are deterministic under input reordering. The set is
capped by `maxFlows` (default 4; 0 disables). Synthesis is an ordinary gated
batch task kind (stage 5, target `flow:<slug>`): closed key list (≤
`flowMaxAnchors`, default 25) as an **upper bound, not an assignment** —
the page cites only the keys it uses, each exactly once in frontmatter and
exactly once across section markers; the shared artifact validator
parameterized by
page kind, bounded repair, transactional write with rollback, token
accounting, and the run failure policy — all identical to stage 4. One
deliberate asymmetry: the stage-5 write gate rejects on ANY verify issue —
error or warning — scoped to the written page and diagram, while stage 4
keeps the error-only filter (R9 contract); pre-existing issues on other
paths never block either gate. Diagrams
are parsed pre-write and bounded (`flowMaxDiagramNodes` 12 /
`flowMaxDiagramEdges` 20); every diagram has a numbered-step textual fallback
in the page. Flow claims cite only closed-list anchors, so flow pages enter
the debt ledger like any page. Structural source maps (structure/import/class
diagrams) are retained and do not count as flow coverage; automatic
whole-repository call-graphs remain out of scope. Quickstart links every
accepted flow page directly and also links the complete hub when at least one
flow page exists; CLI, MCP, export, and the Phase 7 viewer
consume the same files with no separate agent/human truths. The hub is a flat
list without anchored sections, so slug-mapped manual-block reinsertion is
unreliable; as a hub-specific conservative exception to §"Manual-block
preservation", a human, mixed, or unparseable `flows/index.md` is never
rewritten — the regeneration is skipped and the skip is reported (path and
owner) in the current init/batch output, never persisted for later status
queries. `verify` still detects broken links in a preserved hub but cannot
detect semantic omissions (for example, a flow page missing from the list).

### Semantic concept-topic layer

After accepted module and flow artifacts exist, stage 5 runs one bounded
`topic-plan` task over a closed deterministic inventory. The inventory contains
accepted module titles/openings/anchors, import neighbors, generic
configuration/state/output/validation signals, and accepted flow evidence. The
planner may name concepts, but every proposed module, flow, and anchor must be
copied from that inventory. Product code contains no repository-specific topic
table. `maxTopics` defaults to 4 and accepts 0..8; 0 disables planning and topic
generation. Each accepted topic uses 2..6 modules, 0..2 flows, and 5..18 anchors
grouped as contract/state/output/failure, with at least 75% product-role
anchors, no duplicate group membership, no pair above 75% anchor overlap, and
source-span cost within `topicMaxSourceChars` (default 40,000). The accepted raw
plan and derived candidates are persisted in the task checkpoint and reused by
resume and `--only topic:<evidence-hash>`. An inventory with fewer than five
active anchors, or without either two product modules or one accepted flow
spanning at least three modules, skips topic planning deterministically without
creating a failed task or calling the LLM.

Each candidate becomes `livewiki/topics/<title-slug>-<hash>.md`. Topic
frontmatter declares `kind: topic`, its accepted plan order and intent, exact module/flow sets,
and the closed anchors it actually cites. Required H2s are Purpose, When to use
this page, Behavioral contract, Failure and recovery, Change map, and Related
pages. Every factual H2 through Change map carries evidence; the closed list is
an upper bound with exact dual citation for every used key. Topic generation
uses bounded repair, monotonic usage accounting, safe-io, an any-severity
page-scoped verify gate, and transactional rollback. Human/mixed topic pages
and hubs are preserved; stale cleanup removes generated pages only. The hard
prose maximum is 1,400 words, and non-Mermaid code fences are rejected.

Quickstart and Tasks route to topics before implementation references. Module
Navigate blocks link at most two supporting topics, and flow pages link at most
two topics that cite them. Hubs contain title+link only. Auxiliary module pages
retain exact anchor coverage but use the compact Reference/H3 contract; role
classification changes depth and prominence, never inventory membership.

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
rationales(id, file_id→files, symbol_key NULL, kind,          -- tagged comment|docstring
           text, start_line, content_hash)                    -- sha256 of normalized text
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
| `livewiki init` | creates `livewiki/` + `.livewiki/`, indexes the repo, generates deterministic `quickstart.md`, `tasks.md`, architecture overview, and diagrams (no LLM). With `--batch` it triggers the full documentation pipeline and regenerates navigation after stage 4 |
| `livewiki index` | (re)indexes: scans files (respects `.gitignore` + config ignores), extracts symbols, updates hashes, generates debt events. Idempotent. A missing `.livewiki/` is auto-created **silently** (it's a derived cache; rebuilding it is the normal post-clone/handoff flow — never require `init`). If the `livewiki/` wiki also doesn't exist, it indexes anyway and emits an informational note suggesting `init` (exit 0) |
| `livewiki status` | shows: open debt (by page/section/event), new undocumented symbols, pending batch. `--json` for agent consumption |
| `livewiki update` | incremental mode: given the diff since `lastDocumentedCommit`, lists the debt and (a) emits the "work package" for the in-session agent to document, or (b) with `--llm` calls the configured API to pay off the debt |
| `livewiki verify` | validates the wiki: do anchors point to existing symbols? do cited signatures match? are internal links ok? Exits with a nonzero code on failure (CI-friendly). **Parses the wiki fresh from disk** — an anchor in a never-indexed page MUST be caught (that's the anti-hallucination promise: docs freshly written by an LLM are verifiable without running `index` first) |
| `livewiki serve` | starts the MCP server (stdio) |
| `livewiki batch <run>` | continues/inspects a full documentation run (resumes per task). `--only <task-id\|module>` re-runs 1 task (the same interface the in-session mode uses to work the queue); regeneration preserves `lw:manual` blocks byte for byte, refuses `owner: human` pages, and adds the new `usage` to the checkpoint (retries cost tokens and show up in the report) |
| `livewiki export <target>` | (phase 6) exports the wiki to a repository-wiki format: `github-wiki`, `gitlab-wiki`, `generic` (flattened md directory). `--push <remote>` optional |
| `livewiki view` | (phase 7) generates a self-contained static site in `.livewiki/site/` and opens it in the browser. `--template <agent\|docs>`, `--out <dir>` to publish |

All commands: `--json`, `--repo <path>` (default cwd), consistent exit codes.
Commands set `process.exitCode` and return instead of calling
`process.exit(...)`, allowing pending stdout/stderr and async handles to drain.
This applies to normal status propagation and fatal command errors; documented
numeric exit-code semantics remain unchanged.

**Risk-weighted debt ordering (Etapa 2c).** `livewiki status` (and, through the
same array, `livewiki update`'s work package) ranks open debt by a
deterministic, transparent risk score computed without any LLM call. Ordering
changes only — debt identity/dedup is untouched (§"Debt dedup"), and the JSON
change is purely additive (`debt.items[].risk = { score, factors }`). The human
output prints `[risk N]` after each debt item. Rubric (per debt item's source
file; missing data ⇒ factor 0; score = sum; sort: score desc, then detected_at
asc, then id asc):

| Factor | Rule | Points |
|---|---|---|
| event | `changed` / `deleted` | +10 |
| event | `moved` | +5 |
| testGap | anchored-tier file with no importing test file | +40 |
| testGap | prose-tier file (import coverage not possible) | +10 |
| fanIn | 1–2 importers / 3–5 / 6–10 / >10 | +5 / +10 / +15 / +20 |
| churn | 1–3 commits / 4–9 / ≥10 in window | +5 / +10 / +15 |

Config keys: `riskAnalysis` (boolean, default `true`; `false` keeps the
chronological ordering and omits the `risk` field) and `riskChurnCommits`
(integer 0..10000, default 500; `0` disables the git spawn). Imports are
recomputed on demand, never persisted. Git churn uses ONE `git -c
core.quotepath=false log --no-merges --max-count=<N> --name-only --format=`
subprocess via `child_process.spawn` with an argument array and `shell: false`;
when git is absent or the directory is not a repo it degrades silently (churn factor 0, never an error).

## MCP tools (phase 4)

| Tool | Action |
|---|---|
| `livewiki_quickstart` | returns quickstart.md (low-token entry point) |
| `livewiki_read` | reads a wiki page by path |
| `livewiki_search` | full-text search over the wiki (SQLite FTS5) |
| `livewiki_debt` | open debt (equivalent to `status --json`) |
| `livewiki_write_doc` | writes/updates a page (path validated by the allowlist; runs `verify` on the content before accepting) |
| `livewiki_resolve_debt` | marks debt as paid (tied to a write) |
| `livewiki_impact` | blast radius of a symbol key: resolved call-graph callers + the wiki pages documenting them (best-effort, bounded by maxDepth/maxNodes) |

A successful, non-error `livewiki_write_doc` result means the page was written
and passed `verify`, unless the caller explicitly requested `skipVerify: true`.
Any verify failure, including a crash of the verifier itself, triggers a
best-effort rollback so no unverified page is left behind. If rollback fails,
the tool returns an error that names the suspect path and warns that the disk
may contain an unverified page requiring operator inspection.

**Workflow-adjacency hints (Etapa 2d).** Every SUCCESS tool response carries a
static `_hints` block suggesting the next most useful tool calls, so arbitrary
MCP clients discover the livewiki loop on their own. JSON-payload tools
(`search`, `debt`, `impact`, `resolve_debt`) carry a top-level `_hints` field;
plain-text tools (`quickstart`, `read`, `write_doc`) carry a trailing text
block with `{"_hints": [...]}` (the first block stays byte-identical). Error
responses carry no hints. The table is pure presentation-layer data
(`TOOL_HINTS` in `server.ts`) — no config, no state.

## Batch pipeline (5 stages, resumable)

1. **Scan**: full `index`; symbol snapshot.
2. **Module identification**: grouping by directory + import graph (deterministic
   heuristic; an LLM may refine module names/boundaries — 1 call). Oversized
   modules are **split** into smaller units (by **true subdirectory** only —
   peer leaf filenames are never structural groups — else stable dual-axis
   file/symbol **chunks** with ordinal ids `parent-01`, `parent-02`, …) so
   each stage-4 page can complete under the model output budget — thresholds:
   `maxModuleFiles` / `maxModuleSymbols` in config (defaults 12 / 80; `0`
   disables that axis). A single file over `maxModuleSymbols` is emitted as
   `unsplittable` (batch continues; stage 4 bounds context). The plan is an
   **exact partition** of indexed paths (each path in exactly one module) and
   is deterministic under input reordering. Optional stage-2 LLM refine may
   rename/merge whole directories only when it forms an **exact 100% partition**
   of the indexed inventory (every path once; no missing, duplicate, unknown,
   or empty modules). It **must not** fragment peer files under the same
   parent directory (`refine_fragmented_peers`). Any refine rejection keeps
   the full heuristic and does **not** abort the batch. The pre-stage-4
   partition assert compares executable modules to the original indexed
   `filePaths`, never to a post-refine subset.
   A refined module may also carry an optional presentation-only
   `displayTitle`. Missing, malformed, duplicate, or low-quality title values
   are discarded without rejecting the refined module partition; the
   deterministic title fallback remains authoritative when no suggestion is
   accepted. `--no-refine` does not use this channel.
   Module IDs are deterministic, stable slugs. A unique directory leaf keeps
   its short ID; colliding leaves use the shortest unique path suffix
   (`core-src`, `cli-src`, `mcp-src`, expanding only when necessary). Order:
   unique → split → exact-partition assert → unique → assert. Duplicate IDs
   are a hard pipeline error before stage-4 tasks, LLM calls, or page writes:
   one module ID maps to exactly one task target and one `livewiki/<id>.md`
   page.

   **Two content layers (roadmap):** (A) structural/agent pages (dirs, symbols,
   import links, anchors — verifiable); (B) optional later human/product
   narrative synthesized from A. Batch today targets layer A.
3. **Prioritization**: product modules are ordered before auxiliary modules,
   then by centrality (how many others depend on them) and size. Path roles are
   deterministic (`product`, `fixture`, `tooling`, `docs`) with optional
   gitignore-style overrides in `config.pathRoles`. Roles affect ranking,
   navigation, and compact-vs-product presentation depth only: they never remove files, modules, symbols, or closed-list
   obligations. The user can reorder/exclude (`--plan` shows the plan before
   running).
4. **Coordinated documentation**: for each module (task): context = symbols +
   relevant code (bounded by a configurable token budget) → LLM generates a page
   with anchors → normalize and validate the artifact → transactional write +
   `verify` → checkpoint. Failed/interrupted? the task stays resumable.

Stage-4 output is an artifact, never a raw transcript. The prompt contains the
closed canonical key list and explicitly requires exact keys from that list; it
must not contain copyable fake anchors. Marker-shaped text from untrusted source
or prior candidates is replaced with same-length whitespace before prompt
embedding, so neither a fake marker nor a visible replacement sentinel can be
copied into the artifact. Before writing, livewiki:

- removes one complete leading `<think>...</think>` block and rejects an
  unclosed reasoning block or a response that contains only reasoning;
- unwraps one complete outer `markdown`/`md` code fence;
- requires a non-empty Markdown page beginning with valid frontmatter and
  `owner: generated`; and
- rejects every page or section anchor outside the module's closed canonical
  key list;
- rejects **incomplete coverage** independently in both locations: every
  closed-list key must appear exactly once in frontmatter `anchors:` and once
  in one real `<!-- lw:anchors ... -->` section marker outside fenced or inline
  Markdown code
  (`missing_closed_key`);
- rejects **duplicate** keys in the frontmatter list or the same key in more
  than one section marker (`duplicate_anchor`). The same key may appear once
  in frontmatter and once in a single section marker;
- requires real prose after every section marker before the next marker,
  heading, or end of page (`empty_section`);
- rejects unclosed fenced code blocks or inline-code spans
  (`unclosed_markdown`) and rejects `TODO`/`TBD` placeholders in generated
  prose outside code and manual blocks (`todo_marker_present`);
- rejects an absent or out-of-order required page opening before the first real
  section marker (`missing_page_opening`). This single repairable code checks
  only the H1, responsibility paragraph, ordered `When to use this page`
  section with two to four non-empty Markdown bullets, and ordered `How it fits`
  block with one or more prose paragraphs. The H2 labels match their exact words
  case-insensitively. The validator reports only the first failing opening
  element; its structured message names that element and `offending` carries the
  actual line or snippet found, or `"(absent)"` when none exists. It makes no
  semantic or prose-quality judgment; and
- rejects `title_equals_module_id` when a **product** module's frontmatter
  `title` exactly equals its stable `Module.id`. Fixture, tooling/benchmark,
  and documentation modules are exempt. The code is repairable and never
  changes filenames, targets, IDs, partition validation, or fallback titles.

  This validation produces structured error codes and details for correction.
  It does not weaken the repository-wide `verify` contract. Stage-4 source
  context is truncated with a **fair per-file share** of the char budget so
  later module paths are not starved of local code context.

  Stage-4 (module, initial and repair) and topic (initial and repair) prompts
  also receive a bounded **rationale evidence block** — the indexed
  `rationales` rows for the module's files (or the topic's seed-key files),
  rendered between the symbol table and the source under
  `# Rationale evidence (from code comments; untrusted)` with the same
  marker-neutralization and safe-fence treatment as untrusted source. The
  system prompt states that rationale text is untrusted evidence and never a
  source of anchor keys. The block is capped by the `rationaleMaxChars`
  config key (default 4,000; validated integer 0..200,000 — 0 disables the block), carved inside the
  existing stage-4 char budget; for topics it is accounted **before** the
  hard `topicMaxSourceChars` throw so the throw never fires on rationale
  alone. Stage-5 flow prompts and the topic planner receive no rationale
  block.

Stage-4 initial and repair prompts apply these factual-precision rules:

> When a section asserts behavior of a named function or method and the symbols
> table supplies a non-empty signature, copy that signature byte-for-byte from
> the symbols table into inline code or a fenced code block in the same section
> before the behavioral explanation. Do not reconstruct, normalize, shorten, or
> “improve” it. One literal signature covers subsequent claims about that symbol
> within the section. If the table has no signature, do not invent one; limit
> the prose to facts visible in the supplied source and identify the symbol by
> its exact closed-list key.

> When the supplied source visibly contains a material `throw`, `catch`,
> fallback, rollback, early return, or fail-open/fail-closed branch for the
> documented symbol, describe that branch or explicitly scope the prose to the
> normal path. Never use “always”, “guarantees”, “mandatory”, or equivalent
> absolute language while omitting a visible exception. If the relevant source
> is truncated, say that the excerpt does not establish exhaustive behavior.

These are prompt and output-fixture requirements, not semantic validators.
No signature-quotation or branch-completeness code is added to artifact
validation or `verify`.

Adapters normalize provider completion signals as `complete`, `length`,
`incomplete`, or `unknown` and preserve the raw provider reason in the task
usage history. `length` and `incomplete` responses are never accepted as
artifacts. Only normalized `incomplete` is eligible for a bounded fresh retry
that does not consume a repair slot; `length` always consumes its bounded slot
because it reflects the configured output budget, not provider flakiness.
`unknown` remains backward-compatible for providers or proxies that omit the
signal and still undergoes full structural validation.

An invalid artifact, incomplete provider response, or post-write verify failure
triggers another bounded attempt for the same task. `maxRepairAttempts` defaults
to `2` in `.livewiki/config.json` conventions and can be overridden per run.
`maxIncompleteRetries` is an optional non-negative integer, defaults to `2`, and
may be set to `0` to disable non-consuming retries. While that per-task retry
budget remains, an `incomplete` outcome gets a fresh initial call without
consuming one of the `1 + maxRepairAttempts` bounded slots. After the retry
budget is exhausted, later `incomplete` outcomes consume slots exactly as
before, so exhaustion degrades to the ordinary bounded-loop behavior. The
worst-case paid call count per task is
`1 + maxRepairAttempts + maxIncompleteRetries` (default `5`). The next prompt
depends only on the immediately previous attempt:

| Previous outcome | Next prompt | Repair inputs |
|---|---|---|
| no previous attempt | initial | empty |
| LLM error (non-timeout) | initial | cleared |
| incomplete generation | initial | cleared |
| token-limit truncation (`length`) | initial | cleared |
| normalization, artifact-validation, or verify failure with candidate chars above the stage-4 char budget | initial | cleared |
| normalization, artifact-validation, or verify failure with candidate chars within the stage-4 char budget | repair | that attempt's full candidate and exact structured errors |
| LLM timeout | none (terminal for the task) | none |

Incomplete and token-limited responses are not completed artifacts and are
never embedded as repair candidates. A completed response with normalized stop
reason `unknown` still flows through normalization and all validators. A repair
prompt embeds the full prior candidate up to the existing stage-4 char budget;
an oversized candidate instead triggers a fresh initial prompt with all repair
inputs cleared. In the embedded repair candidate, an `lw:anchors` marker is
preserved byte-for-byte only when every key in that marker is an exact member
of the module's closed key list. Source context remains fully neutralized. The
injection-defense invariant for every prompt surface is that no other `lw:*`
syntax may survive: malformed markers, non-anchor marker types, and anchor
markers containing any invalid key are whitespace-neutralized. Repair state is
never resurrected from an older attempt. A repaired task is `done` and does not
increment circuit-breaker failures. Only exhaustion becomes one final task
failure.

Each stage-4 task checkpoint may include an append-only `diagnosticHistory`,
with one content-safe record per LLM attempt: the global attempt number,
normalized/raw stop reasons when available, outcome, prompt kind, bounded
structured error summaries, candidate character count and SHA-256 (never the
candidate itself), and completion timestamp. A non-consuming incomplete retry
sets the optional `budgetConsumed` field to `false`; absence means the attempt
consumed a bounded slot and keeps old checkpoints backward-compatible. It is
seeded and appended on resume and `--only`, exactly like `usageHistory`; every
stage-4 call, including a non-consuming retry or timeout, has one entry in each
history with the same global attempt number. Token and cost totals include every
call and remain monotonic and exact regardless of slot consumption. Diagnostics
never persist prompts, source text, raw candidates, or API keys. Text excerpts
and error lists use fixed persistence caps, while dropped-entry counts preserve
truthful totals.

When attempts are exhausted, `repair_exhausted` reporting presents the ordered
per-attempt sequence and real totals across all attempts. It never describes
the final attempt's error count as the total.

**Closed repair contract.** Every artifact-validation or verify failure code
carries an enumerated, machine-checkable repair contract per page kind
(`module`, `flow`, `topic`), held in one single source of truth
(`packages/core/src/repair-contract.ts`):

- `SUPPORTED_FIXES[kind]` maps each code to the exact ACTION directive the
  repair prompt renders for it. An exhaustiveness check guarantees every
  `ArtifactValidationCode` appears in each per-kind map exactly once — either
  as a directive or as an explicitly `UNCLASSIFIED` entry with a one-line
  reason. The five `verify` issue codes (`broken_anchor`,
  `broken_internal_link`, `invalid_mermaid_diagram`, `manual_block_altered`,
  `missing_wiki_path`) are preserved end-to-end instead of being collapsed
  into `verify_failed`; `verify_failed` remains in the union only as a legacy
  fallback for old checkpoints, mapped to a generic directive.
- Unclassified codes are never repaired by guessing. When a repair prompt
  runs with a mixed error set, supported codes render their ACTION directives
  and each unclassified code appears in a report-only section ("no supported
  repair exists for these — do not attempt to guess; fix the actionable items
  above"). `manual_block_altered` is unclassified by design: human content is
  never model-repaired (rule #6); it is reported to the operator.
- Early abort: before scheduling a repair call, if every error in the set is
  unclassified for that page kind, the orchestrator makes no LLM call and
  fails the task immediately with the `unrepairable` outcome (distinct from
  `repair_exhausted`), rendered in `batch status` with the unclassified codes
  and their reasons. No repair slot is consumed.
- The topic stage aligns with stages 4/5 on write/verify exceptions: a
  `write_verify_exception` short-circuits the task without burning repair
  slots.

**Recovery tier.** Two mechanisms backstop the strict repair loop; anchors,
the closed key list, `verify`, ownership rules, and accounting are never
relaxed by either.

- **Surgical section-scoped repair.** When every error in a failed attempt's
  set is a prose-level code (`missing_page_opening`, `todo_marker_present`,
  `empty_section`, `broken_internal_link`,
  `anchor_missing_in_required_section`) with a resolvable section, the repair
  attempt uses a small scoped prompt (the failed page + the error directives
  + only the affected sections' evidence, capped ~12k chars) with an explicit
  "fix ONLY the named sections" contract. A deterministic anti-cascade guard
  (`section-guard.ts`) splits the page into H2 sections and splices back only
  the named ones; a response that alters any other byte is rejected
  (`surgical_cascade_rejected`). Ineligible error sets use the full-context
  repair prompt unchanged. Config: `surgicalRepair` (boolean, default `true`).
- **Relaxed completion round.** When the strict loop exhausts
  (`repair_exhausted` would be assigned) and the failure is not infra
  (`llm_timeout`, `write_verify_exception`, `context_build_exception`,
  `rollback_failed`, `unrepairable`, ownership refusals, unclassified codes),
  the task gets ONE final attempt under a relaxed presentation contract: flow
  reduces required sections to Purpose / Ordered flow / Diagram / Related
  pages, topic to Purpose / Behavioral contract / Related pages, module keeps
  its opening; bullets are accepted where prose paragraphs were required.
  Frontmatter exactness, anchors, diagram placeholder, marker placement, tier
  coverage, the TODO ban, and `verify` stay strict. Success marks the task
  done and the page degraded: frontmatter `quality: degraded` plus a fixed
  reader notice as the first body line; the batch report and `batch status`
  list `degradedPages`, and `livewiki status` recounts degraded pages fresh
  from disk. Degraded tasks are `done`: a degraded-only run is `completed`
  (exit 0). Config: `relaxedRound` (boolean, default `true`).

Stage-4 output budget defaults to `stage4MaxOutputTokens` **8192** (config
override allowed). Provider presets carry market defaults; **where an API can
disable thinking/reasoning for documentation, livewiki disables it by default**
(e.g. MiniMax-M3 Chat Completions: `thinking: { "type": "disabled" }` — omitting
the field enables thinking on that API).

**LLM HTTP timeout** (client/provider level, not stage-specific) is controlled
by `timeoutMs` in `.livewiki/config.json`:

- default **300_000** ms (5 minutes) when omitted;
- **0** disables the client abort timer (local providers may set e.g. **900_000**);
- must be a non-negative integer (negatives / non-integers rejected at load);
- on client timeout (`AbortError`), livewiki **does not** automatically retry
  the same generation at the adapter **or** in the stage-4 repair loop
  (provider state is unknown and may still bill); the task fails with
  `llm_timeout` and the run may continue other modules;
- HTTP **429** and **5xx** remain retryable under `maxRetries`;
- any `generate()` that throws **without** returning provider usage records
  **usage unknown** (`usage: null`, `usageKnown: false`) — including timeouts
  and network errors after the request may have been sent; this is **not**
  cost zero and must not invent models like `(no usage)`;
- known batch totals are **observed values only** and may be **incomplete**
  (`usageIncomplete`); human status/result output warns when incomplete;
  **proxy or provider billing** is authoritative for wire cost;
- `timeoutMs` must be an integer in `0..2147483647` (Node `setTimeout` safe max).

Candidate writes are transactional. Before retry or final failure, livewiki
restores an existing page byte-for-byte or removes a newly-created page through
the safe-I/O allowlist. No invalid candidate remains on disk. Ownership rules for
regeneration:

- `owner: human` — refuse the entire automated rewrite (no LLM call);
- `owner: generated` — allow full rewrite of the page;
- `owner: mixed` — allow rewrite of generated sections; every `lw:manual` block
  is preserved byte-for-byte and the final frontmatter keeps `owner: mixed`
  (the model still emits `owner: generated` in its artifact; the orchestrator
  restores `mixed` before write/verify).

Manual-block preservation compares a multiset of exact content hashes rather
than byte offsets. Blocks may move as generated prose changes, duplicate blocks
remain count-sensitive, and any missing or changed human block is rejected.

If post-write verify fails **and** rollback itself fails, that is terminal for
the **entire run** (`aborted`): later modules must not call the LLM or write
pages, because disk may be inconsistent.

**Run failure policy**: a task that exhausts artifact/verify correction → marks
`failed` once with the final reason in the checkpoint and MOVES ON to the next
one (an isolated failure doesn't cost the run; surgical retry via `--only`),
except `rollback_failed` which aborts the run as above.
**Circuit breaker**: 3
consecutive failures or >50% failure in the run → aborts with a diagnostic (serial
failure = systemic problem; continuing burns tokens). Run finished with failures:
status `completed_with_failures`, exit ≠ 0, the report lists each failed task with
the reason + a ready retry command.

At the end: regenerates `quickstart.md`, `tasks.md`,
`architecture/overview.md`, `flows/index.md`, `topics/index.md`, `auxiliary/index.md`, and the
deterministic per-module `## Navigate` blocks, then writes the manifest.
Navigation adds no LLM call. Tasks and the architecture overview expose product
work directly and route all fixtures, tooling/benchmarks, and repository docs
through the single auxiliary inventory; every emitted link targets an artifact
that exists.

### Token accounting (Phase 3)

Economy is the product's central thesis — so it is measured, not estimated. **The
primary metric is TOKENS, not money**: the token is a measured fact; USD is an
interpretation that varies by route (the same model costs differently direct vs
via OpenRouter) and by the user's credits. Every report leads with tokens; USD
appears as a secondary estimate, always marked "estimated, table of <date>", and
dropped without drama when there's no price.
- **Batch**: each actual LLM call records exactly one real API `usage` entry in
  the checkpoint, including corrective calls
  (input/output tokens + model). `livewiki batch <run>` reports tokens per
  module/stage and cumulative; USD as a secondary line. Goal: reproducible
  comparison with OpenWiki and similar tools.
- **Incremental**: `update` records the size (tokenizer-estimated tokens) of the
  work package emitted to the agent and of the docs written back. Metrics in a
  dedicated table under `.livewiki/`, exposed via `status --json`.
- The anchor instruction in the batch prompt is closed: the LLM receives the list
  of canonical keys of the module (from the index) and **distributes** those keys
  across the sections — never invents a key. Stage-4 artifact validation rejects
  a key outside that module before acceptance, and `verify` still rejects a key
  not in the repository index.

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
The walker indexes every text file by default (denylist, not allowlist):
archives/binaries, media/fonts, `.map`/minified files, and known lockfiles are
skipped, and `livewiki/` is always ignored alongside `.git/`, `node_modules/`,
`.livewiki/`, `dist/`, and `coverage/`. Files without an extension are skipped
(no meaningful language name). Files with no grammar are indexed without
parsing (`symbolCount: 0`, language = lowercased extension without the dot).
Files over 1 MiB or with a NUL byte in the first 8 KiB are skipped and counted
(`filesSkippedTooLarge`, `filesSkippedBinary`). `status` classifies each
language as `anchored` (grammar available) or `prose` (no grammar).

**Rationale extraction (intent evidence, deterministic — zero LLM cost at
index time).** During parsing, files with a grammar also yield a bounded set
of *rationales*: intent-bearing comments and docstrings stored per file in
the `rationales` table. Two kinds are captured, nothing else:

- **Tagged comments**: comments whose stripped text starts with `WHY:`,
  `NOTE:`, `HACK:`, `TODO:`, or `FIXME:` (case-insensitive). The `kind` is
  the lowercased tag.
- **Docstrings**: Python first-statement strings of a `module`,
  `class_definition`, or `function_definition` body
  (`expression_statement > string`); TS/JS/TSX block comments opening with
  `/**` (plain `/*` block comments do not qualify). Kind: `docstring`.

Rationale text is normalized (comment markers stripped, whitespace
collapsed). Docstring text must have at least 20 characters of content —
shorter is noise; tagged comments are captured whenever the tag prefix
matches, at any length. Attribution is positional (comments are tree-sitter
extras, so association is line-based, not structural): a comment whose line range falls
**inside** a symbol's line range attaches to that symbol; a contiguous
comment block whose last line is **immediately above** the declaration's
first line (no blank lines) attaches to that symbol; everything else is
file-level (`symbol_key` NULL). `content_hash` is the sha256 of the
normalized text, enabling a future "rationale changed" debt signal (not
implemented yet). Files whose first 8 lines contain a generated-code header
marker (`DO NOT EDIT`, `@generated`, `Code generated`, `AUTO-GENERATED`,
`auto-generated`, case-insensitive) are considered auto-generated and yield
zero rationale rows (migration/protobuf revision noise). Rationales are
recomputed wholesale per file (delete + reinsert, no soft-delete) — like
`calls`, a rationale row has no identity worth preserving across a
re-parse. Grammar-less (tier-2 prose) files yield no rationales.

### Phase 2 — Anchors and debt ✅ criterion: editing an anchored function generates `changed` debt; moving generates `moved`; running `verify` catches a broken anchor
Frontmatter + `lw:anchors` marker parser, anchors/debt/undocumented tables, index
diff → events, complete `livewiki status`, `livewiki verify`. **This phase is the
product.** Exhaustive tests here.

### Phase 3 — Init and batch ✅ criterion: `livewiki init --batch` on a medium repo generates a complete wiki; interrupting midway and running `batch resume` continues from the right task
Wiki structure, quickstart/structure.mmd without LLM, LLM client (Anthropic +
OpenAI-compat), 5-stage pipeline with checkpoints, manifest + snapshot hash.

**Deterministic diagrams (no LLM, regenerated on every `index`/`init`)**:
`structure.mmd` (org chart of directories/modules), `modules.mmd` (dependency
graph by imports — a byproduct of pipeline stage 2), and
`diagrams/<module>.classes.mmd` (Mermaid classDiagram: classes/methods/inheritance,
straight from the `symbols` table). These are pure `owner: generated`: they never
age, never enter debt — the generator is what changes. Large graphs: one diagram
per module, never a mega-diagram of the whole repo. These deterministic
diagrams are structural source maps: they answer what exists and what depends
on what, and by themselves they do not explain behavior. Automatic
whole-repository function call-graphs and edge-dense mega-diagrams remain OUT
(see "Out of designed scope" in VISION). A small number of bounded,
source-anchored semantic product-flow artifacts — including
component/data-flow, sequence, or state diagrams synthesized as gated batch
artifacts — are IN when they satisfy §"Semantic product-flow layer".
Generators deduplicate node/edge declarations and keep same-named classes from
different source files distinct. Class-diagram links are emitted only when the
diagram file exists. `verify` checks navigable `.md` and `.mmd` targets while
ignoring link-shaped examples inside Markdown code. Generator tests parse their
output with the real Mermaid parser; parser packages remain development-only.

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
