# livewiki — Product Vision

> Founding document. Defines what livewiki is, why it exists, and the design
> decisions already made. The executable MVP spec lives in [SPEC.md](SPEC.md).
> All durable product artifacts are in English: source code and identifiers,
> comments, tests, CLI/UI text, templates, internal documentation, and
> user-facing livewiki documentation. The maintainers' working conversation may
> be in PT-BR. Existing PT-BR artifacts are migration debt for a dedicated final
> language-normalization pass; new work must not add to that debt.

## What it is

**livewiki** is an open-source **living repository documentation** tool: a
markdown wiki, versioned inside the repo itself, that stays consistent with the
code through a structural index — and that serves as external memory for any
LLM (or human) to pick up work where the previous session left off.

Elevator pitch: *"documentation anchored to the code, verifiable and always
current — written by whoever made the change, at the moment they made it."*

**Two content layers (direction):** (A) structural wiki for agents — directories,
symbols, import links, verifiable anchors; (B) later human/product narrative
(what the project enables, stack, dashboards) generated from A. Layer A is
the MVP engine; B is a subsequent pass so human-written repos with zero docs
still get a map first, then a story.

## The problem

1. **Documentation rots.** Every repo wiki is out of date three months later.
   Existing tools regenerate everything via LLM (expensive) or fail to detect
   what became stale.
2. **Handoff between LLMs loses context.** One agent's quota/session runs out,
   and the next starts from scratch or swallows 200KB of context.
3. **LLMs hallucinate documentation.** LLM-generated docs cite functions that
   don't exist or behavior the code doesn't have, and nobody verifies it.
4. **Token cost.** Dumping the whole repo into context to document (or to resume
   work) is the dominant anti-pattern.

## The empty quadrant (positioning)

| Project | Structure (AST) | Content (docs) | Real-time | Publishing | Handoff |
|---|---|---|---|---|---|
| codegraph | ✅ mature | ❌ | ✅ watcher | ❌ | partial |
| OpenWiki (LangChain) | ❌ | ✅ | ❌ (git diff) | optional | ✅ |
| CodeWiki (Google) | ❌ | ✅ | partial | ✅ cloud | ❌ |
| DeepWiki (Cognition) | ❌ | ✅ | ❌ | ✅ cloud | ❌ |
| agentmemory | ❌ | ❌ (memory) | ✅ hooks | ❌ | ✅ |
| **livewiki** | **✅ (narrow)** | **✅** | **✅** | **✅ (phase 6)** | **✅** |

The technical differentiator no competitor has: **staleness detected at the
section level, without spending an LLM token** — via anchors between docs and
code symbols.

## Non-negotiable principles

1. **Safe by architecture**: livewiki NEVER writes outside `livewiki/` (the wiki)
   and `.livewiki/` (internal state). Path allowlist enforced in code, not a
   prompt promise.
2. **Economical**: the LLM only steps in to *write* docs, never to *discover*
   what is stale. Debt detection is deterministic (tree-sitter + hashes).
3. **Tool-agnostic**: plain markdown as the source of truth. Any LLM reads it,
   any editor opens it, `grep` works. Nothing proprietary.
4. **Local-first**: zero mandatory cloud. Everything runs on the user's machine.
5. **Rebuildable**: the database is a derived index. Deleted `.livewiki/`?
   `reindex` rebuilds everything from the repo + wiki. The DB is never the
   source of truth.
6. **Self-contained**: livewiki may learn from other products, but selected
   capabilities are implemented inside livewiki. The core workflow never
   requires another agent framework, MCP server, code-intelligence service,
   hosted workflow product, or third-party app. LLM providers, MCP clients, Git
   hosts, and editors are optional surfaces chosen by the user, not runtime
   dependencies of the product.

## Key concepts

### Anchors
Each wiki page/section declares which code symbols it refers to
(e.g. `src/auth/login.ts#validateToken`). The index records the symbol's hash
*at the moment it was documented*.

### Documentation debt (doc debt)
When code changes, the indexer (deterministic, milliseconds) compares hashes and
produces events: `changed`, `moved`, `deleted`, `new`. Every section anchored to
an affected symbol becomes **debt** recorded in a ledger. Debt is visible
(`livewiki status`), accumulable, and paid off when the agent/user decides.

### Anti-hallucination verification
When an LLM writes/updates docs, `livewiki verify` checks: do the cited anchors
exist? Do the signatures match? Docs referencing nonexistent code are
rejected/flagged.

### Human content is first-class (ownership)
The wiki is not the tool's exclusive territory. The dev freely creates and edits
pages — business vision, product context, decisions. Each page declares
ownership (`owner: generated | human | mixed`; `lw:manual` blocks in mixed
pages), and the rule is hard: **the LLM never rewrites human content** (enforced
by `verify`, not by convention). And business docs can have anchors too: a page
with `owner: human` anchored to the function that implements a rule enters debt
when the code changes — but instead of being rewritten, it is **flagged for
human review**. Business↔code traceability for free.

### Handoff
The wiki + the versioned manifest (`livewiki/.manifest.json`) are the state that
travels in git. The next LLM on any machine: reads the quickstart (low token),
consults the debt, rebuilds the index locally if needed, and continues —
including resuming a batch documentation process interrupted midway.

## Three-layer architecture

```
user-repo/
├── livewiki/                  # 1. WIKI — markdown, versioned. THE TRUTH.
│   ├── .manifest.json         #    last documented commit + snapshot hash
│   ├── quickstart.md          #    low-token entry point for agents
│   ├── architecture/          #    overview, modules, diagrams
│   ├── files/                 #    per-file/module docs (with anchors)
│   └── decisions/             #    narrative changelog (handoff between sessions)
├── .livewiki/                 # 2. INDEX — SQLite, gitignored. DERIVED.
│   └── index.db               #    symbols, hashes, anchors, debt, pipeline
└── AGENTS.md / CLAUDE.md      # 3. POINTER — 1 paragraph pointing to the wiki
                               #    (added ONLY with explicit consent)
```

## Operating modes

### Incremental mode (the heart)
On closing a commit/task, a hook runs the staleness check (no LLM). If there is
debt, the **in-session agent** is notified and documents what it just did itself
— fresh context, zero extra API cost, maximum quality. Opt-in per event: the
agent/user can defer; the debt stays in the ledger.

### Batch mode (full documentation)
`livewiki init` documents an existing repo through a 4-stage pipeline with
checkpoints: **scan → module identification → prioritization → coordinated
documentation**. Each doc unit is a resumable task: if the quota runs out
midway, the next LLM continues from task 24/61. Who generates the docs in this
mode: an LLM via configurable API (Anthropic/OpenAI-compatible) OR the in-session
agent itself working the queue through livewiki's CLI, MCP tools, or skills.

## Surfaces (one core, four faces)

| Surface | Role |
|---|---|
| **CLI** | `init`, `index`, `status`, `update`, `verify`, `serve`, `export` |
| **MCP server** | wiki read/search tools, debt queries, writes restricted to `livewiki/` |
| **Skills** | teach the agent the flow: "finished a task → check debt → document" |
| **Hooks** | ready-made templates: git post-commit + agent hooks (Claude Code, etc.) |

## Native capability boundary

External projects are design references only. When a pattern fits livewiki, it
is reproduced in the product's own core and exposed through its existing
surfaces. In particular:

- the local structural index remains persistent, incremental, and rebuildable;
- agents receive compact, bounded change context instead of reading the whole
  repository;
- documentation relevance is decided deterministically from anchors and debt
  before any optional LLM call;
- CLI, MCP, and skills expose the same underlying operations rather than
  requiring a second memory or code-intelligence tool;
- automated workflows separate generation from a narrow validated write/action
  boundary; and
- Git-host automation creates reviewable draft changes and preserves human
  approval rather than granting an agent unrestricted write or merge access.

This boundary deliberately does not turn livewiki into a general-purpose code
graph database. It implements the structural intelligence needed to create,
maintain, verify, navigate, and hand off documentation.

## Decisions made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| MVP primary consumer | **Agent** (handoff + economy) | empty market quadrant; human export is a later transformation |
| Stack | **TypeScript/Node** | first-class MCP ecosystem; `npx` = zero friction; one codebase, four surfaces |
| Parsing | **web-tree-sitter (WASM)** | multi-language without native compilation; runs smoothly on Windows/Mac/Linux |
| Indexer | **own, documentation-focused** | implement the structural context and change-impact capabilities documentation needs; external graph tools are references, never dependencies |
| Source of truth | **versioned markdown** | tool-agnostic, git-diff friendly, survives any tool |
| Index | **gitignored SQLite, derived** | queryable, fast, rebuildable; never travels in git |
| Cross-machine handoff | **versioned JSON manifest** | small, travels in git; the DB rebuilds locally |
| Who generates docs | **in-session agent (heart) + API (batch)** | whoever made the change documents best and for free; API covers legacy repos |
| Staleness detection | **deterministic, no LLM** | radical economy: the LLM only writes, never searches |
| Name | **livewiki** | available on npm (verified 2026-07-08); `@livewiki/` scope for packages |

## Post-MVP already designed (SPEC phases 6 and 7)

- **Export to repository wiki** (`livewiki export`): GitHub wiki, GitLab wiki,
  and any host compatible with the format (git markdown repo). Lossy, one-way
  transformation: flattens the namespace, rewrites links, strips anchor markers,
  adds a "generated by livewiki" notice. The source of truth stays `livewiki/`
  in the repo — the published wiki is a generated product.
- **Local viewer with templates** (`livewiki view`): self-contained static site
  (opens in the browser with no server or build), with navigation, client-side
  search, and rendered Mermaid. Templates are **data** (layout + CSS + manifest),
  never executable code — security first. Template MVP: `agent` (dense,
  technical) and `docs` (clean, for humans). The community contributes more.

## Product roadmap (post-validation)

- **Local web dashboard (Phase 8)**: kanban of the debt ledger (detected → in
  progress → paid → human review), real-time batch progress, and settings
  (provider/model/language). Built 100% on the `--json` contracts that already
  exist — no upfront work needed; `livewiki status` is the MVP dashboard, and the
  viewer's "Status" page (Phase 7) is the middle ground.
- **`livewiki compare` (post-MVP)**: run the same repo with N models and compare
  by objective metrics the product already produces (verify pass rate, anchor
  coverage, remaining undocumented, **tokens as the primary metric**; USD only as
  a secondary estimate — price varies by route/credits). Costs N× tokens.
- **Public multi-LLM benchmark (validation/launch)**: we run the compare on real
  repos and publish the table — the product's "real-world stamp", alongside the
  token comparison vs OpenWiki.

### User-informed backlog (mined from OpenWiki issues + ecosystem scan — see [docs/market-research.md](docs/market-research.md))

- **Monorepo support** (their 2nd most-upvoted request): per-package scoping vs
  a single wiki with package sections — deserves explicit design.
- **File-level anchoring for unparsed text files** (Terraform/HCL pain): unknown
  *text* files become anchorable at file level (no symbols) — documentable and
  hash-tracked without a parser; plus demand-driven grammar expansion.
- **`HTTP_PROXY`/`HTTPS_PROXY` support** in the LLM client (corporate environments).
- **Configurable wiki directory** (evaluate carefully — touches the safe-io allowlist).
- **Native CI / PR workflow**: an optional GitHub Actions template runs livewiki
  itself — deterministic `index` + debt gate, optional standalone generation,
  validation, and a draft docs PR. It does not require GitHub Agentic Workflows,
  a separate GitHub App, or an external memory/code-intelligence service.
- **Adapter hardening**: tolerate DeepSeek-style reasoning blocks in
  OpenAI-compat message history (becomes an adapter test).
- **`openwiki/` format bridge (hypothesis, not decided)**: the OpenWiki on-disk
  layout is becoming a de-facto convention (two independent adopters in a week);
  an `export openwiki-compat` and/or an `import` of existing `openwiki/` folders
  would be a painless on-ramp for that user base. Post-MVP evaluation.

## Integration roadmap (post-validation)

Launch goal: a "works with every agent" matrix (reference: agentmemory). The
trick: these are NOT N engineering efforts — it's a 4-tier architecture, and the
matrix is packaging + per-tool docs:

| Tier | Delivery | Cost | Covers |
|---|---|---|---|
| 1 — MCP server | Phase 4 | per-tool config snippet (docs) | Cursor, Cline, Goose, Kilo Code, Roo Code, Windsurf, Claude Desktop, Gemini CLI, Copilot CLI, any MCP client |
| 2 — Hooks + skills | Phase 5 | per-tool template | Claude Code ("native plugin" level), OpenCode, Codex CLI, OpenHands (plugin + skill system) |
| 3 — CLI | already exists | zero | Warp, CI, scripts, any agent with a shell |
| 4 — REST API | post-MVP, thin wrapper over the core | small | Aider and HTTP-only agents |

Dedicated install plugins (register the MCP server + install skills/hooks +
opt-in pointer): **Claude Code, Codex, and Hermes** first; others as traction
justifies. The default LLM model stays open — the config ships ready for the
market's providers (presets in the SPEC), the user chooses.

## Out of designed scope (evaluate later)

- Local embeddings + semantic search (pluggable)
- General-purpose function call-graph databases, graph query languages, and
  dead-code analysis. Documentation-focused impact neighborhoods may be
  implemented natively when required; sequence diagrams require LLM
  interpretation and remain an optional batch extra, never automatic truth.
  Note: structure, module dependencies, and classes ALREADY ship deterministic
  in Phase 3 — see SPEC.
- README generated from the wiki
- Simultaneous multilingual wikis (N synced languages) — each change would become
  N debts and `verify` can't check semantic equivalence across languages; if it
  ever ships, it must be **optional**, with an explicit user warning that
  maintenance cost and token usage grow with each concurrent language, and it
  should remain a one-way translated export (Phase 6+) rather than N sources of
  truth. **MVP today:** single configurable language per repo (`language` in
  config, default `en` / en-US). The user chooses the language when documenting;
  generated pages stay in that language (sticky) — livewiki does not rewrite
  prose into another language on later runs unless the user deliberately
  regenerates with a new setting.
- Final distribution (public npm, binary) — decide at validation

## Open decisions

1. **License** (MIT vs Apache-2.0) — decide before public release.
2. **"Validated" criterion for open-sourcing** — proposal: run cleanly on 3+ of
   Eduardo's real repos + 1 large external repo, with debt detected correctly and
   handoff genuinely exercised between 2 different LLMs.
3. **Languages supported in the MVP** — proposal: TS/JS, Python (loadable WASM
   grammars; adding a language = adding a grammar).
4. **Anchor granularity, per-section vs per-page** — MVP implements both
   (frontmatter = page; HTML marker = section), evaluate in practice.
