/**
 * Global credential-store reader/writer for unattended LLM batches.
 *
 * The store lives outside the repository at ~/.livewiki/credentials.json.
 * Repository safe-io is deliberately not involved: its allowlist covers only
 * livewiki/ and .livewiki/ inside a repository root, so routing a home-dir
 * path through it would either be rejected or force a hole in rule #1. This
 * module therefore owns its own atomic-write primitive, and it is the single
 * writer every production path must go through.
 */

import * as nodeFs from "node:fs";
import * as nodeFsPromises from "node:fs/promises";
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

// ── Atomic write ────────────────────────────────────────────────────────────

/** Owner read/write only: the store holds API keys in cleartext. */
export const CREDENTIALS_FILE_MODE = 0o600;

// Windows virus scanners and concurrent readers can briefly hold the
// destination open; mirrors the retry policy safe-io uses for repo writes.
const RENAME_ATTEMPTS = 20;
const RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

let tempSequence = 0;

/** Current permission bits of `absPath`, or null when it does not exist. */
async function readFileMode(absPath: string): Promise<number | null> {
  try {
    const stat = await nodeFsPromises.stat(absPath);
    return stat.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Flushes the directory entry created by the rename.
 *
 * POSIX `rename` is atomic against readers, but the new directory entry only
 * becomes durable once the parent directory itself is flushed — without this a
 * power loss can roll the swap back after the caller was told the write
 * succeeded. Strictly best-effort: Windows cannot open a directory as a file
 * handle at all, and some filesystems reject `fsync` on a directory fd. Neither
 * is a failure of the write, which has already landed.
 */
async function syncParentDirectory(dirAbs: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const handle = await nodeFsPromises.open(dirAbs, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Unsupported on this platform/filesystem; the rename already happened.
  }
}

async function renameWithRetry(tempAbs: string, targetAbs: string): Promise<void> {
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    try {
      await nodeFsPromises.rename(tempAbs, targetAbs);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !code ||
        !RENAME_RETRY_CODES.has(code) ||
        attempt === RENAME_ATTEMPTS - 1
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 25)));
    }
  }
}

/**
 * Replaces the credential store with `content` atomically.
 *
 * The new bytes land in a sibling temp file inside the same directory (so the
 * final step is a same-filesystem rename), are flushed to disk, and only then
 * replace the target. Any failure before the rename leaves the previous file
 * byte-for-byte intact; the temp file is removed best-effort either way. On
 * POSIX the parent directory is flushed after the rename so the swap survives a
 * power loss — best-effort, never a failure of an already-completed write.
 *
 * Permissions: an existing store keeps its current mode; a freshly created one
 * gets `opts.mode` (default 0600). The temp file is created at 0600 from the
 * first byte, so a wider mode is only applied once the content is written.
 *
 * Windows note: `chmod` there only toggles the read-only bit, so the effective
 * protection is the inherited user-profile ACL, not the POSIX mode.
 */
export async function writeCredentialStoreAtomic(
  storePath: string,
  content: string,
  opts: { mode?: number } = {},
): Promise<void> {
  const targetAbs = nodePath.resolve(storePath);
  const dirAbs = nodePath.dirname(targetAbs);
  await nodeFsPromises.mkdir(dirAbs, { recursive: true });

  const existingMode = await readFileMode(targetAbs);
  const finalMode = existingMode ?? opts.mode ?? CREDENTIALS_FILE_MODE;

  const tempAbs = nodePath.join(
    dirAbs,
    `${nodePath.basename(targetAbs)}.tmp-${process.pid}-${Date.now()}-${tempSequence++}`,
  );

  try {
    const handle = await nodeFsPromises.open(tempAbs, "wx", CREDENTIALS_FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      // Durability before the swap; not supported on every filesystem.
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close();
    }
    if (process.platform !== "win32" && finalMode !== CREDENTIALS_FILE_MODE) {
      await nodeFsPromises.chmod(tempAbs, finalMode);
    }
    await renameWithRetry(tempAbs, targetAbs);
    await syncParentDirectory(dirAbs);
  } finally {
    // No-op on the success path (the temp name is gone after the rename).
    await nodeFsPromises.rm(tempAbs, { force: true }).catch(() => undefined);
  }
}
