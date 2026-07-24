/**
 * CLI E2E — Etapa 1: tier-2 universal prose floor (SPEC §"Coverage ladder").
 *
 * Scenario: a repository mixing grammar-mapped sources (.ts — tier 1,
 * anchored) and grammar-less sources (.go, .rs — tier 2, prose). The walker
 * indexes every text file; the indexer records prose files with
 * `symbolCount: 0`; stage 4 emits zero-key pages (`anchors: []`, no markers)
 * for prose modules via the existing zero-key prompt contract.
 *
 * Coverage:
 *   1. init --batch on a mixed repo completes with exit 0, verify reports
 *      zero issues, prose module pages exist with `anchors: []` and no
 *      lw:anchors markers, and `status --json` classifies each language as
 *      anchored vs prose.
 *   2. A repo with NO grammar-mapped file at all still completes with a
 *      non-empty wiki — the tool never exits 0 with an empty wiki on an
 *      unsupported language.
 *
 * In-process stub (same pattern as cli-batch-e2e-subdirs.test.ts): zero real
 * provider calls. The stub answers the zero-key contract with an unanchored
 * page and grammar-backed modules with a closed-list anchored page.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as http from "node:http";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";

interface StubServer {
  url: string;
  close: () => Promise<void>;
  setHandler: (h: (req: { system: string; user: string }) => StubResponse | null) => void;
}

interface StubResponse {
  status: number;
  body: unknown;
}

async function startStubServer(): Promise<StubServer> {
  let handler: (req: { system: string; user: string }) => StubResponse | null = () => null;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed: { system?: string; messages?: Array<{ role: string; content: string }> } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      const msgs = parsed.messages ?? [];
      const system = parsed.system ?? msgs.find((m) => m.role === "system")?.content ?? "";
      const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");

      const response = handler({ system, user });
      if (!response) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "no handler configured" }));
        return;
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("failed to bind stub server");
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
    setHandler: (h) => { handler = h; },
  };
}

/** Extract closed-list keys from the stage-4 user prompt. */
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys.length > 0 ? keys : [`${fallbackModuleId}.ts#placeholder`];
}

/**
 * Stage-4 handler aware of the zero-key contract: prose modules (empty closed
 * list) get an unanchored page; grammar-backed modules get an anchored page.
 */
function proseTierHandler(req: { system: string; user: string }): StubResponse | null {
  const moduleId = req.user.match(/# Module: ([^\s]+)/)?.[1] ?? "unknown";
  const displayTitle = `${moduleId.replace(/-/g, " ")} responsibilities`;

  let content: string;
  if (req.user.includes("Zero-key contract")) {
    // Tier-2 page: unanchored prose, `anchors: []`, no lw:anchors markers.
    content = `---
title: ${displayTitle}
owner: generated
anchors: []
---

# ${displayTitle}

This page documents the visible responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides one part of the repository implementation visible in the supplied source.

## Details

Some prose about ${moduleId}.
`;
  } else {
    const closedKeys = closedKeysFromPrompt(req.user, moduleId);
    const fmAnchors = closedKeys.map((k) => `  - ${k}`).join("\n");
    content = `---
title: ${displayTitle}
owner: generated
anchors:
${fmAnchors}
---

# ${displayTitle}

This page documents the indexed responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides one part of the repository implementation visible in the supplied source.

## Details
<!-- lw:anchors ${closedKeys.join(" ")} -->

Some prose about ${moduleId}.
`;
  }
  return {
    status: 200,
    body: {
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
      model: "gpt-test-mock",
    },
  };
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = { env: { ...process.env, ...env } };
    const proc: ChildProcess = spawn(
      process.execPath,
      [nodePath.resolve(process.cwd(), "dist/index.js"), ...args],
      opts,
    );
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer | string) => (stdout += typeof d === "string" ? d : d.toString("utf8")));
    proc.stderr?.on("data", (d: Buffer | string) => (stderr += typeof d === "string" ? d : d.toString("utf8")));
    proc.on("close", (code: number | null) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

let stub: StubServer;
let repoRoot: string;

beforeAll(async () => { stub = await startStubServer(); });
afterAll(async () => { await stub.close(); });

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-e2e-prose-tier-"),
  );
});
afterEach(async () => { await nodeFs.rm(repoRoot, { recursive: true, force: true }); });

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify({
      provider: "openai-compat",
      model,
      baseUrl,
      maxTopics: 0,
      pricing: { inputUsdPerMtok: 3.0, outputUsdPerMtok: 15.0 },
    }, null, 2),
    "utf8",
  );
}

/** Runs verify and asserts exit 0 + zero issues of any severity. */
async function expectVerifyClean(): Promise<void> {
  const verifyR = await runCli(["--json", "--repo", repoRoot, "verify"]);
  expect(verifyR.status, `verify failed: ${verifyR.stderr}`).toBe(0);
  const verifyReport = JSON.parse(verifyR.stdout) as { ok: boolean; issues: unknown[] };
  expect(
    verifyReport.issues.length,
    `verify reported ${verifyReport.issues.length} issue(s) (expected 0):\n${JSON.stringify(verifyReport.issues, null, 2)}`,
  ).toBe(0);
  expect(verifyReport.ok).toBe(true);
}

describe("CLI E2E Etapa 1 — tier-2 prose floor (mixed anchored/prose repo)", () => {
  it("init --batch on a .ts + .go + .rs repo completes, verify clean, tiers reported", async () => {
    await writeCode(
      "src/api/handler.ts",
      "export function handleRequest(input: string): string { return input.trim(); }\n",
    );
    await writeCode(
      "src/server/main.go",
      "package main\n\nfunc main() { serve() }\n\nfunc serve() {}\n",
    );
    await writeCode(
      "src/engine/lib.rs",
      "pub fn render(frame: u32) -> u32 { frame + 1 }\n",
    );

    stub.setHandler(proseTierHandler);
    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-prose-tier-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch", "--no-refine"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // All three module pages generated — anchored (api) AND prose (server, engine).
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/api.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/server.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/engine.md"))).resolves.toBeUndefined();

      // Prose pages follow the zero-key contract: `anchors: []`, no markers.
      for (const page of ["server.md", "engine.md"]) {
        const body = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki", page), "utf8");
        expect(body, `${page} declares empty anchors`).toContain("anchors: []");
        expect(body, `${page} carries no lw:anchors marker`).not.toMatch(/<!--\s*lw:anchors\s/);
      }
      // The anchored page cites at least one closed-list key.
      const apiBody = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/api.md"), "utf8");
      expect(apiBody).toContain("src/api/handler.ts#handleRequest");

      // Verify: exit 0 + zero issues of any severity.
      await expectVerifyClean();

      // Batch report: run completed, 3 stage-4 tasks all done.
      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      expect(status.status).toBe(0);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");
      const stage4Tasks = report.tasks.filter((t: { stage: number }) => t.stage === 4);
      expect(stage4Tasks.length, "expected 3 stage-4 tasks").toBe(3);
      expect(
        stage4Tasks.filter((t: { status: string }) => t.status === "done").length,
        "all stage-4 tasks done",
      ).toBe(3);

      // Status: every language classified by coverage tier.
      const statusR = await runCli(["--json", "--repo", repoRoot, "status"]);
      expect(statusR.status).toBe(0);
      const statusReport = JSON.parse(statusR.stdout);
      expect(statusReport.files.byLang.typescript).toBe(1);
      expect(statusReport.files.byLang.go).toBe(1);
      expect(statusReport.files.byLang.rs).toBe(1);
      expect(statusReport.files.tiers.typescript).toBe("anchored");
      expect(statusReport.files.tiers.go).toBe("prose");
      expect(statusReport.files.tiers.rs).toBe("prose");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);

  it("a repo with no grammar-mapped file still completes with a non-empty wiki", async () => {
    await writeCode(
      "src/server/main.go",
      "package main\n\nfunc main() { serve() }\n\nfunc serve() {}\n",
    );
    await writeCode(
      "src/server/routes.go",
      "package main\n\nfunc route(path string) string { return path }\n",
    );

    stub.setHandler(proseTierHandler);
    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-prose-only-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch", "--no-refine"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // The wiki is NOT empty: the prose module page exists.
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/server.md"))).resolves.toBeUndefined();

      await expectVerifyClean();

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");

      const statusR = await runCli(["--json", "--repo", repoRoot, "status"]);
      const statusReport = JSON.parse(statusR.stdout);
      expect(statusReport.files.tiers.go).toBe("prose");
      expect(statusReport.symbols.total).toBe(0);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);

  it("stage-4 prompt carries the indexed rationale evidence block (Etapa 2b)", async () => {
    await writeCode(
      "src/api/handler.ts",
      "// WHY: bursts are smoothed to protect the upstream API\n" +
        "export function handleRequest(input: string): string { return input.trim(); }\n",
    );

    // Capture every request the stub receives so we can assert what the
    // model actually saw.
    const captured: Array<{ system: string; user: string }> = [];
    stub.setHandler((req) => {
      captured.push(req);
      return proseTierHandler(req);
    });
    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-rationale-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch", "--no-refine"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      const stage4Requests = captured.filter((c) => c.user.includes("# Module: api"));
      expect(stage4Requests.length, "expected at least one stage-4 request for module api").toBeGreaterThan(0);
      // The indexed rationale reached the model, fenced as untrusted evidence.
      expect(stage4Requests[0]!.user).toContain("# Rationale evidence");
      expect(stage4Requests[0]!.user).toContain("WHY: bursts are smoothed to protect the upstream API");
      // The system prompt pins rationale text out of the anchor-key space.
      expect(stage4Requests[0]!.system).toMatch(/NEVER a source of anchor keys/);

      await expectVerifyClean();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);
});
