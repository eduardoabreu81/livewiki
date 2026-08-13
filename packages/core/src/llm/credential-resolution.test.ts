import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  CredentialStoreError,
  credentialStorePath,
  parseCredentialStore,
  readCredentialStatusSync,
  resolveCredentialSync,
  resolveLivewikiHome,
} from "../credentials.js";
import { createLlmClient, MissingApiKeyError } from "./index.js";

describe("createLlmClient credential resolution", () => {
  let home: string;
  let previousHome: string | undefined;
  let previousAnthropic: string | undefined;
  let previousOllama: string | undefined;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-credentials-home-"));
    previousHome = process.env.LIVEWIKI_HOME;
    previousAnthropic = process.env.ANTHROPIC_API_KEY;
    previousOllama = process.env.OLLAMA_API_KEY;
    process.env.LIVEWIKI_HOME = home;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_API_KEY;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LIVEWIKI_HOME;
    else process.env.LIVEWIKI_HOME = previousHome;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousOllama === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = previousOllama;
    await nodeFs.rm(home, { recursive: true, force: true });
  });

  async function writeStore(content: string): Promise<string> {
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, content, "utf8");
    return storePath;
  }

  function adapterKey(client: ReturnType<typeof createLlmClient>): string {
    return (client as unknown as { apiKey: string }).apiKey;
  }

  it("prefers the environment over the global credential store", async () => {
    await writeStore(JSON.stringify({ ANTHROPIC_API_KEY: "store-key" }));
    process.env.ANTHROPIC_API_KEY = "environment-key";

    const client = createLlmClient("/tmp/repo", {
      preset: "anthropic",
      model: "claude-sonnet-5",
    });

    expect(adapterKey(client)).toBe("environment-key");
  });

  it("uses the global credential store when the environment is absent", async () => {
    await writeStore(JSON.stringify({ ANTHROPIC_API_KEY: "store-key" }));

    const client = createLlmClient("/tmp/repo", {
      preset: "anthropic",
      model: "claude-sonnet-5",
    });

    expect(adapterKey(client)).toBe("store-key");
  });

  it("stays synchronous and gives an instructive error when no credential exists", () => {
    expect(() =>
      createLlmClient("/tmp/repo", {
        preset: "anthropic",
        model: "claude-sonnet-5",
      }),
    ).toThrow(MissingApiKeyError);

    try {
      createLlmClient("/tmp/repo", {
        preset: "anthropic",
        model: "claude-sonnet-5",
      });
      expect.fail("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("livewiki config");
      expect(message).toContain("ANTHROPIC_API_KEY");
      expect(message).not.toContain("Promise");
    }
  });

  it("fails clearly on a corrupt store and never deletes it", async () => {
    const corrupt = "{ definitely-not-json";
    const storePath = await writeStore(corrupt);

    expect(() =>
      createLlmClient("/tmp/repo", {
        preset: "anthropic",
        model: "claude-sonnet-5",
      }),
    ).toThrow(CredentialStoreError);
    expect(await nodeFs.readFile(storePath, "utf8")).toBe(corrupt);
  });

  it("rejects non-object stores and non-empty-string violations", () => {
    const storePath = credentialStorePath(home);
    for (const raw of ["null", "[]", '{"OPENAI_API_KEY":""}', '{"OPENAI_API_KEY":42}']) {
      expect(() => parseCredentialStore(raw, storePath)).toThrow(CredentialStoreError);
    }
  });

  it("wraps non-missing read failures with the store path", async () => {
    const storePath = credentialStorePath(home);
    await nodeFs.mkdir(storePath, { recursive: true });

    expect(() => resolveCredentialSync("ANTHROPIC_API_KEY", { home, env: {} })).toThrow(
      new RegExp(`Credential store .*credentials\\.json could not be read`),
    );
  });

  it("reports source and presence without returning the credential value", async () => {
    await writeStore(JSON.stringify({ ANTHROPIC_API_KEY: "store-key" }));

    expect(readCredentialStatusSync("ANTHROPIC_API_KEY", { home, env: {} })).toEqual({
      envVar: "ANTHROPIC_API_KEY",
      set: true,
      source: "credentials-store",
      storePath: credentialStorePath(home),
    });
    expect(readCredentialStatusSync("OPENAI_API_KEY", { home, env: {} })).toMatchObject({
      envVar: "OPENAI_API_KEY",
      set: false,
      source: null,
    });
  });

  it("resolves LIVEWIKI_HOME before deriving the global store path", () => {
    const resolved = resolveLivewikiHome({ LIVEWIKI_HOME: nodePath.join(home, "nested", "..") });
    expect(resolved).toBe(nodePath.resolve(home));
    expect(credentialStorePath(resolved)).toBe(
      nodePath.join(nodePath.resolve(home), ".livewiki", "credentials.json"),
    );
  });

  it.each(["ollama", "lmstudio"] as const)(
    "does not require a credential for the %s local preset",
    (preset) => {
      const client = createLlmClient("/tmp/repo", {
        preset,
        model: "local-model",
      });
      expect(client).not.toBeInstanceOf(Promise);
      expect(client.provider).toBe("openai-compat");
      expect(adapterKey(client)).toBe("livewiki-local");
    },
  );

  it("uses an Ollama credential from the global store instead of the local sentinel", async () => {
    await writeStore(JSON.stringify({ OLLAMA_API_KEY: "ollama-store-key" }));

    const client = createLlmClient("/tmp/repo", {
      preset: "ollama",
      model: "gpt-oss:20b-cloud",
      baseUrl: "https://ollama.example.com",
    });

    expect(adapterKey(client)).toBe("ollama-store-key");
  });

  it("lets the Ollama environment credential override the global store", async () => {
    await writeStore(JSON.stringify({ OLLAMA_API_KEY: "ollama-store-key" }));
    process.env.OLLAMA_API_KEY = "ollama-environment-key";

    const client = createLlmClient("/tmp/repo", {
      preset: "ollama",
      model: "gpt-oss:20b-cloud",
      baseUrl: "https://ollama.example.com",
    });

    expect(adapterKey(client)).toBe("ollama-environment-key");
  });
});
