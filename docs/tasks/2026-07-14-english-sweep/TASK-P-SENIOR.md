# Lot P — English-only sweep of source code (SENIOR)

**Date:** 2026-07-14
**Starts after Lot O is approved in the working tree.** Does not block the
clean v20 rerun (the prompts sent to the model are already English; the
remaining PT-BR is comments, test names, and some user-facing strings).

## Context

AGENTS.md language policy: **all durable artifacts are English** — docs,
code comments, CLI strings and messages, error messages, commit messages.
PT-BR is conversation-only. Early phases predate the policy; a lead scan
on 2026-07-14 found PT-BR in 40+ of the 99 `.ts` files under
`packages/*/src` (comments, docstrings, test names like
"Cenário 1: editar função ancorada…", and some CLI/error strings).

## Scope

Translate every remaining PT-BR occurrence in `packages/*/src/**/*.ts`
to clear, idiomatic English, in this risk order:

### P1. Comments and docstrings (zero runtime impact)

Straight translation. Preserve technical meaning exactly — several
comments encode review findings and invariants (e.g. "Codex review
(blocker): …"); keep those references intact.

### P2. Test names and descriptions (zero runtime impact)

`describe`/`test`/`it` titles to English. Keep any scenario numbering or
lot letters ("(N)", "(Q)", "Cenário 3" → "Scenario 3") so historical
cross-references in benchmark notes remain traceable.

### P3. User-facing strings (behavioral — highest care)

CLI output, error messages, log lines. For EVERY string changed, update
the asserting test in the same change. Grep the exact old string across
all packages before changing it; a missed assertion is a red gate.

## Explicit exclusions — do NOT touch

- `packages/core/test/fixtures/**` — fixture file **content** feeds
  symbol hashing and anchor ledgers; translating it changes hashes and
  breaks tests. Fixtures stay byte-identical.
- `docs/benchmarks/**` — immutable evidence.
- `docs/tasks/**` — historical task briefs are records; leave them.
- `.claude/`, `.codegraph/`.
- Anything already English.

## Method

1. Inventory first: produce the full list of files+lines with PT-BR
   (accent regex + common-word list) before editing; keep it as your
   working checklist.
2. P1 and P2 in bulk; P3 string-by-string with its tests.
3. No behavior, naming, or structure changes beyond the language of text.
   This lot must be reviewable as "translation only".

## Hard rules

Same as always: no paid API calls; no commits/pushes (lead reviews the
working tree); English durable text; never `git clean -fdx`. Expected
files: any `.ts` under `packages/*/src` except the exclusions above. If a
PT-BR string turns out to be load-bearing beyond language (e.g. parsed,
hashed, or matched elsewhere), stop and ask the lead instead of guessing.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

Plus a final inventory re-scan proving zero remaining PT-BR matches in
`packages/*/src` outside the exclusions.
