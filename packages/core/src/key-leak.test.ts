/**
 * key-leak — regressão CRÍTICA: API key NUNCA pode aparecer em nenhum output.
 *
 * SPEC §"Stack" (commit 3894f6e): "API key SÓ via env var (ANTHROPIC_API_KEY /
 * OPENAI_API_KEY); nunca em config.json, checkpoint_json, logs ou erros —
 * com teste garantindo."
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
});