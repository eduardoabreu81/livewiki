/**
 * diff-preview — tests for the read-only pre-commit anchor preview
 * (ROADMAP backlog #5; plan docs/plans/2026-07-28-status-diff-preview.md).
 *
 * Fixtures are REAL temp git repos (`git init` + a baseline commit) because
 * the changed-file set comes from one real `git diff --name-only HEAD`
 * spawn. The wiki/anchor state is built through the product path (indexer +
 * anchor ledger), so the anchor rows and `symbol_hash_at_doc` values are the
 * exact ones the ledger itself would compare against post-commit.
 *
 * Hash-equivalence evidence: the "clean working tree" test proves that the
 * working-tree recompute (`parseSource` + `extractSymbols` on disk content)
 * produces hashes IDENTICAL to the indexer's — any drift would make every
 * anchored symbol false-positive as `changed` in that test.
 *
 * No LLM, no network. Requires `git` on PATH (same assumption as the repo's
 * own tooling).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatDiffPreviewHuman,
  parseGitDiffOutput,
  previewWorkingTreeDebt,
} from "./diff-preview.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "livewiki-diff-preview-"));
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
 * Baseline: two anchored TypeScript files + one wiki page per file, all
 * committed, then indexed and ledgered so `anchors.symbol_hash_at_doc`
 * matches the indexed `symbols.content_hash` for every anchor.
 *
 *   src/a.ts → alpha            (page livewiki/a.md)
 *   src/b.ts → beta, gamma      (page livewiki/b.md)
 */
async function setupBaseline(): Promise<void> {
  // `.livewiki/` is the derived cache — it must never travel in git (rule #3,
  // same as `livewiki init`'s managed .gitignore block).
  await writeRepoFile(".gitignore", ".livewiki/\n");
  await writeRepoFile("src/a.ts", "export function alpha() { return 1; }\n");
  await writeRepoFile(
    "src/b.ts",
    "export function beta() { return 1; }\nexport function gamma() { return 1; }\n",
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

describe("diff-preview.parseGitDiffOutput", () => {
  it("parses, dedupes and sorts paths; tolerates blank lines and CRLF", () => {
    const out = parseGitDiffOutput("src/b.ts\r\n\r\nsrc/a.ts\nsrc/b.ts\n");
    expect(out).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps paths with spaces intact", () => {
    expect(parseGitDiffOutput("src/dir with space/f.ts\n")).toEqual([
      "src/dir with space/f.ts",
    ]);
  });
});

describe("diff-preview.previewWorkingTreeDebt", () => {
  it("clean working tree yields empty pages (hash equivalence with the indexer)", async () => {
    await setupBaseline();
    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.notGitRepo).toBe(false);
    expect(preview.changedFiles).toEqual([]);
    expect(preview.pages).toEqual([]);
    expect(formatDiffPreviewHuman(preview)).toContain("working tree clean vs anchors");
  });

  it("a changed symbol is listed as `changed` under the page that anchors it", async () => {
    await setupBaseline();
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.notGitRepo).toBe(false);
    expect(preview.changedFiles).toEqual(["src/a.ts"]);
    expect(preview.pages).toEqual([
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
    ]);

    const human = formatDiffPreviewHuman(preview);
    expect(human).toContain("1 page would be invalidated by the working tree");
    expect(human).toContain("livewiki/a.md");
    expect(human).toContain("[changed] src/a.ts#alpha");
    expect(human).toContain("moved");
  });

  it("a removed symbol is listed as `deleted`", async () => {
    await setupBaseline();
    await writeRepoFile("src/b.ts", "export function beta() { return 1; }\n");

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.pages).toEqual([
      {
        wikiPath: "livewiki/b.md",
        items: [{ symbolKey: "src/b.ts#gamma", event: "deleted" }],
      },
    ]);
  });

  it("a file deleted in the working tree marks all its anchored symbols deleted", async () => {
    await setupBaseline();
    await rm(join(repoRoot, "src/b.ts"));

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.changedFiles).toEqual(["src/b.ts"]);
    expect(preview.pages).toEqual([
      {
        wikiPath: "livewiki/b.md",
        items: [
          { symbolKey: "src/b.ts#beta", event: "deleted" },
          { symbolKey: "src/b.ts#gamma", event: "deleted" },
        ],
      },
    ]);
  });

  it("prose-tier changed files (no grammar) produce no anchor hits", async () => {
    await setupBaseline();
    await writeRepoFile("docs/guide.md", "# Guide\n\noriginal\n");
    gitCommitAll("add prose doc");
    await runIndexer(repoRoot, { quiet: true });

    await writeRepoFile("docs/guide.md", "# Guide\n\nedited\n");
    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.changedFiles).toEqual(["docs/guide.md"]);
    expect(preview.pages).toEqual([]);
  });

  it("untracked files are ignored (new files can hold no anchors)", async () => {
    await setupBaseline();
    await writeRepoFile("src/new.ts", "export function fresh() { return 1; }\n");

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.changedFiles).toEqual([]);
    expect(preview.pages).toEqual([]);
  });

  it("output is grouped and sorted deterministically (wiki_path, then symbolKey)", async () => {
    await setupBaseline();
    // Touch both files: alpha changed; beta changed AND gamma removed —
    // b.md items must sort beta before gamma, pages a.md before b.md.
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");
    await writeRepoFile("src/b.ts", "export function beta() { return 2; }\n");

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(preview.pages).toEqual([
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
      {
        wikiPath: "livewiki/b.md",
        items: [
          { symbolKey: "src/b.ts#beta", event: "changed" },
          { symbolKey: "src/b.ts#gamma", event: "deleted" },
        ],
      },
    ]);
  });

  it("non-git directory degrades cleanly (notGitRepo, never a throw)", async () => {
    // repoRoot is a plain temp dir here — no `git init`.
    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.notGitRepo).toBe(true);
    expect(preview.changedFiles).toEqual([]);
    expect(preview.pages).toEqual([]);
    expect(formatDiffPreviewHuman(preview)).toContain("not a git repository");
  });

  it("no existing index DB → no anchors to check, still reports changedFiles (never creates the DB)", async () => {
    await writeRepoFile("src/a.ts", "export function alpha() { return 1; }\n");
    gitInit();
    gitCommitAll("baseline");
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const preview = await previewWorkingTreeDebt(repoRoot);
    expect(preview.notGitRepo).toBe(false);
    expect(preview.changedFiles).toEqual(["src/a.ts"]);
    expect(preview.pages).toEqual([]);
    // Read-only guarantee: the preview must NOT have created the index.
    await expect(readFile(join(repoRoot, ".livewiki/index.db"))).rejects.toThrow();
  });

  it("zero writes: index.db bytes are identical before and after the preview", async () => {
    await setupBaseline();
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }\n");

    const dbPath = join(repoRoot, ".livewiki", "index.db");
    const before = await readFile(dbPath);
    const preview = await previewWorkingTreeDebt(repoRoot);
    const after = await readFile(dbPath);

    expect(preview.pages.length).toBe(1); // the preview actually did work
    expect(after.equals(before)).toBe(true);
  });
});
