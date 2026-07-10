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
