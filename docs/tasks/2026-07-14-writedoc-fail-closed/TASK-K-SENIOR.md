# Lot K — write_doc fails closed when verify crashes (SENIOR)

**Date:** 2026-07-14
**Base commit:** `b321300` (HEAD = origin/main)
**Origin:** independent quality review of clean v18
(`docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`, findings
L6/O5) — read-only evidence; never modify anything under
`docs/benchmarks/`.

## Root cause (code-confirmed by the lead)

`packages/mcp/src/server.ts:231-237` (`livewiki_write_doc`): when the
post-write `runVerify` call THROWS (as opposed to reporting issues), the
tool KEEPS the file it just wrote and returns a plain `textResult`
(`"wrote <path> (verify step crashed: ...)"`) — not an error result. Three
defects:

1. **Fail-open:** an unverified page persists on disk, breaking the
   product's core promise (write_doc success ⇒ the page passed verify).
2. **Misleading result:** the response is not `isError`, so an MCP client
   treats it as success.
3. **Inconsistent state:** the early return also skips the FTS5
   `indexPage` call, so the kept page is invisible to `livewiki_search`.

The in-code justification ("verify may crash due to corrupted DB") is
stale: verify parses the wiki fresh from disk precisely so it does not
depend on the index DB.

## Frozen design (do not deviate)

On a verify CRASH (exception from `runVerify`), `write_doc` behaves like a
verify REJECTION:

1. Attempt rollback (unlink via the same safe-io-validated path used by
   the rejection branch).
2. Return `errorResult` (isError=true) stating verify crashed, including
   the crash message (content-safe — never the page content), and that the
   page was NOT kept.
3. If rollback itself fails, still return `errorResult`, stating the disk
   may hold an UNVERIFIED page at `<path>` and the operator must inspect —
   mirror the severity language of the batch `rollback_failed` handling.
4. Never call `indexPage` on any failure path (already true — keep it
   true).
5. `skipVerify` semantics unchanged. Verify-rejection branch unchanged.
   Allowlist/path error handling unchanged.

## Deliverables

### K1. SPEC.md delta (before code)

The write_doc guarantee, stated affirmatively: a successful (non-error)
`livewiki_write_doc` result means the page was written AND passed verify —
or `skipVerify: true` was explicitly requested. Any verify failure,
including a crash of the verifier itself, leaves no page behind
(best-effort rollback; a failed rollback is reported as an error naming
the suspect path).

### K2. `packages/mcp/src/server.ts`

Per the frozen design. Extract the rollback into a small helper if that
avoids duplicating the unlink logic between the rejection and crash
branches.

### K3. Tests (`packages/mcp/src/server.test.ts`)

Follow the existing InMemoryTransport E2E pattern. Add scenarios:

1. Verify crash → response `isError: true`, message mentions the crash and
   that the page was not kept; the file does NOT exist afterwards; a
   subsequent `livewiki_search` for the page's content returns nothing.
   (Induce the crash through a controllable seam — e.g., dependency
   injection of the verify function or a filesystem fixture that makes
   verify throw; do NOT weaken production code to create the seam beyond
   accepting an injectable verify hook if needed.)
2. Verify crash + rollback failure (e.g., file removed/locked by the test
   between write and rollback, or injected unlink failure) → `isError:
   true`, message names the path and says the page may remain UNVERIFIED.
3. Existing scenarios (verify rejection rollback, skipVerify escape hatch,
   successful verified write + FTS index) remain green and unchanged in
   meaning.
4. Windows note from AGENTS.md: close the server before cleanup (EBUSY).

## Non-negotiable rules

No paid API calls; no commits/pushes; English durable text; never touch
`docs/benchmarks/**`, `.claude/`, `.codegraph/`; never `git clean -fdx`.
Changes ONLY in: `SPEC.md`, `packages/mcp/src/server.ts`,
`packages/mcp/src/server.test.ts` (and a minimal injectable seam in the
server factory if strictly required for test 1).

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/mcp test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```
