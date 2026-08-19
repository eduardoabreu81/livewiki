/**
 * Decision table for `reconcilePlan` — the write phase's answer to "what do I
 * do with this plan, given the row that exists RIGHT NOW".
 *
 * These are the cases a concurrent writer creates, expressed directly instead
 * of raced for: the point of extracting the function was that the rule can be
 * asserted without depending on two processes interleaving a certain way. The
 * process-level proof that these rules are the ones actually reached lives in
 * packages/cli/src/cli-concurrency-e2e.test.ts.
 */

import { describe, it, expect } from "vitest";
import { reconcilePlan } from "./indexer.js";
import type { FileRow } from "./db.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function row(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 7,
    path: "src/mod.ts",
    lang: "typescript",
    content_hash: HASH_A,
    size: 100,
    mtime: 1,
    indexed_at: 1,
    status: "active",
    ...overrides,
  } as FileRow;
}

function plan(overrides: Partial<Parameters<typeof reconcilePlan>[0]> = {}) {
  return {
    hash: HASH_A,
    eolMigration: false,
    grammarReprocess: false,
    prevHash: null,
    ...overrides,
  };
}

const NO_PENDING = { grammarReprocessStillPending: false };
const PENDING = { grammarReprocessStillPending: true };

describe("reconcilePlan", () => {
  it("inserts when no row exists for the path", () => {
    expect(reconcilePlan(plan(), undefined, NO_PENDING)).toEqual({ kind: "insert" });
  });

  it("converges when a concurrent writer already inserted the same bytes", () => {
    // The plan was built with prevHash null (the planning snapshot had no
    // row), but by write time the row exists carrying our own hash. This is
    // the exact state that used to produce UNIQUE constraint failed.
    const decision = reconcilePlan(plan({ prevHash: null }), row({ content_hash: HASH_A }), NO_PENDING);
    expect(decision).toEqual({ kind: "converged" });
  });

  it("converges when a concurrent writer already updated to the same bytes", () => {
    const decision = reconcilePlan(
      plan({ prevHash: HASH_B }),
      row({ content_hash: HASH_A }),
      NO_PENDING,
    );
    expect(decision.kind).toBe("converged");
  });

  it("updates when the fresh row still holds the hash the plan was built against", () => {
    const fresh = row({ content_hash: HASH_B });
    expect(reconcilePlan(plan({ prevHash: HASH_B }), fresh, NO_PENDING)).toEqual({
      kind: "update",
      row: fresh,
      reactivated: false,
      eolMigration: false,
      grammarReprocess: false,
    });
  });

  it("never converges on a soft-deleted row, even at the planned hash", () => {
    // Same content, but the row is not active: the file is back in the walk
    // and has to be reactivated, which is real work this run must perform.
    const decision = reconcilePlan(
      plan({ prevHash: HASH_A }),
      row({ status: "deleted", content_hash: HASH_A }),
      NO_PENDING,
    );
    expect(decision).toMatchObject({ kind: "update", reactivated: true });
  });

  it("keeps a planned EOL migration while the row still carries the diagnosed hash", () => {
    const decision = reconcilePlan(
      plan({ eolMigration: true, prevHash: HASH_B }),
      row({ content_hash: HASH_B }),
      NO_PENDING,
    );
    expect(decision).toMatchObject({ kind: "update", eolMigration: true });
  });

  it("drops a planned EOL migration once another writer moved the row's hash", () => {
    // "Only the hash algorithm changed" was proved against a hash that is no
    // longer there. Claiming it now would count a real content change as
    // unchanged and silently realign anchors to it.
    const decision = reconcilePlan(
      plan({ eolMigration: true, prevHash: HASH_B }),
      row({ content_hash: "c".repeat(64) }),
      NO_PENDING,
    );
    expect(decision).toMatchObject({ kind: "update", eolMigration: false });
  });

  it("keeps a planned grammar re-parse while meta.grammar_state is still stale", () => {
    // Content matches on both sides — only the pending flag keeps this from
    // being read as "already done".
    const decision = reconcilePlan(
      plan({ grammarReprocess: true, prevHash: HASH_A }),
      row({ content_hash: HASH_A }),
      PENDING,
    );
    expect(decision).toMatchObject({ kind: "update", grammarReprocess: true });
  });

  it("converges a planned grammar re-parse once another writer stamped the current state", () => {
    const decision = reconcilePlan(
      plan({ grammarReprocess: true, prevHash: HASH_A }),
      row({ content_hash: HASH_A }),
      NO_PENDING,
    );
    expect(decision.kind).toBe("converged");
  });

  it("applies this run's plan when a concurrent writer indexed different bytes", () => {
    // Neither the planning hash nor ours. We wrote what was really on disk
    // when we read it; the next run re-reads disk and converges either way.
    const fresh = row({ content_hash: "d".repeat(64) });
    expect(reconcilePlan(plan({ prevHash: HASH_B }), fresh, NO_PENDING)).toMatchObject({
      kind: "update",
      row: fresh,
    });
  });
});
