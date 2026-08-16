import { EventEmitter } from "node:events";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveConfig } from "@livewiki/core/config";
import { createProgram } from "./cli.js";
import {
  readLineInput,
  readSecretInput,
  runConfigWizard,
  isConfigured,
  decideBareInvocation,
  BARE_CONFIG_HINT,
  type ConfigWizardIo,
} from "./commands/config.js";

const CANARY = "CONFIG-SHOW-SECRET-CANARY";

/** Wizard tests never hit the network: the connectivity probe is stubbed. */
const PROBE_OK = async () => ({
  ok: true,
  thinkingLeak: false,
  modelEcho: "stub-model",
  reasoningTokens: 0,
  error: null,
});

describe("livewiki config", () => {
  let home: string;
  let repoRoot: string;
  let previousHome: string | undefined;
  let previousAnthropic: string | undefined;
  let previousExitCode: typeof process.exitCode;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-config-home-"));
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-config-repo-"));
    previousHome = process.env.LIVEWIKI_HOME;
    previousAnthropic = process.env.ANTHROPIC_API_KEY;
    previousExitCode = process.exitCode;
    process.env.LIVEWIKI_HOME = home;
    delete process.env.ANTHROPIC_API_KEY;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.LIVEWIKI_HOME;
    else process.env.LIVEWIKI_HOME = previousHome;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    process.exitCode = previousExitCode;
    await nodeFs.rm(home, { recursive: true, force: true });
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  function makeIo(opts: {
    answers: string[];
    secret?: string;
    confirmations?: boolean[];
    isTTY?: boolean;
  }): ConfigWizardIo & { output: string[]; promptSecret: ReturnType<typeof vi.fn> } {
    const answers = [...opts.answers];
    const confirmations = [...(opts.confirmations ?? [true])];
    const output: string[] = [];
    const promptSecret = vi.fn(async () => opts.secret ?? "");
    return {
      isTTY: opts.isTTY ?? true,
      output,
      promptText: vi.fn(async () => answers.shift() ?? ""),
      promptSecret,
      promptYesNo: vi.fn(async () => confirmations.shift() ?? true),
      write: (text: string) => output.push(text),
    };
  }

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const program = createProgram();
    let stdout = "";
    let stderr = "";
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      await program.parseAsync(args, { from: "user" });
    } finally {
      process.stdout.write = originalOut;
      process.stderr.write = originalErr;
    }
    return { stdout, stderr };
  }

  it("writes repo config and the global credential store without crossing them", async () => {
    const io = makeIo({
      answers: ["anthropic", "claude-sonnet-5", "en"],
      secret: CANARY,
      confirmations: [true],
    });

    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result.ok).toBe(true);

    const repoConfigRaw = await nodeFs.readFile(
      nodePath.join(repoRoot, ".livewiki", "config.json"),
      "utf8",
    );
    expect(JSON.parse(repoConfigRaw)).toMatchObject({
      preset: "anthropic",
      model: "claude-sonnet-5",
      language: "en",
    });
    expect(repoConfigRaw).not.toContain(CANARY);

    const credentialsRaw = await nodeFs.readFile(
      nodePath.join(home, ".livewiki", "credentials.json"),
      "utf8",
    );
    expect(JSON.parse(credentialsRaw)).toEqual({ ANTHROPIC_API_KEY: CANARY });
    expect(io.output.join("\n")).not.toContain(CANARY);
  });

  it.each(["ollama", "lmstudio"] as const)(
    "accepts an empty optional key for the %s preset",
    async (preset) => {
      const io = makeIo({
        answers: [preset, "local-model", "en", ""],
        secret: "",
        confirmations: [true],
      });
      const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
      expect(result.ok).toBe(true);
      expect(io.promptSecret).toHaveBeenCalledOnce();
      await expect(
        nodeFs.access(nodePath.join(home, ".livewiki", "credentials.json")),
      ).rejects.toThrow();
    },
  );

  it("persists an optional baseUrl and Ollama credential for an authenticated endpoint", async () => {
    const io = makeIo({
      answers: ["ollama", "gpt-oss:20b-cloud", "en", "https://ollama.example.com"],
      secret: CANARY,
      confirmations: [true],
    });

    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result.ok).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(nodePath.join(repoRoot, ".livewiki", "config.json"), "utf8"))).toMatchObject({
      preset: "ollama",
      model: "gpt-oss:20b-cloud",
      language: "en",
      baseUrl: "https://ollama.example.com",
    });
    expect(JSON.parse(await nodeFs.readFile(nodePath.join(home, ".livewiki", "credentials.json"), "utf8"))).toEqual({
      OLLAMA_API_KEY: CANARY,
    });
  });

  it("preserves a legacy provider override when the wizard saves", async () => {
    await saveConfig(repoRoot, {
      preset: "openai",
      provider: "anthropic",
      model: "gpt-4o",
      language: "en",
    });
    const io = makeIo({ answers: ["", "", "", ""], confirmations: [true, true] });

    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      probe: PROBE_OK,
      env: { OPENAI_API_KEY: "environment-key" },
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(await nodeFs.readFile(nodePath.join(repoRoot, ".livewiki", "config.json"), "utf8"))).toMatchObject({
      preset: "openai",
      provider: "anthropic",
      model: "gpt-4o",
    });
  });

  it("offers to keep an existing environment credential and skips the store", async () => {
    const io = makeIo({
      answers: ["anthropic", "claude-sonnet-5", "en"],
      confirmations: [true, true],
    });
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      probe: PROBE_OK,
      env: { ANTHROPIC_API_KEY: "already-set" },
    });
    expect(result.ok).toBe(true);
    expect(io.promptSecret).not.toHaveBeenCalled();
    expect(io.output.join("\n")).toContain("already set in the environment");
  });

  it("can replace an environment credential in the store after explicit confirmation", async () => {
    const io = makeIo({
      answers: ["anthropic", "claude-sonnet-5", "en"],
      secret: CANARY,
      confirmations: [false, true],
    });
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      probe: PROBE_OK,
      env: { ANTHROPIC_API_KEY: "environment-key" },
    });

    expect(result.ok).toBe(true);
    expect(io.promptSecret).toHaveBeenCalledOnce();
    expect(
      JSON.parse(await nodeFs.readFile(nodePath.join(home, ".livewiki", "credentials.json"), "utf8")),
    ).toEqual({ ANTHROPIC_API_KEY: CANARY });
  });

  it("re-prompts invalid choices and cancels without writing", async () => {
    const io = makeIo({
      answers: ["not-a-preset", "1", "", "claude-sonnet-5", ""],
      secret: CANARY,
      confirmations: [false],
    });
    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });

    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(io.output.join("\n")).toContain("Choose a preset by name or number.");
    expect(io.output.join("\n")).toContain("Model is required.");
    await expect(nodeFs.access(nodePath.join(repoRoot, ".livewiki", "config.json"))).rejects.toThrow();
  });

  it("rejects an empty remote credential before confirmation", async () => {
    const io = makeIo({ answers: ["anthropic", "claude-sonnet-5", "en"], secret: "" });
    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be empty/) });
  });

  it("preserves current wizard values when answers are left blank", async () => {
    await saveConfig(repoRoot, { preset: "ollama", model: "qwen3", language: "pt-BR" });
    const io = makeIo({ answers: ["", "", ""], confirmations: [true] });
    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result).toMatchObject({ ok: true, preset: "ollama", model: "qwen3", language: "pt-BR" });
  });

  it("returns a config parse error without entering the prompt flow", async () => {
    const configPath = nodePath.join(repoRoot, ".livewiki", "config.json");
    await nodeFs.mkdir(nodePath.dirname(configPath), { recursive: true });
    await nodeFs.writeFile(configPath, "{ invalid", "utf8");
    const io = makeIo({ answers: [] });
    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("config.json") });
    expect(io.promptSecret).not.toHaveBeenCalled();
  });

  it("fails closed without a TTY and writes nothing", async () => {
    const io = makeIo({ answers: [], isTTY: false });
    const result = await runConfigWizard({ repoRoot, home, io, env: {}, probe: PROBE_OK });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/interactive TTY/);
    await expect(nodeFs.access(nodePath.join(repoRoot, ".livewiki", "config.json"))).rejects.toThrow();
    await expect(nodeFs.access(nodePath.join(home, ".livewiki", "credentials.json"))).rejects.toThrow();
  });

  it("reads the secret without echoing it", async () => {
    class FakeInput extends EventEmitter {
      isTTY = true;
      isRaw = false;
      setRawMode = vi.fn((raw: boolean) => {
        this.isRaw = raw;
        return this;
      });
      resume = vi.fn(() => this);
      pause = vi.fn(() => this);
    }
    const input = new FakeInput();
    let displayed = "";
    const output = { write: (chunk: string) => { displayed += chunk; return true; } };
    const pending = readSecretInput(
      "API key: ",
      input as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    input.emit("data", Buffer.from(CANARY));
    input.emit("data", Buffer.from("\r"));

    await expect(pending).resolves.toBe(CANARY);
    expect(displayed).toBe("API key: \n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("reads and trims regular terminal input until newline or end", async () => {
    class FakeInput extends EventEmitter {
      resume = vi.fn(() => this);
      pause = vi.fn(() => this);
    }
    const output = { write: vi.fn(() => true) };

    const newlineInput = new FakeInput();
    const newlineRead = readLineInput(
      "Model: ",
      newlineInput as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    newlineInput.emit("data", Buffer.from("  model-name  \rignored"));
    await expect(newlineRead).resolves.toBe("model-name");

    const endInput = new FakeInput();
    const endRead = readLineInput(
      "Language: ",
      endInput as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    endInput.emit("data", Buffer.from(" pt-BR "));
    endInput.emit("end");
    await expect(endRead).resolves.toBe("pt-BR");
    expect(output.write).toHaveBeenCalledWith("Model: ");
    expect(output.write).toHaveBeenCalledWith("Language: ");
  });

  it("handles secret backspace and terminal cancellation without echo", async () => {
    class FakeInput extends EventEmitter {
      isTTY = true;
      isRaw = false;
      setRawMode = vi.fn((raw: boolean) => { this.isRaw = raw; return this; });
      resume = vi.fn(() => this);
      pause = vi.fn(() => this);
    }
    const output = { write: vi.fn(() => true) };
    const editedInput = new FakeInput();
    const edited = readSecretInput(
      "API key: ",
      editedInput as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    editedInput.emit("data", Buffer.from("abc\bZ\n"));
    await expect(edited).resolves.toBe("abZ");

    const cancelledInput = new FakeInput();
    const cancelled = readSecretInput(
      "API key: ",
      cancelledInput as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    cancelledInput.emit("data", Buffer.from([3]));
    await expect(cancelled).rejects.toThrow("Configuration cancelled");

    const endedInput = new FakeInput();
    const ended = readSecretInput(
      "API key: ",
      endedInput as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );
    endedInput.emit("data", Buffer.from("tail"));
    endedInput.emit("end");
    await expect(ended).resolves.toBe("tail");
    expect(output.write.mock.calls.flat().join("")).not.toContain("abc");
  });

  it("rejects secret reads from a non-interactive stream", async () => {
    await expect(
      readSecretInput(
        "API key: ",
        { isTTY: false } as NodeJS.ReadStream,
        { write: vi.fn() } as unknown as NodeJS.WriteStream,
      ),
    ).rejects.toThrow("interactive TTY");
  });

  it("config show reports store origin but never prints the value", async () => {
    await saveConfig(repoRoot, {
      preset: "anthropic",
      model: "claude-sonnet-5",
      language: "en",
    });
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, JSON.stringify({ ANTHROPIC_API_KEY: CANARY }), "utf8");

    const { stdout, stderr } = await runCli(["--json", "config", "show", "--repo", repoRoot]);
    expect(process.exitCode ?? 0).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toMatchObject({
      ok: true,
      preset: "anthropic",
      model: "claude-sonnet-5",
      language: "en",
      credential: {
        envVar: "ANTHROPIC_API_KEY",
        set: true,
        source: "credentials-store",
      },
    });
    expect(stdout + stderr).not.toContain(CANARY);
  });

  it("config show reports an optional Ollama credential from the store", async () => {
    await saveConfig(repoRoot, {
      preset: "ollama",
      model: "gpt-oss:20b-cloud",
      baseUrl: "https://ollama.example.com",
      language: "en",
    });
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, JSON.stringify({ OLLAMA_API_KEY: CANARY }), "utf8");

    const { stdout, stderr } = await runCli(["--json", "config", "show", "--repo", repoRoot]);
    expect(JSON.parse(stdout)).toMatchObject({
      credential: {
        envVar: "OLLAMA_API_KEY",
        set: true,
        source: "credentials-store",
        required: false,
      },
    });
    expect(stdout + stderr).not.toContain(CANARY);
  });

  it("config show human output covers unconfigured, local, missing, and environment states", async () => {
    let result = await runCli(["config", "show", "--repo", repoRoot]);
    expect(result.stdout).toContain("Credential: unavailable");

    await saveConfig(repoRoot, { preset: "ollama", model: "qwen3", language: "en" });
    result = await runCli(["config", "show", "--repo", repoRoot]);
    expect(result.stdout).toContain("OLLAMA_API_KEY: not set (optional)");

    await saveConfig(repoRoot, { preset: "anthropic", model: "claude-sonnet-5", language: "en" });
    result = await runCli(["config", "show", "--repo", repoRoot]);
    expect(result.stdout).toContain("ANTHROPIC_API_KEY: not set");

    process.env.ANTHROPIC_API_KEY = CANARY;
    result = await runCli(["config", "show", "--repo", repoRoot]);
    expect(result.stdout).toContain("ANTHROPIC_API_KEY: set (from environment)");
    expect(result.stdout).not.toContain(CANARY);
  });

  it("config show reports a corrupt store clearly, without raw stack or deletion", async () => {
    await saveConfig(repoRoot, {
      preset: "anthropic",
      model: "claude-sonnet-5",
      language: "en",
    });
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    const corrupt = `{ ${CANARY}`;
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, corrupt, "utf8");

    const { stdout, stderr } = await runCli(["--json", "config", "show", "--repo", repoRoot]);
    expect(process.exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("credentials.json");
    expect(stdout + stderr).not.toContain(CANARY);
    expect(stdout + stderr).not.toContain("    at ");
    expect(await nodeFs.readFile(storePath, "utf8")).toBe(corrupt);
  });

  it("registers no command-line option that accepts an API key", () => {
    const configCommand = createProgram().commands.find((command) => command.name() === "config");
    expect(configCommand).toBeDefined();
    const optionNames = configCommand?.options.map((option) => option.long) ?? [];
    expect(optionNames).not.toContain("--api-key");
  });

  it("the registered wizard fails closed with structured output outside a TTY", async () => {
    const { stdout, stderr } = await runCli(["--json", "config", "--repo", repoRoot]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: expect.stringMatching(/interactive TTY/) });
    expect(stderr).toBe("");
  });
});

describe("livewiki config — connectivity probe gate", () => {
  let home: string;
  let repoRoot: string;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-probe-home-"));
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-probe-repo-"));
  });

  afterEach(async () => {
    await nodeFs.rm(home, { recursive: true, force: true });
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  function makeProbeIo(confirmations: boolean[]): ConfigWizardIo & { output: string[] } {
    const answers = ["anthropic", "claude-sonnet-5", "en"];
    const queue = [...confirmations];
    const output: string[] = [];
    return {
      isTTY: true,
      output,
      promptText: async () => answers.shift() ?? "",
      promptSecret: async () => "probe-test-key",
      promptYesNo: async () => queue.shift() ?? false,
      write: (text: string) => output.push(text),
    };
  }

  const repoConfigPath = () => nodePath.join(repoRoot, ".livewiki", "config.json");

  it("refuses to save when the probe detects a thinking leak", async () => {
    const io = makeProbeIo([true]);
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      env: {},
      probe: async () => ({ ok: true, thinkingLeak: true, modelEcho: "m", reasoningTokens: 128, error: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("reasoning");
    expect(result.error).not.toContain("probe-test-key");
    await expect(nodeFs.access(repoConfigPath())).rejects.toThrow();
  });

  it("unreachable probe + explicit save-anyway keeps the configuration", async () => {
    const io = makeProbeIo([true, true]);
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      env: {},
      probe: async () => ({ ok: false, thinkingLeak: false, modelEcho: null, reasoningTokens: 0, error: "network down" }),
    });
    expect(result.ok).toBe(true);
    expect(io.output.join("\n")).toContain("Connectivity probe failed");
  });

  it("unreachable probe + decline writes nothing", async () => {
    const io = makeProbeIo([false]);
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      env: {},
      probe: async () => ({ ok: false, thinkingLeak: false, modelEcho: null, reasoningTokens: 0, error: "network down" }),
    });
    expect(result.ok).toBe(false);
    await expect(nodeFs.access(repoConfigPath())).rejects.toThrow();
  });
});

describe("livewiki config — model suggestions from the preset", () => {
  let home: string;
  let repoRoot: string;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-models-home-"));
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-models-repo-"));
  });

  afterEach(async () => {
    await nodeFs.rm(home, { recursive: true, force: true });
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("lists known models for presets with a pricing table, skips empty ones", async () => {
    const output: string[] = [];
    const answers = ["anthropic", "claude-sonnet-5", "en"];
    const io: ConfigWizardIo = {
      isTTY: true,
      promptText: async () => answers.shift() ?? "",
      promptSecret: async () => "models-test-key",
      promptYesNo: async () => true,
      write: (text: string) => output.push(text),
    };
    const result = await runConfigWizard({
      repoRoot,
      home,
      io,
      env: {},
      probe: async () => ({ ok: true, thinkingLeak: false, modelEcho: "m", reasoningTokens: 0, error: null }),
    });
    expect(result.ok).toBe(true);
    expect(output.join("\n")).toContain("Known anthropic models:");
    expect(output.join("\n")).not.toContain("Known anthropic models: \n");
  });
});

describe("livewiki — bare-command onboarding routing", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-onboard-repo-"));
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("isConfigured is false for an empty repo and true once a preset is saved", async () => {
    expect(await isConfigured(repoRoot)).toBe(false);
    await saveConfig(repoRoot, { preset: "anthropic", model: "claude-sonnet-5" });
    expect(await isConfigured(repoRoot)).toBe(true);
  });

  it("isConfigured stays true for a legacy provider override", async () => {
    await saveConfig(repoRoot, { provider: "anthropic", model: "claude-sonnet-5" });
    expect(await isConfigured(repoRoot)).toBe(true);
  });

  it("decideBareInvocation routes help / hint / wizard deterministically", () => {
    expect(decideBareInvocation(true, true, false)).toBe("help");
    expect(decideBareInvocation(false, true, false)).toBe("wizard");
    expect(decideBareInvocation(false, false, false)).toBe("hint");
    expect(decideBareInvocation(false, true, true)).toBe("hint");
  });

  it("the hint points at the wizard and never prints a credential variable name", () => {
    expect(BARE_CONFIG_HINT).toContain("livewiki config");
    expect(BARE_CONFIG_HINT).not.toMatch(/API_KEY/);
  });
});
