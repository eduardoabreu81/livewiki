/**
 * change-impact — tests for the bounded change-impact package
 * (ROADMAP backlog #2; plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
 * Item 2).
 *
 * Fixtures are REAL temp git repos (`git init` + a baseline commit) because
 * the default working-tree mode seeds from one real `git diff --name-only
 * HEAD` spawn (via `previewWorkingTreeDebt`). The wiki/anchor state is built
 * through the product path (indexer + anchor ledger).
 *
 * Covered:
 *   - changed symbol → page + event + direct importer + snippet
 *   - deleted symbol event
 *   - budget caps bind → `truncated: true` with pre-cap totals (never silent)
 *   - debt mode (open debt via status; no git diff involved)
 *   - non-git degrade (notGitRepo, never a throw)
 *   - missing index DB → changed files only, DB never created
 *   - deterministic ordering (two runs deep-equal)
 *   - zero writes (index.db bytes identical before/after)
 *
 * No LLM, no network. Requires `git` on PATH (same assumption as the repo's
 * own tooling).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeChangeImpact, IMPACT_BUDGETS } from "./change-impact.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "livewiki-change-impact-"));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function git(args: string[]): void {
  const r = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
}

function gitInit(): void {
  git(["init", "-q", "-b", "main"]);
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

async function writeRepoFile(rel: string, content: string): Promise<void> {
  const abs = join(repoRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

/**
 * Baseline: three anchored TypeScript files + one wiki page per anchored
 * file, all committed, then indexed and ledgered.
 *
 *   src/a.ts → alpha            (page livewiki/a.md; imported by src/c.ts)
 *   src/b.ts → beta, gamma      (page livewiki/b.md)
 *   src/c.ts → probe            (imports ./a — the importer evidence)
 */
async function setupBaseline(): Promise<void> {
  // `.livewiki/` is the derived cache — it must never travel in git (rule #3).
  await writeRepoFile(".gitignore", ".livewiki/\n");
  await writeRepoFile("src/a.ts", "export function alpha() { return 1; }\n");
  await writeRepoFile(
    "src/b.ts",
    "export function beta() { return 1; }\nexport function gamma() { return 1; }\n",
  );
  await writeRepoFile(
    "src/c.ts",
    'import { alpha } from "./a";\nexport const probe = alpha();\n',
  );
  await writeRepoFile(
    "livewiki/a.md",
    "---\ntitle: a\nowner: generated\nanchors:\n  - src/a.ts#alpha\n---\n\n# a\n\nDocs.\n",
  );
  await writeRepoFile(
    "livewiki/b.md",
    "---\ntitle: b\nowner: generated\nanchors:\n  - src/b.ts#beta\n  - src/b.ts#gamma\n---\n\n# b\n\nDocs.\n",
  );
  gitInit();
  gitCommitAll("baseline");
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
}

describe("change-impact.IMPACT_BUDGETS", () => {
  it("holds the plan's caps in one place (50/20/10/25)", () => {
    expect(IMPACT_BUDGETS).toEqual({
      maxSymbols: 50,
      maxPages: 20,
      maxSnippets: 10,
      maxImporters: 25,
    });
  });
});

describe("change-impact.computeChangeImpact — working-tree mode", () => {
  it("a changed symbol yields page + event + direct importer + snippet", async () => {
    await setupBaseline();
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const impact = await computeChangeImpact(repoRoot);
    expect(impact.mode).toBe("working-tree");
    expect(impact.notGitRepo).toBe(false);
    expect(impact.changedFiles).toEqual(["src/a.ts"]);
    expect(impact.changedSymbols).toEqual([
      { symbolKey: "src/a.ts#alpha", event: "changed" },
    ]);
    expect(impact.pages).toEqual([
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
    ]);
    // src/c.ts imports ./a → direct importer of the changed file.
    expect(impact.importers).toEqual(["src/c.ts"]);
    // Snippet window around the changed symbol carries the new source.
    expect(impact.snippets.length).toBe(1);
    expect(impact.snippets[0]?.symbolKey).toBe("src/a.ts#alpha");
    expect(impact.snippets[0]?.snippet).toMatch(/return 2/);
    expect(impact.truncated).toBe(false);
    expect(impact.totals).toEqual({
      symbols: 1,
      pages: 1,
      importers: 1,
      snippetCandidates: 1,
    });
  });

  it("a removed symbol is listed with event `deleted`", async () => {
    await setupBaseline();
    await writeRepoFile("src/b.ts", "export function beta() { return 1; }\n");

    const impact = await computeChangeImpact(repoRoot);
    expect(impact.changedSymbols).toEqual([
      { symbolKey: "src/b.ts#gamma", event: "deleted" },
    ]);
    expect(impact.pages).toEqual([
      {
        wikiPath: "livewiki/b.md",
        items: [{ symbolKey: "src/b.ts#gamma", event: "deleted" }],
      },
    ]);
  });

  it("budget caps bind → truncated: true with pre-cap totals (never silent)", async () => {
    await setupBaseline();
    // Touch both files: alpha changed; beta changed AND gamma removed —
    // 3 symbols over 2 pages, 1 importer of src/a.ts.
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");
    await writeRepoFile("src/b.ts", "export function beta() { return 2; }\n");

    const impact = await computeChangeImpact(repoRoot, {
      maxSymbols: 2,
      maxPages: 1,
      maxSnippets: 1,
      maxImporters: 0,
    });
    // Symbols sorted by key: alpha, beta kept; gamma dropped.
    expect(impact.changedSymbols).toEqual([
      { symbolKey: "src/a.ts#alpha", event: "changed" },
      { symbolKey: "src/b.ts#beta", event: "changed" },
    ]);
    expect(impact.totals.symbols).toBe(3);
    // Pages sorted by wikiPath: a.md kept; b.md dropped.
    expect(impact.pages).toEqual([
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
    ]);
    expect(impact.totals.pages).toBe(2);
    expect(impact.snippets.length).toBe(1);
    expect(impact.totals.snippetCandidates).toBe(2);
    expect(impact.importers).toEqual([]);
    expect(impact.totals.importers).toBe(1);
    expect(impact.truncated).toBe(true);
  });

  it("output is deterministic: two runs are deep-equal and sorted", async () => {
    await setupBaseline();
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");
    await writeRepoFile("src/b.ts", "export function beta() { return 2; }\n");

    const first = await computeChangeImpact(repoRoot);
    const second = await computeChangeImpact(repoRoot);
    expect(second).toEqual(first);
    expect(first.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(first.pages.map((p) => p.wikiPath)).toEqual([
      "livewiki/a.md",
      "livewiki/b.md",
    ]);
    expect(first.changedSymbols.map((s) => s.symbolKey)).toEqual([
      "src/a.ts#alpha",
      "src/b.ts#beta",
      "src/b.ts#gamma",
    ]);
  });

  it("non-git directory degrades cleanly (notGitRepo, never a throw)", async () => {
    // repoRoot is a plain temp dir here — no `git init`.
    const impact = await computeChangeImpact(repoRoot);
    expect(impact.mode).toBe("working-tree");
    expect(impact.notGitRepo).toBe(true);
    expect(impact.changedFiles).toEqual([]);
    expect(impact.changedSymbols).toEqual([]);
    expect(impact.pages).toEqual([]);
    expect(impact.importers).toEqual([]);
    expect(impact.snippets).toEqual([]);
    expect(impact.truncated).toBe(false);
  });

  it("missing index DB → changed files only, and the DB is never created", async () => {
    await writeRepoFile("src/a.ts", "export function alpha() { return 1; }\n");
    gitInit();
    gitCommitAll("baseline");
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const impact = await computeChangeImpact(repoRoot);
    expect(impact.notGitRepo).toBe(false);
    expect(impact.changedFiles).toEqual(["src/a.ts"]);
    expect(impact.pages).toEqual([]);
    expect(impact.changedSymbols).toEqual([]);
    expect(impact.importers).toEqual([]);
    expect(impact.snippets).toEqual([]);
    // Read-only guarantee: the impact must NOT have created the index.
    await expect(readFile(join(repoRoot, ".livewiki/index.db"))).rejects.toThrow();
  });

  it("zero writes: index.db bytes are identical before and after", async () => {
    await setupBaseline();
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const dbPath = join(repoRoot, ".livewiki", "index.db");
    const before = await readFile(dbPath);
    const impact = await computeChangeImpact(repoRoot);
    const after = await readFile(dbPath);

    expect(impact.pages.length).toBe(1); // the impact actually did work
    expect(after.equals(before)).toBe(true);
  });
});

describe("change-impact.computeChangeImpact — debt mode", () => {
  it("reads open debt via status: page + event + importer + snippet", async () => {
    await setupBaseline();
    // Change + reindex + ledger → REAL open debt for src/a.ts#alpha.
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const impact = await computeChangeImpact(repoRoot, { mode: "debt" });
    expect(impact.mode).toBe("debt");
    expect(impact.notGitRepo).toBe(false);
    expect(impact.changedFiles).toEqual(["src/a.ts"]);
    expect(impact.changedSymbols).toEqual([
      { symbolKey: "src/a.ts#alpha", event: "changed" },
    ]);
    expect(impact.pages).toEqual([
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
    ]);
    expect(impact.importers).toEqual(["src/c.ts"]);
    expect(impact.snippets.length).toBe(1);
    expect(impact.snippets[0]?.symbolKey).toBe("src/a.ts#alpha");
    expect(impact.truncated).toBe(false);
  });

  it("debt mode without an index DB → empty impact, never a throw", async () => {
    const impact = await computeChangeImpact(repoRoot, { mode: "debt" });
    expect(impact.mode).toBe("debt");
    expect(impact.notGitRepo).toBe(false);
    expect(impact.changedFiles).toEqual([]);
    expect(impact.changedSymbols).toEqual([]);
    expect(impact.pages).toEqual([]);
    // Read-only guarantee: debt mode must NOT have created the index.
    await expect(readFile(join(repoRoot, ".livewiki/index.db"))).rejects.toThrow();
  });

  it("debt mode with no open debt → empty impact", async () => {
    await setupBaseline();
    const impact = await computeChangeImpact(repoRoot, { mode: "debt" });
    expect(impact.changedSymbols).toEqual([]);
    expect(impact.pages).toEqual([]);
    expect(impact.importers).toEqual([]);
    expect(impact.truncated).toBe(false);
  });
});
