import type { Command } from "commander";
import * as nodePath from "node:path";
import {
  applyDefaults,
  loadConfig,
  resolveProviderFromConfig,
  saveConfig,
  type LivewikiConfig,
} from "@livewiki/core/config";
import {
  CREDENTIALS_DISPLAY_PATH,
  readCredentialStatusSync,
  resolveLivewikiHome,
} from "@livewiki/core/credentials";
import {
  AVAILABLE_PRESETS,
  resolvePreset,
  type PresetName,
} from "@livewiki/core/presets";
import { applyInstall, planInstall } from "@livewiki/core/install";
import {
  probeProvider,
  formatProbeFailure,
  type ProviderProbeResult,
} from "@livewiki/core/llm";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

export interface ConfigWizardIo {
  isTTY: boolean;
  promptText(question: string): Promise<string>;
  promptSecret(question: string): Promise<string>;
  promptYesNo(question: string, defaultYes?: boolean): Promise<boolean>;
  write(text: string): void;
}

export interface ConfigWizardResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  preset?: PresetName;
  model?: string;
  language?: string;
  credential?: {
    envVar: string;
    set: boolean;
    source: "environment" | "credentials-store" | null;
    required: boolean;
  };
}

interface ConfigOptions {
  json?: boolean;
  repo?: string;
}

function selectPreset(answer: string, fallback?: PresetName): PresetName | null {
  const value = answer.trim();
  if (value === "" && fallback !== undefined) return fallback;
  const numeric = Number.parseInt(value, 10);
  if (String(numeric) === value && numeric >= 1 && numeric <= AVAILABLE_PRESETS.length) {
    return AVAILABLE_PRESETS[numeric - 1] ?? null;
  }
  return AVAILABLE_PRESETS.includes(value as PresetName)
    ? (value as PresetName)
    : null;
}

async function promptForPreset(
  io: ConfigWizardIo,
  current?: PresetName,
): Promise<PresetName> {
  io.write(
    "Available presets:\n" +
      AVAILABLE_PRESETS.map((preset, index) => `  ${index + 1}. ${preset}`).join("\n") +
      "\n",
  );
  for (;;) {
    const suffix = current ? ` [${current}]` : "";
    const selected = selectPreset(await io.promptText(`Preset${suffix}: `), current);
    if (selected !== null) return selected;
    io.write("Choose a preset by name or number.\n");
  }
}

async function promptRequired(
  io: ConfigWizardIo,
  label: string,
  current?: string,
): Promise<string> {
  for (;;) {
    const suffix = current ? ` [${current}]` : "";
    const answer = (await io.promptText(`${label}${suffix}: `)).trim();
    if (answer !== "") return answer;
    if (current) return current;
    io.write(`${label} is required.\n`);
  }
}

export async function runConfigWizard(opts: {
  repoRoot: string;
  home: string;
  io: ConfigWizardIo;
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces the real connectivity probe. */
  probe?: (repoRoot: string, config: LivewikiConfig) => Promise<ProviderProbeResult>;
}): Promise<ConfigWizardResult> {
  const { io } = opts;
  if (!io.isTTY) {
    return {
      ok: false,
      error: "livewiki config requires an interactive TTY and confirmation; no files were written.",
    };
  }

  const env = opts.env ?? process.env;
  let existing: LivewikiConfig;
  try {
    existing = await loadConfig(opts.repoRoot);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  const preset = await promptForPreset(io, existing.preset);
  const presetConfig = resolvePreset(preset);
  // Hermes-style assist: surface the models we know for the preset (from its
  // pricing table) as suggestions — free text still wins, models change weekly.
  const knownModels = Object.keys(presetConfig.pricing);
  if (knownModels.length > 0) {
    io.write(`Known ${preset} models: ${knownModels.join(", ")}\n`);
  }
  const model = await promptRequired(io, "Model", existing.model);
  const language = await promptRequired(io, "Language", existing.language ?? "en");
  const existingBaseUrl = existing.preset === preset ? existing.baseUrl : undefined;
  const baseUrlAnswer = (
    await io.promptText(
      `Base URL (optional) [${existingBaseUrl ?? presetConfig.baseUrl}]: `,
    )
  ).trim();
  const baseUrl = baseUrlAnswer || existingBaseUrl;
  const credentialOptional = presetConfig.credentialOptional ?? false;
  let credentialValue: string | null = null;
  let credentialSource: "environment" | "credentials-store" | null = null;

  const environmentValue = env[presetConfig.envVar];
  if (environmentValue !== undefined && environmentValue.length > 0) {
    io.write(
      `${presetConfig.envVar} is already set in the environment and takes precedence.\n`,
    );
    const skipStore = await io.promptYesNo(
      `Skip writing ${CREDENTIALS_DISPLAY_PATH}? [Y/n] `,
      true,
    );
    if (skipStore) {
      credentialSource = "environment";
    } else {
      credentialValue = await io.promptSecret(
        credentialOptional
          ? `${presetConfig.envVar} (optional; leave empty for no authentication): `
          : `${presetConfig.envVar}: `,
      );
    }
  } else {
    credentialValue = await io.promptSecret(
      credentialOptional
        ? `${presetConfig.envVar} (optional; leave empty for no authentication): `
        : `${presetConfig.envVar}: `,
    );
  }
  if (credentialValue === "") credentialValue = null;
  if (!credentialOptional && credentialSource === null && credentialValue === null) {
    return { ok: false, error: "The API key cannot be empty; no files were written." };
  }

  // Connectivity + thinking-leak probe before anything is written: the
  // configuration is only worth saving if the endpoint answers and reasoning
  // stays off — providers change defaults without notice (2026-08-16 dogfood
  // incident: v4 thinking-on-by-default silently burned a paid round). A
  // freshly typed credential is exposed through the process environment for
  // the duration of the probe only (env wins over the store by design).
  const probe = opts.probe ?? probeProvider;
  const { baseUrl: _probePreviousBaseUrl, ...probeRetained } = existing;
  const candidateConfig: LivewikiConfig = {
    ...probeRetained,
    preset,
    model,
    language,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
  const previousEnvValue = credentialValue !== null
    ? process.env[presetConfig.envVar]
    : undefined;
  if (credentialValue !== null) process.env[presetConfig.envVar] = credentialValue;
  let probeResult: ProviderProbeResult;
  try {
    io.write("Running connectivity probe (one minimal request)...\n");
    probeResult = await probe(opts.repoRoot, candidateConfig);
  } finally {
    if (credentialValue !== null) {
      if (previousEnvValue === undefined) delete process.env[presetConfig.envVar];
      else process.env[presetConfig.envVar] = previousEnvValue;
    }
  }
  if (probeResult.thinkingLeak) {
    return {
      ok: false,
      error: `Connectivity probe failed: ${formatProbeFailure(probeResult)} No files were written.`,
    };
  }
  if (!probeResult.ok) {
    io.write(`Connectivity probe failed: ${formatProbeFailure(probeResult)}\n`);
    const saveAnyway = await io.promptYesNo("Save the configuration anyway? [y/N] ", false);
    if (!saveAnyway) {
      return { ok: false, error: "Connectivity probe failed; no files were written." };
    }
  } else {
    io.write(
      `Probe OK${probeResult.modelEcho !== null ? ` (served model: ${probeResult.modelEcho})` : ""}.\n`,
    );
  }

  let credentialPlan = null;
  if (credentialValue !== null) {
    try {
      credentialPlan = await planInstall({
        repoRoot: opts.repoRoot,
        home: opts.home,
        credential: { envVar: presetConfig.envVar, value: credentialValue },
      });
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  const confirmed = await io.promptYesNo(
    credentialPlan
      ? "Write repository config and global credential store? [y/N] "
      : "Write repository config? [y/N] ",
    false,
  );
  if (!confirmed) return { ok: false, cancelled: true };

  if (credentialPlan !== null) {
    const results = await applyInstall(credentialPlan, opts.repoRoot);
    const failed = results.find(
      (result) => result.action.status === "write" && !result.applied,
    );
    if (failed) {
      return {
        ok: false,
        error: failed.detail ?? "Failed to write the global credential store.",
      };
    }
    credentialSource = "credentials-store";
  }

  const { baseUrl: _previousBaseUrl, ...retained } = existing;
  await saveConfig(opts.repoRoot, {
    ...retained,
    preset,
    model,
    language,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });

  return {
    ok: true,
    preset,
    model,
    language,
    credential: {
      envVar: presetConfig.envVar,
      set: credentialSource !== null,
      source: credentialSource,
      required: !credentialOptional,
    },
  };
}

export function readLineInput(
  question: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  output.write(question);
  return new Promise((resolve) => {
    let value = "";
    const finish = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.pause();
      resolve(value.trim());
    };
    const onData = (chunk: Buffer | string) => {
      value += chunk.toString();
      const newline = value.search(/[\r\n]/);
      if (newline >= 0) {
        value = value.slice(0, newline);
        finish();
      }
    };
    const onEnd = () => finish();
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume();
  });
}

export function readSecretInput(
  question: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Secret input requires an interactive TTY."));
  }
  output.write(question);
  const wasRaw = Boolean(input.isRaw);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.setRawMode(wasRaw);
      input.pause();
    };
    const complete = () => {
      cleanup();
      output.write("\n");
      resolve(value);
    };
    const onEnd = () => complete();
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        const code = char.charCodeAt(0);
        if (code === 3) {
          cleanup();
          output.write("\n");
          reject(new Error("Configuration cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          complete();
          return;
        }
        if (code === 8 || code === 127) {
          value = value.slice(0, -1);
          continue;
        }
        if (code >= 32) value += char;
      }
    };
    input.on("data", onData);
    input.on("end", onEnd);
  });
}

function processIo(json: boolean): ConfigWizardIo {
  const promptOutput = json ? process.stderr : process.stdout;
  return {
    isTTY: Boolean(process.stdin.isTTY),
    promptText: (question) => readLineInput(question, process.stdin, promptOutput),
    promptSecret: (question) => readSecretInput(question, process.stdin, promptOutput),
    promptYesNo: async (question, defaultYes = false) => {
      const answer = (await readLineInput(question, process.stdin, promptOutput)).toLowerCase();
      if (answer === "") return defaultYes;
      return answer === "y" || answer === "yes";
    },
    write: (text) => promptOutput.write(text),
  };
}

function formatShowHuman(result: {
  preset: string | null;
  model: string | null;
  language: string;
  credential: {
    envVar: string | null;
    set: boolean;
    source: "environment" | "credentials-store" | null;
    required: boolean | null;
  };
}): string {
  const lines = [
    `Preset: ${result.preset ?? "not set"}`,
    `Model: ${result.model ?? "not set"}`,
    `Language: ${result.language}`,
  ];
  const credential = result.credential;
  if (credential.envVar === null) {
    lines.push("Credential: unavailable until a preset or provider is configured");
  } else if (!credential.set && credential.required === false) {
    lines.push(`${credential.envVar}: not set (optional)`);
  } else if (!credential.set) {
    lines.push(`${credential.envVar}: not set`);
  } else if (credential.source === "environment") {
    lines.push(`${credential.envVar}: set (from environment)`);
  } else {
    lines.push(`${credential.envVar}: set (from ${CREDENTIALS_DISPLAY_PATH})`);
  }
  return lines.join("\n");
}

async function showConfig(
  repoRoot: string,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<{
  ok: true;
  preset: string | null;
  model: string | null;
  language: string;
  credential: {
    envVar: string | null;
    set: boolean;
    source: "environment" | "credentials-store" | null;
    required: boolean | null;
  };
}> {
  const config = await loadConfig(repoRoot);
  const effective = applyDefaults(config);
  const hasProvider = config.preset !== undefined || config.provider !== undefined;
  if (!hasProvider) {
    return {
      ok: true,
      preset: null,
      model: config.model ?? null,
      language: effective.language ?? "en",
      credential: {
        envVar: null,
        set: false,
        source: null,
        required: null,
      },
    };
  }

  const resolved = resolveProviderFromConfig(config);
  const status = readCredentialStatusSync(resolved.envVar, { home, env });
  return {
    ok: true,
    preset: config.preset ?? config.provider ?? null,
    model: config.model ?? null,
    language: effective.language ?? "en",
    credential: {
      envVar: status.envVar,
      set: status.set,
      source: status.source,
      required: !resolved.credentialOptional,
    },
  };
}

function emitError(json: boolean, error: unknown, label = "config"): void {
  const message = (error as Error).message;
  if (json) emit(true, { ok: false, error: message }, "");
  else process.stderr.write(`livewiki${label ? ` ${label}` : ""}: error — ${message}\n`);
  process.exitCode = 1;
}

/**
 * Whether the repo already has a provider configured (preset or legacy
 * provider). Drives the bare-`livewiki` onboarding: an unconfigured repo gets
 * the wizard; a configured one falls back to `--help`.
 */
export async function isConfigured(repoRoot: string): Promise<boolean> {
  try {
    const config = await loadConfig(repoRoot);
    return config.preset !== undefined || config.provider !== undefined;
  } catch {
    // Malformed config surfaces through the wizard's own loadConfig error.
    return false;
  }
}

export type BareInvocationAction = "help" | "hint" | "wizard";

/** Pure routing for the bare-`livewiki` onboarding, kept free of stdio/fs. */
export function decideBareInvocation(
  configured: boolean,
  isTTY: boolean,
  json: boolean,
): BareInvocationAction {
  if (configured) return "help";
  if (!isTTY || json) return "hint";
  return "wizard";
}

export const BARE_CONFIG_HINT =
  "livewiki is not configured for LLM-backed documentation yet. " +
  "Run `livewiki config` to pick a provider and API key, or set " +
  "`preset`/`model` in `.livewiki/config.json` for headless use.";

/**
 * Runs the interactive config wizard and emits its result. Shared by the
 * `livewiki config` command and the bare-`livewiki` onboarding.
 */
export async function runConfigFlow(options: {
  json: boolean;
  repoRoot: string;
  home: string;
  errorLabel?: string;
}): Promise<void> {
  const { json, repoRoot, home, errorLabel = "config" } = options;
  try {
    const result = await runConfigWizard({
      repoRoot,
      home,
      io: processIo(json),
      env: process.env,
    });
    if (!result.ok && result.error) {
      emitError(json, new Error(result.error), errorLabel);
      return;
    }
    emit(
      json,
      result,
      result.cancelled
        ? "Configuration cancelled; no files were written."
        : `Configuration saved for ${result.preset}/${result.model}.`,
    );
  } catch (error) {
    emitError(json, error, errorLabel);
  }
}

export function registerConfig(program: Command): void {
  const config = program
    .command("config")
    .description("configure the batch LLM and inspect credential presence")
    .action(async (_options: ConfigOptions, command: Command) => {
      const options = command.optsWithGlobals<ConfigOptions>();
      const json = Boolean(options.json);
      const repoRoot = nodePath.resolve(process.cwd(), resolveRepoRoot(options.repo));
      const home = resolveLivewikiHome(process.env);
      await runConfigFlow({ json, repoRoot, home });
    });

  config
    .command("show")
    .description("show effective provider settings and credential origin (never the value)")
    .action(async (_options: ConfigOptions, command: Command) => {
      const options = command.optsWithGlobals<ConfigOptions>();
      const json = Boolean(options.json);
      const repoRoot = nodePath.resolve(process.cwd(), resolveRepoRoot(options.repo));
      const home = resolveLivewikiHome(process.env);
      try {
        const result = await showConfig(repoRoot, home, process.env);
        emit(json, result, formatShowHuman(result));
      } catch (error) {
        emitError(json, error);
      }
    });
}
