/**
 * CLI E2E tests — run the real `livewiki` binary (packages/cli/dist/index.js)
 * against an isolated temporary repository. Validates the full flow:
 *
 *   livewiki index --json --repo <tmp>
 *   livewiki verify --json --repo <tmp>
 *
 * Why E2E and not unit: finding A of the Phase 2 review showed that calling
 * `runLedger` directly (as in anchor-ledger.test.ts) bypasses the soft-delete
 * that `livewiki index` applies on the update path. Without E2E, the
 * A/B/C/D/E fixes stay partially covered — unit tests pass while the real CLI
 * flow could regress. That is why these tests are MANDATORY alongside the
 * fixes (user constraint).
 *
 * Covered scenarios (mapped in the review):
 *   1. Edit anchored function → changed (1, not accumulated)
 *   2. Move function between files → moved + updated anchor + from/to detail
 *   3. Delete function → deleted ONCE even after 3 consecutive `index` runs
 *   4. New page with a phantom anchor, without index → verify fails with broken_anchor
 *   5. Move anchored function (rule #3): markdown on disk contains the new key
 *      + verify passes clean afterward (Fix G)
 *   6. Move anchored function inside a lw:manual block: untouched markdown +
 *      moved debt with assignee=human (Fix G + rule #6)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";

// These scenarios spawn the real CLI several times per test; on Windows under
// parallel package load the default 5s budget is intermittently too tight
// (the same code passes isolated). Timeout is a ceiling, not a delay.
vi.setConfig({ testTimeout: 20_000 });

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-cli-e2e-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/** Resolves the path of the compiled CLI binary. In dev: packages/cli/dist/index.js */
function cliBin(): string {
  return nodePath.resolve(
    process.cwd(),
    "dist/index.js",
  );
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the real livewiki binary via node, captures stdout/stderr/exit. */
function runCli(args: string[]): CliRun {
  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [cliBin(), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("CLI E2E (Phase 2 review finding — mandatory integration tests)", () => {
  // Helper: runs `status --json` and returns `debt.byEvent` (open totals).
  // `index --json` returns `ledger.debtByEvent` per-run, not totals — to
  // validate dedup we need the SQL aggregate, which `status` already exposes.
  function statusDebt(): { changed: number; moved: number; deleted: number } {
    const r = runCli(["--json", "--repo", repoRoot, "status"]);
    expect(r.status, `status failed. stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as { ok: boolean; debt: { byEvent: { changed: number; moved: number; deleted: number } } };
    expect(j.ok).toBe(true);
    return j.debt.byEvent;
  }

  it("Scenario 1: editing an anchored function generates 1 open changed (dedup does not accumulate)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );

    // Baseline: initial index, expects 0 changed.
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status, `stdout=${r1.stdout}\nstderr=${r1.stderr}`).toBe(0);
    const baseline = JSON.parse(r1.stdout) as { ok: boolean; ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(baseline.ok).toBe(true);
    expect(baseline.ledger.debtByEvent.changed).toBe(0);
    expect(statusDebt().changed).toBe(0);

    // Edit 1: creates 1 changed.
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status).toBe(0);
    const after1 = JSON.parse(r2.stdout) as { ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(after1.ledger.debtByEvent.changed).toBe(1);
    expect(after1.ledger.debtCreated).toBe(1);
    expect(statusDebt().changed).toBe(1);

    // Edit 2: dedup — per-run debtByEvent=0, but open total stays 1.
    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    const r3 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r3.status).toBe(0);
    const after2 = JSON.parse(r3.stdout) as { ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(after2.ledger.debtByEvent.changed).toBe(0);
    expect(after2.ledger.debtCreated).toBe(0);
    expect(statusDebt().changed).toBe(1);
  });

  it("Scenario 2: moving a function between files generates moved + updated anchor", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Move: deletes foo.ts and creates baz.ts with the SAME function (same body =
    // same content_hash). Moved detection is by hash match.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);
    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number } };
      index: { symbolsMoved: number };
    };
    // The ledger must detect via content_hash.
    expect(after.ledger.debtByEvent.moved).toBeGreaterThanOrEqual(1);
    expect(after.ledger.debtByEvent.deleted).toBe(0);

    const debt = statusDebt();
    expect(debt.moved).toBeGreaterThanOrEqual(1);
    expect(debt.deleted).toBe(0);
  });

  it("Scenario 3: deleting a function generates 1 open deleted even after 3 consecutive `index` runs (Fix B)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Deletes + indexes 3 times. SPEC v3 (Fix B) requires dedup via hasOpenDebt.
    for (let i = 0; i < 3; i++) {
      await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts")).catch(() => {});
      const r = runCli(["--json", "--repo", repoRoot, "index"]);
      expect(r.status, `iter ${i}: stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    }

    // Open total: 1 deleted (not 3 — dedup).
    expect(statusDebt().deleted).toBe(1);
  });

  it("Scenario 4: wiki page with a phantom anchor (unindexed code) → verify fails with broken_anchor", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki(
      "livewiki/phantom.md",
      `---
title: Phantom
anchors:
  - src/nonexistent.ts#ghost
---
`,
    );

    // Runs index once to create the DB (without the ghost — only bar exists).
    const idx = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(idx.status).toBe(0);

    // Verify must detect broken_anchor.
    const ver = runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(ver.status, `verify should fail — ghost anchor. stdout=${ver.stdout}`).toBe(1);
    const result = JSON.parse(ver.stdout) as { ok: boolean };
    expect(result.ok).toBe(false);
    // brokenAnchors or anchorsBroken — inspect the real shape.
    const raw = ver.stdout;
    expect(raw).toMatch(/nonexistent\.ts/);
    expect(raw).toMatch(/phantom\.md/);
  });

  it("Scenario 5: moving an anchored symbol rewrites the markdown (rule #3) and verify passes clean (Fix G)", async () => {
    // Setup: foo.ts with `bar`, wiki page with TWO anchors on the same symbol
    // (frontmatter + section marker). The markdown rewrite must update BOTH
    // places, and generate 1 moved debt per anchor (= 2 debts total).
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiPath = "livewiki/foo.md";
    await writeWiki(
      wikiPath,
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---

## Detalhes
<!-- lw:anchors src/foo.ts#bar -->
Texto explicando o bar.
`,
    );

    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // MOVE: deletes foo.ts, creates baz.ts with the SAME body (same content_hash).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);

    // The ledger detected via content_hash. 2 anchors → 2 moved debts
    // (1 per anchor: frontmatter + section marker). movedPairs has 1 entry
    // (dedup by oldKey inside detectMoves).
    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number }; movedPairs: Array<{ from: string; to: string }> };
    };
    expect(after.ledger.debtByEvent.moved).toBe(2);
    expect(after.ledger.movedPairs).toContainEqual({
      from: "src/foo.ts#bar",
      to: "src/baz.ts#bar",
    });

    // Fix G (rule #3): the .md on disk MUST have the new key — not just the DB.
    // Reads the file directly to ensure the rewrite went to disk, not just the DB.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");
    expect(mdAfter).toMatch(/src\/baz\.ts#bar/); // frontmatter rewritten
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/); // no occurrence of the old key
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/baz\.ts#bar -->/); // marker rewritten

    // Verify reads from disk (Fix C). Without the rewrite, it would see the
    // old key `foo.ts#bar` → broken_anchor. With the rewrite, everything matches.
    const ver = runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(ver.status, `verify should pass clean. stdout=${ver.stdout}\nstderr=${ver.stderr}`).toBe(0);
    const vResult = JSON.parse(ver.stdout) as { ok: boolean };
    expect(vResult.ok).toBe(true);

    // Debt: 2 moved with assignee=agent (owner=generated, outside manual block).
    const statusR = JSON.parse(
      runCli(["--json", "--repo", repoRoot, "status"]).stdout,
    ) as {
      debt: {
        byEvent: { moved: number; changed: number; deleted: number };
        byAssignee: { agent: number; human: number };
        items: Array<{ event: string; assignee: string; symbol_key: string | null }>;
      };
    };
    expect(statusR.debt.byEvent.moved).toBe(2);
    expect(statusR.debt.byAssignee.agent).toBe(2);
    expect(statusR.debt.byAssignee.human).toBe(0);
    const movedItems = statusR.debt.items.filter((i) => i.event === "moved");
    expect(movedItems).toHaveLength(2);
    expect(movedItems.every((i) => i.assignee === "agent")).toBe(true);
  });

  it("Scenario 6: moving an anchored symbol inside lw:manual → untouched markdown + debt with assignee=human (Fix G + rule #6)", async () => {
    // Setup: foo.ts with `bar`, wiki page with anchor INSIDE a manual block.
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiPath = "livewiki/foo.md";
    const wikiOriginal = `---
title: Foo
---

## Manual notes
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Text written by a human — agent never touches.
<!-- /lw:manual -->
`;
    await writeWiki(wikiPath, wikiOriginal);

    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Snapshot of the markdown BEFORE the move, to compare with AFTER.
    const mdBefore = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");

    // MOVE: deletes foo.ts, creates baz.ts with the same body.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);

    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number }; movedPairs: Array<{ from: string; to: string }> };
    };
    expect(after.ledger.debtByEvent.moved).toBe(1);
    expect(after.ledger.movedPairs).toContainEqual({
      from: "src/foo.ts#bar",
      to: "src/baz.ts#bar",
    });

    // Rule #6: UNTOUCHED markdown. The old key stays there, no rewrite.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");
    expect(mdAfter).toBe(mdBefore);
    expect(mdAfter).toMatch(/src\/foo\.ts#bar/);
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // Debt: assignee=human (rule #6 — manual block is always human).
    const statusR = JSON.parse(
      runCli(["--json", "--repo", repoRoot, "status"]).stdout,
    ) as {
      debt: {
        byEvent: { moved: number; changed: number; deleted: number };
        byAssignee: { agent: number; human: number };
        items: Array<{ event: string; assignee: string }>;
      };
    };
    expect(statusR.debt.byEvent.moved).toBe(1);
    expect(statusR.debt.byAssignee.human).toBe(1);
    expect(statusR.debt.byAssignee.agent).toBe(0);
    const movedItems = statusR.debt.items.filter((i) => i.event === "moved");
    expect(movedItems).toHaveLength(1);
    expect(movedItems[0]?.assignee).toBe("human");
  });
});

/**
 * Regression: `.livewiki/config.json` `ignores` must be honored by
 * `livewiki index`, and the CLI `--ignore` flag must be additive
 * (configured value always wins; flag narrows further on a
 * per-invocation basis). Same semantics as `livewiki init` and
 * `livewiki batch` (covered in `packages/core/src/ignores-propagation.test.ts`).
 *
 * Uses the JSON output of `livewiki index` (counts) to assert the
 * inventory size — the indexer exposes the count of scanned/added
 * files, which is the externally observable signal that a path was
 * excluded by the ignore machinery.
 */
describe("CLI E2E — livewiki index respects config.ignores and adds --ignore", () => {
  async function writeIgnoresConfig(ignores: string[]): Promise<void> {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ ignores }),
      "utf8",
    );
  }

  function readIndexCounts(): { scanned: number; added: number } {
    const r = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as {
      ok: boolean;
      index: { filesScanned: number; filesAdded: number };
    };
    expect(j.ok).toBe(true);
    return { scanned: j.index.filesScanned, added: j.index.filesAdded };
  }

  it("config.ignores is honored by livewiki index", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("benchmarks/tooling/harness.ts", "export function bench() {}");
    await writeCode("raw/openwiki/peer.ts", "export function peer() {}");
    await writeIgnoresConfig(["benchmarks/", "raw/openwiki/"]);

    // Without config.ignores, all 3 files would be scanned. With it, only
    // the product source survives.
    const { scanned, added } = readIndexCounts();
    expect(scanned).toBe(1);
    expect(added).toBe(1);
  });

  it("--ignore is additive to config.ignores (both apply)", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("src/extra.ts", "export function extra() { return 2; }");
    await writeCode("benchmarks/tooling/harness.ts", "export function bench() {}");
    // Config drops the benchmarks/ dir; CLI flag drops src/extra.ts. Both apply.
    await writeIgnoresConfig(["benchmarks/"]);

    const r = runCli([
      "--json",
      "--repo",
      repoRoot,
      "index",
      "--ignore",
      "src/extra.ts",
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as { index: { filesScanned: number; filesAdded: number } };
    // Only src/product.ts survives. The CLI flag narrowed further.
    expect(j.index.filesScanned).toBe(1);
    expect(j.index.filesAdded).toBe(1);
  });

  it("regular non-ignored source files remain indexed", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("src/util.ts", "export function util() { return 1; }");
    await writeIgnoresConfig(["benchmarks/"]);

    const { scanned, added } = readIndexCounts();
    expect(scanned).toBe(2);
    expect(added).toBe(2);
  });
});

/**
 * CLI E2E — `livewiki status --diff` (ROADMAP backlog #5, pre-commit anchor
 * preview). Real temp git repos: the preview's changed-file set comes from a
 * real `git diff --name-only HEAD`. Covers the flag wiring end to end:
 * human + --json shapes, exit 0 on the preview path (with zero debt created
 * — read-only), and the not-a-git-repo degrade (exit 1, no stack trace).
 */
describe("CLI E2E — livewiki status --diff (pre-commit anchor preview)", () => {
  function git(args: string[]): void {
    const r = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    });
    expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
  }

  function gitInitCommit(): void {
    git(["init", "-q", "-b", "main"]);
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=livewiki-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "baseline",
    ]);
  }

  async function setupAnchoredRepo(): Promise<void> {
    // `.livewiki/` is the derived cache — never in git (rule #3).
    await writeCode(".gitignore", ".livewiki/\n");
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );
    gitInitCommit();
    const r = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
  }

  it("--json lists the page whose anchored symbol changed, exit 0, zero debt created", async () => {
    await setupAnchoredRepo();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");

    const r = runCli(["--json", "--repo", repoRoot, "status", "--diff"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as {
      ok: boolean;
      diffPreview: {
        notGitRepo: boolean;
        changedFiles: string[];
        pages: Array<{ wikiPath: string; items: Array<{ symbolKey: string; event: string }> }>;
      };
    };
    expect(j.ok).toBe(true);
    expect(j.diffPreview.notGitRepo).toBe(false);
    expect(j.diffPreview.changedFiles).toEqual(["src/foo.ts"]);
    expect(j.diffPreview.pages).toEqual([
      {
        wikiPath: "livewiki/foo.md",
        items: [{ symbolKey: "src/foo.ts#bar", event: "changed" }],
      },
    ]);

    // Read-only: the preview must not create debt (ledger did not run).
    const statusR = runCli(["--json", "--repo", repoRoot, "status"]);
    expect(statusR.status).toBe(0);
    const statusJ = JSON.parse(statusR.stdout) as {
      debt: { byEvent: { changed: number; deleted: number } };
    };
    expect(statusJ.debt.byEvent.changed).toBe(0);
    expect(statusJ.debt.byEvent.deleted).toBe(0);
  });

  it("human output names the page and the moved scope note; clean tree says clean", async () => {
    await setupAnchoredRepo();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");

    const dirty = runCli(["--repo", repoRoot, "status", "--diff"]);
    expect(dirty.status, `stdout=${dirty.stdout}\nstderr=${dirty.stderr}`).toBe(0);
    expect(dirty.stdout).toContain("1 page would be invalidated by the working tree");
    expect(dirty.stdout).toContain("livewiki/foo.md");
    expect(dirty.stdout).toContain("[changed] src/foo.ts#bar");
    expect(dirty.stdout).toContain("moved");

    git(["add", "-A"]);
    git([
      "-c",
      "user.name=livewiki-test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "-m",
      "second",
    ]);
    const clean = runCli(["--repo", repoRoot, "status", "--diff"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("working tree clean vs anchors");
  });

  it("non-git directory degrades cleanly: exit 1, not_a_git_repo in JSON, no stack trace", () => {
    const r = runCli(["--json", "--repo", repoRoot, "status", "--diff"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    const j = JSON.parse(r.stdout) as {
      ok: boolean;
      error: string;
      diffPreview: { notGitRepo: boolean; pages: unknown[] };
    };
    expect(j.ok).toBe(false);
    expect(j.error).toBe("not_a_git_repo");
    expect(j.diffPreview.notGitRepo).toBe(true);
    expect(j.diffPreview.pages).toEqual([]);
    expect(r.stderr).not.toMatch(/\bat .*\.ts:\d+/); // no stack trace
  });
});