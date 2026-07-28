# Handover — session 2026-07-25/28: Etapa 3 acceptance, A/B parity, Phase 7, onboarding backlog

Date: 2026-07-28
Branch: `main` @ `6939ad6` (**pushed**, synced with origin/main)
Working tree: clean. Untracked and deliberately LOCAL-ONLY (never stage or
commit): `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v30..v34/` +
`revert-check/`, `docs/handoffs/2026-07-23-motor-vs-velocimetro.md`,
`docs/tasks/2026-07-25-etapa-3-e2e/` (all Etapa 3 evidence),
`.playwright-mcp/`, `view-quickstart.jpg` (maintainer's own screenshot).
**Incident recorded: `git add -A -- docs/` once staged that evidence —
caught pre-push, fixed with `reset --soft` + `restore --staged`. NEVER
`-A` evidence-bearing paths; stage explicit files.**

## State

- Full gate green: core **1484 passed / 12 skipped** (expected Windows
  symlink skips), CLI **111**, MCP **54**; `pnpm -r build` clean.
- 31 commits this session, all pushed (`f2d9fcf` … `6939ad6`).
- Paid LLM spend: 11 MiniMax-M3 E2E runs (~9M tokens total, proxied) +
  6 blind-eval rounds on claude/codex CLI subscriptions. All evidence
  local-only per the maintainer rule recorded 2026-07-26 (`ba3348f`).
- MiniMax key: sourced from `C:\Users\Eduardo\bench-secrets.ps1` (sets
  `MINIMAX_API_KEY` only; map to `OPENAI_API_KEY` for the openai-compat
  path). Never print or persist it.

## What happened (by lot, with commits)

| Lot | Result |
|---|---|
| Etapa 2c/2d (risk ordering, MCP hints) | `f2d9fcf`, `6a4115c` |
| Etapa 3 acceptance E2E (MPTP clone, MiniMax-M3) | run #5 **40/40 exit 0, verify 0 issues** (`a64ad2c`, `b284f27`, `1672ec0` fixes en route) |
| Recovery tier (surgical repair + relaxed round) | `dff180c`; validated live run #6 (1 degraded page instead of hole) |
| A/B cycle vs OpenWiki (6 blind rounds) | gap Δ1.0/1.6 → **Δ0.40/0.45** at ~6–8% token cost; commits `a4a9b02`→`2cca5a4` (orientation, topics, nav+clarity, tuning, refine pin) |
| Phase 6 export targets | 3/3 validated on real corpus |
| Phase 7 viewer + UX/design passes | `ab6ec90`, `9e94114`, `fd55c89` |
| Backlog 1/5/2/3/4 | identifier search `91f3ea7`, `status --diff` `cd1fed8`, impact+freshness `81a501b`, install (13 agents) `1b0be18`+`1421aca` |
| Wrap | PROJECT_LOG entry + backlog sync `6939ad6` |

Key maintainer rulings: `completed_with_failures` is NOT acceptance;
internal test evidence never travels; impeccable is developer-side only
(no flow dependency); mmx is a provider, NOT an MCP host; R11-A kept.

## Next actions (priority order)

1. **Cross-platform CI block** (maintainer-deferred to last): fix macOS
   realpath canonicalization (`/var` vs `/private/var` breaking safe-io in
   tests — hundreds of "failed to create .livewiki/" on macos-latest) and
   the workflow smoke step (`Command "livewiki" not found` on
   ubuntu-latest/node-20). Last failing run: `30213783927`. Rule: NO
   "cross-platform validated" claims until the matrix is green on all
   three OS hosts.
2. **Backlog #6 — GitHub Actions "docs-debt on merge" template** (ROADMAP
   item; same-repo variant can ship first; depends on the CI block for the
   repo's own workflow reality).
3. **Beta**: npm packaging/publish of `@livewiki/{core,cli,mcp}`, then
   launch. A/B comparison material is ready locally
   (`/c/tmp/livewiki-e2e/eval-mptp*/COMPARISON.md`).
4. Watch-list (only with real usage): CALLS-edge confidence tiers,
   community detection, tier-1 language expansion, git-pinned evidence.
   Optional hardening: batch-review/CLI-E2E load flakes (pre-existing,
   pass isolated); voice/subtitle false-claim frontier (app-services-03).

## Rules of engagement (unchanged + new)

- No paid LLM runs without explicit maintainer authorization; layered
  validation unit → stub E2E → paid at the end.
- Full gate `pnpm -r test` before any commit; load flakes are known
  (batch-review 5s, CLI E2E under parallel load) — pass isolated.
- Never `git clean -fdx`; never `-A` stage evidence paths; never push
  without separate authorization; `git commit` messages in English.
- Paid E2E pattern: fresh copy of `/c/tmp/moneyprinter-livewiki` →
  `C:\tmp\livewiki-e2e\2026-07-25-mptp\repo`, proxy `token-proxy.mjs` on
  :8900, ceiling monitor 2.5M, wrapper ps1 sourcing bench-secrets.
- All durable artifacts in English; PT-BR only in conversation.

## Pointers

- Day wrap + synced backlog: `docs/PROJECT_LOG.md` (entry 2026-07-25/28)
- Live state: `AGENTS.md` §"Live state" (Etapa 2c→install registry v2)
- Recovery-tier decisions: `docs/plans/2026-07-26-recovery-tier.md`
- Install registry (13 agents + shapes): `packages/core/src/install.ts`
- A/B comparison evidence (local): `/c/tmp/livewiki-e2e/eval-mptp*/`
- Etapa 3 evidence (local): `docs/tasks/2026-07-25-etapa-3-e2e/RESULTS.md`
