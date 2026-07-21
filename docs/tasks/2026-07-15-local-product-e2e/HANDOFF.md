# Local Product E2E Handoff

Date: 2026-07-15  
Status: ready for the next local product flow  
Next owner: coordinator in a fresh conversation window

## Maintainer objective

Livewiki must first work as a simple product, one user flow at a time. A user
should be able to invoke the CLI, MCP server, or packaged skill from an active
development LLM, or configure a provider key for a standalone run. GitHub,
remote CI, benchmarks, and publication evidence come after the local product
flows work.

The long-term output remains agent-facing documentation plus an optional
human-facing navigable knowledge base with technical definitions and Mermaid
flows. Ideas from GitHub Agentic Workflows, codebase-memory-mcp, CodeGraph, or
other products may inform livewiki, but livewiki must implement adopted ideas
natively and must not depend on those external products at runtime.

## Non-negotiable execution rules

1. Validate one real user flow at a time. Do not bundle platform, CI,
   documentation migration, benchmark, or release work into it.
2. Prefer a simple product command over a harness. Harnesses are only for an
   explicitly authorized benchmark or publication audit.
3. No paid/provider call without explicit maintainer approval.
4. The external executor leaves work uncommitted and unpushed. The coordinator
   reviews first; commit/push is a later, separate authorization.
5. GitHub Actions is not a debugger. Do not push incremental hypotheses merely
   to discover the next failure.
6. A passing manual product check creates no new durable test. A confirmed bug
   may receive one minimal regression test; exploratory tests and fixtures are
   deleted before handoff.
7. All durable repository text is English. PT-BR is only for conversation with
   the maintainer; existing PT-BR debt waits for the dedicated final pass.
8. Never touch `docs/benchmarks/**`, `.claude/`, `.codegraph/`, or reviewer
   changes outside the active scope. Never run `git clean`.

## Confirmed current functionality

### Core documentation pipeline

Phases 0–5 are on main. The clean v18 MiniMax run at commit `572b8a3` passed
13/13 modules, verified 427/427 symbols with zero issues, and recorded exact
accounting. That evidence remains valid; no further benchmark run is planned
unless a focused product defect requires reproduction.

This proves the pipeline has worked with a real provider. It does not replace
the next goal: validate the current user experience on the current code with a
small, understandable local repository and simple commands.

### Repository ignores

Commit `f904f6a` propagates `.livewiki/config.json` ignores through the
documentation flows and CLI index path. The change is on main.

### Deterministic generic export

Phase 6 Lot 6A is on main at commit `75cd004`. On 2026-07-15, the current built
CLI was run against a disposable Windows repository:

```text
node packages/cli/dist/index.js --repo C:\tmp\livewiki-export-demo export generic
```

Observed first run:

```text
livewiki export generic: 3 written, 0 removed, 0 issue(s)
exit 0
```

Observed second run:

```text
livewiki export generic: 0 written, 0 removed, 0 issue(s)
exit 0
```

The output contained the expected three pages. Internal links and Mermaid were
exported correctly; `anchors` metadata was removed; other frontmatter and the
`lw:manual` block were preserved; durable paths used forward slashes; source
files were unchanged; all destination SHA-256 hashes matched across runs. No
product bug or code correction was required.

## Deferred work — do not start next

The cross-platform workflow was pushed too early and then used as an iterative
debugger. Runs `29438763571`, `29441166630`, and `29445115951` are not green.
Known observations include workspace-bin timing, unsupported/EOL Node 20 native
dependency behavior, and a macOS `/var` versus `/private/var` realpath mismatch.

These observations are preserved for a later bounded platform-validation lot.
Do not repair the workflow, change the Node contract, or modify `safe-io` in the
next task. An uncommitted seven-file attempt covering those subjects was
discarded during this handoff to restore the committed baseline.

The untracked v21 benchmark metrics and notes are reviewer evidence. Leave them
untouched and untracked.

## Next task: one agent-assisted local E2E

Use a small disposable existing TypeScript repository. Exercise the mode in
which the active development LLM uses livewiki's packaged CLI, MCP surface, or
document-as-you-go skill. Do not configure a standalone provider and do not
make a paid call.

Target flow:

```text
existing TypeScript repository
    -> livewiki init
    -> development LLM documents through CLI/MCP/skill
    -> livewiki verify
    -> livewiki status
    -> livewiki export generic
```

Acceptance criteria:

- user-facing commands are short and understandable;
- source code remains unchanged;
- generated documentation is useful and grounded in the sample source;
- `verify` exits zero with zero errors;
- `status` reports no open documentation debt;
- `export generic` exits zero and a second run is byte-identical;
- no new test, provider call, GitHub action, commit, or push occurs;
- if a real defect appears, stop at that defect, make the smallest scoped
  correction, rerun the same scenario, and report before expanding scope.

After this flow passes, stop. The maintainer chooses the next flow.

## Clean-start expectation

At handoff completion, tracked files should contain only this documentation
update. `git status --short` may still show the two pre-existing untracked v21
benchmark evidence entries; they are intentionally preserved.
