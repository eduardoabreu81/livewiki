# MiniMax-M3 livewiki rerun (post U–X)

> Status: **ready to execute when the maintainer authorizes a paid run**.
> This file is the runbook only. Do **not** claim a public winner until
> quality review of both outputs is done.

## Why

The frozen baseline (`raw/`) measured livewiki **before** Batch Resilience
U–X. That run was a **failed** equivalent output (module-ID collisions,
reasoning-only pages marked done, overwrites). Token totals (~102k) are
evidence of efficiency *potential*, not completed documentation cost.

After U–X (`b132c73` + `5fb9f81` on `main`), rerun **livewiki only** against
the same MiniMax-M3 route and the same code snapshot family, then compare
to the preserved OpenWiki output under `raw/openwiki/`.

## Immutable evidence (do not edit)

```text
docs/benchmarks/2026-07-10-minimax-m3/raw/
  metrics/livewiki.json          # baseline tally (failed run)
  metrics/openwiki.json
  livewiki/                      # baseline wiki pages
  openwiki/                      # baseline OpenWiki pages + side effects
  metrics/*-proxy.log            # may be local-only / gitignored
```

Snapshot note from handoff:

- livewiki repo commit at baseline: `04d6198`
- OpenWiki target was a temp git repo at `02436b0` (message: snapshot of `04d6198`)

## Instrument

Use the upgraded proxy:

```text
docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs
```

Per call it records: timestamps, duration, HTTP status, stream flag, model,
prompt/completion/total tokens, cached prompt tokens (when present),
reasoning tokens (when present), and errors. Summary JSON + JSONL.

### Start proxy (example)

```powershell
$out = "docs/benchmarks/2026-07-10-minimax-m3/rerun/metrics"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$env:LIVEWIKI_PROXY_OUT_DIR = (Resolve-Path $out).Path
$env:LIVEWIKI_PROXY_PORT = "8900"
$env:LIVEWIKI_PROXY_UPSTREAM = "https://api.minimax.io"
# Optional: pin label
node docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs livewiki-ux-rerun
```

Confirm port 8900 is free before start. Stop the previous proxy if any.

## Target tree

1. Work on a **clean throwaway clone or worktree** of livewiki at the commit
   under test (prefer current `main` with U–X, or pin an explicit SHA).
2. Do **not** write into the immutable `raw/` tree.
3. Suggested output root:

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun/
  metrics/
    token-proxy-livewiki-ux-rerun.json
    token-proxy-livewiki-ux-rerun.jsonl
    livewiki-config.json
    batch-status.json          # if captured
  livewiki/                    # copy of generated wiki after run
  notes.md                     # wall time, exit codes, anomalies
```

## livewiki config (same model route as baseline)

Baseline config shape:

```json
{
  "provider": "openai-compat",
  "model": "MiniMax-M3",
  "language": "en",
  "baseUrl": "http://127.0.0.1:8900/v1"
}
```

API key **only** via env (`OPENAI_API_KEY` or whatever the openai-compat
adapter expects for MiniMax). Never commit keys. Do not read
`bench-secrets.ps1` into the repo log.

Optional U–X knobs (document if non-default):

```json
{
  "maxRepairAttempts": 2
}
```

## Run sequence (livewiki only)

```powershell
# From the throwaway target repo root (instrumented tree):
# 1) proxy already listening on 8900
# 2) write .livewiki/config.json as above
# 3) ensure OPENAI_API_KEY (or MiniMax key mapped for openai-compat) is set

pnpm --filter @livewiki/cli exec node dist/index.js init --batch --repo .
# or: npx / pnpm livewiki init --batch  depending on install path

# Capture exit code, wall clock, and:
pnpm --filter @livewiki/cli exec node dist/index.js batch status --json --repo .
pnpm --filter @livewiki/cli exec node dist/index.js verify --json --repo .
```

Copy `livewiki/` (generated wiki) and proxy outputs into `rerun/`.

## Acceptance checks (before any comparison claim)

| Check | Pass criterion |
|---|---|
| Module IDs | One task / one page per unique path group; no single `src.md` overwrite storm |
| Batch status | Prefer `completed` or documented `completed_with_failures`; never silent success with empty pages |
| Verify | Prefer exit 0 and zero error-level issues; list any remaining |
| Ownership | No rewrite of `owner: human`; mixed keeps manuals + `owner: mixed` if exercised |
| Proxy | `calls` ≥ 1; JSONL has per-call status/timestamps; errors logged if any |
| Side effects | livewiki must not write outside allowlist (`livewiki/`, `.livewiki/`) |

## Comparison dimensions (vs frozen OpenWiki)

1. **Completion** — did livewiki finish with a coherent wiki?
2. **Quality** — factual sample vs code; broken anchors; structure
3. **Side effects** — OpenWiki baseline modified `AGENTS.md` and created
   `.github/`; livewiki must not
4. **Time** — wall clock
5. **Tokens** — proxy totals + per-call breakdown (include cache/reasoning
   when present)

**Do not** publish a “winner” line until both sides have a written quality
review. Baseline raw ratio (~134×) is invalid until livewiki completes an
equivalent run.

## Explicit non-goals for this rerun

- Do not re-run OpenWiki (preserve baseline).
- Do not mutate `raw/`.
- Do not spend paid quota without maintainer OK.
- Do not update `docs/BENCHMARK.md` with a ranking until review.

## Sign-off

| Step | Owner | Done |
|---|---|---|
| Proxy upgraded | engineering | yes (this tree) |
| Maintainer authorizes paid MiniMax call | Eduardo | pending |
| Rerun executed + artifacts under `rerun/` | engineering | pending |
| Quality review vs `raw/openwiki/` | reviewer | pending |
| Optional note in BENCHMARK / results folder | maintainer | pending |
