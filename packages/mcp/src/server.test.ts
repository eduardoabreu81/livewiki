/**
 * E2E Phase 4 — MCP server with InMemoryTransport (no real stdio needed).
 *
 * Connects an McpServer (livewiki) with a Client (mock agent) via a pair of
 * InMemoryTransport. Validates:
 *   - handshake (initialize)
 *   - tools/list returns the 6 tools
 *   - tools/call for each one with valid input
 *   - write_doc rejects a path outside livewiki/ (SPEC rule #1)
 *   - write_doc rejects content with broken_anchor (post-write verify)
 *   - read returns pages
 *   - quickstart returns the file
 *   - search returns FTS5 hits
 *   - debt returns the status report
 *   - resolve_debt closes debts
 *
 * Acceptance criterion (SPEC §"Phase 4"): connected to a real MCP client,
 * write_doc rejects paths outside livewiki/ and content that doesn't pass verify.
 *
 * IMPORTANT — Windows file locking: better-sqlite3 opens search.db with
 * WAL (search.db-shm / search.db-wal). The afterEach runs a recursive nodeFs.rm,
 * which can fail with EBUSY if the DB is still open.
 * That's why each test closes server + client in a finally.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type CreateServerOptions } from "./server.js";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-mcp-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/utils"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'ok'; }\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/utils/helper.ts"),
    "export function help() { return 'utils'; }\n",
  );
  // Programmatic init (doesn't go through the CLI to be faster/controlled)
  const { runInit } = await import("@livewiki/core/init");
  await runInit({ repoRoot, quiet: true });
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

interface Connected {
  client: Client;
  server: McpServer;
}

/** Helper: connects server + client via InMemoryTransport.
 *  Returns both so they can be closed before afterEach (releases FTS5 on Windows). */
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> {
  const server = await createServer({ repoRoot, ...opts });
  const client = new Client({ name: "test-agent", version: "0.0.0" }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client, server };
}

async function teardown(c: Connected): Promise<void> {
  await c.client.close();
  await c.server.close();
}

/** Runs git in the test repo (same spawn discipline as core's diff-preview tests). */
function git(args: string[]): void {
  const r = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  expect(r.status, `git ${args.join(" ")} failed: ${r.stderr}`).toBe(0);
}

describe("MCP server — Phase 4", () => {
  it("tools/list returns the 8 tools, including the agent bootstrap queue", async () => {
    const c = await connect();
    try {
      const { tools } = await c.client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "livewiki_debt",
        "livewiki_impact",
        "livewiki_next_task",
        "livewiki_quickstart",
        "livewiki_read",
        "livewiki_resolve_debt",
        "livewiki_search",
        "livewiki_write_doc",
      ]);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_quickstart returns the file content", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_quickstart", arguments: {} });
      const text = extractText(r);
      expect(text).toMatch(/Quickstart|Guia/);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read reads a wiki page", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "livewiki/quickstart.md" },
      });
      const text = extractText(r);
      expect(text).toMatch(/Quickstart|Guia/);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read rejects a path outside livewiki/ (SPEC rule #1)", async () => {
    const c = await connect();
    try {
      // The server returns isError=true (no throw) with a clear message — more
      // useful to the MCP client than an McpError stack trace.
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "src/auth/login.ts" },
      });
      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toMatch(/allowlist|outside|livewiki/i);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_search returns hits via FTS5", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: "modules", limit: 10 },
      });
      const text = extractText(r);
      const parsed = JSON.parse(text);
      expect(Array.isArray(parsed.hits)).toBe(true);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_debt returns the repo's JSON status", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_debt", arguments: {} });
      const text = extractText(r);
      const report = JSON.parse(text);
      expect(report.files).toBeDefined();
      expect(report.symbols).toBeDefined();
      expect(report.debt).toBeDefined();
      expect(report.undocumented).toBeDefined();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact reports a direct caller and the pages that cite it", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/utils/helper.ts"),
      "export function help() { return 'utils'; }\nexport function useHelp() { return help(); }\n",
    );
    const { run: runIndexer } = await import("@livewiki/core/indexer");
    await runIndexer(repoRoot, { quiet: true });

    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/utils/helper.ts#help" },
      });
      const parsed = JSON.parse(extractText(r));
      expect(parsed.symbolKey).toBe("src/utils/helper.ts#help");
      expect(parsed.directCallers).toContain("src/utils/helper.ts#useHelp");
      expect(parsed.truncated).toBe(false);
      expect(Array.isArray(parsed.affectedPages)).toBe(true);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact returns empty callers for a symbol nothing calls", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/auth/login.ts#login" },
      });
      const parsed = JSON.parse(extractText(r));
      expect(parsed.directCallers).toEqual([]);
      expect(parsed.transitiveCallers).toEqual([]);
    } finally {
      await teardown(c);
    }
  });

  // Backlog #2 (plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
  // Item 2): an EMPTY symbolKey returns the repo-wide change-impact package
  // (the same block `livewiki update` emits) instead of the per-symbol blast
  // radius. The fixture is a real git repo: the working-tree seed diffs vs HEAD.
  it("livewiki_impact with an empty symbolKey returns the repo-wide change-impact package", async () => {
    // Wiki page anchoring login → the impact must name this page.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".gitignore"),
      ".livewiki/\n",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/login.md"),
      "---\ntitle: login\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n---\n\n# login\n\nDocs.\n",
    );
    const { run: runIndexer } = await import("@livewiki/core/indexer");
    const { run: runLedger } = await import("@livewiki/core/anchor-ledger");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
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
    // Uncommitted change: the working-tree seed catches it without reindexing.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 'changed'; }\n",
    );

    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "" },
      });
      expect(r.isError).toBeFalsy();
      const parsed = JSON.parse(extractText(r));
      expect(parsed.mode).toBe("working-tree");
      expect(parsed.notGitRepo).toBe(false);
      expect(parsed.changedFiles).toEqual(["src/auth/login.ts"]);
      expect(parsed.changedSymbols).toEqual([
        { symbolKey: "src/auth/login.ts#login", event: "changed" },
      ]);
      expect(parsed.pages).toEqual([
        {
          wikiPath: "livewiki/login.md",
          items: [{ symbolKey: "src/auth/login.ts#login", event: "changed" }],
        },
      ]);
      expect(parsed.snippets.length).toBe(1);
      expect(parsed.snippets[0].snippet).toMatch(/changed/);
      expect(parsed.truncated).toBe(false);
      expect(Array.isArray(parsed._hints)).toBe(true);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc accepts valid content and updates the FTS5 index", async () => {
    const c = await connect();
    try {
      // Page without an anchor = verify OK (no broken_anchor)
      const content = `---
title: scratch
owner: generated
---

# scratch

Notes aqui.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/scratch.md", content },
      });
      const text = extractText(r);
      expect(text).toMatch(/wrote livewiki\/scratch\.md/);
      const onDisk = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/scratch.md"),
        "utf8",
      );
      expect(onDisk).toContain("# scratch");
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rejects a path outside livewiki/ (rule #1)", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "src/evil.ts", content: "export {}" },
      });
      // The server returns isError=true with an InvalidParams McpError (a path outside
      // the allowlist is invalid input from the MCP's point of view).
      // The client SDK may wrap it as a throw OR return isError —
      // we accept both, but the result must signal rejection.
      const rejected = r.isError === true;
      if (!rejected) {
        // Fallback: try to detect via a thrown McpError
        let threw = false;
        try {
          await c.client.callTool({
            name: "livewiki_write_doc",
            arguments: { path: "src/evil2.ts", content: "export {}" },
          });
        } catch {
          threw = true;
        }
        expect(threw, "write_doc should reject a path outside livewiki/").toBe(true);
      }
      // Ensures the file was NOT created
      await expect(
        nodeFs.access(nodePath.join(repoRoot, "src/evil.ts")),
      ).rejects.toThrow();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rejects content with a broken anchor (verify)", async () => {
    const c = await connect();
    try {
      // Anchor for a symbol that does NOT exist in the index
      const broken = `---
title: broken
owner: generated
anchors:
  - src/auth/login.ts#symbolQueNaoExiste
---

# broken

References a symbol that does not exist.

<!-- lw:anchors src/auth/login.ts#symbolQueNaoExiste -->

Content.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/broken.md", content: broken },
      });
      // The result comes with isError=true (doesn't throw, but marks an error)
      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toMatch(/verify rejected/);
      // Ensures the file was NOT written (rollback)
      await expect(
        nodeFs.access(nodePath.join(repoRoot, "livewiki/broken.md")),
      ).rejects.toThrow();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rolls back and fails closed when verify crashes", async () => {
    const crashMessage = "synthetic verifier crash";
    const path = "livewiki/verify-crash.md";
    const sentinel = "lotkverifycrashsentinel";
    const c = await connect({
      verify: async () => {
        throw new Error(crashMessage);
      },
    });
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path, content: `# Verify crash\n\n${sentinel}\n` },
      });

      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toContain(crashMessage);
      expect(text).toMatch(/not kept/i);
      await expect(nodeFs.access(nodePath.join(repoRoot, path))).rejects.toThrow();

      const searchResult = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: sentinel },
      });
      const parsed = JSON.parse(extractText(searchResult)) as { hits: unknown[] };
      expect(parsed.hits).toEqual([]);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc warns about an UNVERIFIED path when crash rollback fails", async () => {
    const crashMessage = "synthetic verifier crash after external removal";
    const path = "livewiki/rollback-failure.md";
    const c = await connect({
      verify: async () => {
        await nodeFs.unlink(nodePath.join(repoRoot, path));
        throw new Error(crashMessage);
      },
    });
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path, content: "# Rollback failure\n" },
      });

      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toContain(crashMessage);
      expect(text).toContain("UNVERIFIED");
      expect(text).toContain(path);
      expect(text).toMatch(/inspect/i);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc accepts with skipVerify=true (documented escape hatch)", async () => {
    const c = await connect();
    try {
      const content = `# skip verify ok\n`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          path: "livewiki/skip.md",
          content,
          skipVerify: true,
        },
      });
      const text = extractText(r);
      expect(text).toMatch(/wrote livewiki\/skip\.md/);
      const onDisk = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/skip.md"),
        "utf8",
      );
      expect(onDisk).toContain("skip verify ok");
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_resolve_debt accepts anchored symbols into the durable baseline", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/login.md"),
      "---\ntitle: login\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n---\n\n# login\n\nDocs.\n",
    );
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: { page: "livewiki/login.md", all: true },
      });
      const parsed = JSON.parse(extractText(r));
      expect(parsed.page).toBe("livewiki/login.md");
      expect(parsed.accepted).toEqual(["src/auth/login.ts#login"]);

      const { readBaseline } = await import("@livewiki/core/baseline");
      const baseline = await readBaseline(repoRoot);
      expect(baseline.state).toBe("available");
      if (baseline.state !== "available") throw new Error("expected available baseline");
      expect(baseline.baseline.entries).toEqual([
        expect.objectContaining({
          wikiPath: "livewiki/login.md",
          symbolKey: "src/auth/login.ts#login",
          provenance: "accepted",
        }),
      ]);
    } finally {
      await teardown(c);
    }
  });

  it("search_db is created at .livewiki/search.db (FTS5 schema)", async () => {
    const c = await connect();
    try {
      const exists = await nodeFs
        .access(nodePath.join(repoRoot, ".livewiki/search.db"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      await teardown(c);
    }
  });
});

/**
 * Roadmap item 14 (in-session cost accounting): the MCP write/resolve
 * surfaces record into the same append-only activity ledger the CLI uses.
 * Recording is fire-and-forget, so tests poll the snapshot briefly.
 */
describe("MCP server — activity ledger (roadmap item 14)", () => {
  async function pollSnapshot(
    cond: (s: import("@livewiki/core/update-metrics").UpdateMetricsSnapshot) => boolean,
    timeoutMs = 5000,
  ): Promise<import("@livewiki/core/update-metrics").UpdateMetricsSnapshot> {
    const { snapshotMetrics } = await import("@livewiki/core/update-metrics");
    const deadline = Date.now() + timeoutMs;
    let snap = await snapshotMetrics(repoRoot);
    while (!cond(snap) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      snap = await snapshotMetrics(repoRoot);
    }
    return snap;
  }

  it("livewiki_write_doc records a write_received entry on success", async () => {
    const content = `---
title: ledger-check
owner: generated
---

# ledger-check

Content here.
`;
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/ledger-check.md", content },
      });
      expect(extractText(r)).toMatch(/wrote livewiki\/ledger-check\.md/);

      const snap = await pollSnapshot((s) => s.writesReceived === 1);
      expect(snap.writesReceived).toBe(1);
      const entry = snap.recent[snap.recent.length - 1];
      if (entry?.kind !== "write_received") throw new Error("expected write_received");
      expect(entry.wikiPath).toBe("livewiki/ledger-check.md");
      expect(entry.bytes).toBe(Buffer.byteLength(content, "utf8"));
      expect(entry.tokensEstimated).toBe(Math.ceil(content.length / 4));
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_resolve_debt records debt_resolved with the resolved count", async () => {
    // Establish a portable baseline, then change the source to create debt.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".gitignore"),
      ".livewiki/\n",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/login.md"),
      "---\ntitle: login\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n---\n\n# login\n\nDocs.\n",
    );
    const { run: runIndexer } = await import("@livewiki/core/indexer");
    const { run: runLedger } = await import("@livewiki/core/anchor-ledger");
    const { acceptBaseline } = await import("@livewiki/core/baseline-operations");
    await runIndexer(repoRoot, { quiet: true });
    await acceptBaseline(repoRoot, { page: "livewiki/login.md", all: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 'changed'; }\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const c = await connect();
    try {
      const debtReport = JSON.parse(
        extractText(await c.client.callTool({ name: "livewiki_debt", arguments: {} })),
      ) as { debt: { repository: { items: Array<{ event: string; symbol_key: string }> } } };
      expect(debtReport.debt.repository.items).toEqual([
        expect.objectContaining({ event: "changed", symbol_key: "src/auth/login.ts#login" }),
      ]);

      // A rejected acceptance records nothing.
      const miss = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: {
          page: "livewiki/login.md",
          symbols: ["src/auth/login.ts#missing"],
        },
      });
      expect(miss.isError).toBe(true);

      const hit = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: {
          page: "livewiki/login.md",
          symbols: ["src/auth/login.ts#login"],
        },
      });
      expect(JSON.parse(extractText(hit)).accepted).toEqual(["src/auth/login.ts#login"]);

      const snap = await pollSnapshot((s) => s.debtResolvedTotal === 1);
      expect(snap.debtResolvedTotal).toBe(1);
      const resolvedEntries = snap.recent.filter((e) => e.kind === "debt_resolved");
      expect(resolvedEntries).toHaveLength(1);
      const entry = resolvedEntries[0]!;
      if (entry.kind !== "debt_resolved") throw new Error("expected debt_resolved");
      expect(entry.count).toBe(1);
      expect(entry.source).toBe("mcp");
    } finally {
      await teardown(c);
    }
  });
});

/**
 * Step 2d — workflow-adjacency hints (capability backlog item 4).
 * Every SUCCESS tool response must carry a static `_hints` block suggesting
 * the next most useful tool calls; error responses carry no hints.
 */
describe("MCP server — workflow-adjacency hints (Step 2d)", () => {
  it("livewiki_quickstart suggests search and read", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_quickstart", arguments: {} });
      expect(hintTools(r)).toEqual(["livewiki_search", "livewiki_read"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read suggests search and write_doc", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "livewiki/quickstart.md" },
      });
      expect(hintTools(r)).toEqual(["livewiki_search", "livewiki_write_doc"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_search suggests read and debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: "modules", limit: 10 },
      });
      expect(hintTools(r)).toEqual(["livewiki_read", "livewiki_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_debt suggests write_doc and resolve_debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_debt", arguments: {} });
      expect(hintTools(r)).toEqual(["livewiki_write_doc", "livewiki_resolve_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact suggests read, write_doc and debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/auth/login.ts#login" },
      });
      expect(hintTools(r)).toEqual([
        "livewiki_read",
        "livewiki_write_doc",
        "livewiki_debt",
      ]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc suggests debt and resolve_debt on success", async () => {
    const c = await connect();
    try {
      const content = `---
title: hints-scratch
owner: generated
---

# hints-scratch

Notes.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/hints-scratch.md", content },
      });
      expect(r.isError).toBeFalsy();
      expect(hintTools(r)).toEqual(["livewiki_debt", "livewiki_resolve_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_resolve_debt suggests debt", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/login.md"),
      "---\ntitle: login\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n---\n\n# login\n\nDocs.\n",
    );
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: { page: "livewiki/login.md", all: true },
      });
      expect(hintTools(r)).toEqual(["livewiki_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("error responses carry no hints", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "src/auth/login.ts" },
      });
      expect(r.isError).toBe(true);
      expect(extractHints(r)).toEqual([]);
    } finally {
      await teardown(c);
    }
  });
});

/**
 * Backlog #3 (plan 2026-07-28, item 3.2): the real fs.watch on the repo
 * root keeps index + ledger + search in sync while the server is alive.
 * Deterministic by polling a bounded window (never fixed sleeps). The
 * afterEach rm is the EBUSY check — close() must release every watcher
 * and DB handle for the temp dir to be removable on Windows.
 */
describe("MCP server — watcher (backlog #3)", () => {
  const PROBE_TOKEN = "zephyrWatcherProbeToken";

  /** Poll until `cond` holds or the bounded window expires (no fixed sleeps). */
  async function pollUntil(cond: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await cond()) return;
      if (Date.now() >= deadline) {
        throw new Error("pollUntil: condition not met within the bounded window");
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("picks up working-tree edits: ledger debt + search rebuild within the debounce window", async () => {
    // Arrange: a wiki page anchoring src/auth/login.ts#login, so a symbol
    // edit becomes `changed` debt on the next ledger run.
    const { acceptBaseline } = await import("@livewiki/core/baseline-operations");
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/login.md"),
      "---\ntitle: login\nowner: generated\nanchors:\n  - src/auth/login.ts#login\n---\n\n# login\n\nDocs.\n",
    );
    await acceptBaseline(repoRoot, { page: "livewiki/login.md", all: true });

    const c = await connect();
    try {
      // Baseline: debt before the watcher sees anything new.
      const before = JSON.parse(
        extractText(await c.client.callTool({ name: "livewiki_debt", arguments: {} })),
      ) as { debt: { total: number } };

      // Act: change the anchored symbol AND drop a brand-new wiki page on
      // disk. Both bypass the MCP tools — only the watcher observes them.
      await nodeFs.writeFile(
        nodePath.join(repoRoot, "src/auth/login.ts"),
        "export function login() { return 'edited'; }\n",
      );
      await nodeFs.writeFile(
        nodePath.join(repoRoot, "livewiki/watch-probe.md"),
        `# Probe\n\n${PROBE_TOKEN}\n`,
      );

      // Assert 1: within the bounded window the ledger reports the new debt.
      await pollUntil(async () => {
        const r = await c.client.callTool({ name: "livewiki_debt", arguments: {} });
        const parsed = JSON.parse(extractText(r)) as {
          debt: { total: number; items: Array<{ symbol_key: string | null }> };
        };
        return (
          parsed.debt.total > before.debt.total &&
          parsed.debt.items.some((i) => i.symbol_key === "src/auth/login.ts#login")
        );
      });

      // Assert 2: the search index reflects the on-disk wiki change.
      await pollUntil(async () => {
        const r = await c.client.callTool({
          name: "livewiki_search",
          arguments: { query: PROBE_TOKEN },
        });
        const parsed = JSON.parse(extractText(r)) as { hits: Array<{ wikiPath: string }> };
        return parsed.hits.some((h) => h.wikiPath === "livewiki/watch-probe.md");
      });
    } finally {
      await teardown(c);
    }
    // teardown → server.close() resolved; the afterEach rm then proves the
    // temp dir is removable (an unreleased handle would EBUSY on Windows).
  }, 20000);
});

interface HintEntry {
  tool: string;
  when: string;
}

/** Extracts the `_hints` array from a tool result: parses each text block as
 *  JSON (plain-text blocks like raw markdown simply fail to parse) and
 *  returns the first block carrying a `_hints` array. Empty when absent. */
function extractHints(r: unknown): HintEntry[] {
  if (typeof r !== "object" || r === null) return [];
  const content = (r as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      try {
        const parsed = JSON.parse((block as { text: string }).text) as { _hints?: unknown };
        if (Array.isArray(parsed._hints)) return parsed._hints as HintEntry[];
      } catch {
        // Not a JSON block (e.g. raw page markdown) — keep scanning.
      }
    }
  }
  return [];
}

function hintTools(r: unknown): string[] {
  return extractHints(r).map((h) => h.tool);
}

/** Every hint entry must be a short `{ tool, when }` pair naming a real tool. */
function assertWellFormedHints(r: unknown): void {
  const hints = extractHints(r);
  expect(hints.length).toBeGreaterThan(0);
  for (const h of hints) {
    expect(h.tool).toMatch(/^livewiki_/);
    expect(typeof h.when).toBe("string");
    expect(h.when.length).toBeGreaterThan(0);
  }
}

/** Extracts text from an MCP result. callTool returns a discriminated type;
 *  here we accept any object with `content: Array<{type, text?}>` and
 *  we join the text blocks. */
function extractText(r: unknown): string {
  if (typeof r !== "object" || r === null) return "";
  const content = (r as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (
      typeof c === "object" &&
      c !== null &&
      (c as { type?: unknown }).type === "text" &&
      typeof (c as { text?: unknown }).text === "string"
    ) {
      parts.push((c as { text: string }).text);
    }
  }
  return parts.join("\n");
}
