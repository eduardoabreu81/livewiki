/**
 * Global credential-store reader for unattended LLM batches.
 *
 * The store lives outside the repository at ~/.livewiki/credentials.json.
 * Repository safe-io is deliberately not involved: its allowlist covers only
 * livewiki/ and .livewiki/ inside a repository root.
 */

import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

export const CREDENTIALS_REL_PATH = nodePath.join(".livewiki", "credentials.json");
export const CREDENTIALS_DISPLAY_PATH = "~/.livewiki/credentials.json";

export type CredentialStore = Record<string, string>;
export type CredentialSource = "environment" | "credentials-store" | null;

export interface CredentialResolution {
  value: string | null;
  source: CredentialSource;
  storePath: string;
}

export interface CredentialStatus {
  envVar: string;
  set: boolean;
  source: CredentialSource;
  storePath: string;
}

export class CredentialStoreError extends Error {
  public readonly storePath: string;

  constructor(storePath: string, reason: string) {
    super(`Credential store ${storePath} ${reason}`);
    this.name = "CredentialStoreError";
    this.storePath = storePath;
  }
}

export function resolveLivewikiHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return nodePath.resolve(env.LIVEWIKI_HOME ?? nodeOs.homedir());
}

export function credentialStorePath(home: string): string {
  return nodePath.join(nodePath.resolve(home), CREDENTIALS_REL_PATH);
}

export function parseCredentialStore(raw: string, storePath: string): CredentialStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CredentialStoreError(storePath, "is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CredentialStoreError(storePath, "must contain a JSON object.");
  }
  const store: CredentialStore = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new CredentialStoreError(
        storePath,
        `contains an invalid value for ${key}; values must be non-empty strings.`,
      );
    }
    store[key] = value;
  }
  return store;
}

export function readCredentialStoreSync(home: string): CredentialStore | null {
  const storePath = credentialStorePath(home);
  let raw: string;
  try {
    raw = nodeFs.readFileSync(storePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new CredentialStoreError(
      storePath,
      `could not be read${code ? ` (${code})` : ""}.`,
    );
  }
  return parseCredentialStore(raw, storePath);
}

export function resolveCredentialSync(
  envVar: string,
  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},
): CredentialResolution {
  const env = opts.env ?? process.env;
  const home = opts.home ?? resolveLivewikiHome(env);
  const storePath = credentialStorePath(home);
  const environmentValue = env[envVar];
  if (environmentValue !== undefined && environmentValue.length > 0) {
    return { value: environmentValue, source: "environment", storePath };
  }
  const store = readCredentialStoreSync(home);
  const storedValue = store?.[envVar];
  if (storedValue !== undefined) {
    return { value: storedValue, source: "credentials-store", storePath };
  }
  return { value: null, source: null, storePath };
}

export function readCredentialStatusSync(
  envVar: string,
  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},
): CredentialStatus {
  const resolution = resolveCredentialSync(envVar, opts);
  return {
    envVar,
    set: resolution.value !== null,
    source: resolution.source,
    storePath: resolution.storePath,
  };
}
