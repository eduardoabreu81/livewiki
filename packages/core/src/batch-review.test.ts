/**
 * batch-review.test.ts — Regressions for the 11 independent reviewer findings.
 *
 * Each `describe` maps 1:1 to a finding in the plan, with a minimal
 * reproduction. Additional coverage: E2E init+batch proving that plan,
 * graph, overview, task IDs and page names use the SAME identity.
 *
 * Runs offline (programmable mock LLM, no network, no charge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, type BatchRunResult } from "./batch.js";
import * as safeIo from "./safe-io.js";
import * as modules from "./modules.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";
import type { PricingOverride } from "./pricing.js";
import { computeSnapshotHash, readManifest } from "./manifest.js";
import { emptyBaseline, writeBaseline } from "./baseline.js";

function makeCompactAuxiliaryPage(closedKeys: string[]): string {
  return [
    "---",
    "title: Auxiliary reference",
    "owner: generated",
    "anchors:",
    ...closedKeys.map((key) => `  - ${key}`),
    "---",
    "",
    "# Auxiliary reference",
    "",
    "This page documents auxiliary repository code.",
    "",
    "## When to use this page",
    "",
    "- Review the auxiliary implementation.",
    "- Change the supporting code safely.",
    "",
    "## How it fits",
    "",
    "This code supports development and is not a product runtime path.",
    "",
    "## Reference",
    "",
    ...closedKeys.flatMap((key) => [
      `### ${key}`,
      `<!-- lw:anchors ${key} -->`,
      "This indexed symbol belongs to the auxiliary implementation.",
      "",
    ]),
  ].join("\n");
}

/**
 * Valid #29 folder-purpose paragraph: plain prose, 40–800 chars, no
 * frontmatter/headings/fences/links/HTML comments/TODO.
 */
const VALID_FOLDER_PURPOSE =
  "This directory holds the auth module: login, session, and token handling.";

/** Valid stage-5c understanding page returned outside mock instrumentation. */
const VALID_UNDERSTANDING_PAGE = [
  "---",
  "title: Test repository",
  "owner: generated",
  "kind: understanding",
  "---",
  "",
  "# Test repository",
  "",
  "This test repository exercises the batch pipeline with a small product surface.",
  "",
].join("\n");

class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  /** #29: folder-purpose calls are real LLM calls, tracked separately. */
  public folderPurposeCount = 0;
  /** Index into `responses` — consumed only by page (non-folder) calls. */
  private pageCallIndex = 0;
  public responses: string[] = [];
  public costInputs: Array<{ inputTokens: number; outputTokens: number; model: string }> = [];

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — stage 5c has its own dedicated
    // suite (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callCount++;
    // #29: a product folder task asks for ONE plain-prose purpose paragraph
    // (system prompt: "Write the purpose paragraph of ONE folder page").
    // Answering with a module page would fail validateFolderPurpose, so the
    // mock discriminates on the system prompt and returns valid prose.
    if (/purpose paragraph of ONE folder page/.test(req.system ?? "")) {
      this.folderPurposeCount++;
      const result: GenerateResult = {
        content: VALID_FOLDER_PURPOSE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
      this.costInputs.push(result.usage);
      return result;
    }
    // Extract the closed key list from the user prompt (format "- <key>")
    const closedKeys: string[] = [];
    for (const line of req.user.split("\n")) {
      const m = /^- (\S+)$/.exec(line);
      if (m && m[1]) closedKeys.push(m[1]);
    }
    const content = this.responses[this.pageCallIndex++] ??
      (closedKeys.length > 0
        ? /compact auxiliary contract/i.test(`${req.system}\n${req.user}`)
          ? makeCompactAuxiliaryPage(closedKeys)
          : [
            "---",
            "title: Module responsibilities",
            "owner: generated",
            "anchors:",
            ...closedKeys.map((k) => `  - ${k}`),
            "---",
            "",
            "# Module responsibilities",
            "",
            "This page documents the module's indexed responsibilities.",
            "",
            "## When to use this page",
            "",
            "- Review this module's behavior.",
            "- Change this module's implementation.",
            "",
            "## How it fits",
            "",
            "This module provides one part of the repository implementation.",
            "",
            "## Details",
            "",
            `<!-- lw:anchors ${closedKeys.join(" ")} -->`,
            "",
            "Body.",
            "",
            ].join("\n")
        : "# t\n");
    const result: GenerateResult = {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
    this.costInputs.push(result.usage);
    return result;
  }
}

let repoRoot: string;
let llm: MockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-review-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'a'; }\nexport function logout() { return 'b'; }",
    "utf8",
  );
  llm = new MockLlm();
  // Roadmap #22: pin the pre-#22 stage-4 format for these review fixtures
  // (the mock pages emit no Diagram section); the #22-on behavior is covered
  // by module-diagram-format.test.ts and batch-module-diagrams.test.ts.
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify({ moduleDiagrams: false, deepHierarchy: false }),
    "utf8",
  );
  await writeBaseline(repoRoot, emptyBaseline());
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === Finding #1 — owner: human is untouchable with LF, CRLF and BOM; zero LLM calls ===
describe("review #1 — owner: human is untouchable (LF, CRLF, BOM) with zero LLM calls", () => {
  const variants: Array<{ name: string; page: string }> = [
    {
      name: "LF",
      page: "---\ntitle: x\nowner: human\n---\n\n# x\n",
    },
    {
      name: "CRLF",
      page: "---\r\ntitle: x\r\nowner: human\r\n---\r\n\r\n# x\r\n",
    },
    {
      name: "BOM + LF",
      page: "\uFEFF---\ntitle: x\nowner: human\n---\n\n# x\n",
    },
  ];

  for (const v of variants) {
    it(`detects owner: human with line endings ${v.name} and blocks BEFORE the LLM`, async () => {
      // #29: the fixture yields TWO page units — the file page
      // (`livewiki/auth/login.md`) and the folder page
      // (`livewiki/auth/index.md`). Both are seeded owner: human so BOTH
      // tasks refuse pre-LLM and the run makes zero LLM calls.
      await safeIo.mkdir(repoRoot, ".livewiki");
      await safeIo.writeText(repoRoot, "livewiki/auth/login.md", v.page);
      await safeIo.writeText(repoRoot, "livewiki/auth/index.md", v.page);

      llm.responses = ["OVERWRITTEN — should not appear"];
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
      });

      // ZERO LLM calls (owner:human blocks pre-LLM on both units)
      expect(llm.callCount).toBe(0);
      // failure recorded as refused_human_page on both units
      expect(result.failures.length).toBeGreaterThan(0);
      for (const f of result.failures) {
        expect(f.error.code).toBe("refused_human_page");
      }
      // Pages preserved byte-for-byte (BOM included)
      expect(await safeIo.readText(repoRoot, "livewiki/auth/login.md")).toBe(v.page);
      expect(await safeIo.readText(repoRoot, "livewiki/auth/index.md")).toBe(v.page);
    });
  }

  it("owner: mixed is allowed (revision) — only owner: human refuses the whole page", async () => {
    // Revision: `owner: mixed` means "human wrote the header +
    // manual blocks; generated regenerates only the auto part". The LLM
    // still gets called, but `tryWriteAndVerify` preserves the manual
    // bytes byte-for-byte.
    await safeIo.mkdir(repoRoot, ".livewiki");
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", "---\ntitle: x\nowner: mixed\n---\n");
    llm.responses = []; // mock generates valid page from the prompt
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    // LLM WAS called (the mixed page is regenerated, with manual blocks
    // preserved — but here there is no manual block, so it just regenerates)
    expect(llm.callCount).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("completed");
  });

  it("P0-2 EXACT: owner: mixed + lw:manual blocks; LLM regenerates prose; final page keeps owner=mixed and manuals byte-identical", async () => {
    // Reviewer revision: when the existing page is `owner: mixed` and has
    // `<!-- lw:manual -->` blocks, the LLM re-generates the page (with
    // owner: generated by validator rule), and the orchestrator must
    // force the final frontmatter back to `owner: mixed` BEFORE
    // write/verify. Without this, the page would be re-classified as
    // pure `generated` and lose the human-mixed signal.
    const manualBlock1 = "HUMAN MANUAL CONTENT #1 — must survive regenerate";
    const manualBlock2 = "HUMAN MANUAL CONTENT #2 — must survive regenerate";
    const existing = [
      "---",
      "title: Auth flow",
      "owner: mixed",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "## Login",
      "",
      "<!-- lw:manual -->",
      manualBlock1,
      "<!-- /lw:manual -->",
      "",
      "Prose about login (old, generated).",
      "",
      "## Logout",
      "",
      "<!-- lw:manual -->",
      manualBlock2,
      "<!-- /lw:manual -->",
      "",
      "Prose about logout (old, generated).",
      "",
    ].join("\n");

    await safeIo.mkdir(repoRoot, ".livewiki");
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", existing);

    // Mock LLM: produces a page with owner=generated, full closed-list
    // coverage, and NEW prose. Validator accepts it.
    // Manual blocks are NOT included (LLM never writes manual blocks
    // per rule #6). The orchestrator must inject them in the final
    // write, AND force owner back to "mixed" (reviewer revision P0-2).
    llm.responses = [
      [
        "---",
        "title: Auth flow",
        "owner: generated",
        "anchors:",
        "  - src/auth/login.ts#login",
        "  - src/auth/login.ts#logout",
        "---",
        "",
        "## Login",
        "",
        "<!-- lw:anchors src/auth/login.ts#login -->",
        "",
        "New prose for login (regenerated).",
        "",
        "## Logout",
        "",
        "<!-- lw:anchors src/auth/login.ts#logout -->",
        "",
        "New prose for logout (regenerated).",
        "",
      ].join("\n"),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // LLM was called (page was regenerated).
    expect(llm.callCount).toBeGreaterThanOrEqual(1);
    // Run completed (no verify failure on the rewritten page).
    if (result.status !== "completed") {
      // Surface the failure for debug.
      const errs = result.failures.map((f) => `${f.module}: ${f.error.code} — ${f.error.message}`).join("\n  ");
      throw new Error(`run status=${result.status} failures:\n  ${errs}`);
    }
    expect(result.status).toBe("completed");

    // Read the final page on disk.
    const finalBytes = (await safeIo.readText(repoRoot, "livewiki/auth/login.md")) ?? "";
    // 1. owner is forced back to `mixed`.
    expect(finalBytes).toMatch(/^owner:\s*mixed\b/m);
    expect(finalBytes).not.toMatch(/^owner:\s*generated\b/m);
    // 2. Manual blocks are byte-identical to the originals.
    expect(finalBytes).toContain(manualBlock1);
    expect(finalBytes).toContain(manualBlock2);
    // 3. Generated prose CHANGED (the LLM re-wrote it; the mock generates
    // new content from the closed key list, not the old prose).
    expect(finalBytes).not.toContain("Prose about login (old, generated).");
    expect(finalBytes).not.toContain("Prose about logout (old, generated).");
  });

  it("corrupt frontmatter (unparseable) is refused as untrusted", async () => {
    await safeIo.mkdir(repoRoot, ".livewiki");
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", "---\nbad: : :\n---\n");
    await safeIo.writeText(repoRoot, "livewiki/auth/index.md", "---\nbad: : :\n---\n");
    llm.responses = ["X"];
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(llm.callCount).toBe(0);
    // Corrupt frontmatter is treated as untrusted (refused) on every unit
    expect(result.failures.length).toBeGreaterThan(0);
    for (const f of result.failures) {
      expect(f.error.code).toMatch(/^refused_(human|unparseable)_page$/);
    }
  });
});

// === Finding #2 — IDs before edges/diagrams/quickstart/overview/tasks ===
// Already covered by the existing test "5 directories with leaf 'src' → 5 distinct pages".
// Adding: IDs are resolved BEFORE edges (not after), proven by the
// presence of `core-src` in `livewiki/architecture/overview.md` and in tasks.
describe("review #2 — unique IDs applied before edges/overview/tasks", () => {
  it("overview.md and tasks use the unique ID (core-src), not the colliding leaf (src)", async () => {
    // Setup: 3 packages with leaf "src"
    for (const d of ["packages/core", "packages/cli", "packages/mcp"]) {
      const dir = nodePath.join(repoRoot, d, "src");
      await nodeFs.mkdir(dir, { recursive: true });
      await nodeFs.writeFile(
        nodePath.join(dir, "a.ts"),
        `export function f_${d.replace(/[\\/]/g, "_")}() { return "x"; }`,
        "utf8",
      );
    }
    // Remove the auth dir from beforeEach
    await nodeFs.rm(nodePath.join(repoRoot, "src"), { recursive: true, force: true });

    // Mock generates valid page from the prompt (from the keys)
    llm.responses = [];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: false,
    });
    expect(result.status).toBe("completed");

    // Read overview.md (regenerated by batch at the end) and check that
    // the IDs are the unique ones, not the leaf "src"
    const overview = await safeIo.readText(repoRoot, "livewiki/architecture/overview.md");
    expect(overview).toMatch(/core-src/);
    expect(overview).toMatch(/cli-src/);
    expect(overview).toMatch(/mcp-src/);
    const navigationTasks = await safeIo.readText(repoRoot, "livewiki/tasks.md");
    // #29: tasks.md links the FOLDER pages (`<folderId>/index.md`); the
    // colliding leaf "src" never appears as an id.
    expect(navigationTasks).toContain("](core-src/index.md)");
    expect(navigationTasks).toContain("](cli-src/index.md)");
    expect(navigationTasks).toContain("](mcp-src/index.md)");
    expect(navigationTasks).not.toContain("](src/index.md)");

    // Task IDs in the DB: file units first (`<folderId>/<fileBase>`), then
    // the folder units (`<folderId>`).
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const tasks = db
        .prepare("SELECT DISTINCT target FROM batch_tasks WHERE stage = 4")
        .all() as Array<{ target: string }>;
      const taskIds = new Set(tasks.map((t) => t.target));
      // Folder units
      expect(taskIds.has("core-src")).toBe(true);
      expect(taskIds.has("cli-src")).toBe(true);
      expect(taskIds.has("mcp-src")).toBe(true);
      // File units
      expect(taskIds.has("core-src/a")).toBe(true);
      expect(taskIds.has("cli-src/a")).toBe(true);
      expect(taskIds.has("mcp-src/a")).toBe(true);
      // The leaf "src" alone is NOT among the tasks (collision was resolved)
      expect(taskIds.has("src")).toBe(false);
    } finally {
      db.close();
    }
  });
});

// === Finding #3 — defensive collision finalizes the run as aborted (not running) ===
describe("review #3 — defensive collision finalizes the run as aborted", () => {
  it("when assertUniqueModuleIds fires, the run is marked 'aborted' and never 'running'", async () => {
    // Force the assertUniqueModuleIds failure by mocking it
    const spy = vi.spyOn(modules, "assertUniqueModuleIds").mockImplementation(() => {
      throw new modules.DuplicateModuleIdError(
        "forced collision for test — modules [\"src\", \"src\"]",
      );
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
      }).catch((e) => ({ error: e as Error }) as unknown as BatchRunResult);

      // The run CANNOT be "completed" — abort is the only acceptable terminal status
      // when the defensive gate fires.
      const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      try {
        const row = db
          .prepare("SELECT status FROM batch_runs ORDER BY id DESC LIMIT 1")
          .get() as { status: string } | undefined;
        expect(row).toBeDefined();
        // Final status: 'aborted' (NEVER 'running')
        expect(row?.status).toBe("aborted");
        // summary_json has the abortedReason
        const summaryRow = db
          .prepare("SELECT summary_json FROM batch_runs ORDER BY id DESC LIMIT 1")
          .get() as { summary_json: string | null };
        expect(summaryRow?.summary_json).toBeTruthy();
        const summary = JSON.parse(summaryRow!.summary_json!);
        expect(summary.abortedReason).toMatch(/forced collision/);
      } finally {
        db.close();
      }

      // The function returned or threw — either way, the run is aborted
      expect(result).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});

// === Finding #4 — rollback failure is terminal (now for the ENTIRE RUN) ===
describe("review #4 — rollback failure aborts the ENTIRE RUN (not best-effort)", () => {
  it("rollback_failed aborts the run; second unit never calls LLM and never writes", async () => {
    // Reviewer revision: setup with 2 units. The first processed unit has
    // rollback_failed (safeIo.remove throws). Every other unit MUST NOT be
    // processed: zero LLM calls for it, zero page writes. The run is
    // finalized as "aborted" and the only failure recorded is from the
    // first unit.

    // Setup: 2 folders. Add a second TS file.
    // #29 units: file pages `auth/login` + `src/other`, folder pages
    // `auth` + `src`.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/other.ts"),
      "export function other() { return 'o'; }",
      "utf8",
    );

    // Mock verify: report a broken_anchor on EVERY wiki page currently on
    // disk. tryWriteAndVerify scopes issues to the written artifact, so the
    // page that was just written is the one that fails — whichever unit the
    // deterministic queue processes first.
    const verifyModule = await import("./verify.js");
    const verifySpy = vi.spyOn(verifyModule, "run");
    verifySpy.mockImplementation(async (root: string) => {
      const wikiDir = nodePath.join(root, "livewiki");
      const mdPages: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
          entries = await nodeFs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const abs = nodePath.join(dir, entry.name);
          if (entry.isDirectory()) await walk(abs);
          else if (entry.isFile() && entry.name.endsWith(".md")) mdPages.push(abs);
        }
      };
      await walk(wikiDir);
      return {
        ok: false,
        pagesChecked: mdPages.length,
        issues: mdPages.map((abs) => ({
          severity: "error" as const,
          code: "broken_anchor",
          wikiPath: nodePath.relative(root, abs).split(nodePath.sep).join("/"),
          detail: "injected broken_anchor",
        })),
      };
    });

    // Mock safeIo.remove: ALWAYS fails (rollback breaks)
    const removeSpy = vi.spyOn(safeIo, "remove").mockImplementation(async () => {
      throw new Error("simulated rollback failure");
    });

    // LLM mock that generates valid pages for ANY unit
    // (auto-extracts closed keys)
    llm.responses = []; // empty → uses auto-extract in MockLlm

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 0, // no repair — focus on the rollback path
      });

      // Run status: "aborted" (NOT "completed_with_failures")
      expect(result.status).toBe("aborted");

      // Only 1 LLM call was made (the first file unit) — every other unit
      // NEVER reached the LLM.
      expect(llm.callCount).toBe(1);

      // Only 1 failure (first unit with rollback_failed)
      expect(result.failures.length).toBe(1);
      expect(result.failures[0]?.error.code).toBe("rollback_failed");

      // Verify via DB: exactly ONE stage 4 task exists — the queue stopped
      // before creating any other unit's task.
      const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      try {
        const tasks = db
          .prepare("SELECT target, status FROM batch_tasks WHERE stage = 4 ORDER BY target")
          .all() as Array<{ target: string; status: string }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0]?.status).toBe("failed");
        // The failed task is the unit whose failure the run reported.
        expect(tasks[0]?.target).toBe(result.failures[0]?.module);
      } finally {
        db.close();
      }
    } finally {
      verifySpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

// === Finding #6 (reshaped by #29) — stage 2 is deterministic: no LLM refine ===
// The pre-#29 stage-2 LLM refine (and its validateRefinedModules rejection
// codes) was REMOVED: real repository units are not refinable. These tests
// pin the replacement contract: stage 2 never calls the LLM, persists a
// `done` checkpoint (with the optional community cross-check diagnostic),
// and the stage-4 queue is exactly the real file/folder units.
describe("review #6 — stage 2 has NO LLM refine: real units only (#29)", () => {
  it("stage 2 makes zero LLM calls even with refine enabled (noRefine: false)", async () => {
    // Pre-#29 this path called the LLM to refine the heuristic modules and
    // validated the JSON. Now the planner is deterministic; `--no-refine`
    // is a backward-compatible no-op.
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: false, // refine "enabled" — must still make ZERO stage-2 calls
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      // Stage-2 task persisted as done, with NO LLM usage and NO error.
      const s2 = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 2")
        .get() as { checkpoint_json: string };
      const cp = JSON.parse(s2.checkpoint_json) as {
        status: string;
        error?: { code: string };
        usageHistory: unknown[];
      };
      expect(cp.status).toBe("done");
      expect(cp.error).toBeUndefined();
      expect(cp.usageHistory).toHaveLength(0);

      // Stage-4 targets are exactly the real units of the fixture: the
      // file page `auth/login` and the folder page `auth`. No refined id
      // can ever enter the queue.
      const targets = db
        .prepare("SELECT DISTINCT target FROM batch_tasks WHERE stage = 4 ORDER BY target")
        .all() as Array<{ target: string }>;
      expect(targets.map((t) => t.target)).toEqual(["auth", "auth/login"]);
    } finally {
      db.close();
    }

    // Exactly 2 LLM calls: 1 file page + 1 folder purpose. Any refine call
    // would show up here.
    expect(llm.callCount).toBe(2);
    expect(llm.folderPurposeCount).toBe(1);
  });

  it("the run summary persists the deterministic partition (modulesRefined = folder units)", async () => {
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: false,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT summary_json FROM batch_runs ORDER BY id DESC LIMIT 1")
        .get() as { summary_json: string };
      const summary = JSON.parse(row.summary_json) as {
        modulesRefined: Array<{ id: string; paths: string[] }> | null;
      };
      // The name is legacy — the content is the deterministic folder-unit
      // partition, an EXACT cover of the indexed inventory.
      expect(summary.modulesRefined).toEqual([
        { id: "auth", paths: ["src/auth/login.ts"] },
      ]);
    } finally {
      db.close();
    }
  });
});

// === T0 (reshaped by #29) — exact partition with NO size-based splitting ===
// The pre-#29 refine-partition rejections (refine_incomplete_partition,
// refine_duplicate_path, refine_unknown_path) died with the refine pass.
// What remains worth pinning: the deterministic planner covers the indexed
// inventory EXACTLY, and legacy size budgets (maxModuleFiles /
// maxModuleSymbols) never split a real folder into `id-NN` chunks.
describe("T0 — real-units partition is exact and never size-split (#29)", () => {
  const FILES = [
    "src/auth/login.ts",
    "src/auth/session.ts",
    "src/auth/token.ts",
    "src/auth/roles.ts",
    "src/auth/audit.ts",
  ] as const;

  async function seedFiveFileRepo(): Promise<void> {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    for (const rel of FILES) {
      const base = nodePath.basename(rel, ".ts");
      await nodeFs.writeFile(
        nodePath.join(repoRoot, rel),
        `export function ${base}() { return '${base}'; }\n`,
        "utf8",
      );
    }
  }

  it("a 5-file folder yields 5 file units + 1 folder unit, an exact inventory cover", async () => {
    await seedFiveFileRepo();

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: false,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const targets = db
        .prepare("SELECT DISTINCT target FROM batch_tasks WHERE stage = 4 ORDER BY target")
        .all() as Array<{ target: string }>;
      const targetList = targets.map((t) => t.target);
      // 5 file pages + 1 folder page — no `auth-01`-style chunks.
      expect(targetList).toEqual([
        "auth",
        "auth/audit",
        "auth/login",
        "auth/roles",
        "auth/session",
        "auth/token",
      ]);
      expect(targetList.some((t) => /-\d+$/.test(t))).toBe(false);

      // Exact partition: the folder unit's paths are exactly the 5 files.
      const row = db
        .prepare("SELECT summary_json FROM batch_runs ORDER BY id DESC LIMIT 1")
        .get() as { summary_json: string };
      const summary = JSON.parse(row.summary_json) as {
        modulesRefined: Array<{ id: string; paths: string[] }> | null;
      };
      const planPaths = (summary.modulesRefined ?? []).flatMap((m) => m.paths).sort();
      expect(planPaths).toEqual([...FILES].sort());
    } finally {
      db.close();
    }

    // 5 file-page calls + 1 folder-purpose call; zero stage-2 calls.
    expect(llm.callCount).toBe(6);
    expect(llm.folderPurposeCount).toBe(1);
  });

  it("a folder larger than the legacy maxModuleFiles budget is NOT split into chunks", async () => {
    // 40 files > legacy maxModuleFiles (12): pre-#29 this folder became
    // `bulk-01`…`bulk-04` chunks. #29 keeps ONE folder unit + 40 file units.
    await nodeFs.rm(nodePath.join(repoRoot, "src"), { recursive: true, force: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/bulk"), { recursive: true });
    const paths: string[] = [];
    for (let i = 0; i < 40; i++) {
      const rel = `src/bulk/f${String(i).padStart(3, "0")}.ts`;
      paths.push(rel);
      await nodeFs.writeFile(
        nodePath.join(repoRoot, rel),
        `export function f${String(i).padStart(3, "0")}() { return ${i}; }\n`,
        "utf8",
      );
    }

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const targets = db
        .prepare("SELECT DISTINCT target FROM batch_tasks WHERE stage = 4 ORDER BY target")
        .all() as Array<{ target: string }>;
      const targetList = targets.map((t) => t.target);
      // 40 file units + 1 folder unit = 41, and NO chunk ids.
      expect(targetList).toHaveLength(41);
      expect(targetList).toContain("bulk");
      expect(targetList).toContain("bulk/f000");
      expect(targetList).toContain("bulk/f039");
      expect(targetList.some((t) => /-\d+$/.test(t))).toBe(false);
    } finally {
      db.close();
    }

    // 40 file-page calls + 1 folder-purpose call.
    expect(llm.callCount).toBe(41);
    expect(llm.folderPurposeCount).toBe(1);
  });
});

// === Finding #5 — pricing override preserved in repairs ===
describe("review #5 — pricing override is preserved in repairs (not just the initial call)", () => {
  it("cost of repairs is calculated with the config's override, not the embedded table", async () => {
    // Create config.json with an absurd pricing override (sentinel) that would
    // NEVER match the embedded table.
    await safeIo.mkdir(repoRoot, ".livewiki");
    const sentinelPrice: PricingOverride = {
      "claude-test-mock": { input: 9999, output: 9999 },
    };
    await safeIo.writeText(
      repoRoot,
      ".livewiki/config.json",
      JSON.stringify({
        provider: "anthropic",
        model: "claude-test-mock",
        pricing: sentinelPrice,
        // Roadmap #22: same pre-#22 format pins as beforeEach (this config overwrites it).
        moduleDiagrams: false,
        deepHierarchy: false,
      }),
    );

    // Initial: anchor outside the closed list → validator rejects
    // Repair 1: correct anchor → valid
    llm.responses = [
      "---\ntitle: t\nowner: generated\nanchors:\n  - bad-key\n---\n# t\n",
      "---\ntitle: t\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n  - src/auth/login.ts#logout\n---\n# t\n",
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // Status completed (repair succeeded)
    expect(result.status).toBe("completed");

    // Cost in the report MUST use the override (9999 USD/1M tokens). Without the
    // override preserved, the cost would be null (model outside the embedded
    // table). With the override, it is clearly non-null.
    // (input=100, output=50, both with 9999 USD/1M)
    // Total cost = 100 * 9999 / 1_000_000 + 50 * 9999 / 1_000_000
    //            = 0.9999 + 0.49995 = 1.49985 USD
    // But also only the last call (repair) needs to have the override
    // preserved, because the initial had an invalid artifact but usage was
    // recorded. As `accumulateUsage` sums the costUsd from the entry,
    // total cost = cost of initial (rejected but usage recorded) +
    // cost of repair (valid, with override).
    expect(result.totals.costUsd).not.toBeNull();
    expect(result.totals.costUsd!).toBeGreaterThan(1); // >> 0 proves override was applied
  });
});

// === Finding #6 — attempts monotonic after --only/resume ===
describe("review #6 — attempts remain monotonic after --only/resume", () => {
  it("--only increments attempt from the last persisted value (does not reset)", async () => {
    // Initial run
    const r1 = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(r1.status).toBe("completed");

    // Read initial attempt + usageHistory
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    let db = new Database(dbPath, { readonly: true });
    let task;
    try {
      task = db
        .prepare("SELECT id, checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = 'auth/login'")
        .get() as { id: number; checkpoint_json: string };
    } finally {
      db.close();
    }
    const cpBefore = JSON.parse(task.checkpoint_json) as {
      attempt: number;
      usageHistory: unknown[];
    };
    expect(cpBefore.attempt).toBe(1);
    expect(cpBefore.usageHistory.length).toBe(1);
    const taskIdBefore = task.id;

    // Reset the llm and re-run with --only (the task is re-processed and
    // usageHistory MUST accumulate, not replace).
    llm.callCount = 0;
    const { runOnly } = await import("./batch.js");
    const r2 = await runOnly({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      onlyTarget: "auth/login",
    });
    expect(r2.status).toBe("completed");
    expect(llm.callCount).toBe(1); // re-runs 1 task, 1 call

    // Re-read attempt and usageHistory
    db = new Database(dbPath, { readonly: true });
    try {
      task = db
        .prepare("SELECT id, checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = 'auth/login'")
        .get() as { id: number; checkpoint_json: string };
    } finally {
      db.close();
    }
    const cpAfter = JSON.parse(task.checkpoint_json) as {
      attempt: number;
      usageHistory: unknown[];
    };
    // Same task (same id) — runOnly updates the checkpoint, does not create another
    expect(task.id).toBe(taskIdBefore);
    // Monotonic: attempt grew (did not go back to 1)
    expect(cpAfter.attempt).toBe(2);
    // usageHistory accumulated (did not replace): 1 initial + 1 repair = 2
    expect(cpAfter.usageHistory.length).toBe(2);
  });

  it("multiple --only accumulate monotonically: usageHistory.attempt === [1,2,3,4]", async () => {
    // Reviewer revision (finding #5): after initial run + 3x --only,
    // usageHistory must have 4 entries with GLOBAL attempt [1, 2, 3, 4].
    // Before the fix, attempt was `i + 1` inside the repair loop, so
    // it reset on every new execution. Now it uses the global counter
    // `attempt` that persists in the checkpoint.
    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;

    // 3x --only
    const { runOnly } = await import("./batch.js");
    for (let i = 0; i < 3; i++) {
      await runOnly({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        onlyTarget: "auth/login",
      });
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = 'auth/login'")
        .get() as { checkpoint_json: string };
      const cp = JSON.parse(task.checkpoint_json) as {
        attempt: number;
        usageHistory: Array<{ attempt: number }>;
      };
      // 1 (initial) + 3 (--only) = 4 total attempts
      expect(cp.attempt).toBe(4);
      expect(cp.usageHistory.length).toBe(4);
      // GLOBAL counter, monotonic, no reset between runs
      expect(cp.usageHistory.map((u) => u.attempt)).toEqual([1, 2, 3, 4]);
    } finally {
      db.close();
    }
  });
});

// === Finding #7a — LLM cannot invent lw:manual blocks ===
describe("review #7a — validator rejects when LLM invents a <!-- lw:manual --> block", () => {
  it("artifact with <!-- lw:manual --> in body is rejected (model_invented_manual)", async () => {
    // Unit validation (without the full orchestrator)
    const { validateStage4Artifact } = await import("./artifact.js");
    const artifact = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "---",
      "",
      "# t",
      "",
      "## Section",
      "",
      "<!-- lw:manual -->",
      "Invented by LLM — should be rejected",
      "<!-- /lw:manual -->",
      "",
    ].join("\n");

    // Closed list matches the single declared anchor — rejection is for manual only.
    const result = validateStage4Artifact(artifact, ["src/auth/login.ts#login"]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "model_invented_manual")).toBe(true);
  });
});

// === Finding #7b — manual block preserves position + bytes ===
describe("review #7b — manual block preserves bytes and position (section)", () => {
  it("block in a section is re-injected in the corresponding section of new content", async () => {
    // We test the behavior end-to-end via orchestrator (the internal function
    // `injectManualBlocksBySection` is not exported).
    const existing = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## First section",
      "",
      "Some text.",
      "",
      "<!-- lw:manual -->",
      "MANUAL CONTENT — must survive",
      "<!-- /lw:manual -->",
      "",
      "## Second section",
      "",
      "More text.",
      "",
    ].join("\n");
    const newContent = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## First section",
      "",
      "<!-- lw:anchors src/auth/login.ts#login -->",
      "",
      "New prose here.",
      "",
      "## Second section",
      "",
      "<!-- lw:anchors src/auth/login.ts#logout -->",
      "",
      "Also new.",
      "",
    ].join("\n");

    // Access via dynamic import — do we re-export?
    // For now, we test the behavior via orchestrator
    // (write+verify cycle with LLM that does not write manual).
    // Mark that the function is tested indirectly in another test.

    // Direct test: use the full pipeline
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", existing);
    llm.responses = [newContent];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // Read the generated page
    const onDisk = await safeIo.readText(repoRoot, "livewiki/auth/login.md");

    // MANUAL CONTENT survived byte-for-byte
    expect(onDisk).toContain("MANUAL CONTENT — must survive");
    // Position: still inside the "first section" (before "## Second section")
    const firstIdx = onDisk.indexOf("## First section");
    const secondIdx = onDisk.indexOf("## Second section");
    const manualIdx = onDisk.indexOf("MANUAL CONTENT");
    expect(manualIdx).toBeGreaterThan(firstIdx);
    expect(manualIdx).toBeLessThan(secondIdx);
  });

  it("block without matching section in new goes to the end (not lost)", async () => {
    const existing = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "## Removed section",
      "",
      "<!-- lw:manual -->",
      "ORPHAN MANUAL",
      "<!-- /lw:manual -->",
      "",
    ].join("\n");
    const newContent = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## Totally different section",
      "",
      "<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->",
      "",
      "New prose.",
      "",
    ].join("\n");

    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", existing);
    llm.responses = [newContent];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    const onDisk = await safeIo.readText(repoRoot, "livewiki/auth/login.md");
    expect(onDisk).toContain("ORPHAN MANUAL");
  });

  it("revision: 2 blocks in the SAME section are preserved in order (E2E: status completed + identical bytes)", async () => {
    // Scenario: existing page has TWO manual blocks in the same section
    // ("Repeated section"). The LLM regenerates the page WITHOUT the
    // blocks (LLM never writes manual blocks — rule #6). The orchestrator
    // must reinsert BOTH blocks in the same section, IN ORIGINAL ORDER.
    const block1 = "FIRST MANUAL — must be first";
    const block2 = "SECOND MANUAL — must be second";
    const existing = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## Repeated section",
      "",
      "Some text.",
      "",
      "<!-- lw:manual -->",
      block1,
      "<!-- /lw:manual -->",
      "",
      "More text in the same section.",
      "",
      "<!-- lw:manual -->",
      block2,
      "<!-- /lw:manual -->",
      "",
      "## Other section",
      "",
      "Other content.",
      "",
    ].join("\n");
    const newContent = [
      "---",
      "title: t",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "  - src/auth/login.ts#logout",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## Repeated section",
      "",
      "<!-- lw:anchors src/auth/login.ts#login -->",
      "",
      "Totally new prose for the repeated section.",
      "",
      "## Other section",
      "",
      "<!-- lw:anchors src/auth/login.ts#logout -->",
      "",
      "Also new.",
      "",
    ].join("\n");

    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", existing);
    llm.responses = [newContent];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // E2E requirement: status completed (orchestrator succeeded, no
    // rollback failure, verify passed, blocks preserved)
    expect(result.status).toBe("completed");
    expect(result.failures).toHaveLength(0);

    const onDisk = await safeIo.readText(repoRoot, "livewiki/auth/login.md");

    // Both blocks present
    expect(onDisk).toContain(block1);
    expect(onDisk).toContain(block2);
    // In ORDER: block1 comes before block2 in the final page
    const idx1 = onDisk.indexOf(block1);
    const idx2 = onDisk.indexOf(block2);
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    // Both inside "## Repeated section" (before "## Other section")
    const repeatedIdx = onDisk.indexOf("## Repeated section");
    const otherIdx = onDisk.indexOf("## Other section");
    expect(repeatedIdx, onDisk).toBeGreaterThanOrEqual(0);
    expect(otherIdx, onDisk).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeGreaterThan(repeatedIdx);
    expect(idx2).toBeLessThan(otherIdx);

    // IDENTICAL BYTES: extract the whole blocks (including markers) and
    // check that each one is byte-equal to the original
    const block1Full = `<!-- lw:manual -->\n${block1}\n<!-- /lw:manual -->`;
    const block2Full = `<!-- lw:manual -->\n${block2}\n<!-- /lw:manual -->`;
    expect(onDisk).toContain(block1Full);
    expect(onDisk).toContain(block2Full);
  });
});

// === Finding #8 — prompt shows section-marker syntax with real canonical keys ===
describe("review #8 — prompt shows section-marker syntax using real keys", () => {
  it("buildStage4Prompt includes a concrete section-marker example with keys from the closed list", async () => {
    const { buildStage4Prompt } = await import("./prompts.js");
    const closed = ["src/auth.ts#login", "src/auth.ts#logout", "src/auth.ts#validate"];
    const r = buildStage4Prompt(
      { id: "auth", paths: ["src/auth.ts"], symbolCount: 3 },
      closed,
      "sym",
      "code",
      "en",
    );
    // The example uses the real keys (not placeholders like "key1")
    expect(r.user).toMatch(/<!--\s*lw:anchors\s+src\/auth\.ts#login\s+src\/auth\.ts#logout/);
    // And the system prompt has NO copyable placeholders
    expect(r.system).not.toMatch(/\bkey\d+\b/);
  });
});

// === Finding #9 — owner must be explicitly present ===
describe("review #9 — owner must be EXPLICITLY present and 'generated'", () => {
  it("artifact WITHOUT `owner:` line is rejected (missing_owner)", async () => {
    const { validateStage4Artifact } = await import("./artifact.js");
    const artifact = [
      "---",
      "title: t",
      // NO owner line
      "anchors:",
      "  - src/auth.ts#login",
      "---",
      "",
      "# t",
      "",
    ].join("\n");
    const result = validateStage4Artifact(artifact, ["src/auth.ts#login"]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_owner")).toBe(true);
  });

  it("artifact with owner: human is rejected (wrong_owner) — no fallback to 'generated'", async () => {
    const { validateStage4Artifact } = await import("./artifact.js");
    const artifact = [
      "---",
      "title: t",
      "owner: human",
      "anchors:",
      "  - src/auth.ts#login",
      "---",
      "",
      "# t",
      "",
    ].join("\n");
    const result = validateStage4Artifact(artifact, ["src/auth.ts#login"]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "wrong_owner")).toBe(true);
  });
});

// === Finding #10 — repair_exhausted preserves the last diagnostic ===
//
// Lot B (2026-07-12) re-shaped the `repair_exhausted` message to
// report the FULL ordered diagnostic sequence (one compact line per
// attempt) and the REAL error count (summed across this loop's
// attempts), not just the last attempt's error. The test below is
// updated to assert the new contract format while keeping the
// original intent: the terminal message MUST surface the validation
// errors that the operator needs to diagnose the failure.
describe("review #10 — repair_exhausted preserves the structured diagnostics", () => {
  it("repair_exhausted message reports the ordered per-attempt sequence and the real total", async () => {
    // 3 calls: initial + 2 repairs, all invalid
    llm.responses = [
      "---\ntitle: t\nowner: generated\nanchors:\n  - bad-key\n---\n# t\n",
      "---\ntitle: t\nowner: mixed\nanchors:\n  - src/auth/login.ts#login\n---\n# t\n",
      "---\ntitle: t\nowner: generated\nanchors:\n  - another-bad\n---\n# t\n",
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
    });

    expect(result.failures.length).toBe(1);
    expect(result.failures[0]?.error.code).toBe("repair_exhausted");
    const message = result.failures[0]!.error.message;

    // New contract: one ordered line per attempt, codes-only.
    // Both `bad-key` and `another-bad` raise `anchor_outside_closed_list`,
    // and attempt 2 raises `wrong_owner` (owner: mixed is not allowed
    // by the stage-4 validator).
    expect(message).toMatch(/attempt 1: .* -> artifact_validation_failed/);
    expect(message).toMatch(/attempt 2: .* -> artifact_validation_failed/);
    expect(message).toMatch(/attempt 3: .* -> artifact_validation_failed/);
    // The codes appear in the bracketed list (deduped, first-seen order).
    expect(message).toMatch(/\[anchor_outside_closed_list/);
    expect(message).toMatch(/wrong_owner/);
    // And the real total is reported (sum of errors.length +
    // truncatedErrorCount across the loop's attempts).
    expect(message).toMatch(/Total errors recorded: \d+\./);
    // The "Last diagnostic: ..." single-line tail of the pre-Lot B
    // message is gone — the per-attempt lines replace it.
    expect(message).not.toMatch(/Last diagnostic:/);
  });
});

// === Finding #11 (E2E) — init+batch: consistent identity ===
describe("review #11 — E2E: plan, graph, overview, task IDs and pages share the same identity", () => {
  it("all output artifacts reference the same unit IDs (5 leaf 'src' collisions)", async () => {
    // Setup: 5 packages with leaf "src" (benchmark scenario)
    for (const d of ["packages/core", "packages/cli", "packages/mcp", "tests/fixtures", "scripts"]) {
      const dir = nodePath.join(repoRoot, d, "src");
      await nodeFs.mkdir(dir, { recursive: true });
      await nodeFs.writeFile(
        nodePath.join(dir, "a.ts"),
        `export function f_${d.replace(/[\\/]/g, "_")}() { return "x"; }`,
        "utf8",
      );
    }
    await nodeFs.rm(nodePath.join(repoRoot, "src"), { recursive: true, force: true });

    // E2E: init (generates plan, diagrams, quickstart, overview) + batch
    // (re-runs plan, regenerates overview with real links, writes pages).
    const { runInit } = await import("./init.js");
    await runInit({
      repoRoot,
      quiet: true,
      // no `batch: true` — we only want the initial structure
    });

    // Init already applied uniqueness (via buildPlan). R11-NAV keeps product
    // folders in Tasks and moves auxiliary folders to one separate hub.
    const initQuickstart = await safeIo.readText(repoRoot, "livewiki/quickstart.md");
    expect(initQuickstart).toContain("[Tasks](tasks.md)");
    expect(initQuickstart).toContain("[Architecture overview](architecture/overview.md)");
    const initTasks = await safeIo.readText(repoRoot, "livewiki/tasks.md");
    // #29: before pages exist, tasks.md names each folder through its
    // display title with one "Page not written yet" line — #30 dropped the
    // raw `livewiki/<id>/index.md` path from the human surface. The identity
    // check below asserts the fallback titles never collapse to the bare
    // colliding leaf ("Src") and that exactly the 3 product folders are
    // listed as not written.
    const notWritten = initTasks.match(/Page not written yet/g) ?? [];
    expect(notWritten.length).toBe(3);
    const initHeadings = [...initTasks.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(initHeadings).not.toContain("Src");
    const initAuxiliary = await safeIo.readText(repoRoot, "livewiki/auxiliary/index.md");
    expect(initAuxiliary.match(/ — page not written yet$/gm)).toHaveLength(2);
    expect(initTasks).toContain("[Auxiliary areas](auxiliary/index.md)");
    expect(initTasks).not.toContain("## Test fixtures");
    expect(initTasks).not.toContain("## Tooling and benchmarks");

    // Run batch (generates pages, regenerates overview with links)
    await safeIo.writeText(
      repoRoot,
      ".livewiki/config.json",
      JSON.stringify({ maxTopics: 0, moduleDiagrams: false, deepHierarchy: false }),
    );
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: false,
    });
    expect(result.failures).toEqual([]);
    expect(result.status).toBe("completed");
    // #29: the 2 auxiliary folders (fixture + tooling) and their file pages
    // are assembled deterministically — zero LLM. The 3 product folders cost
    // 1 file-page call + 1 folder-purpose call each.
    expect(llm.callCount).toBe(6);
    expect(llm.folderPurposeCount).toBe(3);
    expect((await readManifest(repoRoot))?.snapshotHash).toBe(await computeSnapshotHash(repoRoot));

    // === Collect IDs from each FINAL surface ===

    // 1. Pages on disk (#29): `livewiki/<folderId>/index.md` (folder page,
    //    surfaced as the bare folder id) and `livewiki/<folderId>/<file>.md`
    //    (file page). Reserved hubs and deterministic root pages are not
    //    unit pages.
    const RESERVED = new Set(["topics", "flows", "architecture", "diagrams", "auxiliary"]);
    const ROOT_PAGES = new Set(["quickstart.md", "tasks.md", "understanding.md", ".manifest.json"]);
    const pageIds = new Set<string>();
    const livewikiDir = nodePath.join(repoRoot, "livewiki");
    const walkWiki = async (relDir: string): Promise<void> => {
      const absDir = relDir === "" ? livewikiDir : nodePath.join(livewikiDir, relDir);
      const entries = await nodeFs.readdir(absDir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!RESERVED.has(entry.name)) await walkWiki(rel);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        if (relDir === "" && ROOT_PAGES.has(entry.name)) continue;
        const noExt = rel.replace(/\.md$/, "");
        pageIds.add(noExt.endsWith("/index") ? noExt.slice(0, -"/index".length) : noExt);
      }
    };
    await walkWiki("");

    // 2. Task IDs in batch_tasks.target
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    let taskIds: Set<string>;
    let runSummary: { modulesRefined: Array<{ id: string; paths: string[] }> | null };
    try {
      const rows = db
        .prepare("SELECT DISTINCT target FROM batch_tasks WHERE stage = 4")
        .all() as Array<{ target: string }>;
      taskIds = new Set(rows.map((r) => r.target));
      const summaryRow = db
        .prepare("SELECT summary_json FROM batch_runs ORDER BY id DESC LIMIT 1")
        .get() as { summary_json: string | null };
      runSummary = JSON.parse(summaryRow!.summary_json!);
    } finally {
      db.close();
    }

    // 3. modules.mmd (generated by init): when there are edges, lists the nodes. When
    //    there are no edges, shows only the placeholder. We only verify that it does NOT
    //    leak non-unique IDs (leaf "src" does not appear as a node).
    const mmd = await safeIo.readText(repoRoot, "livewiki/architecture/modules.mmd");
    expect(mmd).not.toMatch(/^\s*src\s*\[/m);

    // 4. R11-NAV routes product folder IDs through tasks.md and auxiliary
    //    folder IDs through the single auxiliary hub. Both use the same
    //    stable folder IDs as the folder pages (`<id>/index.md`).
    const quickstart = await safeIo.readText(repoRoot, "livewiki/quickstart.md");
    expect(quickstart).not.toMatch(/overview\.md#[\w-]+/);
    const tasks = await safeIo.readText(repoRoot, "livewiki/tasks.md");
    const navigationTaskIds = new Set<string>();
    for (const m of tasks.matchAll(/\]\(([\w-]+)\/index\.md\)/g)) {
      if (m[1] && m[1] !== "auxiliary") navigationTaskIds.add(m[1]);
    }
    expect(navigationTaskIds.size).toBe(3);
    for (const id of navigationTaskIds) {
      expect(id).not.toBe("src"); // leaf "src" alone NEVER appears
    }
    const auxiliary = await safeIo.readText(repoRoot, "livewiki/auxiliary/index.md");
    const auxiliaryIds = new Set<string>();
    for (const m of auxiliary.matchAll(/\]\(\.\.\/([\w-]+)\/index\.md\)/g)) {
      if (m[1]) auxiliaryIds.add(m[1]);
    }
    expect(auxiliaryIds.size).toBe(2);
    for (const id of auxiliaryIds) expect(id).not.toBe("src");
    const navigationIds = new Set([...navigationTaskIds, ...auxiliaryIds]);
    // R10.1 E: tasks.md carries no `Module ID:` line at all — the stable
    // module id lives in the architecture overview (asserted below).
    expect(tasks).not.toContain("Module ID:");

    // 5. overview.md (regenerated by batch): links `[module page](../<id>/index.md)`
    const overview = await safeIo.readText(repoRoot, "livewiki/architecture/overview.md");
    const overviewIds = new Set<string>();
    for (const m of overview.matchAll(/\(\.\.\/([\w-]+)\/index\.md\)/g)) {
      if (m[1] && m[1] !== "auxiliary") {
        overviewIds.add(m[1]);
      }
    }
    expect(overviewIds.size).toBe(3);
    expect(overview).toContain("[Auxiliary areas](../auxiliary/index.md)");

    // 6. summary.modulesRefined (batch persisted): the folder-unit partition
    const summaryIds = new Set(
      (runSummary.modulesRefined ?? []).map((m) => m.id),
    );
    expect(summaryIds.size).toBe(5);

    // === Critical IDs still match; primary overview/tasks intentionally carry
    // only the product subset while their union with the auxiliary hub is full. ===
    // 5 folder pages + 5 file pages = 10 unit pages and 10 stage-4 tasks.
    expect(pageIds.size).toBe(10);
    expect(taskIds.size).toBe(10);
    expect(navigationIds.size).toBe(5);
    expect(overviewIds.size).toBe(3);
    expect(summaryIds.size).toBe(5);

    // pages === tasks (batch creates pages based on the unit ID)
    expect(taskIds).toEqual(pageIds);
    // folder pages are exactly the units whose id has no file segment
    const folderIds = new Set([...pageIds].filter((id) => !id.includes("/")));
    expect(folderIds.size).toBe(5);
    // every file page lives under one of the folder ids
    for (const id of pageIds) {
      if (id.includes("/")) {
        expect(folderIds.has(id.slice(0, id.indexOf("/")))).toBe(true);
      }
    }
    // folder pages === all navigation targets (display titles never become identity)
    expect(navigationIds).toEqual(folderIds);
    // product Tasks === product overview; auxiliary pages stay one hop away.
    expect(overviewIds).toEqual(navigationTaskIds);
    // folder pages === summary.modulesRefined (summary persists the partition)
    expect(summaryIds).toEqual(folderIds);
  });
});
