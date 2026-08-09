/**
 * CLI E2E Fase 3 rev2 — cenário do revisor empírico (achados H–M).
 *
 * Cenário: repo com módulos em SUBDIRETÓRIOS (src/auth/, src/billing/, src/utils/),
 * imports cruzados NodeNext (../utils/crypto.js → crypto.ts), config openai-compat
 * apontando pra stub local, key só no env. Esse cenário EXPLICITAMENTE expõe os
 * bugs que o fixture flat do cli-batch-e2e.test.ts não cobre.
 *
 * Cobertura (contrato #29 — real page units: um FILE unit por arquivo com
 * símbolos, um FOLDER unit por diretório real; stage 2 é determinístico e
 * NÃO existe refine LLM):
 *   H — init --batch com subdiretórios + imports cruzados gera TODAS as
 *       páginas de unidade real (file pages + folder pages), não 0.
 *   I — stage 2 não faz NENHUMA chamada LLM: o planner determinístico
 *       particiona o inventário e o summary reflete as pastas reais.
 *   K — imports NodeNext ../utils/crypto.js resolvem pra crypto.ts (edges > 0).
 *   L — batch sem config LLM falha com mensagem clara E exit 1 (não crasha
 *       com exit -1073740791 do libuv).
 *   M — filesWritten do init não lista manifest que não foi regravado
 *       (writeManifestIfChanged retorna false → não faz push).
 *
 * Stub in-process (mesmo padrão do cli-batch-e2e.test.ts): zero chamada real.
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
  callCount: () => number;
  /** Lista os bodies recebidos (parsed JSON) — pra asserções finas. */
  received: () => Array<{ system: string; user: string }>;
}

interface StubResponse {
  status: number;
  body: unknown;
}

async function startStubServer(): Promise<StubServer> {
  let handler: (req: { system: string; user: string }) => StubResponse | null = () => null;
  let calls = 0;
  const log: Array<{ system: string; user: string }> = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls++;
      let parsed: { system?: string; user?: string; messages?: Array<{ role: string; content: string }> } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      type ChatMsg = { role: string; content: string };
      const msgs = (parsed.messages ?? []) as ChatMsg[];
      const system = parsed.system ?? msgs.find((m) => m.role === "system")?.content ?? "";
      const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? parsed.user ?? "";
      log.push({ system, user });

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
    callCount: () => calls,
    received: () => [...log],
  };
}

/** Extract closed-list keys from the stage-4 / repair user prompt. */
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys.length > 0 ? keys : [`${fallbackModuleId}.ts#placeholder`];
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

function understandingResponse(req: { system: string; user: string }): StubResponse | null {
  if (!req.user.includes("# Output: livewiki/understanding.md")) return null;
  return {
    status: 200,
    body: {
      choices: [{ message: { role: "assistant", content: UNDERSTANDING_PAGE } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
      model: "gpt-test-mock",
    },
  };
}

/** Gera doc Markdown válido pra qualquer file unit (mesmo formato do E2E da Fase 3). */
function defaultHandler(req: { system: string; user: string }): StubResponse | null {
  const understanding = understandingResponse(req);
  if (understanding) return understanding;
  // #29 folder page: the model writes ONLY the purpose paragraph (plain
  // prose, 40–800 chars, no headings/frontmatter/links); the skeleton is
  // deterministic. Initial system carries "purpose paragraph of ONE folder
  // page"; the repair variant carries "folder purpose paragraph".
  if (
    req.system.includes("purpose paragraph of ONE folder page") ||
    req.system.includes("folder purpose paragraph")
  ) {
    return {
      status: 200,
      body: {
        choices: [{
          message: {
            role: "assistant",
            content:
              "This directory groups product source files whose documented responsibilities are covered by the file pages it contains.",
          },
        }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
        model: "gpt-test-mock",
      },
    };
  }
  // #29: file-unit prompts carry `# File: <repoPath>` (single-path units);
  // the legacy `# Module: <id>` line only appears for multi-path prompts.
  const moduleId =
    req.user.match(/# Module: ([^\s]+)/)?.[1] ??
    req.user.match(/# File: ([^\s]+)/)?.[1] ??
    "unknown";
  const closedKeys = closedKeysFromPrompt(req.user, moduleId);
  const fmAnchors = closedKeys.map((k) => `  - ${k}`).join("\n");
  const displayTitle = `${moduleId.replace(/-/g, " ")} responsibilities`;
  const content = `---
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
    nodePath.join(nodeOs.tmpdir(), "livewiki-e2e-f3rev2-"),
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

describe("CLI E2E Fase 3 rev2 — subdiretórios + NodeNext + openai-compat (achados H–M)", () => {
  it("H: init --batch com subdiretórios + NodeNext gera TODAS as páginas (não 0)", async () => {
    // Cenário do revisor: 3 subdiretórios, 4 arquivos, imports cruzados NodeNext.
    await writeCode(
      "src/auth/login.ts",
      "import { hashPassword } from '../utils/crypto.js';\nexport function login(user: string, pass: string) { return hashPassword(pass); }",
    );
    await writeCode(
      "src/auth/session.ts",
      "import { sign } from '../utils/crypto.js';\nexport function createSession(userId: string) { return sign(userId); }",
    );
    await writeCode(
      "src/billing/invoice.ts",
      "import { sign } from '../utils/crypto.js';\nexport function createInvoice(amount: number) { return sign('inv:' + amount); }",
    );
    await writeCode(
      "src/utils/crypto.ts",
      "export function hashPassword(p: string): string { return 'h:' + p; }\nexport function sign(data: string): string { return 's:' + data; }",
    );

    stub.setHandler(defaultHandler);

    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-H-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // #29 real units: 4 file pages + 3 folder pages (não 0!)
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/auth/login.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/auth/session.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/auth/index.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/billing/invoice.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/billing/index.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/utils/crypto.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/utils/index.md"))).resolves.toBeUndefined();

      // status report: run completed, 7 stage-4 tasks (unit ids as targets), usage > 0
      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      expect(status.status).toBe(0);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");
      const stage4Tasks = report.tasks.filter(
        (t: { stage: number }) => t.stage === 4,
      );
      expect(stage4Tasks.length, "esperava 7 tasks de stage 4 (4 file + 3 folder units)").toBe(7);
      const doneTasks = stage4Tasks.filter((t: { status: string }) => t.status === "done");
      expect(doneTasks.length, "esperava 7 tasks de stage 4 com status done").toBe(7);
      // #29: the stage-4 task target IS the unit id (file `auth/login`, folder `auth`).
      const targets = stage4Tasks.map((t: { target: string }) => t.target).sort();
      expect(targets).toEqual([
        "auth",
        "auth/login",
        "auth/session",
        "billing",
        "billing/invoice",
        "utils",
        "utils/crypto",
      ]);
      // #29: stage 2 is the deterministic planner — exactly one task, done,
      // with ZERO LLM tokens (no refine call exists anymore).
      const stage2Tasks = report.tasks.filter((t: { stage: number }) => t.stage === 2);
      expect(stage2Tasks.length).toBe(1);
      const stage2 = stage2Tasks[0];
      expect(stage2.status).toBe("done");
      expect(stage2.inputTokens, "stage 2 determinístico: zero tokens de LLM").toBe(0);
      expect(stage2.outputTokens, "stage 2 determinístico: zero tokens de LLM").toBe(0);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 60_000);

  it("I: stage 2 NÃO chama o LLM — o planner determinístico particiona em unidades reais", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    await writeCode("src/billing/invoice.ts", "export function inv() {}");
    await writeCode("src/utils/crypto.ts", "export function c() {}");

    // #29: não existe refine de stage 2. Qualquer chamada com o marcador do
    // antigo prompt de refine ("Heuristic module grouping") falha o teste —
    // o stub registra tudo e asserimos no fim.
    stub.setHandler(defaultHandler);

    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-I-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // Real units: 3 file pages + 3 folder pages.
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/auth/login.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/auth/index.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/billing/invoice.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/billing/index.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/utils/crypto.md"))).resolves.toBeUndefined();
      await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/utils/index.md"))).resolves.toBeUndefined();

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      const report = JSON.parse(status.stdout);
      expect(report.run.status).toBe("completed");
      // Stage 2: done, ZERO tokens — nenhuma chamada LLM saiu do stage 2.
      const stage2 = report.tasks.find(
        (t: { stage: number }) => t.stage === 2,
      );
      expect(stage2).toBeDefined();
      expect(stage2.status).toBe("done");
      expect(stage2.inputTokens, "stage 2 determinístico não chama o LLM").toBe(0);
      expect(stage2.outputTokens, "stage 2 determinístico não chama o LLM").toBe(0);
      // E no transporte: nenhum prompt de refine chegou ao stub.
      expect(
        stub.received().filter((c) => c.user.includes("Heuristic module grouping")).length,
        "nenhum prompt de refine de stage 2 pode existir sob #29",
      ).toBe(0);
      // O summary reflete a partição determinística: as 3 pastas reais.
      const refined = report.run.summary?.modulesRefined ?? [];
      expect(
        refined.map((m: { id: string }) => m.id).sort(),
        "summary.modulesRefined = pastas reais do planner",
      ).toEqual(["auth", "billing", "utils"]);
      const pathsById = Object.fromEntries(
        refined.map((m: { id: string; paths: string[] }) => [m.id, m.paths]),
      );
      expect(pathsById).toEqual({
        auth: ["src/auth/login.ts"],
        billing: ["src/billing/invoice.ts"],
        utils: ["src/utils/crypto.ts"],
      });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 60_000);

  it("K: imports NodeNext ../utils/crypto.js resolvem pra crypto.ts (edges > 0)", async () => {
    await writeCode(
      "src/auth/login.ts",
      "import { hashPassword } from '../utils/crypto.js';\nexport function login(p: string) { return hashPassword(p); }",
    );
    await writeCode(
      "src/utils/crypto.ts",
      "export function hashPassword(p: string): string { return 'h:' + p; }",
    );

    stub.setHandler(defaultHandler);

    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-K-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, r.stderr).toBe(0);

      // modules.mmd tem que ter edges — não "No module edges detected"
      const modulesMmd = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/architecture/modules.mmd"),
        "utf8",
      );
      expect(modulesMmd).not.toMatch(/No module edges detected/);
      // Edge auth→utils (login importa de utils via NodeNext)
      expect(modulesMmd).toMatch(/auth.*--.*utils|auth.*→.*utils/s);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 60_000);

  it("L: batch sem config LLM falha com exit ≠ 0 e mensagem clara (sem crash libuv)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    // SEM .livewiki/config.json E SEM env var
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      // Deve ser exit 1 (erro de config), não -1073740791 (libuv crash) e nem 0.
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Cannot run LLM batch/);
      expect(r.stderr).toMatch(/missing provider/);
      expect(r.stderr).toMatch(/claude-sonnet-5.*example only/);
    } finally {
      if (prev) process.env.OPENAI_API_KEY = prev;
    }
  }, 30_000);

  it("M: filesWritten do init NÃO lista manifest que não foi regravado", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    stub.setHandler(defaultHandler);

    await writeOpenAiConfig("gpt-test-mock", stub.url);
    process.env["OPENAI_API_KEY"] = "test-canary-M-DONOTLEAK";
    try {
      // 1º init: manifest é gravado
      const r1 = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      const report1 = JSON.parse(r1.stdout);
      expect(report1.filesWritten).toContain("livewiki/.manifest.json");
      const manifestContent1 = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
        "utf8",
      );
      const manifestTime1 = (await nodeFs.stat(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
      )).mtimeMs;

      // 2º init SEM mudança no repo: snapshotHash igual, manifest NÃO regrava
      await new Promise((r) => setTimeout(r, 50));
      const r2 = await runCli(["--json", "--repo", repoRoot, "init"]);
      const report2 = JSON.parse(r2.stdout);
      const manifestContent2 = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
        "utf8",
      );
      const manifestTime2 = (await nodeFs.stat(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
      )).mtimeMs;
      // Arquivo no disco tem que ser byte-idêntico (writeManifestIfChanged pulou)
      expect(manifestContent2).toBe(manifestContent1);
      expect(manifestTime2).toBe(manifestTime1);
      // report2.filesWritten NÃO contém o manifest
      expect(report2.filesWritten, "manifest byte-idêntico não pode aparecer como written").not.toContain(
        "livewiki/.manifest.json",
      );
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  }, 60_000);
});
