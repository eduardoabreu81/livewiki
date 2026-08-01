# Market Research Notes

> Competitive intelligence informing the roadmap. Each section is dated and
> sourced. Items promoted to the roadmap live in [VISION.md](../VISION.md);
> this file keeps the evidence and rationale.

## 2026-07-10 — OpenWiki issue mining (langchain-ai/openwiki)

Method: fetched all issues (open + closed) via GitHub API, ranked by
engagement (reactions + comments). ~27 substantive issues analyzed.
Rationale: OpenWiki's user base already paid the discovery cost — their issues
are free user research for this product category.

### Headline finding

The **most-upvoted issue in the entire tracker** —
[#156](https://github.com/langchain-ai/openwiki/issues/156) (9 reactions) —
asks for an official **"Claude Code mode": running OpenWiki keyless on the host
agent's own inference**. A user independently built a third-party plugin doing
exactly that and is asking LangChain to adopt it. Together with
[#225](https://github.com/langchain-ai/openwiki/issues/225) ("Openwiki Skill"),
the market is explicitly requesting **livewiki's core thesis** (in-session
agent mode via skills/hooks/MCP, zero dedicated API cost) as a bolt-on to a
tool that wasn't designed for it. Use this in launch material.

### Pain points that validate decisions we already shipped

| Their issue | Pain | Our answer (already built) |
|---|---|---|
| [#176](https://github.com/langchain-ai/openwiki/issues/176), [#157](https://github.com/langchain-ai/openwiki/issues/157), [#159](https://github.com/langchain-ai/openwiki/issues/159) | silent fallback to OpenRouter; wrong provider's key demanded | no hardcoded default model; presets as data; clear config errors |
| [#193](https://github.com/langchain-ai/openwiki/issues/193) | "switched model mid-run and spent all my OpenRouter credit" | circuit breaker; token-first accounting; no silent model switching |
| [#223](https://github.com/langchain-ai/openwiki/issues/223) | "don't mess with my home directory" (hardcoded `~/.openwiki`) | everything lives in-repo (`.livewiki/`); home dir never touched |
| [#235](https://github.com/langchain-ai/openwiki/issues/235) | undocumented domains silently dropped | `undocumented` table, visible in `status` |
| [#198](https://github.com/langchain-ai/openwiki/issues/198) | optional Mermaid diagrams requested | deterministic diagrams ship free with `init` |
| [#237](https://github.com/langchain-ai/openwiki/issues/237) | retry/backoff for transient provider errors | built-in, tested |
| [#194](https://github.com/langchain-ai/openwiki/issues/194) | scripts break on Windows | Windows-first from day one |

### Plausible NEW roadmap items (promoted to VISION)

1. **Monorepo support** — [#162](https://github.com/langchain-ai/openwiki/issues/162),
   2nd most upvoted. Directory-based module identification helps but true
   monorepos (workspaces/packages) deserve explicit design: per-package scoping
   vs a single wiki with package sections.
2. **File-level anchoring for unparsed text files** — inspired by
   [#168](https://github.com/langchain-ai/openwiki/issues/168) (Terraform/HCL
   treated as binary). Two-part answer: (a) demand-driven grammar expansion
   (tree-sitter has HCL); (b) smarter: any unknown *text* file becomes
   anchorable at file level (no symbols) — documentable and hash-tracked
   without a parser.
3. **`HTTP_PROXY`/`HTTPS_PROXY` support** in the LLM HTTP client —
   [#222](https://github.com/langchain-ai/openwiki/issues/222). Small; matters
   for corporate environments.
4. **Configurable wiki directory** —
   [#183](https://github.com/langchain-ai/openwiki/issues/183). We hardcode
   `livewiki/`; some users want `docs/wiki`. Evaluate carefully: touches the
   safe-io allowlist.
5. **CI / PR-bot recipe** — [#240](https://github.com/langchain-ai/openwiki/issues/240)
   plus the openhands-autodocs scheduled-automation use case (below): a
   documented GitHub Action that runs `index` + `status`, pays debt via API,
   and opens a docs PR. All the pieces exist (CI-friendly exit codes, verify,
   batch); this is a recipe, not a feature.
6. **Adapter hardening: DeepSeek reasoning blocks** —
   [#231](https://github.com/langchain-ai/openwiki/issues/231). Real-world
   OpenAI-compat quirk that broke them; our openai-compat adapter should
   tolerate reasoning blocks in message history. Becomes an adapter test.

## 2026-07-10 — openhands-autodocs (rajshah4/openhands-autodocs)

Created 2026-07-02 (one week after OpenWiki), 14 stars. An **OpenHands plugin +
skill workflow** that runs docs maintenance **on the host agent's inference**
(no dedicated key), writes **OpenWiki's exact on-disk format** (`openwiki/`,
quickstart, `.last-update.json`, AGENTS.md pointer), and optionally enriches
context with **GitNexus** (a code knowledge graph, cousin of codegraph).
Modes: standard, graph-enriched, planning (plan without writing — equivalent
to our `init --plan`).

### Strategic reading

1. **Strongest validation yet, and an urgency signal.** One week after
   OpenWiki's launch, someone glued together the three pieces we defined in
   VISION: structure (graph) + content (wiki) + in-session execution. The
   quadrant we identified as empty is being invaded by glue projects. The
   window is real but closing.
2. **Our moat is intact and now precisely nameable.** Autodocs uses the graph
   as *evidence for the LLM to read* ("graph-backed module maps ... as
   additional evidence") — the LLM still *discovers* what is stale, paying
   tokens and able to miss. Nobody in this space has: deterministic per-anchor
   debt, anti-hallucination verify, inviolable manual blocks, token-first
   accounting, resumable checkpointed batch, or a code-enforced write
   allowlist. Positioning line: **they use the graph as context; we use it as
   accounting.**
3. **Absorbed into our roadmap**: OpenHands added to the integration matrix
   (tier 2 — plugin + skills system); the scheduled "docs PR bot" use case
   folded into the CI/PR recipe item above.
4. **Ecosystem watchlist**: GitNexus, openhands-autodocs. If the public
   benchmark ever gains a third competitor beyond OpenWiki, it's autodocs.

### Migration-bridge hypothesis (recorded, not decided)

Two independent projects adopting OpenWiki's on-disk format in one week means
`openwiki/` is becoming a de-facto convention. A future
`livewiki export openwiki-compat` (emitting that layout) would make migration
from the existing user base painless — an on-ramp, not a strategy change. The
reverse (an `import` that adopts an existing `openwiki/` folder as seed
content) is worth the same consideration. Post-MVP evaluation.

## 2026-08-01 — Speed-focused scan: DeepWiki, Mintlify repo→docs, DocBot, RepoAgent

Method: maintainer-supplied URLs, fetched and read in full. Focus question:
what can livewiki improve, primarily in **wall-clock time**? Sources:
[deepwiki.directory](https://deepwiki.directory/),
[mintlify.com/blog/auto-generate-docs-from-repos](https://www.mintlify.com/blog/auto-generate-docs-from-repos),
[github.com/marketplace/ai-document-creator](https://github.com/marketplace/ai-document-creator)
(Woden "DocBot"),
[github.com/openbmb/repoagent](https://github.com/openbmb/repoagent).
(A fifth URL, codec8.com, turned out to be an unrelated Kenyan SME
fraud-verification product — excluded.)

### What each one does

- **DeepWiki (Cognition)** — hosted; replace `github.com` with
  `deepwiki.com` and get a wiki + Q&A assistant. Self-reported numbers:
  5–10 min average index time, ~$12 average cost per repo, 30K+ repos
  indexed. No in-repo artifacts, no incremental freshness story, no
  verification contract.
- **Mintlify repo→docs** — sandboxed agent pipeline (Bull/Redis queue,
  Daytona sandboxes, mitmproxy allowlist egress). Pipeline: brand/project
  pre-analysis → **plan-first JSON navigation map** → parallel subagents
  writing one section per navigation tab → orchestrator reconciles
  cross-references → CLI build validation + broken-link check. Parallelism
  cut a large-repo run (Excalidraw) from ~70 to ~45 minutes.
- **DocBot (GitHub Marketplace app)** — docs as a per-PR side effect:
  per-file READMEs, directory summaries, master index, Mermaid, committed
  back into the PR. Runs on GPT-5-mini (70–90% cheaper than frontier
  models) which is what makes a genuinely usable free tier (500K tokens)
  possible. `.github/wai-docbot.yml` config; `/docbot-rerun` comment to
  regenerate.
- **RepoAgent (OpenBMB)** — object-level docs (per function/class) from an
  AST hierarchy with bidirectional call relations; **multi-threaded
  concurrent generation**; `pre-commit` hook that regenerates docs at
  commit time and rewrites the staged files; `repoagent diff` previews
  what will change; GitBook rendering. Python-only, no verification
  contract, no token accounting, hook blocks/rewrites commits.

### The time analysis (headline finding)

livewiki's batch pipeline is **fully sequential**: stage 4 iterates
`tasksToRun` in a single `for` loop (`packages/core/src/batch.ts:726`);
there is no `Promise.all`/concurrency anywhere in the LLM path. Every
competitor that publishes a pipeline either parallelizes generation
(Mintlify, RepoAgent) or amortizes it away (DocBot per-PR, DeepWiki
hosted scale). Meanwhile our own numbers show the quality side is solved
at low cost (Etapa 3 run #5: 40/40, exit 0, verify zero; ~1M tokens ≈
6–8% of OpenWiki) — so **wall-clock is now the weakest axis, not
quality or cost**.

### Candidate improvements, ranked by leverage

1. **Bounded parallel execution of stage-4 tasks** (highest leverage).
   Tasks are already atomic per module (transactional write, per-task
   checkpoint, monotonic usage accounting), so they parallelize cleanly.
   A `batchConcurrency` config key (default 1 = current behavior; 3–5
   typical) would cut wall-clock roughly proportionally. Design care:
   circuit-breaker semantics under interleaved failures, rate-limit
   backoff shared across workers, checkpoint ordering (usage history must
   stay monotonic per task), and deterministic stage-5 input (flows
   consume stage-4 results — keep the barrier between stages).
2. **Model tiering by page kind** (time + cost). DocBot's lesson: a
   cheap/fast model is enough for a large fraction of docs. Auxiliary and
   prose-tier pages could run on a cheaper preset while product modules
   keep the strong model — one extra optional config key per tier. This
   compounds with #1 (cheap models usually have higher rate limits).
3. **Time-to-first-value is already our structural edge — say it.** Our
   deterministic layer (quickstart, tasks, overview, diagrams) renders
   immediately with zero LLM calls; DeepWiki's 5–10 min hosted wait is
   the thing we beat by design. Marketing angle, no code.
4. **Amortized freshness, validated by DocBot** — our hook → debt →
   pay-in-session loop already does what DocBot sells as a hosted app.
   The remaining gap is exactly backlog #6 (docs-debt-on-merge Action);
   DocBot's existence is market evidence for shipping it.
5. **Anti-pattern to avoid (RepoAgent)**: a hook that blocks the commit
   and rewrites staged files. Our post-commit hook never blocks — keep
   it that way; debt is reported, never forced.

### What they do that we should NOT chase

- Object-level (per-function) doc generation (RepoAgent): token-expensive,
  duplicates what anchors + verify already guarantee structurally.
- Hosted Q&A assistant (DeepWiki): out of scope per VISION; our answer is
  the MCP server exposing the wiki to the user's own agent.
- Sandboxed cloud pipeline (Mintlify): contradicts the native, in-repo,
  no-external-dependency rule (rule #8).

## 2026-08-01 — Wiki.js (requarks/wiki) — adjacent platform, not a competitor

Source: [github.com/requarks/wiki](https://github.com/requarks/wiki) +
[js.wiki](https://js.wiki/). Maintainer-supplied URL, same scan as the
speed-focused section above.

### What it is

The leading open-source self-hosted wiki **platform** (AGPLv3, Node.js,
100M+ downloads, 28K+ stars): DB-backed content (PostgreSQL/MySQL/SQLite),
rich admin area, pluggable modules for auth (local/social/LDAP/SAML/OIDC),
editors, rendering, search, and **storage backends — including git**.
50+ integrations. It is an authoring/hosting product for human-written
wikis, not a code-documentation generator: there is no AI, no code
analysis, no staleness model.

### Strategic reading

1. **Different quadrant, complementary not competitive.** Wiki.js answers
   "where does a wiki live and who can edit it"; livewiki answers "how
   does a wiki about code get written and stay true". Zero feature
   overlap on generation, verification, or freshness.
2. **A consumption surface, not a threat.** Wiki.js's git storage module
   syncs a folder of plain Markdown bi-directionally. Our canonical
   `livewiki/` tree is exactly that. A `wikijs` export target (Phase 6
   family, alongside generic/github-wiki/gitlab-wiki) would be near-free
   and puts livewiki content in front of teams already standardized on
   Wiki.js. Recorded as a candidate; not promoted.
3. **Validates decisions we already made.** Their 50+ modules for
   auth/search/storage show the cost of being a *platform*; our scope
   discipline (docs in-repo, consumption via CLI/MCP/export/viewer)
   avoids that entire maintenance surface. Their heavy i18n investment
   validates our cheap per-repo `language` setting as the right scope
   for generated docs.
4. **Licensing caution.** AGPLv3 — never vendor or link their code;
   export-target compatibility must be implemented from their public
   storage-format behavior only (rule #8, native implementation).
5. **On the time axis: nothing to copy.** Generation speed is not their
   problem; setup speed is, and their "running in minutes" bar is one we
   already beat with the deterministic layer rendering before any LLM
   call.

## 2026-08-01 — Graphify (Graphify-Labs) + CodeGraph: graph-speed analysis

Sources: [github.com/Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)
(readme in full) and the project's own CodeGraph analysis (VISION
§"empty quadrant"; `docs/handoffs/2026-07-23-motor-vs-velocimetro.md`).
Trigger question from the maintainer: both map code extremely fast —
would integrating them make livewiki better/faster?

### The settled constraint first

ROADMAP (`docs/ROADMAP.md:220`): runtime dependency on CodeGraph,
codebase-memory-mcp, or any equivalent product is **rejected** —
references inform the design, the shipped capability is native (rule #8).
So "integration" is off the table; the question becomes which techniques
to adopt natively.

### What Graphify is

A `/graphify` skill + CLI that maps a codebase (plus docs/PDFs/media) into
a queryable knowledge graph: tree-sitter AST over ~36 grammars, fully
local and deterministic for code; every edge tagged EXTRACTED vs
INFERRED; Leiden community detection with LLM-free labels; god-node
ranking; `query`/`path`/`explain` against `graph.json`; incremental
`--update`; post-commit auto-rebuild hook; MCP server; optional
`--wiki` markdown output. AST parallelism via `GRAPHIFY_MAX_WORKERS`;
concurrent LLM extraction via `--max-concurrency` with 429/Retry-After
retry handling. No anchors, no verify, no debt model, no anti-hallucination
contract — the `--wiki` output is graph-as-context prose, the exact
autodocs pattern we already positioned against ("they use the graph as
context; we use it as accounting").

### Where their speed would NOT help us

Mapping is not our bottleneck. Our indexer is the same technology family
(tree-sitter + SQLite, zero LLM) and our measured wall-clock is the
sequential stage-4 LLM loop (~27 min/run on MPTP; `batch.ts:726`).
CodeGraph/Graphify mapping speed is irrelevant to that axis.

### Techniques worth adopting natively (indirect time lever)

Better deterministic evidence upstream → fewer LLM attempts downstream:

1. **CALLS edges with confidence tags** — their EXTRACTED/INFERRED split
   is exactly our watch-list item "CALLS-edge confidence tiers". Feeds
   flow/topic candidate detection: fewer false candidates, fewer burned
   repair rounds (the `733fc53` class of bug came from weak graph
   evidence).
2. **Community detection for stage-2 modules** — they ship Leiden
   clustering with deterministic labels; our watch-list item "community
   detection cross-check". Better partitions reduce LLM refine and
   mis-scoped pages.
3. **AST parse parallelism** — `GRAPHIFY_MAX_WORKERS` is prior art for
   parallelizing our initial index (web-tree-sitter WASM, currently
   sequential). Cheap win on large repos, but second-order vs LLM time.
4. **Concurrent LLM extraction with rate-limit discipline** —
   `--max-concurrency` + 429/Retry-After retry is shipped prior art
   validating the `batchConcurrency` design proposed in the 2026-08-01
   speed section above, including the shared-backoff concern.

### Convergent validations (no action)

- Their `# NOTE:`/`# WHY:` rationale nodes = our Etapa 2b `rationales`
  table, built independently. Same evidence channel, same attribution
  idea.
- Their incremental `--update` + post-commit hook = our index/ledger/
  hook loop. Their git-committed `graph.json` with union merge driver is
  the opposite of our rule-3 choice (derived cache never travels) — we
  keep ours.
- Their 20+ platform install matrix mirrors our `livewiki install`
  13-agent registry, including a `--platform kimi` entry.

### Positioning note

CodeGraph and Graphify both occupy "structure ✅, content ❌/unverified".
Graphify's `--wiki` closes the content gap only in the unverified,
graph-as-context sense. Our differentiators remain untouched: anchored
pages, verify, debt ledger, exact token accounting, human-content
protection. Launch framing: **they map the territory fast; we keep the
map true.**

## 2026-08-01 — Codec8 correction (r/SideProject) + thread insights

The codec8.com fetch in the speed-scan section returned an unrelated
Kenyan SME fraud-verification product — the domain no longer (or not yet)
serves the product the maintainer found. The actual product, from its
r/SideProject launch post: **Codec8 connects to GitHub (read-only OAuth)
and one-shot generates README + API docs + Mermaid diagrams + setup
guides in ~30 seconds**, with edit/export/create-PR output. SvelteKit +
Supabase; free tier 1 repo; $99 lifetime deal.

Assessment: a one-shot generator with no freshness model, no verification,
no anchors — the same category as the OpenWiki first run, weaker on
structure. The PR-creation output is the only forward-looking piece and
is covered by our backlog #6 (docs-debt on merge).

Two insights from the thread worth keeping:

1. **"Keeping docs in sync with code changes is where most projects fall
   apart"** — the top comment names staleness, not generation, as the
   real pain. Direct market validation of the debt-ledger thesis; usable
   in launch material.
2. **Social previews for generated docs** — the commenter notes that
   shared doc links would feel more professional with polished
   "Auto-generated docs for [Project]" OG previews. Adopted as roadmap
   item 10(b) (viewer/export OG metadata).
3. Their open question ("is Mermaid inferred from imports/folders or does
   it need comments?") is one we already answer deterministically:
   import-graph diagrams free with `init`, semantic flow diagrams from
   anchored evidence. Another launch-material contrast.
