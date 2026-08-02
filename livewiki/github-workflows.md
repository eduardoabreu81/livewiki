---
title: Cross-platform CI workflow
owner: generated
anchors: []
---

# Cross-platform CI workflow

This page documents the GitHub Actions workflow that runs the livewiki build, test, and CLI smoke checks across Linux, Windows, and macOS runners on every pull request and push to `main`.

## When to use this page

- **Review** the matrix coverage and step order defined in `.github/workflows/cross-platform-ci.yml` before changing build, test, or install commands in the repo.
- **Debug** a failing CI leg by mapping the failing step name to one of the jobs or matrix axes documented below.
- **Extend** the matrix (for example, to add a new Node.js version or a new runner OS) by editing the `strategy.matrix` block in this workflow.

## How it fits

The workflow lives at the repository path `.github/workflows/cross-platform-ci.yml`, so it is executed by GitHub Actions whenever a contributor opens or updates a pull request, pushes a commit to `main`, or triggers it manually via `workflow_dispatch`. Its job consumes the pnpm workspace defined at the repository root: `pnpm install --frozen-lockfile` and the `pnpm -r build` / `pnpm -r test` commands both rely on the workspace layout that the rest of the livewiki repo declares. The CLI smoke steps at the end of the job exercise the `livewiki` package's executable, so a green CI run implicitly validates that the package's CLI entry point can at least print its help text on each supported platform shell.

## Triggers and permissions

The workflow declares three triggers: `pull_request`, `push` to the `main` branch, and `workflow_dispatch` for manual runs. It requests only `contents: read` permissions, so steps cannot push back to the repository or manage issues from this job.

## Matrix strategy

The single `matrix` job uses a `fail-fast: false` strategy so that one failing leg does not cancel the others. The cartesian product covers three operating systems (`ubuntu-latest`, `windows-latest`, `macos-latest`) against Node.js `20`, with an explicit `include` entry that also runs the matrix on Node.js `24` for `ubuntu-latest` only. The job's display name interpolates `${{ matrix.os }}` and `${{ matrix.node }}` so each leg appears in the GitHub UI as `os / node-XX`.

## Steps

1. **Checkout** — `actions/checkout@v6` clones the repository into the runner.
2. **Setup pnpm** — `pnpm/action-setup@v6` installs the pnpm CLI so the subsequent install, build, and test commands resolve.
3. **Setup Node.js** — `actions/setup-node@v6` installs the matrix's Node version, configures the pnpm cache, and points the cache key at `pnpm-lock.yaml`.
4. **Install dependencies** — runs `pnpm install --frozen-lockfile`, so the lockfile is treated as authoritative and unreviewed drift fails the leg.
5. **Build all packages** — runs `pnpm -r build` across every workspace package.
6. **Run all tests** — runs `pnpm -r test` across every workspace package.
7. **CLI entry-point smoke (default shell)** — runs `pnpm exec livewiki --help` once per matrix leg using the runner's default shell (PowerShell on Windows, Bash on Ubuntu/macOS, per the inline comment).
8. **CLI entry-point smoke (Windows: cmd)** — gated by `if: matrix.os == 'windows-latest'` and forced to `shell: cmd`, re-running the same `pnpm exec livewiki --help` invocation under the Windows `cmd` shell.
9. **CLI entry-point smoke (macOS: zsh)** — gated by `if: matrix.os == 'macos-latest'` and run under `shell: zsh {0}`, re-running the help invocation under the macOS `zsh` shell.

## Visible failure modes

Because `fail-fast: false` is set, a failure on one OS or Node version will not cancel the remaining legs; the full matrix still runs and reports independently. The `--frozen-lockfile` flag on the install step means a stale or out-of-date lockfile causes the install step to fail rather than silently updating it. The two platform-specific smoke steps are gated by `matrix.os` equality checks, so they only execute on their matching runner; on Ubuntu neither the Windows `cmd` step nor the macOS `zsh` step runs at all, and any shell-specific breakage on those runners will only surface on the runner that actually executes them.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
