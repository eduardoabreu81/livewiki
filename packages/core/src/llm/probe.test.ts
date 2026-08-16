import { describe, it, expect, vi, afterEach } from "vitest";
import { probeProvider, formatProbeFailure } from "./probe.js";

const CONFIG = {
  provider: "openai-compat",
  model: "probe-model",
  baseUrl: "https://probe.example",
} as const;

function stubFetchResponse(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

function completion(content: string, reasoningTokens?: number): unknown {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    model: "served-model-id",
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      ...(reasoningTokens !== undefined
        ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } }
        : {}),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("llm/probe — connectivity + thinking-leak detection", () => {
  it("clean minimal answer: ok, no leak, model echo captured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    stubFetchResponse(completion("OK"));
    const probe = await probeProvider(".", { ...CONFIG });
    expect(probe.ok).toBe(true);
    expect(probe.thinkingLeak).toBe(false);
    expect(probe.modelEcho).toBe("served-model-id");
    expect(probe.reasoningTokens).toBe(0);
    expect(probe.error).toBeNull();
  });

  it("reasoning_tokens > 0 under the current config: thinkingLeak", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    stubFetchResponse(completion("OK", 512));
    const probe = await probeProvider(".", { ...CONFIG });
    expect(probe.ok).toBe(true);
    expect(probe.thinkingLeak).toBe(true);
    expect(probe.reasoningTokens).toBe(512);
  });

  it("inline <think> block in content: thinkingLeak", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    stubFetchResponse(completion("<think>hmm</think>OK"));
    const probe = await probeProvider(".", { ...CONFIG });
    expect(probe.thinkingLeak).toBe(true);
  });

  it("request failure: ok=false with the error detail", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const probe = await probeProvider(".", { ...CONFIG });
    expect(probe.ok).toBe(false);
    expect(probe.error).toMatch(/network|ECONNREFUSED/);
  });

  it("missing credential: ok=false naming only the env var slot", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const probe = await probeProvider(".", { ...CONFIG });
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("OPENAI_API_KEY");
  });

  it("formatProbeFailure points at thinking disabled on a leak", () => {
    const text = formatProbeFailure({
      ok: true,
      thinkingLeak: true,
      modelEcho: "m",
      reasoningTokens: 10,
      error: null,
    });
    expect(text).toContain('"thinking": "disabled"');
    expect(text).not.toContain("test-key");
  });
});
