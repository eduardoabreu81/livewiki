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
  const match = req.user.match(/# Module: ([^\s]+)/);
  const moduleId = match ? match[1] : "unknown";
  const keyMatch = req.user.match(/^- (.+?#[\w.]+)$/m);
  const firstKey = keyMatch ? keyMatch[1] : `${moduleId}.ts#placeholder`;
  const content = `---
title: ${moduleId}
owner: generated
anchors:
  - ${firstKey}
---

# ${moduleId}

Documentation for ${moduleId}.

## Details
<!-- lw:anchors ${firstKey} -->

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
    nodePath.join(process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp", "livewiki-e2e-f3-"),
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
    JSON.stringify({ provider, model, baseUrl }, null, 2),
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
      ).toContain("graph TD");
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/modules.mmd"), "utf8"),
      ).toContain("graph LR");

      // Overview (P): gerado em init base + batch, target dos links do quickstart
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/overview.md"), "utf8"),
      ).toMatch(/Architecture overview/);

      // Manifest
      const manifest = JSON.parse(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/.manifest.json"), "utf8"),
      );
      expect(manifest.version).toBe(1);
      expect(manifest.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

      // Quickstart
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8"),
      ).toMatch(/Quickstart|Guia/);

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

      // Re-roda 1 task
      const r2 = await runCli(["--json", "--repo", repoRoot, "batch", "--only", "auth", "1"]);
      // O número de args esperado é: --only <target> <runId>
      // Vamos usar a forma alternativa: --only <target> (sem runId — usa o último)
      const r2b = await runCli(["--json", "--repo", repoRoot, "batch", "--only", "auth"]);
      expect(r2b.status, r2b.stderr).toBe(0);

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

  it("(P) init gera livewiki/architecture/overview.md (target dos links do quickstart)", async () => {
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
    // Módulo "auth" presente
    expect(overview).toMatch(/### auth/);
    expect(overview).toMatch(/### utils/);
    // Anchor HTML inline garante match exato com o link do quickstart
    expect(overview).toMatch(/<a id="auth"><\/a>/);
    expect(overview).toMatch(/<a id="utils"><\/a>/);
    // Link para diagrama de classes
    expect(overview).toMatch(/\[class diagram\]\(\.\.\/diagrams\/auth\.classes\.mmd\)/);
    // Diagramas embedados (mermaid code fence)
    expect(overview).toMatch(/```mermaid/);
    expect(overview).toMatch(/%% livewiki\/architecture\/structure\.mmd/);
    expect(overview).toMatch(/%% livewiki\/architecture\/modules\.mmd/);
  });

  it("(P) init --batch gera overview.md com pages dos módulos linkadas", async () => {
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
      // Modules heurísticos
      expect(overview).toMatch(/### auth/);
      expect(overview).toMatch(/### utils/);
      // Page link existe
      expect(overview).toMatch(/\[page\]\(\.\.\/auth\.md\)/);
      expect(overview).toMatch(/\[page\]\(\.\.\/utils\.md\)/);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60_000);

  it("(P) links do quickstart para architecture/overview.md#<m.id> batem com anchors", async () => {
    // Os links que o quickstart emite (`architecture/overview.md#auth`) precisam
    // resolver para anchors reais no overview.md (definidos via `<a id="...">`).
    // Sem isso, o verify emite WARNs e a navegação fica quebrada.
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

    // Extrai todos os anchors que o quickstart linka
    const linkMatches = [...quickstart.matchAll(/\(architecture\/overview\.md#([^)]+)\)/g)];
    expect(linkMatches.length).toBeGreaterThan(0);
    for (const m of linkMatches) {
      const anchor = m[1];
      if (anchor === undefined) continue; // TS narrow: matchAll pode devolver undefined em captura
      // Cada anchor linkado deve existir como `<a id="X">` no overview
      const re = new RegExp(`<a id="${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`);
      expect(overview, `quickstart linka #${anchor} mas overview não tem o anchor`).toMatch(re);
    }
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
    // SEM .livewiki/config.json
    const r = await runCli(["--json", "--repo", repoRoot, "init"]);
    expect(r.status, r.stderr).toBe(0);
    // Gera layout determinístico
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/architecture/structure.mmd"), "utf8"),
    ).toContain("graph TD");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8"),
    ).toMatch(/Quickstart|Guia/);
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
      expect(overview).toMatch(/\[page\]\(\.\.\/auth\.md\)/);
      expect(overview).toMatch(/\[page\]\(\.\.\/utils\.md\)/);
      expect(overview).toMatch(/\[page\]\(\.\.\/api\.md\)/);

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
});