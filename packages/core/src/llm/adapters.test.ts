import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAiCompatAdapter } from "./openai-compat.js";
import { LlmRequestError } from "./index.js";

/** Fake fetch que devolve uma response controlada. */
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch {
  return vi.fn(async () => {
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    const bodyText = response.body !== undefined ? JSON.stringify(response.body) : "{}";
    return new Response(bodyText, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("AnthropicAdapter", () => {
  it("POST pra /v1/messages com headers x-api-key + anthropic-version", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi from claude" }],
          model: "claude-sonnet-5",
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const adapter = new AnthropicAdapter({
      apiKey: "sk-test-123",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-5",
      fetchImpl,
    });
    const r = await adapter.generate({ system: "sys", user: "hi" });
    expect(r.content).toBe("hi from claude");
    expect(r.usage.inputTokens).toBe(10);
    expect(r.usage.outputTokens).toBe(5);
    expect(r.usage.model).toBe("claude-sonnet-5");

    // Verifica request shape
    const [calledUrl, calledInit] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.anthropic.com/v1/messages");
    expect((calledInit as RequestInit).method).toBe("POST");
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-123");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse((calledInit as RequestInit).body as string);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("normaliza input_tokens → inputTokens, output_tokens → outputTokens", async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      body: {
        content: [{ type: "text", text: "x" }],
        model: "claude-sonnet-5",
        usage: { input_tokens: 1234, output_tokens: 567 },
      },
    });
    const adapter = new AnthropicAdapter({
      apiKey: "k", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", fetchImpl,
    });
    const r = await adapter.generate({ system: "s", user: "u" });
    expect(r.usage.inputTokens).toBe(1234);
    expect(r.usage.outputTokens).toBe(567);
  });

  it("status 4xx (não 429) lança LlmRequestError sem retry", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("invalid api key", { status: 401 }),
    ) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter({
      apiKey: "k", baseUrl: "https://api.anthropic.com", model: "x", fetchImpl, maxRetries: 3,
    });
    await expect(adapter.generate({ system: "s", user: "u" })).rejects.toThrow(LlmRequestError);
    // 1 única chamada — sem retry
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

describe("OpenAiCompatAdapter", () => {
  it("POST pra /v1/chat/completions com Authorization Bearer", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hi" } }],
          model: "gpt-4o-mini",
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const adapter = new OpenAiCompatAdapter({
      apiKey: "sk-openai-test",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o-mini",
      fetchImpl,
    });
    const r = await adapter.generate({ system: "sys", user: "hi" });
    expect(r.content).toBe("hi");
    expect(r.usage.inputTokens).toBe(20);
    expect(r.usage.outputTokens).toBe(10);

    const [calledUrl, calledInit] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://api.openai.com/v1/chat/completions");
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-openai-test");
  });

  it("respeita baseUrl que JÁ termina em /v1 (não duplica)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [], model: "x", usage: { prompt_tokens: 0, completion_tokens: 0 } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const adapter = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://proxy.example.com/v1",
      model: "x",
      fetchImpl,
    });
    await adapter.generate({ system: "s", user: "u" });
    const [calledUrl] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledUrl).toBe("https://proxy.example.com/v1/chat/completions");
  });

  it("sends thinking.disabled and max_completion_tokens for MiniMax-M3 defaults", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.max_completion_tokens).toBe(8000);
      expect(body.max_tokens).toBeUndefined();
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
          model: "MiniMax-M3",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const adapter = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:8900/v1",
      model: "MiniMax-M3",
      fetchImpl,
      thinkingDefault: "omit", // model heuristic still disables for MiniMax-M3
      preferMaxCompletionTokens: true,
    });
    await adapter.generate({ system: "s", user: "u", maxTokens: 8000 });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("omits thinking for plain openai models", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(body.thinking).toBeUndefined();
      expect(body.max_tokens).toBe(4096);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
          model: "gpt-4o",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const adapter = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o",
      fetchImpl,
      thinkingDefault: "omit",
      preferMaxCompletionTokens: false,
    });
    await adapter.generate({ system: "s", user: "u" });
  });

  it("normaliza prompt_tokens → inputTokens, completion_tokens → outputTokens", async () => {
    const fetchImpl = fakeFetch({
      status: 200,
      body: {
        choices: [{ message: { role: "assistant", content: "x" } }],
        model: "x",
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
    });
    const adapter = new OpenAiCompatAdapter({
      apiKey: "k", baseUrl: "https://api.openai.com", model: "x", fetchImpl,
    });
    const r = await adapter.generate({ system: "s", user: "u" });
    expect(r.usage.inputTokens).toBe(100);
    expect(r.usage.outputTokens).toBe(50);
  });
});

describe("requestWithRetry — retry em 429/5xx", () => {
  it("retry 3x em 429 e desiste", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    const { requestWithRetry } = await import("./base.js");
    // retryDelayMs=0 → sem espera entre tentativas (teste rápido)
    await expect(
      requestWithRetry(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
        { apiKey: "k", baseUrl: "x", model: "y", fetchImpl, maxRetries: 3, timeoutMs: 1000, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(LlmRequestError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("retry em 500 (5xx também é retryable)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("server error", { status: 500 }),
    ) as unknown as typeof fetch;
    const { requestWithRetry } = await import("./base.js");
    await expect(
      requestWithRetry(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
        { apiKey: "k", baseUrl: "x", model: "y", fetchImpl, maxRetries: 2, timeoutMs: 1000, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(LlmRequestError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});