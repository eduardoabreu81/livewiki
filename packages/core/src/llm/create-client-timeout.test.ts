/**
 * createLlmClient propagates timeoutMs into requestWithRetry behavior.
 * Offline — controlled fetch only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLlmClient, LlmTimeoutError } from "./index.js";
import { OpenAiCompatAdapter } from "./openai-compat.js";
import { AnthropicAdapter } from "./anthropic.js";
import { withTimeoutMs, DEFAULT_LLM_TIMEOUT_MS } from "./base.js";

describe("createLlmClient / adapter timeoutMs end-to-end", () => {
  const prevOpen = process.env.OPENAI_API_KEY;
  const prevAnth = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key-not-real";
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  });

  afterEach(() => {
    if (prevOpen === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpen;
    if (prevAnth === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnth;
  });

  it("withTimeoutMs preserves 0", () => {
    expect(withTimeoutMs(0)).toEqual({ timeoutMs: 0 });
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(300_000);
  });

  it("createLlmClient rejects invalid timeoutMs programmatically", () => {
    expect(() =>
      createLlmClient("/tmp/x", {
        provider: "openai-compat",
        model: "m",
        timeoutMs: -5,
        baseUrl: "https://api.openai.com",
      }),
    ).toThrow(/timeoutMs/);
    expect(() =>
      createLlmClient("/tmp/x", {
        provider: "openai-compat",
        model: "m",
        timeoutMs: 2_147_483_648,
        baseUrl: "https://api.openai.com",
      }),
    ).toThrow(/timeoutMs/);
  });

  it("openai-compat: timeoutMs 0 never auto-aborts a hanging fetch until resolved", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;

    const client = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      timeoutMs: 0,
      fetchImpl,
    });
    const p = client.generate({ system: "s", user: "u" });
    // Allow microtasks; without timeout the promise stays pending.
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveFetch!(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
          model: "m",
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
        { status: 200 },
      ),
    );
    const r = await p;
    expect(r.content).toBe("ok");
    expect(r.usage.inputTokens).toBe(2);
  });

  it("openai-compat: short timeoutMs aborts once (no second generation)", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;

    const client = new OpenAiCompatAdapter({
      apiKey: "k",
      baseUrl: "https://api.openai.com",
      model: "m",
      timeoutMs: 25,
      maxRetries: 3,
      fetchImpl,
    });
    await expect(
      client.generate({ system: "s", user: "u" }),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("anthropic: short timeoutMs aborts once", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;

    const client = new AnthropicAdapter({
      apiKey: "k",
      baseUrl: "https://api.anthropic.com",
      model: "claude-test",
      timeoutMs: 25,
      maxRetries: 3,
      fetchImpl,
    });
    await expect(
      client.generate({ system: "s", user: "u" }),
    ).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("factory constructs openai-compat and anthropic with timeoutMs", () => {
    const oai = createLlmClient("/tmp/a", {
      provider: "openai-compat",
      model: "MiniMax-M3",
      timeoutMs: 900_000,
      baseUrl: "https://api.openai.com",
    });
    expect(oai.provider).toBe("openai-compat");
    const anth = createLlmClient("/tmp/b", {
      provider: "anthropic",
      model: "claude-sonnet-5",
      timeoutMs: 0,
      baseUrl: "https://api.anthropic.com",
    });
    expect(anth.provider).toBe("anthropic");
  });
});
