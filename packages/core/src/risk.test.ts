/**
 * risk — unit tests for the deterministic debt-risk rubric (Etapa 2c).
 *
 * Covers: coverage/fan-in maps from synthetic import edges, rubric math per
 * factor, tie-break determinism, git-churn output parsing, and the graceful
 * degradation of the git spawn (non-git dir, disabled window, spawn error).
 * No LLM, no network; the success-path git test uses an injected fake spawn.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectGitChurn,
  compareByRisk,
  computeTestCoverageAndFanIn,
  derivePathFromSymbolKey,
  parseGitChurnOutput,
  scoreDebtItem,
  type SpawnImpl,
} from "./risk.js";
import type { ExtractedImport } from "./imports.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "livewiki-risk-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function tsImport(source: string): ExtractedImport {
  return { source, kind: "ts-import" };
}

/** Fake spawn: emits the given stdout then closes with the given code. */
function fakeSpawnOk(output: string, code = 0): SpawnImpl {
  return (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    child.stdout = new EventEmitter();
    process.nextTick(() => {
      if (output.length > 0) child.stdout.emit("data", Buffer.from(output));
      child.emit("close", code);
    });
    return child;
  }) as unknown as SpawnImpl;
}

/** Fake spawn: emits an `error` (git missing / cannot spawn). */
function fakeSpawnError(): SpawnImpl {
  return (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    child.stdout = new EventEmitter();
    process.nextTick(() => {
      child.emit("error", new Error("spawn git ENOENT"));
    });
    return child;
  }) as unknown as SpawnImpl;
}

describe("risk.computeTestCoverageAndFanIn", () => {
  it("marks files imported by a test file as covered; fan-in counts distinct importers", () => {
    const knownFiles = new Set([
      "src/a.ts",
      "src/b.ts",
      "src/util.ts",
      "src/a.test.ts",
      "src/c.ts",
    ]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/a.test.ts", [tsImport("./a")]],
      ["src/c.ts", [tsImport("./b"), tsImport("./util")]],
      ["src/b.ts", [tsImport("./util")]],
    ]);
    const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
      importsByFile,
      knownFiles,
    });
    expect(coveredByTest.has("src/a.ts")).toBe(true);
    expect(coveredByTest.has("src/b.ts")).toBe(false);
    expect(fanIn.get("src/a.ts")).toBe(1);
    expect(fanIn.get("src/util.ts")).toBe(2); // two DISTINCT importers
    expect(fanIn.get("src/b.ts")).toBe(1);
  });

  it("drops self-edges and ignores specifiers that resolve outside known files", () => {
    const knownFiles = new Set(["src/a.ts", "src/a.test.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/a.ts", [tsImport("./a"), tsImport("node:fs"), tsImport("left-pad")]],
      ["src/a.test.ts", [tsImport("./a")]],
    ]);
    const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
      importsByFile,
      knownFiles,
    });
    expect(fanIn.get("src/a.ts")).toBe(1); // self-edge dropped; external ignored
    expect(coveredByTest.has("src/a.ts")).toBe(true);
  });

  it("a test file importing another test file covers it (and only it)", () => {
    const knownFiles = new Set(["src/a.test.ts", "src/helpers.test.ts", "src/b.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/a.test.ts", [tsImport("./helpers.test")]],
    ]);
    const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
      importsByFile,
      knownFiles,
    });
    expect(coveredByTest.has("src/helpers.test.ts")).toBe(true);
    expect(coveredByTest.has("src/b.ts")).toBe(false);
    expect(fanIn.get("src/helpers.test.ts")).toBe(1);
  });

  it("python test-file conventions count as test importers", () => {
    const knownFiles = new Set(["app/svc.py", "tests/test_svc.py"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["tests/test_svc.py", [{ source: "app.svc", kind: "py-import" }]],
    ]);
    const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
      importsByFile,
      knownFiles,
    });
    expect(coveredByTest.has("app/svc.py")).toBe(true);
    expect(fanIn.get("app/svc.py")).toBe(1);
  });

  it("a prose-tier file with no imports appears in neither map", () => {
    const knownFiles = new Set(["docs/guide.md", "src/a.ts", "src/a.test.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/a.test.ts", [tsImport("./a")]],
      // docs/guide.md is never parsed (prose tier): no entry at all
    ]);
    const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
      importsByFile,
      knownFiles,
    });
    expect(coveredByTest.has("docs/guide.md")).toBe(false);
    expect(fanIn.has("docs/guide.md")).toBe(false);
  });
});

describe("risk.scoreDebtItem — rubric math", () => {
  it("event points: changed/deleted +10, moved +5", () => {
    expect(scoreDebtItem({ event: "changed", tier: null, coveredByTest: false, fanIn: 0, churnCount: null }).factors.event).toBe(10);
    expect(scoreDebtItem({ event: "deleted", tier: null, coveredByTest: false, fanIn: 0, churnCount: null }).factors.event).toBe(10);
    expect(scoreDebtItem({ event: "moved", tier: null, coveredByTest: false, fanIn: 0, churnCount: null }).factors.event).toBe(5);
  });

  it("test gap: anchored uncovered +40, anchored covered 0, prose +10", () => {
    const base = { event: "changed" as const, fanIn: 0, churnCount: null };
    expect(scoreDebtItem({ ...base, tier: "anchored", coveredByTest: false }).factors.testGap).toBe(40);
    expect(scoreDebtItem({ ...base, tier: "anchored", coveredByTest: true }).factors.testGap).toBe(0);
    expect(scoreDebtItem({ ...base, tier: "prose", coveredByTest: false }).factors.testGap).toBe(10);
    expect(scoreDebtItem({ ...base, tier: null, coveredByTest: false }).factors.testGap).toBe(0);
  });

  it("fan-in bands: 1-2 → 5, 3-5 → 10, 6-10 → 15, >10 → 20; prose always 0", () => {
    const base = { event: "changed" as const, tier: "anchored" as const, coveredByTest: true, churnCount: null };
    expect(scoreDebtItem({ ...base, fanIn: 0 }).factors.fanIn).toBe(0);
    expect(scoreDebtItem({ ...base, fanIn: 1 }).factors.fanIn).toBe(5);
    expect(scoreDebtItem({ ...base, fanIn: 2 }).factors.fanIn).toBe(5);
    expect(scoreDebtItem({ ...base, fanIn: 3 }).factors.fanIn).toBe(10);
    expect(scoreDebtItem({ ...base, fanIn: 5 }).factors.fanIn).toBe(10);
    expect(scoreDebtItem({ ...base, fanIn: 6 }).factors.fanIn).toBe(15);
    expect(scoreDebtItem({ ...base, fanIn: 10 }).factors.fanIn).toBe(15);
    expect(scoreDebtItem({ ...base, fanIn: 11 }).factors.fanIn).toBe(20);
    // Prose tier: fan-in not extractable — forced 0 even if a count is passed.
    expect(
      scoreDebtItem({ event: "changed", tier: "prose", coveredByTest: false, fanIn: 99, churnCount: null }).factors.fanIn,
    ).toBe(0);
  });

  it("churn bands: 1-3 → 5, 4-9 → 10, >=10 → 15; null → 0", () => {
    const base = { event: "changed" as const, tier: "anchored" as const, coveredByTest: true, fanIn: 0 };
    expect(scoreDebtItem({ ...base, churnCount: null }).factors.churn).toBe(0);
    expect(scoreDebtItem({ ...base, churnCount: 0 }).factors.churn).toBe(0);
    expect(scoreDebtItem({ ...base, churnCount: 1 }).factors.churn).toBe(5);
    expect(scoreDebtItem({ ...base, churnCount: 3 }).factors.churn).toBe(5);
    expect(scoreDebtItem({ ...base, churnCount: 4 }).factors.churn).toBe(10);
    expect(scoreDebtItem({ ...base, churnCount: 9 }).factors.churn).toBe(10);
    expect(scoreDebtItem({ ...base, churnCount: 10 }).factors.churn).toBe(15);
    expect(scoreDebtItem({ ...base, churnCount: 500 }).factors.churn).toBe(15);
  });

  it("score is the sum of factors", () => {
    const s = scoreDebtItem({
      event: "changed",
      tier: "anchored",
      coveredByTest: false,
      fanIn: 4,
      churnCount: 2,
    });
    expect(s.factors).toEqual({ event: 10, testGap: 40, fanIn: 10, churn: 5 });
    expect(s.score).toBe(65);
  });
});

describe("risk.compareByRisk — tie-break determinism", () => {
  const item = (id: number, detected_at: number, score: number) => ({
    id,
    detected_at,
    risk: { score, factors: { event: score, testGap: 0, fanIn: 0, churn: 0 } },
  });

  it("orders by score desc, then detected_at asc, then id asc", () => {
    const a = item(1, 100, 50);
    const b = item(2, 100, 50); // same score + same detected_at → id asc
    const c = item(3, 90, 50); // same score, earlier detected_at → first of ties
    const d = item(4, 80, 60); // higher score → first overall
    const e = item(5, 70, 10); // lowest score → last
    const sorted = [a, b, c, d, e].sort(compareByRisk);
    expect(sorted.map((x) => x.id)).toEqual([4, 3, 1, 2, 5]);
  });

  it("same input twice yields byte-identical order (stable across shuffles)", () => {
    const items = [
      item(1, 100, 50),
      item(2, 100, 50),
      item(3, 90, 50),
      item(4, 80, 60),
      item(5, 100, 50),
      item(6, 90, 60),
    ];
    const first = [...items].sort(compareByRisk).map((x) => x.id);
    const second = [...items].reverse().sort(compareByRisk).map((x) => x.id);
    const third = [...items].sort(compareByRisk).map((x) => x.id);
    expect(first).toEqual(second);
    expect(first).toEqual(third);
  });
});

describe("risk.derivePathFromSymbolKey", () => {
  it("derives the path prefix from a symbol key", () => {
    expect(derivePathFromSymbolKey("src/foo.ts#bar")).toBe("src/foo.ts");
    expect(derivePathFromSymbolKey("src/dir with space/f.py#fn")).toBe("src/dir with space/f.py");
  });

  it("returns null for missing or pathless keys", () => {
    expect(derivePathFromSymbolKey(null)).toBeNull();
    expect(derivePathFromSymbolKey("#bar")).toBeNull();
    expect(derivePathFromSymbolKey("no-hash")).toBeNull();
  });
});

describe("risk.parseGitChurnOutput", () => {
  it("counts repeated paths across commits, tolerates blank lines", () => {
    const out = parseGitChurnOutput(
      [
        "src/a.ts",
        "src/b.ts",
        "",
        "src/a.ts",
        "",
        "",
        "src/a.ts",
        "lib/c.py",
      ].join("\n"),
    );
    expect(out.get("src/a.ts")).toBe(3);
    expect(out.get("src/b.ts")).toBe(1);
    expect(out.get("lib/c.py")).toBe(1);
    expect(out.size).toBe(3);
  });

  it("keeps paths with spaces intact and handles CRLF", () => {
    const out = parseGitChurnOutput("src/dir with space/f.ts\r\nsrc/dir with space/f.ts\r\n");
    expect(out.get("src/dir with space/f.ts")).toBe(2);
  });

  it("empty output yields an empty map", () => {
    expect(parseGitChurnOutput("").size).toBe(0);
    expect(parseGitChurnOutput("\n\n\n").size).toBe(0);
  });
});

describe("risk.collectGitChurn", () => {
  it("returns null (never throws) in a non-git directory", async () => {
    const churn = await collectGitChurn(tmpDir, 500);
    expect(churn).toBeNull();
  });

  it("maxCommits 0 disables the spawn entirely", async () => {
    const spawnThatThrows = (() => {
      throw new Error("must not be called");
    }) as unknown as SpawnImpl;
    expect(await collectGitChurn(tmpDir, 0, spawnThatThrows)).toBeNull();
  });

  it("parses a successful git log via the injected spawn", async () => {
    const output = "src/a.ts\n\nsrc/a.ts\nsrc/b.ts\n";
    const churn = await collectGitChurn(tmpDir, 500, fakeSpawnOk(output));
    expect(churn).not.toBeNull();
    expect(churn?.get("src/a.ts")).toBe(2);
    expect(churn?.get("src/b.ts")).toBe(1);
  });

  it("non-zero exit yields null", async () => {
    const churn = await collectGitChurn(tmpDir, 500, fakeSpawnOk("fatal: not a git repository\n", 128));
    expect(churn).toBeNull();
  });

  it("spawn error (git missing) yields null", async () => {
    const churn = await collectGitChurn(tmpDir, 500, fakeSpawnError());
    expect(churn).toBeNull();
  });
});
