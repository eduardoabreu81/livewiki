/**
 * update — incremental-mode tests (Phase 5).
 *
 * Covers the product's heart: loadWorkPackage emits a focused package
 * (debt + snippets + validAnchors + estimated tokens). Thesis: a small
 * package (~800 tokens) vs rereading the whole repo (~12.5k tokens).
 *
 * Acceptance criterion (SPEC §Phase 5):
 *   "end-to-end flow — agent changes code, hook detects, agent pays the
 *    debt via MCP, verify passes, manifest updated."
 *
 * Here we cover the "agent receives package + pays debt via write_doc":
 *   - loadWorkPackage returns the correct debt (changed/moved/deleted)
 *   - snippets have real file source
 *   - validAnchors are active symbols
 *   - tokensEstimated > 0 and reasonable
 *   - status --json exposes metrics with the efficiency (write/package)
 *   - recordDocWrittenBack updates efficiencyRatio
 *
 * Helpers: a setup that includes a wiki page with an anchor — without it,
 * the ledger generates no debt (rule: debt = anchor changed; without an
 * anchor, nothing to detect).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWorkPackage,
  recordDocWrittenBack,
  CHARS_PER_TOKEN,
} from "./update.js";
import {
  snapshotMetrics,
  clearMetricsForTests,
} from "./update-metrics.js";
import { runInit } from "./init.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runStatus } from "./status.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "livewiki-update-"));
  await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  await clearMetricsForTests(repoRoot);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = join(repoRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = join(repoRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

/**
 * Setup that places a wiki page with an anchor for foo.ts#bar — without it,
 * the anchor-ledger does not detect a change (rule: debt = anchor changed).
 */
async function setupWithAnchor(): Promise<void> {
  await writeCode("src/foo.ts", "export function bar() { return 1; }");
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
  await writeWiki(
    "livewiki/foo.md",
    `---
title: foo
owner: generated
anchors:
  - src/foo.ts#bar
---

# foo

Documentation.
`,
  );
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
}

describe("update.loadWorkPackage — Phase 5 (incremental mode)", () => {
  it("package includes manifest when livewiki was initialized", async () => {
    await setupWithAnchor();
    await runInit({ repoRoot, quiet: true });
    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.manifest).not.toBeNull();
    expect(pkg.bytes).toBeGreaterThan(0);
  });

  it("package without manifest if repo was never initialized", async () => {
    // Without setupWithAnchor and without runInit — manifest was never written
    await writeCode("src/foo.ts", "export function bar() {}");
    await runIndexer(repoRoot, { quiet: true });
    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.manifest).toBeNull();
    expect(pkg.bytes).toBeGreaterThan(0);
  });

  it("detects changed when the source is modified (existing anchor)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 2; /* changed */ }",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    const changed = pkg.debt.filter((d) => d.event === "changed");
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.some((d) => d.symbol_key === "src/foo.ts#bar")).toBe(true);
  });

  it("snippets have real file source (window around the symbol)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      [
        "// line 0",
        "// line 1",
        "// line 2",
        "export function bar() { return 999; /* changed */ }",
        "// line 4",
        "// line 5",
      ].join("\n"),
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    const snippet = pkg.snippets.find((s) => s.symbolKey === "src/foo.ts#bar");
    expect(snippet).toBeDefined();
    expect(snippet?.filePath).toBe("src/foo.ts");
    // Snippet includes the modified source (return 999)
    expect(snippet?.snippet).toMatch(/return 999/);
    // And context lines
    expect(snippet?.snippet).toMatch(/line/);
  });

  it("tokensEstimated > 0 when there is debt", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.tokensEstimated).toBeGreaterThan(0);
    expect(pkg.tokensEstimated).toBeLessThan(10000); // ~800 expected, sanity
  });

  it("validAnchors = active symbols from the debt", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.validAnchors).toContain("src/foo.ts#bar");
  });

  it("respects maxSnippets (defense against a huge debt)", async () => {
    // 5 files each with an anchor
    for (let i = 0; i < 5; i++) {
      await writeCode(`src/file${i}.ts`, `export function fn${i}() { return 1; }`);
      await writeWiki(
        `livewiki/file${i}.md`,
        `---
title: file${i}
owner: generated
anchors:
  - src/file${i}.ts#fn${i}
---
`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    for (let i = 0; i < 5; i++) {
      await writeCode(`src/file${i}.ts`, `export function fn${i}() { return 2; }`);
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot, { maxSnippets: 2 });
    expect(pkg.snippets.length).toBeLessThanOrEqual(2);
  });

  it("respects snippetWindow (custom)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      Array.from({ length: 50 }, (_, i) => `// line ${i}`).join("\n") +
        "\nexport function bar() { return 2; }",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot, { snippetWindow: 5 });
    const snippet = pkg.snippets.find((s) => s.symbolKey === "src/foo.ts#bar");
    expect(snippet).toBeDefined();
    // snippetWindow=5 + 3 context lines before/after = ~11 lines
    const lines = snippet?.snippet.split("\n") ?? [];
    expect(lines.length).toBeLessThanOrEqual(15);
  });
});

describe("update — accounting (SPEC §Accounting)", () => {
  it("recordDocWrittenBack updates efficiencyRatio", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Emits the package
    await loadWorkPackage(repoRoot);
    const snap1 = await snapshotMetrics(repoRoot);
    expect(snap1?.packagesEmitted).toBeGreaterThanOrEqual(1);

    // Agent writes the doc (a 100-token write)
    await recordDocWrittenBack(repoRoot, {
      wikiPath: "livewiki/foo.md",
      bytes: 400,
      tokensEstimated: 100,
    });

    const snap2 = await snapshotMetrics(repoRoot);
    expect(snap2?.writesReceived).toBe(1);
    // efficiencyRatio = writes/packages. It may be < 1 or > 1 depending
    // on the package size — the test only verifies that it updates.
    expect(snap2?.efficiencyRatio).not.toBeNull();
  });

  it("snapshot is null-efficiency when update never happened", async () => {
    await setupWithAnchor();
    const snap = await snapshotMetrics(repoRoot);
    expect(snap?.packagesEmitted).toBe(0);
    expect(snap?.writesReceived).toBe(0);
    expect(snap?.efficiencyRatio).toBeNull();
  });

  it("status --json includes metrics (exposed via SPEC §Accounting)", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await loadWorkPackage(repoRoot);

    const status = await runStatus(repoRoot);
    expect(status.metrics).not.toBeNull();
    expect(status.metrics?.packagesEmitted).toBeGreaterThanOrEqual(1);
    expect(status.metrics?.totalPackageTokens).toBeGreaterThan(0);
  });
});

describe("update — savings (the product's thesis)", () => {
  it("package is smaller than 'rereading the whole repo' (~12.5k tokens)", async () => {
    // Creates 20 files each with its own anchor
    for (let i = 0; i < 20; i++) {
      await writeCode(
        `src/file${i}.ts`,
        Array.from({ length: 50 }, (_, j) => `// line ${j}`).join("\n") +
          `\nexport function fn${i}() { return ${i}; }`,
      );
      await writeWiki(
        `livewiki/file${i}.md`,
        `---
title: file${i}
anchors: [src/file${i}.ts#fn${i}]
---
`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    // Modifies all of them (generates 20 changed)
    for (let i = 0; i < 20; i++) {
      await writeCode(
        `src/file${i}.ts`,
        Array.from({ length: 50 }, (_, j) => `// line ${j}`).join("\n") +
          `\nexport function fn${i}() { return ${i + 100}; }`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    // Thesis: the package is far smaller than the estimated 12.5k of "rereading the whole repo".
    expect(pkg.tokensEstimated).toBeLessThan(12500);
    expect(pkg.tokensEstimated).toBeGreaterThan(0);
  });
});

describe("update — CHARS_PER_TOKEN (heuristic)", () => {
  it("constant is 4 (standard GPT/code heuristic)", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});

describe("update — risk-ordered work package (Etapa 2c)", () => {
  it("loadWorkPackage emits debt items and snippets in risk order", async () => {
    // src/a.ts is imported by src/a.test.ts (covered); src/b.ts is
    // uncovered — the uncovered item must lead the package.
    await writeCode("src/a.ts", "export function alpha() { return 1; }");
    await writeCode("src/b.ts", "export function beta() { return 1; }");
    await writeCode(
      "src/a.test.ts",
      'import { alpha } from "./a";\nexport const probe = alpha();\n',
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeWiki(
      "livewiki/a.md",
      `---
title: a
owner: generated
anchors:
  - src/a.ts#alpha
---

# a

Documentation.
`,
    );
    await writeWiki(
      "livewiki/b.md",
      `---
title: b
owner: generated
anchors:
  - src/b.ts#beta
---

# b

Documentation.
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeCode("src/a.ts", "export function alpha() { return 2; }");
    await writeCode("src/b.ts", "export function beta() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.debt.length).toBe(2);
    expect(pkg.debt[0]?.symbol_key).toBe("src/b.ts#beta");
    expect(pkg.debt[1]?.symbol_key).toBe("src/a.ts#alpha");
    // Snippets follow the same order (highest-risk items first).
    expect(pkg.snippets.length).toBe(2);
    expect(pkg.snippets[0]?.symbolKey).toBe("src/b.ts#beta");
    expect(pkg.snippets[1]?.symbolKey).toBe("src/a.ts#alpha");
  });
});

describe("update — persisted files", () => {
  it("update_metrics.json is created in .livewiki/", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await loadWorkPackage(repoRoot);

    const raw = await readFile(
      join(repoRoot, ".livewiki/update_metrics.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries.length).toBeGreaterThanOrEqual(1);
    expect(parsed.entries[0].kind).toBe("package_emitted");
  });
});

/**
 * Backlog #2 (plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
 * Item 2): the work package carries the additive `impact` block — the same
 * bounded change-impact payload `livewiki_impact` returns with an empty
 * symbolKey. Read-only; degrades outside git.
 */
describe("update — impact block (backlog #2)", () => {
  it("work package carries an impact block, degraded outside git", async () => {
    await setupWithAnchor();
    const pkg = await loadWorkPackage(repoRoot);
    // No `git init` in this fixture — the impact degrades, never throws.
    expect(pkg.impact).toBeDefined();
    expect(pkg.impact.mode).toBe("working-tree");
    expect(pkg.impact.notGitRepo).toBe(true);
    expect(pkg.impact.pages).toEqual([]);
    expect(pkg.impact.changedSymbols).toEqual([]);
  });

  it("impact block lists the affected page for working-tree changes", async () => {
    await setupWithAnchor();
    // Commit the indexed baseline so the working-tree diff sees exactly one
    // source change (`.livewiki/` is the derived cache — never in git).
    await writeFile(join(repoRoot, ".gitignore"), ".livewiki/\n");
    git(["init", "-q", "-b", "main"]);
    gitCommitAll("baseline");
    // Uncommitted change: the preview seed catches it without reindexing.
    await writeCode("src/foo.ts", "export function bar() { return 2; }\n");

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.impact.notGitRepo).toBe(false);
    expect(pkg.impact.changedFiles).toEqual(["src/foo.ts"]);
    expect(pkg.impact.changedSymbols).toEqual([
      { symbolKey: "src/foo.ts#bar", event: "changed" },
    ]);
    expect(pkg.impact.pages).toEqual([
      {
        wikiPath: "livewiki/foo.md",
        items: [{ symbolKey: "src/foo.ts#bar", event: "changed" }],
      },
    ]);
    expect(pkg.impact.truncated).toBe(false);
  });
});

function git(args: string[]): void {
  const r = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
}

function gitCommitAll(message: string): void {
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
    message,
  ]);
}