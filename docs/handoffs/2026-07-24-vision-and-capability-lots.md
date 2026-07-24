# Handover — session 2026-07-23/24: vision alignment + capability lots (Etapas 0–2b)

Date: 2026-07-24
Branch: `main` @ `8101d11` (5 commits this session, **not pushed**)
Working tree: clean except pre-existing untracked benchmark evidence
(`docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v30..v34/`,
`revert-check/`) and the previous session's handoff
(`docs/handoffs/2026-07-23-motor-vs-velocimetro.md`) — both deliberately
left untracked.

## State

- Full gate green: core **1194 passed / 12 skipped** (expected Windows
  symlink skips), CLI **89**, MCP **23**; `pnpm -r build` clean.
- Zero paid LLM calls this entire session. All validation was unit +
  stub-server E2E.
- Schema is now **v6** (`rationales` table). Existing `.livewiki/index.db`
  files migrate idempotently on next `livewiki index`.

## What happened this session (commits)

| Commit | Content |
|---|---|
| `55d87b1` | test(cli): 20s timeout ceiling for `cli-e2e.test.ts` (proven pre-existing flake: ~6 CLI spawns vs 5s budget under `pnpm -r` parallel load; A/B-verified against HEAD) |
| `c7ce149` | **Etapa 1** — tier-2 universal prose floor: walker is denylist-based (any text file indexed; binaries/lockfiles/minified skipped; `livewiki/` always ignored); grammar-less files index with 0 symbols (no parse attempt, no warning); `status` reports `anchored`/`prose` tiers per language; zero-key contract reused; new E2E `cli-batch-e2e-prose-tier.test.ts` |
| `889461d` | docs: VISION amendment — layer-B human wiki is the product destination, agent layer is phase 1; export git-host + viewer promoted to next lots after MVP validation; `docs/plans/2026-07-23-capability-backlog.md` created |
| `7cf15d1` | **Etapa 2a** — closed repair contract: `repair-contract.ts` single source of truth (37 codes; `SUPPORTED_FIXES` per page kind + `UNCLASSIFIED` with reasons; exhaustiveness-tested); `verify_failed` split into the 5 real verify codes; early abort `unrepairable` (zero LLM calls on all-unrepairable sets); topic write-exception aligned with stages 4/5 |
| `8101d11` | **Etapa 2b** — rationale extraction: `extractRationales` (tagged comments WHY/NOTE/HACK/TODO/FIXME + docstrings ≥20 chars, positional attribution, generated-file sniff); `rationales` table; bounded `# Rationale evidence` block in stage-4 + topic prompts (`rationaleMaxChars` default 4000, 0 disables); stub E2E proves the evidence reaches the model |

Strategic context (why): the maintainer re-anchored the product vision —
livewiki must document **any** language (OpenWiki comparison: they get
universal coverage via agentic plain-text reading at ~10× token cost and
zero grounding; livewiki's answer is the two-tier ladder + verify). Three
external code-graph tools were mined for ideas (recorded origin-free in
the capability backlog). Tree-sitter grammars are adaptation, not
authorship (official WASM inventory; tier-1 language = wasm + extension
map + node-type mapping in `symbols.ts`, hours-to-a-day each).

## Next actions (priority order)

1. **Etapa 2c — test-gap signal + risk-weighted debt prioritization**
   (capability backlog item 3): derive test-coverage edges from the
   existing import graph (test file imports module ⇒ coverage edge),
   combine with importer count + git churn into a deterministic risk
   score; rank debts in `status`, order regeneration in `update`. No LLM.
   Start with plan mode; investigate `status.ts`, `update.ts`,
   `modules.ts`, `imports.ts`.
2. **Etapa 2d — MCP `_hints` workflow-adjacency** (backlog item 4):
   trivial; static next-tool table in `packages/mcp/src/server.ts`
   responses. Good filler for a short window.
3. **Etapa 3 — maintainer decision**: one authorized paid E2E on a real
   multi-language repo (proves tier 2 + rationale end-to-end) OR explicit
   waiver; plus unblocking the deferred cross-platform CI (runs
   `29438763571`+ had macOS path-canonicalization issues — recorded, not
   repaired). No "production/cross-platform" claims until green.
4. **Etapa 4 — human delivery (the vision destination)**: Phase 6 export
   git-host targets (GitHub/GitLab wiki) manual validation; Phase 7
   `livewiki view` static viewer (templates `agent`/`docs`, Mermaid
   render, client-side search).
5. **Etapa 5 — tier-1 language expansion, usage-driven**: grammar
   manifest + regeneration script first; mapping queue from the
   maintainer's real repos (offer: extension-histogram script over local
   clones), then one bounded lot per language. `languages.toml` only
   after the 4th/5th language. CALLS-edge confidence tiers
   (EXTRACTED/INFERRED/AMBIGUOUS) land when call resolution beyond
   imports is designed.

## Rules of engagement (unchanged)

- No paid LLM runs without explicit maintainer authorization (post-v34
  cut). Layered validation: unit → stub E2E → paid only at the end.
- Full gate `pnpm -r test` before any commit; known benign flake is gone
  (timeout fix), so any red is real — investigate, don't retry blindly.
- Never `git clean -fdx`; never push without separate authorization;
  never touch the untracked benchmark evidence or previous handoffs.
- Plan-mode first for each new lot; annotate as-built deviations in the
  plan file (precedent: Etapa 2a plan).
- All durable artifacts in English; PT-BR only in conversation.

## Pointers

- Capability backlog (prioritized ideas, language ladder, grammar
  bundling policy, watch-list, rejected): `docs/plans/2026-07-23-capability-backlog.md`
- Execution sequence (Etapas 0–6 with exit criteria): conversation of
  2026-07-23 — summarized in AGENTS.md Live state entries for Etapas 1/2a/2b.
- Repair contract module: `packages/core/src/repair-contract.ts`
- Rationale extraction: `packages/core/src/symbols.ts:extractRationales`
- Previous session handoff (5 bug fixes, language-coverage gap origin):
  `docs/handoffs/2026-07-23-motor-vs-velocimetro.md`
