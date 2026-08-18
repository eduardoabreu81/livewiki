/**
 * Regression suite for the credential-store atomic write.
 *
 * The store holds provider API keys outside the repository; a torn write there
 * bricks credential resolution until a human edits the file by hand. These
 * tests pin the invariant from both ends: the production install path replaces
 * the file atomically, and every failure before the rename leaves the previous
 * bytes untouched with no temp leftovers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { applyInstall, planInstall } from "./install.js";
import { credentialStorePath, writeCredentialStoreAtomic } from "./credentials.js";

const injected = vi.hoisted(() => ({
  failRenameTo: null as string | null,
  failOpenPrefix: null as string | null,
  failOpenExact: null as string | null,
  trackDirOpen: null as string | null,
  dirOpens: [] as string[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    open: async (path: Parameters<typeof actual.open>[0], ...rest: unknown[]) => {
      if (
        injected.failOpenPrefix !== null &&
        String(path).startsWith(injected.failOpenPrefix)
      ) {
        const error = new Error("simulated failure while writing the temp file");
        (error as NodeJS.ErrnoException).code = "ENOSPC";
        throw error;
      }
      if (injected.failOpenExact !== null && String(path) === injected.failOpenExact) {
        injected.dirOpens.push(String(path));
        const error = new Error("simulated directory handle refusal");
        (error as NodeJS.ErrnoException).code = "EACCES";
        throw error;
      }
      if (injected.trackDirOpen !== null && String(path) === injected.trackDirOpen) {
        injected.dirOpens.push(String(path));
      }
      return (actual.open as (...args: unknown[]) => unknown)(path, ...rest);
    },
    rename: async (from: string, to: string) => {
      if (injected.failRenameTo !== null && to === injected.failRenameTo) {
        const error = new Error("simulated crash before the replace");
        (error as NodeJS.ErrnoException).code = "EIO";
        throw error;
      }
      return actual.rename(from, to);
    },
  };
});

const EXISTING_STORE = `${JSON.stringify({ OPENAI_API_KEY: "keep-me" }, null, 2)}\n`;

describe("credential store — atomic write", () => {
  let home: string;
  let repoRoot: string;
  let storePath: string;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cred-atomic-home-"));
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cred-atomic-repo-"));
    storePath = credentialStorePath(home);
    injected.failRenameTo = null;
    injected.failOpenPrefix = null;
    injected.failOpenExact = null;
    injected.trackDirOpen = null;
    injected.dirOpens = [];
  });

  afterEach(async () => {
    injected.failRenameTo = null;
    injected.failOpenPrefix = null;
    injected.failOpenExact = null;
    injected.trackDirOpen = null;
    injected.dirOpens = [];
    await nodeFs.rm(home, { recursive: true, force: true });
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  async function seedStore(): Promise<void> {
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, EXISTING_STORE, { encoding: "utf8", mode: 0o600 });
  }

  /** Temp leftovers are siblings of the store, named `credentials.json.tmp-*`. */
  async function tempLeftovers(): Promise<string[]> {
    const entries = await nodeFs.readdir(nodePath.dirname(storePath));
    return entries.filter((entry) => entry.startsWith("credentials.json.tmp-"));
  }

  it("replaces the store through the install path and leaves no temp file", async () => {
    await seedStore();

    const plan = await planInstall({
      repoRoot,
      home,
      credential: { envVar: "ANTHROPIC_API_KEY", value: "new-secret" },
    });
    const results = await applyInstall(plan, repoRoot);

    expect(results[0]?.applied).toBe(true);
    const raw = await nodeFs.readFile(storePath, "utf8");
    expect(JSON.parse(raw)).toEqual({
      OPENAI_API_KEY: "keep-me",
      ANTHROPIC_API_KEY: "new-secret",
    });
    // Same serialization contract as before: 2-space JSON, trailing newline.
    expect(raw).toBe(
      `${JSON.stringify({ OPENAI_API_KEY: "keep-me", ANTHROPIC_API_KEY: "new-secret" }, null, 2)}\n`,
    );
    expect(await tempLeftovers()).toEqual([]);
  });

  it("creates a brand-new store atomically when none exists", async () => {
    await writeCredentialStoreAtomic(storePath, `${JSON.stringify({ A: "1" }, null, 2)}\n`);

    expect(JSON.parse(await nodeFs.readFile(storePath, "utf8"))).toEqual({ A: "1" });
    expect(await tempLeftovers()).toEqual([]);
  });

  it("keeps the previous file byte-for-byte when the replace fails", async () => {
    await seedStore();
    const before = await nodeFs.readFile(storePath);
    injected.failRenameTo = storePath;

    await expect(
      writeCredentialStoreAtomic(storePath, '{"ANTHROPIC_API_KEY":"never-lands"}\n'),
    ).rejects.toThrow(/simulated crash before the replace/);

    expect(await nodeFs.readFile(storePath)).toEqual(before);
  });

  it("keeps the previous file byte-for-byte when the temp write fails", async () => {
    await seedStore();
    const before = await nodeFs.readFile(storePath);
    injected.failOpenPrefix = `${storePath}.tmp-`;

    await expect(
      writeCredentialStoreAtomic(storePath, '{"ANTHROPIC_API_KEY":"never-lands"}\n'),
    ).rejects.toThrow(/simulated failure while writing the temp file/);

    expect(await nodeFs.readFile(storePath)).toEqual(before);
    expect(await tempLeftovers()).toEqual([]);
  });

  it("removes the temp file after a failed replace", async () => {
    await seedStore();
    injected.failRenameTo = storePath;

    await expect(
      writeCredentialStoreAtomic(storePath, '{"ANTHROPIC_API_KEY":"never-lands"}\n'),
    ).rejects.toThrow();

    expect(await tempLeftovers()).toEqual([]);
  });

  it("reports the failure through applyInstall without touching the store", async () => {
    await seedStore();
    const before = await nodeFs.readFile(storePath);

    const plan = await planInstall({
      repoRoot,
      home,
      credential: { envVar: "ANTHROPIC_API_KEY", value: "never-lands" },
    });
    injected.failRenameTo = storePath;
    const results = await applyInstall(plan, repoRoot);

    expect(results[0]?.applied).toBe(false);
    expect(results[0]?.detail).toMatch(/simulated crash before the replace/);
    // The redaction contract still holds on the failure path.
    expect(results[0]?.action.content).toBeNull();
    expect(await nodeFs.readFile(storePath)).toEqual(before);
    expect(await tempLeftovers()).toEqual([]);
  });

  it("still succeeds when the parent-directory flush is refused", async () => {
    await seedStore();
    // The directory fsync only hardens durability of an already-completed
    // rename; a filesystem that refuses the handle must not fail the write.
    injected.failOpenExact = nodePath.dirname(storePath);

    await writeCredentialStoreAtomic(
      storePath,
      `${JSON.stringify({ ANTHROPIC_API_KEY: "landed" }, null, 2)}\n`,
    );

    expect(JSON.parse(await nodeFs.readFile(storePath, "utf8"))).toEqual({
      ANTHROPIC_API_KEY: "landed",
    });
    expect(await tempLeftovers()).toEqual([]);
  });

  it("flushes the parent directory on POSIX and never opens it on Windows", async () => {
    const dirPath = nodePath.dirname(storePath);
    injected.trackDirOpen = dirPath;

    await writeCredentialStoreAtomic(storePath, `${JSON.stringify({ A: "1" }, null, 2)}\n`);

    // Windows cannot open a directory as a file handle, so the flush is skipped
    // outright rather than attempted and swallowed.
    expect(injected.dirOpens).toEqual(process.platform === "win32" ? [] : [dirPath]);
  });

  it.skipIf(process.platform === "win32")(
    "preserves the existing file mode instead of resetting it (POSIX only)",
    async () => {
      await seedStore();
      await nodeFs.chmod(storePath, 0o640);

      await writeCredentialStoreAtomic(storePath, `${JSON.stringify({ A: "1" }, null, 2)}\n`, {
        mode: 0o600,
      });

      const stat = await nodeFs.stat(storePath);
      expect(stat.mode & 0o777).toBe(0o640);
    },
  );

  it.skipIf(process.platform === "win32")(
    "creates a missing store at 0600 (POSIX only)",
    async () => {
      await writeCredentialStoreAtomic(storePath, `${JSON.stringify({ A: "1" }, null, 2)}\n`);

      const stat = await nodeFs.stat(storePath);
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );
});
