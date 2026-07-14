# Clean v8 — FAIL (infrastructure, pre-wire)

## Identity

- Base commit: `300e98e787f4b4faa019edec3380a8ff5d505fc4`
- Short: `300e98e` — `docs(benchmark): refresh offline T0 inventory`
- Intended command: `livewiki init --batch --no-refine --json`
- Model / route (intended): MiniMax-M3 via openai-compat → local token-proxy `:8900` → `https://api.minimax.io`
- Thinking: disabled (config)
- Product timeout: default (`timeoutMs` omitted)
- **Paid batch attempts: 0**
- **Proxy started: no**
- **Wire / MiniMax API calls: 0**
- No preflight chat completion, `--only`, resume, replay, retry, or wiki rewrite was used.

## Verdict

**FAIL de infraestrutura** — harness aborted **before** proxy start and **before** any paid call.

Per clean-v8 protocol: when the harness fails before any wire call, preserve the failure and **stop**. No v8b, no second paid attempt.

## What ran

| Step | Result |
|------|--------|
| HEAD confirmation `300e98e` | PASS |
| Tracked working tree clean | PASS |
| Secrets load (env only; value never printed) | PASS (`MINIMAX_API_KEY` present) |
| Port 8900 free | PASS |
| Detached worktree at target SHA | PASS (`livewiki-clean-v8-20260712-180903`) |
| Strip versioned `livewiki/` / `.livewiki/` | PASS |
| `pnpm install --frozen-lockfile --prefer-offline` | **FAIL (exit ≠ 0)** |
| Build CLI / start proxy / batch | **not reached** |

## Root cause

`metrics/pnpm-install.log` shows packages **did** install (`+412` packages, typescript present), but pnpm exited non-zero with:

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.21.5
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

Also non-fatal bin warnings (expected before `cli` build):

```text
[WARN] Failed to create bin ... packages\cli\dist\index.js.EXE
```

The v8 orchestrator treats **any** non-zero `pnpm install` exit as fatal:

```powershell
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
```

The proven v7 harness used `pnpm install --force` and did **not** hard-fail on install exit code, then built with `tsc` directly. That is why v7 succeeded on the same machine policy while this stricter v8 install gate aborted.

Disposable worktree after abort (local only; not required for published evidence):

- Packages on disk: yes (`node_modules` present, typescript installed)
- `esbuild` package present: no (build scripts ignored)
- No `token-proxy-*.json` / no proxy PID / no batch status / no generated wiki

## Harness review (pre-run)

Reviewed untrusted files under `rerun-clean-v8/` before launch:

| File | Assessment |
|------|------------|
| `_orchestrate-v8.ps1` | Structure matches stable v7 pattern (same foreground proxy+batch, port wait, PID check, single attempt, acceptance basename `token-proxy-livewiki-clean-v8.json`). Publish-safe (no secrets source). **Install gate too strict vs v7** (this failure). Notes here-string had PowerShell escaping bugs (fixed below in preserved notes only). |
| `_qualitative-audit.mjs` | Sound static checks for v7 regressions; small hardenings applied pre-run (Important symbols heading, truncation). Never edits wiki. |
| `_combine-gates.mjs` | Combines mechanical + qualitative + stage2/reasoning/proxy accounting. Not reached. |

## Terminal metrics

| Metric | Value |
|--------|------:|
| Product status | not started |
| Final gate | **FAIL** (`metrics/final-gate.json`, kind=`infrastructure_pre_wire`) |
| Qualitative gate | **not run** (no wiki) |
| Mechanical acceptance | **not run** (no wiki / no proxy) |
| Stage-4 tasks | n/a |
| Batch process exit | n/a |
| Wall clock (orchestrator start → terminal fail) | **~7.6 s** (18:09:03.4 → 18:09:11.1) |
| Proxy calls | **0** |
| Prompt / completion / reasoning tokens | **0 / 0 / 0** |
| Verify | not run |
| Harness error | `pnpm install failed` (`ERR_PNPM_IGNORED_BUILDS` esbuild@0.21.5) |

## Mechanical gates (1–20)

All **not evaluated** — product batch never started. Recorded as infrastructure block, not product pass/fail.

## Qualitative review (incl. sampling)

**Not performed on generated wiki** — `livewiki/` does not exist. Required samples (`commands.md`, `tools.md`, core-src with `prompts.ts` / `verify.ts`, `quickstart.md`, `architecture/overview.md`) are absent. This is **not** a qualitative product FAIL; there is no generated corpus to judge.

## Artifacts preserved

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/
  _orchestrate-v8.ps1
  _qualitative-audit.mjs
  _combine-gates.mjs
  notes.md                    # this file
  metrics/
    final-gate.json
    run-meta.txt
    orchestrator.log
    orchestrator-console.log
    pnpm-install.log
```

No `livewiki/`, no proxy metrics, no batch/verify/acceptance/qualitative JSON — correctly, because the paid pipeline never started.

## Secret hygiene and final sanitization

- Key loaded only into the local process environment from the operator secrets file used by prior clean runs (outside the repo).
- Key value never printed, never written to config/wiki/metrics/notes.
- Published harness does **not** source any absolute secrets path (reads `MINIMAX_API_KEY` from caller env only).
- Final scan of all files under `rerun-clean-v8/`:
  - no secret values / `sk-…` keys
  - no Authorization/Bearer **values** (only redaction regex + prose mentioning the words)
  - no `C:\Users\…` absolute paths
  - no raw `AppData\Local\Temp` paths
  - no absolute secrets-file path
  - no absolute clone/worktree path with user home
- Sanitization actions actually applied:
  - `metrics/pnpm-install.log`: absolute temp/worktree paths → `<temporary-directory>\livewiki-clean-v8-20260712-180903\…`
  - `metrics/final-gate.json` + `metrics/run-meta.txt`: written without secrets/paths
  - `notes.md`: rewritten with factual infrastructure FAIL (no key material)
- **Not altered to flip outcome:** no wiki (none existed), no token totals, no batch status. Result remains FAIL.

## Explicit non-actions (protocol)

- Did **not** start proxy.
- Did **not** run `livewiki init --batch`.
- Did **not** issue any MiniMax chat/completions call.
- Did **not** create v8b or retry the paid batch.
- Did **not** touch `rerun-clean-v2` … `v7`, `.codegraph/`, or product code.
- Did **not** edit `docs/BENCHMARK.md` or claim any winner.

## What a future authorized attempt would need

1. Fix harness install step (e.g. match v7: do not abort solely on `ERR_PNPM_IGNORED_BUILDS` when the tree is usable; or pre-approve esbuild builds; or `pnpm install --force` + explicit `tsc` build as in v7).
2. Avoid Tee-Object lock on files the orchestrator also rewrites during sanitize.
3. Re-run **one** clean attempt from empty v8 metrics/wiki with the same base commit — only with maintainer authorization after this infrastructure FAIL.

This artifact is a **pre-wire infrastructure FAIL**, not a product quality FAIL and not a MiniMax/model FAIL.
