import { describe, expect, it } from "vitest";
import {
  folderCoverageSignal,
  planPageUnits,
  stripTestInfix,
  type FileUnit,
} from "./page-units.js";

function plan(
  files: Array<{ path: string; symbols?: number; bytes?: number }>,
  opts: Parameters<typeof planPageUnits>[1] = {},
) {
  return planPageUnits(
    {
      filePaths: files.map((f) => f.path),
      symbolCountByPath: new Map(files.map((f) => [f.path, f.symbols ?? 0])),
      sizeByPath: new Map(files.map((f) => [f.path, f.bytes ?? 1000])),
    },
    opts,
  );
}

function fileUnit(plan1: ReturnType<typeof plan>, filePath: string): FileUnit {
  const u = plan1.fileUnits.find((f) => f.filePath === filePath);
  expect(u, `file unit for ${filePath}`).toBeDefined();
  return u!;
}

describe("stripTestInfix", () => {
  it("strips .test./.spec. infixes", () => {
    expect(stripTestInfix("batch.test.ts")).toBe("batch.ts");
    expect(stripTestInfix("parser.spec.py")).toBe("parser.py");
    expect(stripTestInfix("batch.ts")).toBeNull();
  });
});

describe("planPageUnits", () => {
  it("accounts every indexed file on exactly one folder entry (exact partition)", () => {
    const files = [
      { path: "README.md" },
      { path: "packages/core/src/batch.ts", symbols: 55 },
      { path: "packages/core/src/index.ts" },
      { path: "packages/core/src/batch.test.ts", symbols: 10 },
      { path: "packages/cli/src/cli.ts", symbols: 8 },
    ];
    const p = plan(files);
    const accounted = p.folderUnits.flatMap((f) => f.entries.map((e) => e.filePath));
    expect([...accounted].sort()).toEqual(files.map((f) => f.path).sort());
    // no duplicates
    expect(new Set(accounted).size).toBe(accounted.length);
  });

  it("emits one file unit per symbol-bearing non-test file with real page paths", () => {
    const p = plan([
      { path: "packages/core/src/batch.ts", symbols: 55 },
      { path: "packages/core/src/view.ts", symbols: 48 },
      { path: "packages/core/src/index.ts" }, // inert: no page
    ]);
    expect(p.fileUnits.map((u) => u.id)).toEqual(["src/batch", "src/view"]);
    expect(fileUnit(p, "packages/core/src/batch.ts").pagePath).toBe(
      "livewiki/src/batch.md",
    );
    const folder = p.folderUnits.find((f) => f.id === "src")!;
    expect(folder.pagePath).toBe("livewiki/src/index.md");
    expect(folder.dirPath).toBe("packages/core/src");
    const dispositions = new Map(folder.entries.map((e) => [e.filePath, e.disposition]));
    expect(dispositions.get("packages/core/src/batch.ts")).toBe("page");
    expect(dispositions.get("packages/core/src/index.ts")).toBe("inert");
    const batchEntry = folder.entries.find((e) => e.filePath.endsWith("batch.ts"))!;
    expect(batchEntry.pagePath).toBe("livewiki/src/batch.md");
  });

  it("pairs same-name tests as facts, prefix tests as likely, unmatched as orphans", () => {
    const p = plan([
      { path: "src/batch.ts", symbols: 55 },
      { path: "src/batch.test.ts", symbols: 10 },
      { path: "src/batch-repair.test.ts", symbols: 5 },
      { path: "src/e2e-cross.test.ts", symbols: 3 },
    ]);
    const unit = fileUnit(p, "src/batch.ts");
    expect(unit.pairedTestPath).toBe("src/batch.test.ts");
    expect(unit.likelyTestPaths).toEqual(["src/batch-repair.test.ts"]);
    const folder = p.folderUnits.find((f) => f.id === "src")!;
    const byPath = new Map(folder.entries.map((e) => [e.filePath, e.disposition]));
    expect(byPath.get("src/batch.test.ts")).toBe("test-paired");
    expect(byPath.get("src/batch-repair.test.ts")).toBe("test-likely");
    expect(byPath.get("src/e2e-cross.test.ts")).toBe("test-orphan");
    // tests never get file pages
    expect(p.fileUnits.some((u) => u.filePath.includes(".test."))).toBe(false);
  });

  it("makes folder ids unique across packages and guards reserved wiki dirs", () => {
    const p = plan([
      { path: "packages/core/src/a.ts", symbols: 1 },
      { path: "packages/cli/src/b.ts", symbols: 1 },
      { path: "flows/c.ts", symbols: 1 }, // repo dir colliding with livewiki/flows/
      { path: "root-file.ts", symbols: 1 },
    ]);
    const ids = p.folderUnits.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("core-src");
    expect(ids).toContain("cli-src");
    expect(ids).toContain("flows-files"); // reserved guard
    expect(ids).toContain("root");
    const root = p.folderUnits.find((f) => f.id === "root")!;
    expect(root.dirPath).toBe("");
    expect(root.pagePath).toBe("livewiki/root/index.md");
  });

  it("suffixes colliding file bases with their extension, symmetrically", () => {
    const p = plan([
      { path: "src/util.ts", symbols: 2 },
      { path: "src/util.js", symbols: 2 },
    ]);
    const names = p.fileUnits.map((u) => u.id).sort();
    expect(names).toEqual(["src/util-js", "src/util-ts"]);
  });

  it("suffixes an `index` file base even when lone — the unsuffixed page would collide with the folder page", () => {
    const p = plan([
      { path: "cli/index.ts", symbols: 2 },
      { path: "cli/main.ts", symbols: 2 },
    ]);
    const indexUnit = fileUnit(p, "cli/index.ts");
    expect(indexUnit.id).toBe("cli/index-ts");
    expect(indexUnit.pagePath).toBe("livewiki/cli/index-ts.md");
    const folder = p.folderUnits.find((f) => f.id === "cli")!;
    expect(folder.pagePath).toBe("livewiki/cli/index.md");
    const allPaths = [...p.fileUnits, ...p.folderUnits].map((u) => u.pagePath);
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });

  it("flags oversized sources only above the split threshold", () => {
    const p = plan(
      [
        { path: "src/big.ts", symbols: 55, bytes: 262_000 },
        { path: "src/small.ts", symbols: 5, bytes: 10_000 },
      ],
      { fileSplitSourceBytes: 60_000 },
    );
    expect(fileUnit(p, "src/big.ts").oversizedSource).toBe(true);
    expect(fileUnit(p, "src/small.ts").oversizedSource).toBe(false);
    // 0 disables the axis
    const p2 = plan([{ path: "src/big.ts", symbols: 55, bytes: 262_000 }], {
      fileSplitSourceBytes: 0,
    });
    expect(p2.fileUnits[0]!.oversizedSource).toBe(false);
  });

  it("sanitizes dot-prefixed directories (wiki walkers skip dot-dirs)", () => {
    const p = plan([
      { path: ".claude/notes.md" },
      { path: ".claude/hook.ts", symbols: 2 },
    ]);
    const folder = p.folderUnits.find((f) => f.dirPath === ".claude")!;
    expect(folder.id).toBe("dot-claude");
    expect(folder.pagePath).toBe("livewiki/dot-claude/index.md");
    expect(fileUnit(p, ".claude/hook.ts").pagePath).toBe("livewiki/dot-claude/hook.md");
  });

  it("is deterministic under shuffled input", () => {
    const files = [
      { path: "b/y.ts", symbols: 3 },
      { path: "a/x.ts", symbols: 5 },
      { path: "a/x.test.ts", symbols: 2 },
      { path: "a/README.md" },
      { path: "z.ts", symbols: 1 },
    ];
    const shuffled = [files[2]!, files[4]!, files[0]!, files[3]!, files[1]!];
    expect(JSON.stringify(plan(shuffled))).toBe(JSON.stringify(plan(files)));
  });

  it("computes the folder coverage signal (pages without same-name test)", () => {
    const p = plan([
      { path: "src/a.ts", symbols: 5 },
      { path: "src/a.test.ts", symbols: 2 },
      { path: "src/b.ts", symbols: 5 },
      { path: "src/c.ts", symbols: 5 },
    ]);
    const folder = p.folderUnits.find((f) => f.id === "src")!;
    expect(folderCoverageSignal(folder)).toEqual({ pages: 3, withoutSameNameTest: 2 });
  });
});
