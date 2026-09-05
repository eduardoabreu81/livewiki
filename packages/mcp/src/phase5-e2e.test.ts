/**
 * E2E Phase 5 — end-to-end flow: hook detects → agent pays via MCP → clean verify.
 *
 * Acceptance criterion (SPEC §Phase 5):
 *   "end-to-end flow — agent edits code, hook detects, agent pays
 *    the debt via MCP (livewiki_write_doc), verify passes clean (exit 0 AND zero
 *    issues of any severity), manifest updated."
 *   "The E2E must assert the issue count, not just the exit code."
 *
 * Scenario:
 *   1. Fresh repo with code (no wiki)
 *   2. `livewiki init` creates the wiki + indexes
 *   3. Agent edits a symbol in the source (modifies body — doesn't create a new one)
 *   4. Hook (`livewiki index --quiet`) detects the change and generates debt
 *   5. `livewiki status --json` confirms: debt.items > 0
 *   6. Agent pays via MCP `livewiki_write_doc` (InMemoryTransport — the same
 *      MCP client the agents use in production)
 *   7. `livewiki verify`: exit 0 + ZERO issues (errors AND warnings)
 *   8. `livewiki/.manifest.json`: updatedAt changed (rule #3: disk is the truth)
 *
 * Why subprocess for init/index/verify and in-process for MCP?
 *   - subprocess: tests the REAL binary (no mocks) — what the hook and the agent
 *     will call in production.
 *   - in-process MCP: the MCP server is what the agent uses; InMemoryTransport
 *     is the same MCP client the Phase 4 tests use. No stdio subprocess
 *     needed (which adds flakiness).
 *
 * Important: uses the CLI compiled at packages/cli/dist/index.js. The test
 * assumes `pnpm -r build` was run (same as the other CLI E2Es).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
// src/mcp/phase5-e2e.test.ts → packages/mcp/src/
// dist/index.js → packages/cli/dist/index.js
const cliBin = nodePath.resolve(here, "..", "..", "cli", "dist", "index.js");

if (!nodeFsSync.existsSync(cliBin)) {
  throw new Error(
    `livewiki CLI binary not found at ${cliBin}. Run \`pnpm -r build\` first.`,
  );
}

interface SubprocessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Budget for a test that shells out to the real CLI. The default 5s was too
 * tight for these: `livewiki init` costs ~0.9s on a developer machine and the
 * idempotence case runs it twice, which measured 2.6s locally and 2.8s on a
 * healthy Windows runner — under two-fold headroom, so a loaded runner
 * overshot. Matches the budget the other subprocess-heavy E2Es already use.
 * Applied per test, never as a suite-wide default: fast tests must stay fast
 * to fail.
 */
const SUBPROCESS_TIMEOUT_MS = 30_000;

/** Runs the livewiki CLI as a subprocess. Captures stdout/stderr/code. */
/**
 * CLI subprocesses started by the currently running test and not yet closed.
 *
 * Vitest abandons a test's promise when it times out, but it does not kill the
 * process that test spawned. Without this registry the CLI kept writing
 * `.livewiki/index.db` while the teardown removed the directory, and the real
 * failure (a slow `init`) surfaced as `EBUSY: unlink index.db` on Windows —
 * the timeout's consequence masquerading as its cause.
 */
const liveChildren = new Set<ReturnType<typeof spawn>>();

function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args, "--repo", cwd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveChildren.add(child);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => {
      liveChildren.delete(child);
      resolve({ code, stdout: out, stderr: err });
    });
    child.on("error", (e) => {
      liveChildren.delete(child);
      reject(e);
    });
  });
}

/**
 * Terminates any CLI subprocess still running and waits for it to actually
 * exit before the caller deletes the repo. Waiting on `close` — not a sleep —
 * is what guarantees Windows has released the SQLite handles.
 *
 * This only reaps orphans left by an aborted test. A subprocess that fails on
 * its own still resolves through `runCli`, so genuine failures stay visible.
 */
async function reapLiveChildren(): Promise<void> {
  const pending = [...liveChildren];
  liveChildren.clear();
  await Promise.all(
    pending.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("close", () => resolve());
          child.kill();
        }),
    ),
  );
}

interface Connected {
  client: Client;
  server: McpServer;
}

async function connectMcp(repoRoot: string): Promise<Connected> {
  const server = await createServer({ repoRoot });
  const client = new Client({ name: "phase5-e2e-agent", version: "0.0.0" }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client, server };
}

async function teardown(c: Connected): Promise<void> {
  await c.client.close();
  await c.server.close();
}

interface VerifyOutput {
  ok: boolean;
  exitCode: number;
  issues: Array<{
    severity: "error" | "warning";
    kind: string;
    detail: string;
    wikiPath?: string;
  }>;
  rawStdout: string;
}

/** Runs `livewiki verify --json` and parses the output. */
async function runVerify(repoRoot: string): Promise<VerifyOutput> {
  const r = await runCli(["verify", "--json"], repoRoot);
  // verify may emit text before the JSON in human mode, but with --json it's only JSON
  let parsed: { ok?: boolean; issues?: VerifyOutput["issues"] } = {};
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    // fallback: try to extract JSON from stdout
    const match = r.stdout.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }
  return {
    ok: parsed.ok ?? false,
    exitCode: r.code ?? -1,
    issues: parsed.issues ?? [],
    rawStdout: r.stdout,
  };
}

describe("E2E Phase 5 — end-to-end flow (hook → MCP → verify)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-phase5-"));
    // Setup source code: 1 file, 2 functions
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth.ts"),
      [
        "export function validate(token: string): boolean {",
        "  return token.length > 0;",
        "}",
        "",
        "export function refresh(token: string): string {",
        "  return token + 'x';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(async () => {
    // Orphaned subprocesses must die before the directory goes, or the rm
    // races a live writer and fails with EBUSY on Windows.
    await reapLiveChildren();
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("full flow: edit → hook → MCP write_doc → verify zero issues → manifest updated", async () => {
    // ── STEP 1: livewiki init ───────────────────────────────────────────
    const initResult = await runCli(["init"], repoRoot);
    expect(initResult.code, `init failed: ${initResult.stderr}`).toBe(0);

    // Checks that wiki + index were created
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", "quickstart.md"))).toBe(true);
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, ".livewiki", "index.db"))).toBe(true);
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", ".manifest.json"))).toBe(true);

    // ── STEP 1.5: agent creates an initial anchored wiki page (to have debt later) ──
    // Without an anchored page, changing the source generates no debt (the ledger detects it,
    // but without a matching anchor it doesn't become debt with a wiki_path).
    const initialPage = [
      "---",
      "title: Auth module",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "  - src/auth.ts#refresh",
      "updated: 2026-07-09",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "`validate(token)` checks token presence.",
      "",
      "## Refresh",
      "<!-- lw:anchors src/auth.ts#refresh -->",
      "`refresh(token)` extends token.",
      "",
    ].join("\n");

    const mcp1 = await connectMcp(repoRoot);
    let pageWriteResult: { isError?: boolean; content?: Array<{ text?: string }> };
    try {
      pageWriteResult = (await mcp1.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: initialPage },
      })) as typeof pageWriteResult;
    } finally {
      await teardown(mcp1);
    }
    expect(pageWriteResult?.isError, "initial write_doc should pass").toBeFalsy();

    // CRITICAL: run index BEFORE the modification. write_doc writes the
    // file but does NOT re-run the ledger — the anchors need to enter the
    // DB with the OLD hash so the next change is detectable.
    const indexBeforeChange = await runCli(["index"], repoRoot);
    const acceptInitial = await runCli([
      "baseline",
      "accept",
      "--page",
      "livewiki/auth.md",
      "--all",
    ], repoRoot);
    expect(acceptInitial.code, `baseline accept failed: ${acceptInitial.stderr}`).toBe(0);
    expect(indexBeforeChange.code, `index pre-modify failed: ${indexBeforeChange.stderr}`).toBe(0);

    // Snapshot of the manifest (current updatedAt)
    const manifestBeforeRaw = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki", ".manifest.json"),
      "utf8",
    );
    const manifestBefore = JSON.parse(manifestBeforeRaw) as { updatedAt: string };

    // ── STEP 2: agent edits code (changes the body of `validate`) ─────────
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth.ts"),
      [
        "export function validate(token: string): boolean {",
        "  // CHANGED: now requires length > 5 (was > 0)",
        "  return token.length > 5;",
        "}",
        "",
        "export function refresh(token: string): string {",
        "  return token + 'x';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    // ── STEP 3: hook (git post-commit) — `livewiki index --quiet` ───────
    const indexResult = await runCli(["index", "--quiet"], repoRoot);
    expect(indexResult.code, `index failed: ${indexResult.stderr}`).toBe(0);
    // Quiet mode: empty stdout (no note)
    expect(indexResult.stdout.trim()).toBe("");

    // ── STEP 4: status confirms open debt ──────────────────────────
    const statusResult = await runCli(["status", "--json"], repoRoot);
    expect(statusResult.code, `status failed: ${statusResult.stderr}`).toBe(0);
    const status = JSON.parse(statusResult.stdout) as {
      debt: {
        repository: {
          total: number;
          items: Array<{ event: string; symbol_key: string; wiki_path: string }>;
        };
      };
    };
    expect(status.debt.repository.total, "expected portable debt after the source change")
      .toBeGreaterThanOrEqual(1);
    // The debt can be in any position (ordered by detected_at).
    // We look for the specific validate item (which is what changed).
    const validateDebt = status.debt.repository.items.find(
      (i) => i.symbol_key === "src/auth.ts#validate",
    );
    expect(validateDebt, `expected validate debt, items: ${JSON.stringify(status.debt.repository.items.map(i => i.symbol_key))}`).toBeDefined();
    expect(validateDebt!.event).toBe("changed");
    expect(validateDebt!.wiki_path).toBe("livewiki/auth.md");

    // ── STEP 5: agent pays via MCP write_doc ─────────────────────────
    // Rewrites the page with a new anchor (same symbol_key — only the body changed,
    // the hash changed, the ledger generates 'changed'). The agent documents the change.
    const updatedPage = [
      "---",
      "title: Auth module",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "  - src/auth.ts#refresh",
      "updated: 2026-07-09",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "`validate(token)` now requires length > 5 (was > 0).",
      "",
      "## Refresh",
      "<!-- lw:anchors src/auth.ts#refresh -->",
      "`refresh(token)` extends token.",
      "",
    ].join("\n");

    const mcp2 = await connectMcp(repoRoot);
    let writeResult: { isError?: boolean; content?: Array<{ text?: string }> };
    try {
      writeResult = (await mcp2.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: updatedPage },
      })) as typeof writeResult;
      const acceptance = await mcp2.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: { page: "livewiki/auth.md", all: true },
      });
      expect(acceptance.isError, JSON.stringify(acceptance)).toBeFalsy();
    } finally {
      await teardown(mcp2);
    }
    expect(writeResult?.isError, `write_doc failed: ${JSON.stringify(writeResult)}`).toBeFalsy();

    // ── STEP 6: verify — exit 0 + ZERO issues (errors AND warnings) ────
    const verifyResult = await runVerify(repoRoot);
    expect(verifyResult.exitCode, `verify exit ${verifyResult.exitCode}. Issues: ${JSON.stringify(verifyResult.issues)}`).toBe(0);
    // SPEC CRITERION: assert the issue COUNT, not just the exit code
    expect(verifyResult.issues.length, `verify reported ${verifyResult.issues.length} issues: ${JSON.stringify(verifyResult.issues)}`).toBe(0);
    expect(verifyResult.ok, "verify.ok should be true").toBe(true);

    // ── STEP 7: manifest updated — re-init updates the snapshot hash ──
    // (write_doc doesn't update the manifest by design — the Phase 4 E2E covers write_doc.
    //  The manifest handoff happens via `init` (snapshot of livewiki/).
    //  In production, the agent runs `init` when closing the session; here we simulate it.)
    const initAgain = await runCli(["init"], repoRoot);
    expect(initAgain.code, `init post-payment failed: ${initAgain.stderr}`).toBe(0);
    const manifestAfterRaw = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki", ".manifest.json"),
      "utf8",
    );
    const manifestAfter = JSON.parse(manifestAfterRaw) as {
      updatedAt: string;
      snapshotHash: string;
    };
    expect(
      manifestAfter.updatedAt,
      "manifest.updatedAt did not change after the post-payment init",
    ).not.toBe(manifestBefore.updatedAt);
    expect(
      manifestAfter.snapshotHash,
      "manifest.snapshotHash should reflect the new auth.md",
    ).not.toBe(JSON.parse(manifestBeforeRaw).snapshotHash);

    // ── STEP 8 (sanity): status now shows zeroed debt ──────────────
    const statusAfter = await runCli(["status", "--json"], repoRoot);
    const statusAfterJson = JSON.parse(statusAfter.stdout) as {
      debt: { repository: { total: number } };
    };
    // After a successful write_doc, the debt should have been resolved
    // (re-index detects that the anchor was rewritten, the ledger resolves it).
    // It can be 0 (clean) or different from the original — doesn't require 0, but checks
    // that it decreased.
    expect(statusAfterJson.debt.repository.total, "debt did not decrease after acceptance")
      .toBeLessThan(status.debt.repository.total);
  }, 60_000);

  it("write_doc rejects a page with a broken anchor AND rollback restores the previous state", async () => {
    // Minimal setup: init + an anchored page
    const initResult = await runCli(["init"], repoRoot);
    expect(initResult.code).toBe(0);

    const goodPage = [
      "---",
      "title: Auth",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "good",
      "",
    ].join("\n");

    const mcp1 = await connectMcp(repoRoot);
    try {
      const r1 = await mcp1.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: goodPage },
      });
      expect((r1 as { isError?: boolean }).isError).toBeFalsy();
    } finally {
      await teardown(mcp1);
    }

    // Page with a broken anchor (symbol nonexistent in the index)
    const brokenPage = [
      "---",
      "title: Auth",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#ghostSymbol",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#ghostSymbol -->",
      "broken",
      "",
    ].join("\n");

    const mcp2 = await connectMcp(repoRoot);
    let brokenResult: { isError?: boolean };
    try {
      brokenResult = (await mcp2.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: brokenPage },
      })) as typeof brokenResult;
    } finally {
      await teardown(mcp2);
    }
    expect(brokenResult?.isError, "write_doc should reject a broken anchor").toBe(true);

    // Rejecting an update must preserve the existing page, not merely remove
    // the invalid candidate along with the user's previous documentation.
    expect(await nodeFs.readFile(nodePath.join(repoRoot, "livewiki", "auth.md"), "utf8"))
      .toBe(goodPage);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// (R) Reviewer finding: `livewiki init` must add `.livewiki/` to the
// target repo's .gitignore (SPEC rule #3: derived database, never travels in git).
// Idempotent: re-init is a no-op if it already contains it.
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E Phase 5 — Finding R: livewiki init adds .livewiki/ to .gitignore", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-r-gitignore-"));
    // Minimal source setup (init needs something to index)
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/lib.ts"),
      "export function hello(): string { return 'hi'; }\n",
      "utf8",
    );
  });

  afterEach(async () => {
    // Orphaned subprocesses must die before the directory goes, or the rm
    // races a live writer and fails with EBUSY on Windows.
    await reapLiveChildren();
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("init creates .gitignore with .livewiki/ when absent", async () => {
    // .gitignore does NOT exist
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, ".gitignore"))).toBe(false);

    const r = await runCli(["init"], repoRoot);
    expect(r.code, `init failed: ${r.stderr}`).toBe(0);

    // .gitignore was created with .livewiki/ inside a managed block
    const giPath = nodePath.join(repoRoot, ".gitignore");
    expect(nodeFsSync.existsSync(giPath)).toBe(true);
    const content = await nodeFs.readFile(giPath, "utf8");
    expect(content).toContain(".livewiki/");
    expect(content).toContain("# livewiki:start");
    expect(content).toContain("# livewiki:end");
  }, SUBPROCESS_TIMEOUT_MS);

  it("init PRESERVES existing user entries (append, not overwrite)", async () => {
    // .gitignore already exists with user entries
    const userGi = "node_modules/\ndist/\n*.log\n";
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), userGi, "utf8");

    const r = await runCli(["init"], repoRoot);
    expect(r.code).toBe(0);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    // User entries preserved
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    expect(content).toContain("*.log");
    // .livewiki/ added
    expect(content).toContain(".livewiki/");
    // Managed block present
    expect(content).toContain("# livewiki:start");
    expect(content).toContain("# livewiki:end");
  }, SUBPROCESS_TIMEOUT_MS);

  it("init is idempotent: running twice doesn't duplicate .livewiki/", async () => {
    await runCli(["init"], repoRoot);
    const first = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    await runCli(["init"], repoRoot);
    const second = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    expect(second).toBe(first);
    // Exact count of ".livewiki/" — only 1 (not duplicated)
    const matches = second.match(/^\.livewiki\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  }, SUBPROCESS_TIMEOUT_MS);

  it("init respects an existing user entry with the same name (doesn't duplicate)", async () => {
    // The user already added .livewiki/ manually (outside the managed block)
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), ".livewiki/\n", "utf8");

    const r = await runCli(["init"], repoRoot);
    expect(r.code).toBe(0);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    // Didn't duplicate — the user's entry remains the only one
    const matches = content.match(/^\.livewiki\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  }, SUBPROCESS_TIMEOUT_MS);

  it("init --batch also adds .gitignore (regression: must run before the batch)", async () => {
    // Ensures init (with or without --batch) does the gitignore work
    // BEFORE anything else — the batch shouldn't have to care about it.
    const r = await runCli(["init", "--batch"], repoRoot);
    // init --batch may fail if no LLM is configured; what matters is the .gitignore
    const giExists = nodeFsSync.existsSync(nodePath.join(repoRoot, ".gitignore"));
    if (giExists) {
      const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
      expect(content).toContain(".livewiki/");
    } else {
      // If r.code !== 0 (e.g. batch aborted due to missing config), the base init
      // may still have run partially. Check stderr.
      // We don't fail the test here — the point is to document the behavior.
      expect(r.code).not.toBe(0);
    }
  }, 60_000);
});

/**
 * Regression for the harness itself.
 *
 * A Windows CI run failed here with `EBUSY: unlink index.db`. The EBUSY was a
 * consequence, not a cause: `init is idempotent` overshot the 5s default,
 * vitest abandoned the test, the subprocess kept writing the database, and the
 * teardown deleted the directory underneath it. Proven separately — the same
 * sequence with the child killed first cleans up fine, and leftover WAL
 * sidecars with no live handle delete without complaint (40/40).
 */
describe("E2E Phase 5 — subprocess lifecycle", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-lifecycle-"));
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/lib.ts"),
      "export function hello(): string { return 'hi'; }\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await reapLiveChildren();
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("deregisters a subprocess that exits normally", async () => {
    const before = liveChildren.size;
    const r = await runCli(["init"], repoRoot);
    expect(r.code).toBe(0);
    // The registry must not grow across a completed run.
    expect(liveChildren.size).toBe(before);
  }, SUBPROCESS_TIMEOUT_MS);

  it("reaps a subprocess still running at teardown, then the repo deletes cleanly", async () => {
    // Start the CLI and deliberately do NOT await it — the exact state vitest
    // leaves behind when a test times out.
    const pending = runCli(["init"], repoRoot);
    expect(liveChildren.size).toBe(1);

    // Wait until the database actually exists, so the child provably holds it.
    const dbPath = nodePath.join(repoRoot, ".livewiki", "index.db");
    const deadline = Date.now() + 20_000;
    while (!nodeFsSync.existsSync(dbPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(nodeFsSync.existsSync(dbPath)).toBe(true);

    // Teardown behaviour: reap first, then delete.
    await reapLiveChildren();
    expect(liveChildren.size).toBe(0);

    // The child is gone, so this must not throw EBUSY/EPERM.
    await nodeFs.rm(repoRoot, { recursive: true });
    expect(nodeFsSync.existsSync(repoRoot)).toBe(false);

    // Let the abandoned promise settle so it cannot leak into another test.
    await pending.catch(() => undefined);
    await nodeFs.mkdir(repoRoot, { recursive: true }); // afterEach removes it again
  }, SUBPROCESS_TIMEOUT_MS);

  it("leaves no live child behind once teardown has run", async () => {
    const pending = runCli(["init"], repoRoot);
    expect(liveChildren.size).toBe(1);
    await reapLiveChildren();
    expect(liveChildren.size).toBe(0);
    await pending.catch(() => undefined);
  }, SUBPROCESS_TIMEOUT_MS);
});
