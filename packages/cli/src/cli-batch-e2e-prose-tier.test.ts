/**
 * CLI E2E — Etapa 1: tier-2 universal prose floor (SPEC §"Coverage ladder"),
 * migrated to the #29 real-page-units contract.
 *
 * Scenario: a repository mixing grammar-mapped sources (.ts — tier 1,
 * anchored) and grammar-less sources (.rb, .kt — tier 2, prose). The walker
 * indexes every text file; the indexer records prose files with
 * `symbolCount: 0`. Under #29 there are no module chunks and no LLM-written
 * zero-key pages: the deterministic planner (`page-units.ts`) emits one FILE
 * unit per symbol-bearing product file and one FOLDER unit per real
 * directory, and a prose (inert) file is accounted for as a deterministic
 * line on its folder page ("not documented") — zero tokens.
 *
 * Coverage:
 *   1. init --batch on a mixed repo completes, verify reports zero issues,
 *      the anchored file page lands at `livewiki/<folder>/<file>.md`, prose
 *      files appear as inert lines on their folder pages, no legacy
 *      `<module>.md` chunk pages exist, and `status --json` classifies each
 *      language as anchored vs prose.
 *   2. A repo with NO grammar-mapped file at all still completes with a
 *      non-empty wiki — the folder page alone documents the inventory, so
 *      the tool never exits 0 with an empty wiki on an unsupported language.
 *   3. D1: a root README feeds the quickstart `## What this repository is`
 *      block (first section after the H1, provenance marked, tool-meta
 *      sections after the product sections) while being accounted for as an
 *      inert file on the root folder page.
 *
 * In-process stub (same pattern as cli-batch-e2e-subdirs.test.ts): zero real
 * provider calls. The stub answers file-page prompts with a closed-list
 * anchored page and folder-purpose prompts with a plain-prose paragraph.
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

/** Extract closed-list keys from the stage-4 file-page user prompt. */
function closedKeysFromPrompt(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

/**
 * Stage 5c (roadmap item 23): the mandatory understanding task. Its prompt
 * carries `# Output: livewiki/understanding.md`; answer with a strict-contract
 * page (owner: generated, one H1, one 40–600-char purpose paragraph, no
 * anchors, no inline code, no links).
 */
const UNDERSTANDING_PAGE = `---
title: Test repository
owner: generated
kind: understanding
---

# Test repository

This test repository exercises the batch pipeline with a small product surface.
`;

/**
 * #29 folder page: the model writes ONLY the purpose paragraph (plain prose,
 * 40–800 chars — no headings, frontmatter, links, or fences); the page
 * skeleton around it is deterministic. One call per product folder per run.
 * The initial system prompt carries "purpose paragraph of ONE folder page";
 * the repair variant carries "folder purpose paragraph".
 */
const FOLDER_PURPOSE =
  "This directory holds product source files whose documented responsibilities are covered by the file pages it groups.";

function isFolderPurposePrompt(system: string): boolean {
  return (
    system.includes("purpose paragraph of ONE folder page") ||
    system.includes("folder purpose paragraph")
  );
}

/**
 * Stage-4 handler for the #29 real-units contract: folder-purpose prompts get
 * a plain paragraph; file-page prompts (`# File: <repoPath>` +
 * `# Paths (1): <repoPath>`) get a closed-list anchored page. Prose files
 * never reach the LLM — they are inert lines on the deterministic folder
 * page — so there is no zero-key branch here anymore.
 */
function proseTierHandler(req: { system: string; user: string }): StubResponse | null {
  if (req.user.includes("# Output: livewiki/understanding.md")) {
    return {
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: UNDERSTANDING_PAGE } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
        model: "gpt-test-mock",
      },
    };
  }
  if (isFolderPurposePrompt(req.system)) {
    return {
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: FOLDER_PURPOSE } }],
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
        model: "gpt-test-mock",
      },
    };
  }
  const filePath = req.user.match(/# File: (\S+)/)?.[1] ?? "unknown.ts";
  const fileBase = (filePath.split("/").pop() ?? "unknown").replace(/\.[^.]+$/, "");
  const displayTitle = `${fileBase} responsibilities`;

  const closedKeys = closedKeysFromPrompt(req.user);
  const fmAnchors = closedKeys.map((k) => `  - ${k}`).join("\n");
  const content = `---
title: ${displayTitle}
owner: generated
anchors:
${fmAnchors}
---

# ${displayTitle}

This page documents the indexed responsibilities of ${fileBase}.

## When to use this page

- Review ${fileBase} behavior.
- Change ${fileBase} implementation.

## How it fits

This file provides one part of the repository implementation visible in the supplied source.

## Details
<!-- lw:anchors ${closedKeys.join(" ")} -->

Some prose about ${fileBase}.
`;
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
      // Roadmap #22: pin the pre-#22 stage-4 format (stub pages emit no
      // Diagram section); #22-on is covered by the core #22 suites.
      moduleDiagrams: false,
      deepHierarchy: false,
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

async function wikiPageExists(rel: string): Promise<boolean> {
  return nodeFs.access(nodePath.join(repoRoot, rel)).then(() => true).catch(() => false);
}

async function readWikiPage(rel: string): Promise<string> {
  return nodeFs.readFile(nodePath.join(repoRoot, rel), "utf8");
}

describe("CLI E2E Etapa 1 — tier-2 prose floor (mixed anchored/prose repo)", () => {
  it("init --batch on a .ts + .rb + .kt repo completes, verify clean, tiers reported", async () => {
    await writeCode(
      "src/api/handler.ts",
      "export function handleRequest(input: string): string { return input.trim(); }\n",
    );
    await writeCode(
      "src/server/main.rb",
      "def serve\nend\n",
    );
    await writeCode(
      "src/engine/lib.kt",
      "fun render(frame: Int): Int = frame + 1\n",
    );
    // D1: a root README feeds the quickstart orientation block. It is a
    // tier-2 prose file, so under #29 it is accounted for as an inert line
    // on the root folder page — zero tokens, no LLM page.
    await writeCode(
      "README.md",
      [
        "# Media fixture",
        "",
        "[![CI](https://img.shields.io/badge/ci-passing-green)](https://ci.example)",
        "",
        "This fixture repository renders short media clips by wiring an API handler, a Ruby server, and a Kotlin engine into one local pipeline.",
        "",
        "## Getting Started",
        "",
        "1. Install dependencies.",
      ].join("\n"),
    );

    stub.setHandler(proseTierHandler);
    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-prose-tier-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch", "--no-refine"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // #29 page units: the symbol-bearing .ts file gets a FILE page at
      // `livewiki/<folderId>/<fileBase>.md`; every real directory gets a
      // FOLDER page at `livewiki/<folderId>/index.md`.
      expect(await wikiPageExists("livewiki/api/handler.md")).toBe(true);
      for (const folder of ["api", "server", "engine", "root"]) {
        expect(await wikiPageExists(`livewiki/${folder}/index.md`), `${folder} folder page`).toBe(true);
      }
      // The legacy module-chunk pages are gone.
      for (const legacy of ["api.md", "server.md", "engine.md", "root.md"]) {
        expect(await wikiPageExists(`livewiki/${legacy}`), `no legacy ${legacy}`).toBe(false);
      }

      // The anchored file page cites at least one closed-list key.
      const handlerBody = await readWikiPage("livewiki/api/handler.md");
      expect(handlerBody).toContain("src/api/handler.ts#handleRequest");

      // Prose files never reach the LLM: each is a deterministic inert line
      // on its folder page (zero tokens, nothing hallucinated).
      const serverFolder = await readWikiPage("livewiki/server/index.md");
      expect(serverFolder).toContain("`main.rb` — not documented (re-export, configuration, or plain-text file)");
      const engineFolder = await readWikiPage("livewiki/engine/index.md");
      expect(engineFolder).toContain("`lib.kt` — not documented (re-export, configuration, or plain-text file)");
      const rootFolder = await readWikiPage("livewiki/root/index.md");
      // #30 follow-up: a Markdown prose file's OWN title (frontmatter/H1)
      // replaces the raw-filename fallback — harvested from the source file
      // through the real batch path (regression: safeIo is allowlist-
      // restricted to the wiki dirs, so the harvest must read via plain fs).
      expect(rootFolder).toContain("`README.md` — Media fixture");

      // The product folder pages carry the LLM purpose paragraph above the
      // deterministic file guide.
      const apiFolder = await readWikiPage("livewiki/api/index.md");
      expect(apiFolder).toContain(FOLDER_PURPOSE);
      expect(apiFolder).toContain("[handler.ts](handler.md)");

      // D1: the quickstart opens with the product-orientation block sourced
      // from the fixture README (badges skipped, provenance marked, fast-path
      // section pointed at by name) before any tool-meta section.
      const quickstart = await readWikiPage("livewiki/quickstart.md");
      const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(headings[0], "orientation block is the first section after the H1").toBe(
        "What this repository is",
      );
      expect(quickstart).toContain(
        "This fixture repository renders short media clips by wiring an API handler",
      );
      // Stage 5c: with the understanding synthesis present, the README
      // purpose is demoted to secondary evidence (not the authority).
      expect(quickstart).toContain(
        "*(Purpose excerpt from the repository README: `README.md` — one evidence input, not the authority.)*",
      );
      expect(quickstart).toContain(
        '**Fastest local path:** see the "Getting Started" section of `README.md`.',
      );
      expect(quickstart.indexOf("## Document a repo")).toBeGreaterThan(
        quickstart.indexOf("## Work by intent"),
      );

      // D1.5: the reader digest follows the orientation block. Under #29 the
      // digest entries are the FOLDER pages (`<id>/index.md`), and the
      // responsibility sentence is the folder page's opening — the accepted
      // LLM purpose paragraph.
      expect(headings[1], "reader digest follows the orientation block").toBe(
        "What you'll find in this wiki",
      );
      expect(quickstart).toContain(`- **[src/api](api/index.md)** — ${FOLDER_PURPOSE}`);
      expect(quickstart).not.toContain("Synthesized from the generated folder pages");

      // Verify: exit 0 + zero issues of any severity.
      await expectVerifyClean();

      // Batch report: run completed; stage-4 queue = 1 file unit + 4 folder
      // units (api, server, engine, root), all done. The prose files cost
      // zero stage-4 tasks of their own.
      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      expect(status.status).toBe(0);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");
      const stage4Tasks = report.tasks.filter((t: { stage: number }) => t.stage === 4);
      expect(stage4Tasks.length, "expected 5 stage-4 tasks (1 file + 4 folders)").toBe(5);
      expect(
        stage4Tasks.filter((t: { status: string }) => t.status === "done").length,
        "all stage-4 tasks done",
      ).toBe(5);
      const targets = stage4Tasks.map((t: { target: string }) => t.target).sort();
      expect(targets, "stage-4 targets are the real unit ids").toEqual([
        "api",
        "api/handler",
        "engine",
        "root",
        "server",
      ]);

      // Status: every language classified by coverage tier.
      const statusR = await runCli(["--json", "--repo", repoRoot, "status"]);
      expect(statusR.status).toBe(0);
      const statusReport = JSON.parse(statusR.stdout);
      expect(statusReport.files.byLang.typescript).toBe(1);
      expect(statusReport.files.byLang.rb).toBe(1);
      expect(statusReport.files.byLang.kt).toBe(1);
      expect(statusReport.files.tiers.typescript).toBe("anchored");
      expect(statusReport.files.tiers.rb).toBe("prose");
      expect(statusReport.files.tiers.kt).toBe("prose");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);

  it("a repo with no grammar-mapped file still completes with a non-empty wiki", async () => {
    await writeCode(
      "src/server/main.rb",
      "def serve\nend\n",
    );
    await writeCode(
      "src/server/routes.rb",
      "def route(path)\n  path\nend\n",
    );

    stub.setHandler(proseTierHandler);
    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-prose-only-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch", "--no-refine"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // The wiki is NOT empty: with zero symbol-bearing files there is no
      // file page, but the FOLDER page documents the whole inventory — both
      // prose files appear as deterministic inert lines.
      expect(await wikiPageExists("livewiki/server/index.md")).toBe(true);
      expect(await wikiPageExists("livewiki/server.md"), "no legacy chunk page").toBe(false);
      const folderBody = await readWikiPage("livewiki/server/index.md");
      expect(folderBody).toContain("`main.rb` — not documented (re-export, configuration, or plain-text file)");
      expect(folderBody).toContain("`routes.rb` — not documented (re-export, configuration, or plain-text file)");

      await expectVerifyClean();

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");
      const stage4Tasks = report.tasks.filter((t: { stage: number }) => t.stage === 4);
      expect(
        stage4Tasks.map((t: { target: string }) => t.target),
        "one folder unit is the whole stage-4 queue",
      ).toEqual(["server"]);
      expect(stage4Tasks[0].status).toBe("done");

      const statusR = await runCli(["--json", "--repo", repoRoot, "status"]);
      const statusReport = JSON.parse(statusR.stdout);
      expect(statusReport.files.tiers.rb).toBe("prose");
      expect(statusReport.symbols.total).toBe(0);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);

  it("stage-4 file-page prompt carries the indexed rationale evidence block (Etapa 2b)", async () => {
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

      // #29: the file page prompt is keyed by the real path, not a module id.
      const fileRequests = captured.filter((c) => c.user.includes("# File: src/api/handler.ts"));
      expect(fileRequests.length, "expected at least one stage-4 request for the handler file unit").toBeGreaterThan(0);
      expect(fileRequests[0]!.user).toContain("# Paths (1): src/api/handler.ts");
      // The indexed rationale reached the model, fenced as untrusted evidence.
      expect(fileRequests[0]!.user).toContain("# Rationale evidence");
      expect(fileRequests[0]!.user).toContain("WHY: bursts are smoothed to protect the upstream API");
      // The system prompt pins rationale text out of the anchor-key space.
      expect(fileRequests[0]!.system).toMatch(/NEVER a source of anchor keys/);

      // Exactly one folder-purpose call (the product `api` folder), and the
      // folder prompt carries no rationale block (Etapa 2b scope: stage-4
      // module/file and topic prompts only).
      const folderRequests = captured.filter((c) => isFolderPurposePrompt(c.system));
      expect(folderRequests.length, "one folder-purpose call for the api folder").toBe(1);
      expect(folderRequests[0]!.user).not.toContain("# Rationale evidence");

      await expectVerifyClean();
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 90_000);
});
