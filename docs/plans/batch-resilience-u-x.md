# Batch Resilience U-X: External Executor Handoff

## Role

You are the implementation executor. The Codex root agent is the technical
manager and independent reviewer. Implement the approved scope below, then
stop and return the diff and test evidence for review.

Do not run paid or network LLM calls. Do not read `bench-secrets.ps1`, expose
API keys, rerun the MiniMax/OpenWiki benchmark, commit, or push.

## Required Reading

Read `AGENTS.md`, `SPEC.md`, and `VISION.md` before changing code. Use
CodeGraph for structural exploration. All durable artifacts, code comments,
messages, tests, and commit text must be in English.

The working tree intentionally contains:

- a proposed, uncommitted `SPEC.md` diff for this task;
- `.codegraph/`, a local structural index; and
- `docs/benchmarks/2026-07-10-minimax-m3/raw/`, the immutable benchmark
  baseline.

Review the SPEC diff before coding. Do not edit or delete the raw benchmark
artifacts. Never run `git clean -fdx`.

## Observed Baseline

The preserved MiniMax-M3 run exposed interacting defects:

1. `buildStage4Prompt` contains the copyable fake anchor example `key1 key2`.
2. MiniMax returned leading `<think>...</think>` reasoning. One response used
   all 4,000 output tokens on reasoning and never produced the final page, but
   the task was marked done.
3. Five directories with the leaf name `src` received the same module ID.
   They reused one `batch_task`, overwrote `livewiki/src.md`, and corrupted
   attempt/failure reporting.
4. Seven stage-4 iterations became only three unique LLM page files. Five
   iterations were reported done and two failed, so the old success count is
   not a valid page count.
5. A verify failure can leave the invalid candidate on disk.

The verifier correctly rejected nonexistent anchors. Do not weaken it.

## Approved Scope

### U. Prompt hardening

- Remove literal fake anchors such as `key1` and `key2`.
- Require exact keys from the supplied closed canonical list.
- Any syntax illustration must use actual supplied keys or prose that cannot
  become a parsed anchor when copied.

### V. Response normalization and artifact validation

Stage-4 accepts a Markdown artifact, not a raw model transcript.

- Remove one complete leading `<think>...</think>` block.
- Treat an unclosed reasoning block or reasoning-only response as invalid; do
  not salvage Markdown embedded inside incomplete reasoning.
- Unwrap one complete outer `markdown` or `md` code fence.
- Require non-empty Markdown beginning with valid frontmatter.
- Require `owner: generated`.
- Reject every page or section anchor outside the module's closed key list.
- Return structured validation codes/details suitable for a repair prompt.
- Keep this stage-specific unless evidence and tests justify changing other
  LLM stages or adapters.

### W. Unique deterministic module identity

- Keep a short leaf ID when it is globally unique.
- For collisions, expand path segments from right to left until each slug is
  unique, such as `core-src`, `cli-src`, and `mcp-src`.
- Resolve normalization collisions deterministically; use a stable path-based
  suffix only if all path segments are insufficient.
- Preserve deterministic ordering and safe filename slugs.
- Add a defensive uniqueness assertion after final module selection and before
  stage-4 task creation, LLM calls, or page writes.
- A duplicate-ID hard failure must return a nonzero terminal run status and
  must not leave the run incorrectly marked `running`.
- One module ID must map to exactly one task target and one page.

### X. Bounded corrective repair

- Make one initial generation call plus `maxRepairAttempts` corrective calls.
- Default `maxRepairAttempts` to `2`; allow a nonnegative integer override in
  `config.json` using the existing config style and through `BatchOptions` for
  tests.
- Give each repair call the structured artifact/verify errors, exact closed
  key list, and bounded prior-candidate context.
- Record exactly one real `usageHistory` entry for every successful LLM
  response, including repairs.
- Never add a duplicate zero-usage record after a response whose usage was
  already recorded. Preserve a no-usage record only when an attempted call
  genuinely returned no result/usage and existing reporting requires it.
- Accumulate repair usage in module, stage, run, token, and cost reports.
- A repaired task is `done` and does not increment circuit-breaker failures.
- Only exhausted repair becomes one final task failure.

## Transactional Safety

Validate artifact shape before writing. For disk-based repository verification:

1. Snapshot the previous page bytes before the first candidate write.
2. Write the normalized candidate through safe I/O while preserving manual
   blocks.
3. Run the existing repository verifier.
4. On failure, restore the previous page byte-for-byte or remove a newly
   created page through safe I/O before retrying or returning failure.

No rejected candidate may remain on disk. Refuse `owner: human` before an LLM
call, and preserve every `lw:manual` block byte-for-byte.

Reuse the MCP rollback approach or extract shared core logic where it removes
real duplication. Do not bypass `safe-io`.

## Likely Code Areas

- `packages/core/src/prompts.ts`
- `packages/core/src/modules.ts`
- `packages/core/src/batch.ts`
- `packages/core/src/batch-state.ts`
- `packages/core/src/config.ts`
- `packages/core/src/safe-io.ts`
- `packages/mcp/src/server.ts` for the existing rollback pattern
- related unit and E2E tests

Use existing repository patterns instead of introducing an agent framework or
new dependency.

## Required Tests

1. Duplicate directory leaves produce deterministic shortest unique IDs;
   unique leaf IDs remain unchanged.
2. A defensive duplicate-ID failure occurs before any stage-4 call/write and
   leaves a terminal nonzero run status.
3. The stage-4 prompt contains no copyable fake anchor.
4. Complete leading reasoning and one outer Markdown fence normalize to the
   final page.
5. Unclosed reasoning, reasoning-only output, missing frontmatter, invalid
   frontmatter, and wrong owner cannot pass as done.
6. An unknown anchor triggers repair; a valid second response completes with
   exactly two real usage entries and no circuit-breaker failure.
7. Exhausting the initial call plus two repairs creates one final failure,
   records three calls, and restores/deletes the rejected page.
8. Human ownership and manual-block protections remain intact.
9. Config default and override validation work.
10. Status and result totals include repair usage without fake duplicate usage.
11. The key-leak regression remains green.

Prefer focused regression tests that reproduce the observed MiniMax shapes,
then run the documented validation workflow:

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e-subdirs.test.ts
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
pnpm --filter @livewiki/mcp test
pnpm --filter @livewiki/mcp test -- src/phase5-e2e.test.ts
```

## Stop Conditions and Deliverable

Do not rerun the paid benchmark. Stop after implementation and local tests.
Return:

- files changed and why;
- exact config and retry semantics;
- rollback and module-ID design;
- tests added plus command results;
- remaining risks or decisions;
- `git diff --stat` and any unrelated pre-existing changes left untouched.

The technical manager will independently inspect the diff, rerun validation,
and decide with the maintainer whether the paid benchmark may proceed.
