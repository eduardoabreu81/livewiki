import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAiCompatAdapter } from "./openai-compat.js";
import { LlmRequestError } from "./index.js";
import {
  DEFAULT_LLM_TIMEOUT_MS,
  LlmTimeoutError,
  requestWithRetry,
  withTimeoutMs,
} from "./base.js";

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

  it("normalizes Anthropic stop reasons and preserves unknown values safely", async () => {
    const cases: Array<[string | null | undefined, "complete" | "length" | "incomplete" | "unknown"]> = [
      ["max_tokens", "length"],
      ["end_turn", "complete"],
      ["stop_sequence", "complete"],
      ["tool_use", "incomplete"],
      [null, "unknown"],
      [undefined, "unknown"],
    ];
    for (const [raw, expected] of cases) {
      const fetchImpl = fakeFetch({
        status: 200,
        body: {
          content: [{ type: "text", text: "x" }],
          model: "claude-sonnet-5",
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: raw,
        },
      });
      const adapter = new AnthropicAdapter({
        apiKey: "k", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", fetchImpl,
      });
      const r = await adapter.generate({ system: "s", user: "u" });
      expect(r.stopReason).toBe(expected);
    }
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

  it("normalizes OpenAI-compatible finish reasons and preserves unknown values safely", async () => {
    const cases: Array<[string | null | undefined, "complete" | "length" | "incomplete" | "unknown"]> = [
      ["length", "length"],
      ["stop", "complete"],
      ["tool_calls", "incomplete"],
      [null, "unknown"],
      [undefined, "unknown"],
    ];
    for (const [raw, expected] of cases) {
      const fetchImpl = fakeFetch({
        status: 200,
        body: {
          choices: [{ message: { role: "assistant", content: "x" }, finish_reason: raw }],
          model: "x",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
      });
      const adapter = new OpenAiCompatAdapter({
        apiKey: "k", baseUrl: "https://api.openai.com", model: "x", fetchImpl,
      });
      const r = await adapter.generate({ system: "s", user: "u" });
      expect(r.stopReason).toBe(expected);
    }
  });
});

describe("requestWithRetry — retry policy (timeout vs HTTP)", () => {
  it("defaults to DEFAULT_LLM_TIMEOUT_MS (300_000) when timeoutMs omitted", async () => {
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(300_000);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      // Abort signal must be present when default timeout is active.
      expect(init?.signal).toBeDefined();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await requestWithRetry(
      "openai-compat",
      "https://example.test/v1/chat/completions",
      { method: "POST" },
      { apiKey: "k", baseUrl: "x", model: "y", fetchImpl, maxRetries: 1 },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("timeoutMs: 0 does not attach an abort that fires (no automatic abort)", async () => {
    let sawSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal as AbortSignal | undefined;
      // Even if a signal object exists, it must not be pre-aborted.
      expect(sawSignal?.aborted).toBeFalsy();
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await requestWithRetry(
      "openai-compat",
      "https://example.test/v1/chat/completions",
      { method: "POST" },
      {
        apiKey: "k",
        baseUrl: "x",
        model: "y",
        fetchImpl,
        maxRetries: 1,
        timeoutMs: 0,
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("withTimeoutMs preserves 0 (not truthy-gated)", () => {
    expect(withTimeoutMs(0)).toEqual({ timeoutMs: 0 });
    expect(withTimeoutMs(undefined)).toEqual({});
    expect(withTimeoutMs(300_000)).toEqual({ timeoutMs: 300_000 });
  });

  it("response after 60s but before configured timeout does not retry (fake clock)", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        calls++;
        return new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          signal?.addEventListener("abort", onAbort);
          // Resolves at 90s — old 60s default would abort; 180s config must succeed once.
          setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve(new Response("{}", { status: 200 }));
          }, 90_000);
        });
      }) as unknown as typeof fetch;

      const p = requestWithRetry(
        "openai-compat",
        "https://example.test/v1/chat/completions",
        { method: "POST" },
        {
          apiKey: "k",
          baseUrl: "x",
          model: "y",
          fetchImpl,
          maxRetries: 3,
          timeoutMs: 180_000,
          retryDelayMs: 0,
        },
      );
      await vi.advanceTimersByTimeAsync(90_000);
      const res = await p;
      expect(res.ok).toBe(true);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AbortError makes only one call even with maxRetries: 3", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(
      requestWithRetry(
        "openai-compat",
        "https://example.test/v1/chat/completions",
        { method: "POST" },
        {
          apiKey: "k",
          baseUrl: "x",
          model: "y",
          fetchImpl,
          maxRetries: 3,
          timeoutMs: 1000,
          retryDelayMs: 0,
        },
      ),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retry 3x on 429 then gives up", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch;
    await expect(
      requestWithRetry(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
        {
          apiKey: "k",
          baseUrl: "x",
          model: "y",
          fetchImpl,
          maxRetries: 3,
          timeoutMs: 1000,
          retryDelayMs: 0,
        },
      ),
    ).rejects.toThrow(LlmRequestError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("retry on 503 (5xx still retryable)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("server error", { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(
      requestWithRetry(
        "anthropic",
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
        {
          apiKey: "k",
          baseUrl: "x",
          model: "y",
          fetchImpl,
          maxRetries: 2,
          timeoutMs: 1000,
          retryDelayMs: 0,
        },
      ),
    ).rejects.toThrow(LlmRequestError);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("successful HTTP after 429 retry attributes only the received response usage (one success)", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) return new Response("rate limited", { status: 429 });
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
          model: "m",
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const client = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      fetchImpl,
      maxRetries: 3,
      timeoutMs: 5000,
      retryDelayMs: 0,
    });
    const result = await client.generate({
      system: "s",
      user: "u",
      maxTokens: 16,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(7);
  });

  it("E2E stub: timeout does not start a second generation", async () => {
    let generations = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      generations++;
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
          return;
        }
        signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
        // Never resolves successfully — only abort ends the attempt.
      });
    }) as unknown as typeof fetch;

    const client = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      fetchImpl,
      maxRetries: 3,
      timeoutMs: 30,
    });
    await expect(
      client.generate({ system: "s", user: "u", maxTokens: 8 }),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(generations).toBe(1);
  });
});
