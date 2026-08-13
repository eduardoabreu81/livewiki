/**
 * key-leak — regressão CRÍTICA: API key NUNCA pode aparecer em nenhum output.
 *
 * Credentials may come from the environment or the global credential store,
 * but never from repo config, checkpoint_json, logs, or errors.
 *
 * Este teste simula todos os call sites do LLM + config + batch-state com
 * uma chave fake identificável ("KEY-LEAK-CANARY-DONOTUSE-7f3a") e verifica
 * que ela NÃO vaza em:
 *   - Mensagens de erro (LlmRequestError, MissingApiKeyError, etc.)
 *   - JSON serializado de checkpoint_json / config / summary_json
 *   - Logs de console (capturados via spy)
 *   - Mensagens de MissingProviderConfigError
 *
 * Se este teste falhar, NÃO comite — significa que algum caminho de erro
 * está expondo credencial.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";

const CANARY_KEY = "KEY-LEAK-CANARY-DONOTUSE-7f3a";

describe("key-leak — API key nunca vaza", () => {
  let repoRoot: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-keyleak-"));
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  function assertCanaryNotPresent(value: string, context: string): void {
    if (value.includes(CANARY_KEY)) {
      throw new Error(
        `CANARY KEY leaked in ${context}!\n` +
          `Canary: ${CANARY_KEY}\n` +
          `Value (first 500 chars): ${value.slice(0, 500)}`,
      );
    }
  }

  it("MissingApiKeyError NÃO contém o valor da key (apenas nome do env var)", async () => {
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { createLlmClient, MissingApiKeyError } = await import("./llm/index.js");
      try {
        createLlmClient(repoRoot, { provider: "anthropic", model: "claude-sonnet-5" });
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(MissingApiKeyError);
        const msg = (err as Error).message;
        assertCanaryNotPresent(msg, "MissingApiKeyError.message");
      }
    } finally {
      if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevOpenai !== undefined) process.env.OPENAI_API_KEY = prevOpenai;
    }
  });

  it("MissingProviderConfigError NÃO contém key (só mensagem com exemplo de modelo)", async () => {
    const { MissingProviderConfigError } = await import("./config.js");
    try {
      new MissingProviderConfigError(repoRoot, ["provider", "model"]);
    } catch (err) {
      // Não throw aqui — só instanciamos
    }
    const err = new (await import("./config.js")).MissingProviderConfigError(repoRoot, ["provider"]);
    assertCanaryNotPresent(err.message, "MissingProviderConfigError.message");
    assertCanaryNotPresent(err.stack ?? "", "MissingProviderConfigError.stack");
  });

  it("LlmRequestError NÃO carrega a key mesmo quando o body do provider vem", async () => {
    // Simula provider devolvendo erro 500 com body que menciona a key (worst case).
    // O adapter NÃO deve incluir esse body na mensagem — só status + summary truncado.
    const fakeBody = `{"error":"internal","leak":"${CANARY_KEY}"}`;
    const fetchImpl = vi.fn(async () =>
      new Response(fakeBody, { status: 500 }),
    ) as unknown as typeof fetch;
    const { AnthropicAdapter } = await import("./llm/anthropic.js");
    const adapter = new AnthropicAdapter({
      apiKey: CANARY_KEY,
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5",
      fetchImpl,
      maxRetries: 1, // 1 tentativa só — não loop no teste
      timeoutMs: 1000,
    });
    try {
      await adapter.generate({ system: "s", user: "u" });
    } catch (err) {
      const e = err as Error;
      assertCanaryNotPresent(e.message, "LlmRequestError.message (Anthropic)");
      assertCanaryNotPresent(e.stack ?? "", "LlmRequestError.stack (Anthropic)");
    }
  });

  it("config.json gravado via saveConfig() NÃO contém key", async () => {
    const { saveConfig, loadConfig } = await import("./config.js");
    await saveConfig(repoRoot, {
      provider: "anthropic",
      model: "claude-sonnet-5",
      pricing: { "claude-sonnet-5": { input: 3, output: 15 } },
    });
    const raw = await nodeFs.readFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      "utf8",
    );
    assertCanaryNotPresent(raw, "config.json on disk");

    const loaded = await loadConfig(repoRoot);
    const loadedJson = JSON.stringify(loaded);
    assertCanaryNotPresent(loadedJson, "loaded config as JSON");
  });

  it("the new credential store never crosses into repo config or errors", async () => {
    const home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-keyleak-home-"));
    const previousHome = process.env.LIVEWIKI_HOME;
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.LIVEWIKI_HOME = home;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { planInstall, applyInstall } = await import("./install.js");
      const plan = await planInstall({
        repoRoot,
        home,
        credential: { envVar: "ANTHROPIC_API_KEY", value: CANARY_KEY },
      });
      const results = await applyInstall(plan, repoRoot);
      assertCanaryNotPresent(JSON.stringify(results), "credential apply results");

      const { saveConfig } = await import("./config.js");
      await saveConfig(repoRoot, {
        preset: "anthropic",
        model: "claude-sonnet-5",
        language: "en",
      });
      const repoConfig = await nodeFs.readFile(
        nodePath.join(repoRoot, ".livewiki", "config.json"),
        "utf8",
      );
      assertCanaryNotPresent(repoConfig, "repo config after credential write");
    } finally {
      if (previousHome === undefined) delete process.env.LIVEWIKI_HOME;
      else process.env.LIVEWIKI_HOME = previousHome;
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      await nodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("checkpoint_json com usageHistory NÃO vaza key em nenhum item", async () => {
    // Simula checkpoint típico do batch (sem precisar do orchestrator ainda).
    const checkpoint = {
      stage: 4,
      status: "done",
      attempt: 1,
      startedAt: 1700000000,
      finishedAt: 1700000123,
      usageHistory: [
        {
          attempt: 1,
          usage: { inputTokens: 100, outputTokens: 50, model: "claude-sonnet-5" },
          costUsd: { input: 0.0003, output: 0.00075, total: 0.00105, refDate: "2026-07-09" },
          finishedAt: 1700000123,
        },
      ],
      artifacts: { wikiPath: "livewiki/auth.md", pageHash: "abc123" },
    };
    const json = JSON.stringify(checkpoint);
    assertCanaryNotPresent(json, "checkpoint_json serialized");
  });

  it("adapter headers carregam a key (correto) mas NUNCA logs/erros", async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-5",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const { AnthropicAdapter } = await import("./llm/anthropic.js");
    const adapter = new AnthropicAdapter({
      apiKey: CANARY_KEY,
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5",
      fetchImpl,
    });
    await adapter.generate({ system: "s", user: "u" });
    // A key ESTÁ nos headers (precisa estar) — isso é correto.
    expect(capturedHeaders["x-api-key"]).toBe(CANARY_KEY);

    // Mas NÃO pode ter vazado em logs capturados
    for (const call of consoleLogSpy.mock.calls) {
      for (const arg of call) {
        assertCanaryNotPresent(String(arg), "console.log output");
      }
    }
  });

  it("console.error/warn não contém a key em nenhum path", async () => {
    // Dispara erro real e checa logs capturados
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { createLlmClient } = await import("./llm/index.js");
      try {
        createLlmClient(repoRoot, { provider: "anthropic", model: "claude-sonnet-5" });
      } catch (err) {
        // Esperado. Erro NÃO deve logar sozinho (vamos logar manualmente aqui).
        console.error("Failed to create LLM client:", err);
      }
    } finally {
      if (prevAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropic;
    }

    for (const spy of [consoleLogSpy, consoleWarnSpy, consoleErrorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const s = typeof arg === "string" ? arg : JSON.stringify(arg);
          assertCanaryNotPresent(s, "console spy output");
        }
      }
    }
  });

  it("manifest.ts equivalente não vai conter a key (checkpoint_summary JSON)", async () => {
    // Simula summary_json de batch_run — sem key em lugar nenhum
    const summary = {
      totals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.005, models: ["claude-sonnet-5"] },
      byStage: {
        "2": { inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
        "4": { inputTokens: 900, outputTokens: 450, costUsd: 0.004 },
      },
      byModule: [{ module: "auth", inputTokens: 900, outputTokens: 450, costUsd: 0.004, models: ["claude-sonnet-5"] }],
      tasksDone: 1,
      tasksFailed: 0,
      tasksPending: 0,
    };
    const json = JSON.stringify(summary);
    assertCanaryNotPresent(json, "batch_run.summary_json");
  });

  /**
   * H8 (Lot B): the diagnosticHistory surface is a NEW persisted
   * output (checkpoint JSON + `batch status --json`). The contract's
   * I4 (content safety) and the key-leak guarantee MUST both extend
   * to it. This test:
   *   - runs a real stage-4 batch with a stubbed provider whose
   *     candidate embeds a long sentinel string;
   *   - serializes the checkpoint JSON + the status report;
   *   - asserts the canary key never appears in either, AND
   *   - asserts the long sentinel is only present TRUNCATED to
   *     DIAGNOSTIC_TEXT_CAP (200) chars inside `offending`/`message`,
   *     never whole.
   *
   * The sentinel has to be LONGER than DIAGNOSTIC_TEXT_CAP so that a
   * truncated prefix (≤200 chars) is distinguishable from a
   * whole-string leak. We use 400 chars.
   */
  it("H8 — diagnosticHistory in checkpoint + status JSON leaks neither the key nor the whole candidate", async () => {
    // Build a 400-char sentinel (2× DIAGNOSTIC_TEXT_CAP) so the
    // truncation is observable.
    const CANARY_SENTINEL = "SENTINEL-CANDIDATE-LEAK-DONOTUSE-" + "X".repeat(370);

    // Source file (so the planner finds a file unit to document).
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\n",
      "utf8",
    );
    // Disable every stage-5 surface: this test is about the stage-4
    // diagnostic history, not flows/topics/understanding.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxFlows: 0, maxTopics: 0, understandingSynthesis: false }),
      "utf8",
    );

    // Stub LLM that returns an invalid candidate with the long
    // sentinel in the frontmatter `anchors:` key. The validator
    // puts the key into `offending` and embeds it into the message
    // string, so the diagnostic error summary contains the
    // (eventually truncated) sentinel. The FOLDER-purpose prompt
    // (#29: one extra deterministic task per product folder) gets a
    // valid plain-prose paragraph so only the file task fails.
    //
    // Inline stub — `ProgrammableMockLlm` lives in
    // `batch-repair.test.ts` and is not exported as a shared helper.
    const stub = {
      provider: "anthropic" as const,
      model: "claude-test-mock",
      async generate(req: { system: string }) {
        if (req.system.includes("purpose paragraph of ONE folder page")) {
          return {
            content:
              "This directory holds the authentication module: the login flow and its session handling.",
            usage: { inputTokens: 100, outputTokens: 50, model: this.model },
            stopReason: "complete" as const,
            rawStopReason: "stop",
          };
        }
        return {
          content: [
            "---",
            "title: auth",
            "owner: generated",
            "anchors:",
            `  - ${CANARY_SENTINEL}`,
            "---",
            "",
            "# auth",
            "",
            `Body with ${CANARY_SENTINEL} inline (this string is also a leak).`,
            "",
          ].join("\n"),
          usage: { inputTokens: 100, outputTokens: 50, model: this.model },
          stopReason: "complete" as const,
          rawStopReason: "stop",
        };
      },
    };

    // Run a real batch (single attempt — maxRepairAttempts: 0). The
    // validator will reject the FILE task's candidate (the sentinel key is
    // not in the closed list) and the diagnostic history will record the
    // truncated sentinel in `offending` and `message`. #29: the file task
    // target is the real unit id `auth/login` (`auth` is now the folder
    // task, which the stub answers validly).
    const { runBatch } = await import("./batch.js");
    const result = await runBatch({
      repoRoot,
      llmClient: stub as unknown as import("./llm/index.js").LlmClient,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
      // Roadmap #22: pin the pre-#22 stage-4 format (the stub emits no Diagram
      // section); #22-on is covered by module-diagram-format/batch-module-diagrams.
      moduleDiagrams: false,
      deepHierarchy: false,
    });
    expect(result.status).toBe("completed_with_failures");

    // 1. Read the serialized checkpoint JSON (and the status report).
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    let checkpointJson: string;
    let statusJson: string;
    try {
      const row = db
        .prepare(
          "SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?",
        )
        .get("auth/login") as { checkpoint_json: string };
      checkpointJson = row.checkpoint_json;
    } finally {
      db.close();
    }
    assertCanaryNotPresent(checkpointJson, "checkpoint_json (diagnosticHistory present)");

    // 2. The status report JSON MUST also be free of the canary key.
    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    statusJson = JSON.stringify(report);
    assertCanaryNotPresent(statusJson, "status report JSON (diagnosticHistory present)");

    // 3. The candidate sentinel must NEVER appear WHOLE anywhere in
    // the serialized surfaces. The contract requires it appears only
    // truncated to DIAGNOSTIC_TEXT_CAP inside `offending`/`message`.
    expect(checkpointJson).not.toContain(CANARY_SENTINEL);
    expect(statusJson).not.toContain(CANARY_SENTINEL);

    // 4. The truncated prefix (first 200 chars) IS allowed (that's
    // the whole point of the cap), and the second 200 chars are
    // forbidden.
    const truncated = CANARY_SENTINEL.slice(0, 200);
    const overflow = CANARY_SENTINEL.slice(200);
    // The truncated prefix is fine — it must appear at least once
    // (the validator includes the key in the diagnostic message).
    expect(checkpointJson).toContain(truncated);
    expect(statusJson).toContain(truncated);
    // The overflow portion must not appear.
    expect(checkpointJson).not.toContain(overflow);
    expect(statusJson).not.toContain(overflow);

    // 5. Walk the diagnostic structure: every `offending` and
    // `message` field, where present, must be ≤ DIAGNOSTIC_TEXT_CAP.
    const checkpoint = JSON.parse(checkpointJson) as {
      diagnosticHistory: Array<{
        errors: Array<{ offending?: string; message: string }>;
      }>;
    };
    expect(checkpoint.diagnosticHistory).toBeDefined();
    for (const entry of checkpoint.diagnosticHistory) {
      for (const e of entry.errors) {
        if (e.offending !== undefined) {
          expect(e.offending.length).toBeLessThanOrEqual(200);
        }
        expect(e.message.length).toBeLessThanOrEqual(200);
      }
    }
  });

  /**
   * Lot D — D3.1 (extends H8 surface). A candidate containing BOTH a
   * valid marker (all keys in the closed list) and a fake marker
   * whose key is a long sentinel. The selective neutralization in
   * the repair prompt preserves the valid marker and neutralizes
   * the fake one, but the diagnostic history (which is content-safe
   * per I4 and lives in the checkpoint + status JSON) MUST still
   * never contain the whole sentinel — only the 200-char truncated
   * prefix of the fake key as `offending`. This is the new
   * "combination" surface for the H8 contract: a valid marker
   * present alongside a sentinel-bearing fake marker.
   */
  it("D3.1 — valid marker + sentinel-bearing fake marker in the same candidate never leaks the sentinel whole", async () => {
    // 400-char sentinel (2× DIAGNOSTIC_TEXT_CAP) so truncation is
    // observable. Distinct from the H8 sentinel so we can assert
    // it independently.
    const SENTINEL_KEY = "D3-SENTINEL-FAKE-KEY-DONOTUSE-" + "Z".repeat(370);
    expect(SENTINEL_KEY.length).toBeGreaterThan(200);

    // Source file so the planner finds a file unit to document.
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\n",
      "utf8",
    );
    // Disable every stage-5 surface: this test is about the stage-4
    // diagnostic history, not flows/topics/understanding.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxFlows: 0, maxTopics: 0, understandingSynthesis: false }),
      "utf8",
    );

    // The candidate contains BOTH:
    //   1. A valid marker (all keys from the closed list — login
    //      and logout are the only symbols in this module).
    //   2. A fake marker whose key IS the SENTINEL_KEY. The
    //      validator rejects it with `anchor_outside_closed_list`,
    //      putting the whole SENTINEL_KEY (then truncated to 200)
    //      into the diagnostic's `offending` field.
    //
    // The valid marker is preserved by the selective neutralizer
    // when this candidate is re-embedded in a repair prompt. The
    // fake marker is neutralized to whitespace. The candidate is
    // NOT persisted to the diagnostic history — only its hash +
    // size and the structured errors.
    // The FOLDER-purpose prompt (#29: one extra deterministic task per
    // product folder) gets a valid plain-prose paragraph so only the
    // file task fails.
    const stub = {
      provider: "anthropic" as const,
      model: "claude-test-mock",
      async generate(req: { system: string }) {
        if (req.system.includes("purpose paragraph of ONE folder page")) {
          return {
            content:
              "This directory holds the authentication module: the login flow and its session handling.",
            usage: { inputTokens: 100, outputTokens: 50, model: this.model },
            stopReason: "complete" as const,
            rawStopReason: "stop",
          };
        }
        const validMarker =
          "<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->";
        const fakeMarker = `<!-- lw:anchors ${SENTINEL_KEY} -->`;
        return {
          content: [
            "---",
            "title: auth",
            "owner: generated",
            "anchors:",
            "  - src/auth/login.ts#login",
            "  - src/auth/login.ts#logout",
            "---",
            "",
            "# auth",
            "",
            validMarker,
            "",
            "Body with a poisoned fake marker:",
            fakeMarker,
            "",
          ].join("\n"),
          usage: { inputTokens: 100, outputTokens: 50, model: this.model },
          stopReason: "complete" as const,
          rawStopReason: "stop",
        };
      },
    };

    const { runBatch } = await import("./batch.js");
    const result = await runBatch({
      repoRoot,
      llmClient: stub as unknown as import("./llm/index.js").LlmClient,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
      // Roadmap #22: pin the pre-#22 stage-4 format (the stub emits no Diagram
      // section); #22-on is covered by module-diagram-format/batch-module-diagrams.
      moduleDiagrams: false,
      deepHierarchy: false,
    });
    expect(result.status).toBe("completed_with_failures");

    // 1. Read the serialized checkpoint JSON + the status report.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    let checkpointJson: string;
    let statusJson: string;
    try {
      const row = db
        .prepare(
          "SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?",
        )
        .get("auth/login") as { checkpoint_json: string };
      checkpointJson = row.checkpoint_json;
    } finally {
      db.close();
    }
    assertCanaryNotPresent(checkpointJson, "checkpoint_json (D3.1)");

    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    statusJson = JSON.stringify(report);
    assertCanaryNotPresent(statusJson, "status JSON (D3.1)");

    // 2. The whole SENTINEL_KEY never appears in either serialized
    // surface. The fake marker is NOT in the diagnostic (only its
    // truncated key as offending, plus a SHA-256 of the candidate).
    expect(checkpointJson).not.toContain(SENTINEL_KEY);
    expect(statusJson).not.toContain(SENTINEL_KEY);

    // 3. The truncated prefix (first 200 chars) is allowed; the
    // overflow portion (chars 201+) is forbidden. This is the
    // DIAGNOSTIC_TEXT_CAP guarantee applied to the new combination
    // surface (valid marker + sentinel-bearing fake marker).
    const truncated = SENTINEL_KEY.slice(0, 200);
    const overflow = SENTINEL_KEY.slice(200);
    expect(checkpointJson).toContain(truncated);
    expect(checkpointJson).not.toContain(overflow);
    expect(statusJson).toContain(truncated);
    expect(statusJson).not.toContain(overflow);

    // 4. The valid marker (which would survive selective
    // neutralization in a repair prompt) is NOT in the diagnostic
    // history. The diagnostic only persists errors + hash + size —
    // never the prompt content itself. This is the I4 content-safety
    // guarantee reasserted under the new selective neutralization.
    const validMarker =
      "<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->";
    expect(checkpointJson).not.toContain(validMarker);
    expect(statusJson).not.toContain(validMarker);

    // 5. Walk the diagnostic structure: every offending/message is
    // bounded by DIAGNOSTIC_TEXT_CAP.
    const checkpoint = JSON.parse(checkpointJson) as {
      diagnosticHistory: Array<{
        errors: Array<{ offending?: string; message: string; code: string }>;
      }>;
    };
    expect(checkpoint.diagnosticHistory).toBeDefined();
    for (const entry of checkpoint.diagnosticHistory) {
      for (const e of entry.errors) {
        if (e.offending !== undefined) {
          expect(e.offending.length).toBeLessThanOrEqual(200);
        }
        expect(e.message.length).toBeLessThanOrEqual(200);
      }
      // The error code MUST be `anchor_outside_closed_list`
      // (proves the validator caught the fake key).
      const codes = entry.errors.map((e) => e.code);
      expect(codes).toContain("anchor_outside_closed_list");
    }
  });
});
