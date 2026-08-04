/**
 * CLI E2E Fase 3 — pipeline completo init --batch com stub HTTP server.
 *
 * Usa um mini server HTTP local (Node http nativo) que simula a API Anthropic.
 * Zero chamada real — tudo mockado em process-localhost.
 *
 * Cenários cobertos:
 *   1. `init --batch` end-to-end → quickstart + diagramas + manifest + pages + status report
 *   2. Resume: interrompe após 1 task, resume continua da task certa
 *   3. --only: re-roda 1 task, usageHistory acumula
 *   4. Circuit breaker: mock que falha 3x → abort
 *
 * Estratégia: stub server recebe request, valida shape (system prompt inclui
 * regra "NEVER invent key", user prompt inclui lista fechada), responde com
 * Markdown válido. Validações E2E:
 *   - arquivos de output existem
 *   - manifest tem snapshotHash
 *   - batch_tasks tem usageHistory populado
 *   - status report tem totals/byStage/byModule
 *   - key-leak: nenhuma string da chave (vinda de env var) aparece em nenhum output
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
  /** Customize o handler por request (# de chamadas, falhar N vezes, etc) */
  setHandler: (h: (req: { system: string; user: string }) => StubResponse | null) => void;
  callCount: () => number;
}

interface StubResponse {
  status: number;
  body: unknown;
}

async function startStubServer(): Promise<StubServer> {
  let handler: (req: { system: string; user: string }) => StubResponse | null = () => null;
  let calls = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls++;
      let parsed: { system?: string; user?: string; messages?: Array<{ content: string }> } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      // Anthropic-shape: { system, messages: [{role:"user", content}] }
      // OpenAI-shape:  { messages: [{role:"system", content}, {role:"user", content}] }
      type ChatMsg = { role: string; content: string };
      const msgs = (parsed.messages ?? []) as ChatMsg[];
      const system = parsed.system ?? msgs.find((m) => m.role === "system")?.content ?? "";
      const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? parsed.user ?? "";

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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    setHandler: (h) => {
      handler = h;
    },
    callCount: () => calls,
  };
}

/** Default handler: gera doc Markdown válido pra qualquer módulo. */
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
      content: [{ type: "text", text: UNDERSTANDING_PAGE }],
      model: "claude-test-mock",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}

function defaultHandler(
  req: { system: string; user: string },
  opts: { failNTimes?: number } = {},
): StubResponse | null {
  if (opts.failNTimes && opts.failNTimes > 0) {
    opts.failNTimes--;
    return {
      status: 500,
      body: { error: "simulated failure" },
    };
  }
  const understanding = understandingResponse(req);
  if (understanding) return understanding;
  const moduleId = req.user.match(/# Module: ([^\s]+)/)?.[1] ?? "unknown";
  const closedKeys = closedKeysFromPrompt(req.user, moduleId);
  const fmAnchors = closedKeys.map((k) => `  - ${k}`).join("\n");
  const displayTitle = `${moduleId.replace(/-/g, " ")} responsibilities`;
  const primaryTask = moduleId.includes("provider")
    ? "Add or configure a provider."
    : moduleId.includes("verify")
      ? "Diagnose a failed verify."
      : moduleId.includes("batch")
        ? "Document a repository with the batch pipeline."
        : `Review ${moduleId} behavior.`;
  const content = `---
title: ${displayTitle}
owner: generated
anchors:
${fmAnchors}
---

# ${displayTitle}

This page documents the indexed responsibilities of ${moduleId}.

## When to use this page

- ${primaryTask}
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
      content: [{ type: "text", text: content }],
      model: "claude-test-mock",
      usage: { input_tokens: 100, output_tokens: 50 },
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

beforeAll(async () => {
  stub = await startStubServer();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-e2e-f3-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    // Roadmap #22: pin the pre-#22 stage-4 format — the stub pages emit no
    // Diagram section. #22-on is covered (core) by module-diagram-format.test.ts
    // and batch-module-diagrams.test.ts.
    JSON.stringify({ provider, model, baseUrl, moduleDiagrams: false, deepHierarchy: false }, null, 2),
    "utf8",
  );
}

describe("CLI E2E Fase 3 — pipeline init --batch com stub Anthropic", () => {
  it("init --batch gera quickstart + diagramas + manifest + pages + status", async () => {
    // Repo: 2 arquivos em 2 módulos
    await writeCode("src/auth/login.ts", "export function login() { return 'auth'; }");
    await writeCode("src/utils/helper.ts", "export function help() { return 'utils'; }");

    stub.setHandler((req) => defaultHandler(req));

    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-DONOTLEAK";
    try {
      // Init com --batch
      const r = runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      const result = await r;
      expect(result.status, `init falhou: ${result.stderr}`).toBe(0);

      // Wiki pages geradas
      expect(await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8")).toMatch(
        /title: auth/,
      );
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/utils.md"), "utf8"),
      ).toMatch(/title: utils/);

      // Diagramas
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/structure.mmd"), "utf8"),
      ).toContain("graph LR");
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/modules.mmd"), "utf8"),
      ).toContain("graph LR");

      // Deterministic navigation hubs are regenerated after stage 4.
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/overview.md"), "utf8"),
      ).toMatch(/Architecture overview/);
      const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
      expect(tasks).toContain("owner: generated");
      expect(tasks).toMatch(/\[[^\]]+\]\(auth\.md\)/);
      expect(tasks).toMatch(/\[[^\]]+\]\(utils\.md\)/);

      // Manifest
      const manifest = JSON.parse(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/.manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe(1);
      expect(manifest.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

      const quickstart = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/quickstart.md"),
        "utf8",
      );
      expect([...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
        "What this repository is",
        "What you'll find in this wiki",
        "Work by intent",
        "Document a repo",
        "Query the wiki from an agent",
        "Pay documentation debt",
        "Repository facts",
      ]);
      for (const moduleId of ["auth", "utils"]) {
        const page = await nodeFs.readFile(nodePath.join(repoRoot, `livewiki/${moduleId}.md`), "utf8");
        expect(page).toContain("## Navigate");
        expect(page).toContain("<!-- livewiki:navigate:start -->");
        expect(page).toContain("<!-- livewiki:navigate:end -->");
        // C1: page-specific links only — the universal hub triple lives in
        // the quickstart and must not be repeated on module pages.
        expect(page).not.toContain("[Quickstart](quickstart.md)");
        expect(page).not.toContain("[Tasks](tasks.md)");
        expect(page).not.toContain("[Architecture](architecture/overview.md)");
      }

      // Status report
      const statusR = runCli(["--json", "--repo", repoRoot, "batch"]);
      const status = await statusR;
      expect(status.status, `batch falhou: ${status.stderr}`).toBe(0);
      const report = JSON.parse(status.stdout);
      expect(report.totals.inputTokens).toBeGreaterThan(0);
      expect(report.byModule.length).toBeGreaterThanOrEqual(2);
      expect(report.run.status).toBe("completed");

      // (Q) Verify limpo: exit 0 + zero issues de qualquer severity.
      // Antes do fix, overview emitia [page](../auth.md) que verify normalizava
      // pra "livewiki/../auth.md" → broken_internal_link warning. Critério
      // ampliado: "batch completo" = verify 100% limpo (incluindo warnings).
      const verifyR = runCli(["--json", "--repo", repoRoot, "verify"]);
      const verify = await verifyR;
      expect(verify.status, `verify falhou: ${verify.stderr}`).toBe(0);
      const verifyReport = JSON.parse(verify.stdout);
      expect(
        verifyReport.issues.length,
        `verify reportou ${verifyReport.issues.length} issue(s) (esperado 0):\n${JSON.stringify(verifyReport.issues, null, 2)}`,
      ).toBe(0);
      expect(verifyReport.ok).toBe(true);

      // Key-leak: NENHUMA string da chave aparece em nenhum arquivo gerado
      const allFiles = [
        "livewiki/auth.md",
        "livewiki/utils.md",
        "livewiki/quickstart.md",
        "livewiki/tasks.md",
        "livewiki/architecture/structure.mmd",
        "livewiki/architecture/modules.mmd",
        "livewiki/architecture/overview.md",
        "livewiki/.manifest.json",
      ];
      for (const f of allFiles) {
        const content = await nodeFs.readFile(nodePath.join(repoRoot, f), "utf8");
        expect(content, `key leaked in ${f}`).not.toContain("test-canary-DONOTLEAK");
      }
      // Status stdout também não
      expect(status.stdout).not.toContain("test-canary-DONOTLEAK");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    // No 10s override: it predates the 30s suite default (e2f345c) and had
    // become a silent REDUCTION — the flake class that only hit the two
    // tightest budgets under pnpm -r parallel load (2026-08-04).
  });

  it("init --batch --no-refine skips stage-2 LLM (zero stage-2 tokens and stub calls)", async () => {
    // Regression: Commander maps --no-refine → opts.refine === false; CLI must
    // pass noRefine: true into runInit. Without the fix, stage 2 still calls LLM.
    await writeCode("src/auth/login.ts", "export function login() { return 'auth'; }");
    await writeCode("src/utils/helper.ts", "export function help() { return 'utils'; }");

    let stage2Calls = 0;
    let stage4Calls = 0;
    stub.setHandler((req) => {
      if (req.user.includes("Heuristic module grouping")) {
        stage2Calls++;
        // If this fires under --no-refine, the wiring is still broken.
        return {
          status: 200,
          body: {
            content: [{ type: "text", text: JSON.stringify({ modules: [] }) }],
            model: "claude-test-mock",
            usage: { input_tokens: 999, output_tokens: 99 },
          },
        };
      }
      stage4Calls++;
      return defaultHandler(req);
    });

    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-norefine";
    const callsBefore = stub.callCount();
    try {
      const r = await runCli([
        "--json",
        "--repo",
        repoRoot,
        "init",
        "--batch",
        "--no-refine",
      ]);
      expect(r.status, `init --batch --no-refine failed: ${r.stderr}`).toBe(0);

      // No stage-2 refine HTTP call at all
      expect(stage2Calls, "stage-2 refine must not call the stub under --no-refine").toBe(0);
      // Stage 4 still documents modules
      expect(stage4Calls).toBeGreaterThanOrEqual(2);
      expect(stub.callCount() - callsBefore).toBe(stage4Calls);
      expect(stub.callCount() - callsBefore).toBeGreaterThan(0);

      // Heuristic pages still produced
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8"),
      ).toMatch(/title: auth/);
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/utils.md"), "utf8"),
      ).toMatch(/title: utils/);

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      expect(status.status, status.stderr).toBe(0);
      const report = JSON.parse(status.stdout) as {
        byStage: Record<string, { inputTokens: number; outputTokens: number }>;
        run: { status: string };
      };
      expect(report.run.status).toBe("completed");
      const stage2 = report.byStage["2"] ?? { inputTokens: 0, outputTokens: 0 };
      expect(stage2.inputTokens, "stage 2 input tokens must be 0 with --no-refine").toBe(0);
      expect(stage2.outputTokens, "stage 2 output tokens must be 0 with --no-refine").toBe(0);
      // Stage 4 still spent tokens
      const stage4 = report.byStage["4"];
      expect(stage4).toBeDefined();
      expect(stage4!.inputTokens).toBeGreaterThan(0);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("init --batch without --no-refine still invokes stage-2 refine", async () => {
    await writeCode("src/auth/login.ts", "export function login() { return 'auth'; }");
    await writeCode("src/utils/helper.ts", "export function help() { return 'utils'; }");

    let stage2Calls = 0;
    stub.setHandler((req) => {
      if (req.user.includes("Heuristic module grouping")) {
        stage2Calls++;
        return {
          status: 200,
          body: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  modules: [
                    { id: "auth", paths: ["src/auth/login.ts"] },
                    { id: "utils", paths: ["src/utils/helper.ts"] },
                  ],
                }),
              },
            ],
            model: "claude-test-mock",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
      }
      return defaultHandler(req);
    });

    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-refine-on";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init --batch failed: ${r.stderr}`).toBe(0);
      expect(stage2Calls, "default init --batch must call stage-2 refine").toBeGreaterThanOrEqual(1);

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      expect(status.status, status.stderr).toBe(0);
      const report = JSON.parse(status.stdout) as {
        byStage: Record<string, { inputTokens: number; outputTokens: number }>;
      };
      const stage2 = report.byStage["2"];
      expect(stage2).toBeDefined();
      expect(stage2!.inputTokens).toBeGreaterThan(0);
      expect(stage2!.outputTokens).toBeGreaterThan(0);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("--only <module> re-roda 1 task: usageHistory acumula", async () => {
    await writeCode("src/auth/login.ts", "export function login() { return 1; }");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-2";
    try {
      // Init --batch inicial
      const r1 = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r1.status, r1.stderr).toBe(0);
      const callsAfterInit = stub.callCount();

      // Re-run one task in the initial run.
      const rerun = await runCli([
        "--json",
        "--repo",
        repoRoot,
        "batch",
        "--only",
        "auth",
        "1",
      ]);
      expect(rerun.status, rerun.stderr).toBe(0);

      // Pelo menos 1 chamada extra pro mock LLM
      expect(stub.callCount()).toBeGreaterThan(callsAfterInit);

      // Status mostra attempt >= 2 na task 'auth'
      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      const report = JSON.parse(status.stdout);
      const authTask = report.tasks.find(
        (t: { target: string; stage: number }) => t.target === "auth" && t.stage === 4,
      );
      expect(authTask).toBeDefined();
      expect(authTask.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
    // No 10s override (see the init --batch test above): inherits the 30s
    // suite default.
  });

  it("--only <module> SEM runId posicional re-executa a task (não cai no status)", async () => {
    // Regression (2026-08-04): `batch --only <target>` without a positional
    // runId silently printed `batch status` — the early no-args branch ran
    // first and the flag was ignored; three "rehearsal" invocations in a
    // row were status reads with zero LLM calls.
    await writeCode("src/auth/login.ts", "export function login() { return 1; }");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-2";
    try {
      const r1 = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r1.status, r1.stderr).toBe(0);
      const callsAfterInit = stub.callCount();

      // NO positional runId — must still rerun the task, not print status.
      const rerun = await runCli(["--json", "--repo", repoRoot, "batch", "--only", "auth"]);
      expect(rerun.status, rerun.stderr).toBe(0);
      expect(stub.callCount()).toBeGreaterThan(callsAfterInit);

      const status = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
      const report = JSON.parse(status.stdout);
      const authTask = report.tasks.find(
        (t: { target: string; stage: number }) => t.target === "auth" && t.stage === 4,
      );
      expect(authTask).toBeDefined();
      expect(authTask.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("circuit breaker: falha 3x seguidas → abort", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    // Configura 3 módulos separados — mas só temos 1 arquivo. Pra ter 3+,
    // espalhamos arquivos em 3 dirs diferentes.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    await writeCode("src/api/y.ts", "export function c() {}");

    let n = 0;
    stub.setHandler(() => {
      n++;
      return { status: 500, body: { error: "simulated failure" } };
    });
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-3";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      // init retorna { ok, filesWritten, batchSummary: { runId, status, ... } }
      const report = JSON.parse(r.stdout);
      expect(report.batchSummary).toBeDefined();
      expect(report.batchSummary.status).toBe("aborted");
      expect(report.batchSummary.tasksFailed).toBeGreaterThanOrEqual(3);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(O) init --batch aborted → exit code 2 (sem --json)", async () => {
    // Antes do fix (O), init --batch SEMPRE retornava 0 mesmo quando o batch
    // tinha aborted (circuit breaker) — escondia falha sistêmica do orquestrador.
    // Aqui usamos SEM --json pra capturar o exit code real do processo.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    await writeCode("src/api/y.ts", "export function c() {}");
    stub.setHandler(() => ({ status: 500, body: { error: "always fail" } }));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-exit-aborted";
    try {
      const r = await runCli(["--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init --batch aborted deveria exit 2; stderr=${r.stderr}`).toBe(2);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(O) init --batch completed_with_failures → exit code 1 (sem --json)", async () => {
    // Cenário: 3 módulos, falha só no 1º da etapa 4 → circuit breaker não
    // dispara (1 < 3 consecutivas, < 50%), mas o run termina com N-1 done + 1
    // failed → status=completed_with_failures → exit 1.
    // Importante: NÃO falhar na etapa 2 (refine) — refine é opt-in/degradável
    // (correção #5) e falha vira heurística sem afetar status do run.
    // Diferenciamos por marker do prompt: etapa 4 tem `# Module: <id>`.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    await writeCode("src/api/y.ts", "export function c() {}");

    stub.setHandler((req) => {
      // Falha apenas na 1ª chamada de etapa 4 (módulos). Refine passa.
      if (req.user.includes("# Module: auth")) {
        return { status: 500, body: { error: "simulated transient failure" } };
      }
      return defaultHandler(req);
    });
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-exit-cwf";
    try {
      const r = await runCli(["--repo", repoRoot, "init", "--batch"]);
      expect(
        r.status,
        `init --batch completed_with_failures deveria exit 1; stderr=${r.stderr}; stdout=${r.stdout}`,
      ).toBe(1);
      // O output sem --json é humano; confirmamos que menciona o run id e exit code
      expect(r.stdout).toMatch(/run #\d+: completed_with_failures/);
      expect(r.stdout).toMatch(/exit code: 1/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(O) init --batch completed → exit code 0 (sanity do caminho feliz)", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-exit-completed";
    try {
      const r = await runCli(["--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init --batch completed deveria exit 0; stderr=${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(/run #\d+: completed/);
      expect(r.stdout).toMatch(/exit code: 0/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(O) init --batch --json sempre exit 0 (output estruturado)", async () => {
    // Convenção batch CLI (setExitCode em packages/cli/src/commands/batch.ts):
    // --json → exit 0 sempre, mesmo em failure. Mantém consistência.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    await writeCode("src/api/y.ts", "export function c() {}");
    stub.setHandler(() => ({ status: 500, body: { error: "always fail" } }));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-exit-json";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, r.stderr).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(report.batchSummary.status).toBe("aborted");
      // batchExitCode também é exposto no JSON para consumers
      expect(report.batchExitCode).toBe(2);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(P) init generates overview cards with display titles and stable module IDs", async () => {
    // Sem --batch: overview é gerado em init base com módulos heurísticos.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");

    const r = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(r.status, r.stderr).toBe(0);

    // Arquivo existe
    const overviewPath = nodePath.join(repoRoot, "livewiki/architecture/overview.md");
    const overview = await nodeFs.readFile(overviewPath, "utf8");
    expect(overview).toMatch(/^---$/m);
    expect(overview).toMatch(/owner: generated/);
    expect(overview).toMatch(/Architecture overview/);
    expect(overview).toMatch(/### Auth source/);
    expect(overview).toMatch(/### Utils source/);
    expect(overview).toContain("Module ID: `auth`");
    expect(overview).toContain("Module ID: `utils`");
    // Stable HTML identity remains Module.id, independent of display title.
    expect(overview).toMatch(/<a id="auth"><\/a>/);
    expect(overview).toMatch(/<a id="utils"><\/a>/);
    // Function-only modules do not generate `diagrams/<slug>.classes.mmd`,
    // so the overview must not link to a nonexistent artifact.
    expect(overview).not.toMatch(/\[class diagram\]\(\.\.\/diagrams\/auth\.classes\.mmd\)/);
    expect(overview).not.toMatch(/\[class diagram\]\(\.\.\/diagrams\/utils\.classes\.mmd\)/);
    // Diagramas embedados (mermaid code fence)
    expect(overview).toMatch(/```mermaid/);
    expect(overview).toMatch(/%% livewiki\/architecture\/structure\.mmd/);
    expect(overview).toMatch(/%% livewiki\/architecture\/modules\.mmd/);
  });

  it("(P) init --batch regenerates overview cards with existing module-page links", async () => {
    // Com --batch: overview é gerado junto com as pages geradas pelo LLM.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-overview-batch";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, r.stderr).toBe(0);

      const overview = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
        "utf8",
      );
      expect(overview).toContain("Module ID: `auth`");
      expect(overview).toContain("Module ID: `utils`");
      expect(overview).toMatch(/\[module page\]\(\.\.\/auth\.md\)/);
      expect(overview).toMatch(/\[module page\]\(\.\.\/utils\.md\)/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(P) Quickstart links both hubs while overview keeps stable Module.id anchors", async () => {
    await writeCode("src/auth/login.ts", "export function a() {}");
    const r = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(r.status, r.stderr).toBe(0);

    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
    expect(quickstart).toContain("[Tasks](tasks.md)");
    expect(quickstart).toContain("[Architecture overview](architecture/overview.md)");
    expect(overview).toContain('<a id="auth"></a>');
    // R10.1 E: tasks.md has no `Module ID:` line — before the page exists,
    // the stable id is carried by the unavailable-entry path.
    expect(tasks).toContain("Page unavailable: `livewiki/auth.md`");
    expect(tasks).not.toContain("Module ID:");
    expect(tasks).not.toContain("](auth.md)");
  });

  it("(R10.1 C) init surfaces a skipped human flows hub in JSON and human output", async () => {
    await writeCode("src/auth/login.ts", "export function a() {}");
    // One flow page arms the hub write path; the hub itself is human-owned.
    await writeCode(
      "livewiki/flows/alpha.md",
      "---\ntitle: Alpha flow\nowner: generated\n---\n# Alpha flow\n",
    );
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    await writeCode("livewiki/flows/index.md", humanHub);

    const jsonRun = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(jsonRun.status, jsonRun.stderr).toBe(0);
    const report = JSON.parse(jsonRun.stdout);
    expect(report.skippedFlowsHub).toEqual({
      path: "livewiki/flows/index.md",
      owner: "human",
    });
    expect(report.filesWritten).not.toContain("livewiki/flows/index.md");
    const hub = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      "utf8",
    );
    expect(hub).toBe(humanHub);

    const humanRun = await runCli(["--repo", repoRoot, "init"]);
    expect(humanRun.status, humanRun.stderr).toBe(0);
    expect(humanRun.stdout).toContain("flows hub: preserved (owner: human)");
    expect(humanRun.stdout).toContain("livewiki/flows/index.md");
  });

  it("(R11-NAV) init surfaces a skipped human auxiliary hub in JSON and human output", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}\n");
    await writeCode(
      "test/fixtures/example/value.ts",
      "export function fixtureValue() { return 1; }\n",
    );
    const humanHub = "---\ntitle: My auxiliary guide\nowner: human\n---\n# My auxiliary guide\n";
    await writeCode("livewiki/auxiliary/index.md", humanHub);

    const jsonRun = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(jsonRun.status, jsonRun.stderr).toBe(0);
    const report = JSON.parse(jsonRun.stdout);
    expect(report.skippedAuxiliaryHub).toEqual({
      path: "livewiki/auxiliary/index.md",
      owner: "human",
    });
    expect(report.filesWritten).not.toContain("livewiki/auxiliary/index.md");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auxiliary/index.md"), "utf8"),
    ).toBe(humanHub);

    const humanRun = await runCli(["--repo", repoRoot, "init"]);
    expect(humanRun.status, humanRun.stderr).toBe(0);
    expect(humanRun.stdout).toContain("auxiliary hub: preserved (owner: human)");
    expect(humanRun.stdout).toContain("livewiki/auxiliary/index.md");
  });

  it("init --plan funciona SEM config LLM (correção #5)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    // SEM .livewiki/config.json — --plan não pode exigir LLM
    const r = await runCli(["--json", "--repo", repoRoot, "init", "--plan"]);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.plan).toBeDefined();
    expect(report.plan.modules.length).toBeGreaterThan(0);
    // Não tocou em livewiki/auth.md (--plan é só plano)
    await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/foo.md"))).rejects.toThrow();
  });

  it("init sem --batch funciona SEM config LLM (sem LLM calls)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    const callsBeforeInit = stub.callCount();
    // SEM .livewiki/config.json
    const r = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(r.status, r.stderr).toBe(0);
    // Gera layout determinístico
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/structure.mmd"), "utf8"),
    ).toContain("graph LR");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8"),
    ).toContain("## Document a repo");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8"),
    ).toContain("Page unavailable:");
    await expect(
      nodeFs.stat(nodePath.join(repoRoot, "livewiki/architecture/overview.md")),
    ).resolves.toBeDefined();
    expect(stub.callCount()).toBe(callsBeforeInit);
    const verify = await runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).issues).toEqual([]);
    // Sem module pages (não chamou LLM)
    await expect(nodeFs.access(nodePath.join(repoRoot, "livewiki/foo.md"))).rejects.toThrow();
  });

  it("init --batch SEM config LLM falha com mensagem clara apontando pro config", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    // SEM .livewiki/config.json E SEM env var
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
    expect(r.status).toBe(1); // erro
    // Mensagem aponta pro config.json E cita claude-sonnet-5 como EXEMPLO (não default silencioso)
    expect(r.stderr).toMatch(/Cannot run LLM batch/);
    expect(r.stderr).toMatch(/missing provider/);
    expect(r.stderr).toMatch(/claude-sonnet-5.*example only/);
    expect(r.stderr).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("idempotência: dois init seguidos sem mudança = manifest byte-idêntico", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-4";
    try {
      await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      const manifest1 = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
        "utf8",
      );
      // 2º init sem mudança no repo
      await runCli(["--json", "--repo", repoRoot, "init"]);
      const manifest2 = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/.manifest.json"),
        "utf8",
      );
      // snapshotHash tem que ser igual (conteúdo de livewiki/ não mudou)
      const m1 = JSON.parse(manifest1);
      const m2 = JSON.parse(manifest2);
      expect(m1.snapshotHash).toBe(m2.snapshotHash);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("(N) full-stack Quickstart → Tasks routes reach provider and verify pages with compliant openings", async () => {
    await writeCode(
      "src/providers/index.ts",
      "export function configureProvider() { return 'configured'; }\n",
    );
    await writeCode(
      "src/batch/index.ts",
      "export function documentRepository() { return 'documented'; }\n",
    );
    await writeCode(
      "src/verify/index.ts",
      "export function diagnoseVerify() { return 'diagnosed'; }\n",
    );
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    stub.setHandler((req) => defaultHandler(req));

    const result = await runCli([
      "--json", "--repo", repoRoot, "init", "--batch", "--no-refine",
    ], { ANTHROPIC_API_KEY: "stub-key" });
    expect(result.status, result.stderr).toBe(0);

    const quickstart = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8");
    const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
    expect(quickstart).toContain("[Tasks](tasks.md)");
    expect(quickstart).toMatch(/## Document a repo[\s\S]*`livewiki init`[\s\S]*`livewiki init --batch`/);
    expect(tasks).toContain("[providers responsibilities](providers.md)");
    expect(tasks).not.toContain("This page documents the indexed responsibilities of providers.");
    expect(tasks).toContain("[verify responsibilities](verify.md)");
    expect(tasks).not.toContain("This page documents the indexed responsibilities of verify.");
    // tasks.md copies no module-page prose at all: neither the responsibility
    // sentence nor the `When to use this page` bullets (duplicate-prose audit).
    expect(tasks).not.toContain("- Add or configure a provider.");
    expect(tasks).not.toContain("- Diagnose a failed verify.");

    for (const moduleId of ["providers", "batch", "verify"]) {
      const page = await nodeFs.readFile(nodePath.join(repoRoot, `livewiki/${moduleId}.md`), "utf8");
      const when = page.indexOf("## When to use this page");
      const how = page.indexOf("## How it fits");
      const marker = page.indexOf("<!-- lw:anchors ");
      expect(when).toBeGreaterThan(0);
      expect(how).toBeGreaterThan(when);
      expect(marker).toBeGreaterThan(how);
      expect(page).toContain(`src/${moduleId}/index.ts#`);
    }

    const verify = await runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(JSON.parse(verify.stdout).issues).toEqual([]);
  });

  it("(Q) critério 'batch completo' = verify exit 0 + zero issues (incluindo warnings)", async () => {
    // Achado Q (revisão Fase 4): o P gerou overview.md mas os links internos
    // ([page](../<modulo>.md)) eram normalizados pelo verify como
    // "livewiki/../<modulo>.md" → broken_internal_link. 3 WARNs no verify
    // após run completo. Critério ampliado: "batch completo" exige verify
    // 100% limpo (zero issues de qualquer severity, não só errors).
    //
    // Cenário do repro: 3 módulos (auth/utils/api) com pages geradas.
    // Overview emite [page](../auth.md), [page](../utils.md), [page](../api.md).
    // Sem o fix, cada um vira "livewiki/../X.md" → 3 broken_internal_link.
    await writeCode("src/auth/login.ts", "export function a() {}");
    await writeCode("src/utils/x.ts", "export function b() {}");
    await writeCode("src/api/y.ts", "export function c() {}");
    stub.setHandler((req) => defaultHandler(req));
    await writeConfig("anthropic", "claude-test-mock", stub.url);
    process.env["ANTHROPIC_API_KEY"] = "test-canary-Q";
    try {
      // 1. Batch completo
      const initR = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(initR.status, `init --batch falhou: ${initR.stderr}`).toBe(0);
      const initReport = JSON.parse(initR.stdout);
      expect(initReport.batchSummary.status).toBe("completed");

      // 2. Overview.md existe com os links emitidos
      const overview = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
        "utf8",
      );
      expect(overview).toMatch(/\[module page\]\(\.\.\/auth\.md\)/);
      expect(overview).toMatch(/\[module page\]\(\.\.\/utils\.md\)/);
      expect(overview).toMatch(/\[module page\]\(\.\.\/api\.md\)/);

      // 3. Verify limpo: exit 0 + zero issues
      const verifyR = await runCli(["--json", "--repo", repoRoot, "verify"]);
      expect(verifyR.status, `verify falhou: ${verifyR.stderr}`).toBe(0);
      const verifyReport = JSON.parse(verifyR.stdout);
      const broken = verifyReport.issues.filter(
        (i: { code: string }) => i.code === "broken_internal_link",
      );
      expect(
        broken.length,
        `verify reportou ${broken.length} broken_internal_link (esperado 0):\n` +
          broken.map((b: { detail: string }) => `  - ${b.detail}`).join("\n"),
      ).toBe(0);
      expect(
        verifyReport.issues.length,
        `verify reportou ${verifyReport.issues.length} issue(s) total (esperado 0):\n` +
          JSON.stringify(verifyReport.issues, null, 2),
      ).toBe(0);
      expect(verifyReport.ok).toBe(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  /**
   * Regression: `livewiki init --batch` must honor `config.ignores`.
   * Configured ignored paths must NOT enter the indexed inventory, the
   * module plan, batch tasks, the LLM work, or the generated pages.
   * The stub server records every module the LLM was asked to
   * document; we assert no ignored module ever shows up in that log.
   */
  it("init --batch respects config.ignores (no module/task/page for ignored paths)", async () => {
    // Product source (must be documented) + ignored dirs (must NOT).
    await writeCode("src/auth/login.ts", "export function login() { return 'auth'; }");
    await writeCode(
      "benchmarks/tooling/harness.ts",
      "export function runHarness() { return 'bench'; }",
    );
    await writeCode(
      "raw/openwiki/peer.ts",
      "export function peerImpl() { return 'peer'; }",
    );

    // Track every module the stub saw, then assert the ignored ones
    // never appeared.
    const seenModules: string[] = [];
    stub.setHandler((req) => {
      const match = req.user.match(/# Module: ([^\s]+)/);
      if (match) seenModules.push(match[1]!);
      return defaultHandler(req);
    });

    // Config with the same LLM stub URL + ignores list.
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify(
        {
          provider: "anthropic",
          model: "claude-test-mock",
          baseUrl: stub.url,
          ignores: ["benchmarks/", "raw/openwiki/"],
          // Roadmap #22: same pre-#22 format pins as the shared writeConfig helper.
          moduleDiagrams: false,
          deepHierarchy: false,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env["ANTHROPIC_API_KEY"] = "test-canary-DONOTLEAK";
    try {
      const r = await runCli(["--json", "--repo", repoRoot, "init", "--batch"]);
      expect(r.status, `init falhou: ${r.stderr}`).toBe(0);

      // No batch task for an ignored module.
      const tasksDir = nodePath.join(repoRoot, "livewiki");
      const wikiEntries = await nodeFs.readdir(tasksDir);
      for (const e of wikiEntries) {
        expect(e).not.toMatch(/benchmarks|openwiki|raw/i);
      }

      // The LLM was only asked to document the product module.
      expect(seenModules).toEqual(["auth"]);

      // Verify passes clean — no broken_internal_link / broken_anchor.
      const verR = await runCli(["--json", "--repo", repoRoot, "verify"]);
      expect(verR.status, `verify falhou: ${verR.stderr}`).toBe(0);
      const verReport = JSON.parse(verR.stdout) as { ok: boolean; issues: unknown[] };
      expect(verReport.issues).toEqual([]);
      expect(verReport.ok).toBe(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);
});
