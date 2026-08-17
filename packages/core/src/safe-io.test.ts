import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import {
  ALLOWED_DIRS,
  isInsideAllowlist,
  resolveAndValidate,
  writeText,
  writeTextAtomic,
  readText,
  exists,
  mkdir,
  remove,
  PathOutsideAllowlistError,
  InvalidRelativePathError,
  CompareAndSwapConflictError,
  WriteLockBusyError,
} from "./safe-io.js";

// `resolveAndValidate` must retry a realpath that races a concurrent delete
// (Windows NTFS tombstone / POSIX ENOENT). Mock only `realpath`; everything
// else on node:fs/promises stays real. beforeEach resets the spy to delegate
// to the real realpath; tests inject transient failures via mockImplementationOnce.
const realpathHolder = vi.hoisted(() => ({
  impl: null as null | typeof import("node:fs/promises")["realpath"],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  realpathHolder.impl = actual.realpath;
  return {
    ...actual,
    realpath: vi.fn(),
  };
});

let repoRoot: string;
let cwdSnapshot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-safeio-"));
  cwdSnapshot = process.cwd();
  vi.mocked(nodeFs.realpath).mockReset();
  vi.mocked(nodeFs.realpath).mockImplementation((p) => realpathHolder.impl!(p));
});

afterEach(async () => {
  process.chdir(cwdSnapshot);
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/**
 * On Windows, creating symlinks requires privilege (admin or Developer Mode).
 * We detect once at test-run boot — if unsupported, we skip symlink-sensitive
 * tests via `it.runIf(canSymlink)`.
 */
async function detectSymlinkSupport(): Promise<boolean> {
  const probe = nodePath.join(nodeOs.tmpdir(), `livewiki-symlink-probe-${process.pid}`);
  const target = nodePath.join(nodeOs.tmpdir(), `livewiki-symlink-target-${process.pid}`);
  try {
    await nodeFs.writeFile(target, "x");
    await nodeFs.symlink(target, probe);
    await nodeFs.rm(probe);
    await nodeFs.rm(target);
    return true;
  } catch {
    return false;
  }
}

const canSymlink = await detectSymlinkSupport();

describe("ALLOWED_DIRS", () => {
  it("contains livewiki and .livewiki (rule #1)", () => {
    expect(ALLOWED_DIRS).toEqual(["livewiki", ".livewiki"]);
  });
});

describe("isInsideAllowlist", () => {
  it("accepts livewiki/ at the root", () => {
    const target = nodePath.join(repoRoot, "livewiki", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(true);
  });

  it("accepts .livewiki/ at the root", () => {
    const target = nodePath.join(repoRoot, ".livewiki", "index.db");
    expect(isInsideAllowlist(repoRoot, target)).toBe(true);
  });

  it("rejects src/ (outside the allowlist)", () => {
    const target = nodePath.join(repoRoot, "src", "index.ts");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("rejects path outside of repoRoot", async () => {
    const other = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-other-"));
    try {
      const target = nodePath.join(other, "livewiki", "foo.md");
      expect(isInsideAllowlist(repoRoot, target)).toBe(false);
    } finally {
      await nodeFs.rm(other, { recursive: true, force: true });
    }
  });

  it("does NOT confuse livewiki with livewiki-evil (prefix is not substring)", () => {
    const target = nodePath.join(repoRoot, "livewiki-evil", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("does NOT confuse .livewiki with .livewiki-evil", () => {
    const target = nodePath.join(repoRoot, ".livewiki-evil", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("with allowPointer=true accepts AGENTS.md at root", () => {
    const target = nodePath.join(repoRoot, "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(true);
  });

  it("with allowPointer=true accepts CLAUDE.md at root", () => {
    const target = nodePath.join(repoRoot, "CLAUDE.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(true);
  });

  it("with allowPointer=true rejects subdir/AGENTS.md (only at root)", () => {
    const target = nodePath.join(repoRoot, "subdir", "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(false);
  });

  it("with allowPointer=false (default) rejects AGENTS.md at root", () => {
    const target = nodePath.join(repoRoot, "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("with allowReadme=true accepts README.md at root", () => {
    const target = nodePath.join(repoRoot, "README.md");
    expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(true);
  });

  it("with allowReadme=true rejects other root files", () => {
    for (const name of ["CONTRIBUTING.md", "package.json", "AGENTS.md"]) {
      const target = nodePath.join(repoRoot, name);
      expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(false);
    }
  });

  it("with allowReadme=true rejects subdir/README.md (only at root)", () => {
    const target = nodePath.join(repoRoot, "subdir", "README.md");
    expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(false);
  });

  it("with allowReadme=false (default) rejects README.md at root", () => {
    const target = nodePath.join(repoRoot, "README.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });
});

describe("resolveAndValidate (declared path, without symlinks)", () => {
  it("rejects absolute path", async () => {
    await expect(
      resolveAndValidate(repoRoot, nodePath.join(repoRoot, "livewiki", "x.md")),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("rejects path with .. (traversal)", async () => {
    await expect(resolveAndValidate(repoRoot, "../etc/passwd")).rejects.toBeInstanceOf(
      InvalidRelativePathError,
    );
    await expect(
      resolveAndValidate(repoRoot, "livewiki/../../etc/passwd"),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("rejects path outside allowlist", async () => {
    await expect(resolveAndValidate(repoRoot, "src/index.ts")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
    await expect(resolveAndValidate(repoRoot, "package.json")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("accepts path inside livewiki/", async () => {
    const abs = await resolveAndValidate(repoRoot, "livewiki/architecture/overview.md");
    // The returned path is canonicalized: realpath(repoRoot) + relPath.
    // On macOS (/var → /private/var) and Windows (8.3 RUNNER~1) the two
    // forms differ; compare against the realpath'd root.
    const realRoot = await nodeFs.realpath(repoRoot);
    expect(abs).toBe(
      nodePath.join(realRoot, "livewiki", "architecture", "overview.md"),
    );
  });

  it("accepts path inside .livewiki/", async () => {
    const abs = await resolveAndValidate(repoRoot, ".livewiki/index.db");
    const realRoot = await nodeFs.realpath(repoRoot);
    expect(abs).toBe(nodePath.join(realRoot, ".livewiki", "index.db"));
  });

  it("errors have descriptive name and context", async () => {
    try {
      await resolveAndValidate(repoRoot, "src/x.ts");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PathOutsideAllowlistError);
      expect((err as PathOutsideAllowlistError).name).toBe("PathOutsideAllowlistError");
      expect((err as PathOutsideAllowlistError).allowlist).toContain("livewiki");
      expect((err as PathOutsideAllowlistError).allowlist).toContain(".livewiki");
    }
  });

  it("retries a transient realpath failure (concurrent-delete race) instead of failing closed", async () => {
    // The stage-4 worker pool creates+deletes `.livewiki/*.lock` files during
    // concurrent durable commits. `findDeepestExisting` can see a lock file,
    // then the realpath runs after another worker already unlinked it: on
    // Windows realpath returns an NTFS tombstone (outside the allowlist) and
    // on POSIX it throws ENOENT. Both must be retried, not surfaced as a
    // path-outside-allowlist failure.
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    let ancestorAttempts = 0;
    vi.mocked(nodeFs.realpath).mockImplementation((p) => {
      const target = String(p);
      // Fail the first ancestor realpath (.livewiki/) once, like a lock
      // unlinked between existsSync and realpath on POSIX. The repoRoot
      // realpath (absRoot) and all later calls delegate normally.
      if (target.endsWith(".livewiki") && ancestorAttempts === 0) {
        ancestorAttempts++;
        const err = new Error("ENOENT: no such file or directory");
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      }
      return realpathHolder.impl!(p);
    });
    const abs = await resolveAndValidate(repoRoot, ".livewiki/index.db");
    expect(abs).toBe(
      nodePath.join(await realpathHolder.impl!(repoRoot), ".livewiki", "index.db"),
    );
    expect(ancestorAttempts).toBe(1);
  });

  it("fails closed when realpath resolves outside the allowlist and stays that way", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    const tombstone = nodePath.join(nodeOs.tmpdir(), "$Extend", "$Deleted", "ghost");
    vi.mocked(nodeFs.realpath).mockImplementation((p) => {
      const target = String(p);
      if (target.endsWith(".livewiki")) return Promise.resolve(tombstone);
      return realpathHolder.impl!(p);
    });
    await expect(resolveAndValidate(repoRoot, ".livewiki/index.db")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });
});

describe("symlink attack defense (realpath of existing ancestor + revalidation)", () => {
  // These tests exercise the critical point of the defense: the declared path is
  // inside the allowlist, but the realpath is not. All must reject.

  it.runIf(canSymlink)(
    "ATTACK: livewiki is a symlink to a directory OUTSIDE the repo → writeText rejects",
    async () => {
      // Creates a directory completely outside repoRoot
      const outsideDir = await nodeFs.mkdtemp(
        nodePath.join(nodeOs.tmpdir(), "livewiki-outside-"),
      );
      try {
        // Removes livewiki (which doesn't exist yet) and creates it as symlink
        await nodeFs.symlink(outsideDir, nodePath.join(repoRoot, "livewiki"), "dir");
        await expect(
          writeText(repoRoot, "livewiki/pwned.md", "x"),
        ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
      } finally {
        await nodeFs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(canSymlink)(
    "ATTACK: livewiki/sub is a symlink to ../src (inside repo, outside allowlist)",
    async () => {
      // Setup: creates src/ inside repo (outside allowlist) and livewiki/
      await nodeFs.mkdir(nodePath.join(repoRoot, "src"));
      await nodeFs.writeFile(nodePath.join(repoRoot, "src", "real.ts"), "real content");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // livewiki/sub → ../src (escapes livewiki/ to src/)
      await nodeFs.symlink(
        nodePath.join(repoRoot, "src"),
        nodePath.join(repoRoot, "livewiki", "sub"),
        "dir",
      );

      await expect(
        writeText(repoRoot, "livewiki/sub/pwned.md", "x"),
      ).rejects.toBeInstanceOf(PathOutsideAllowlistError);

      // Asserts that nothing was written to src/
      const srcFiles = await nodeFs.readdir(nodePath.join(repoRoot, "src"));
      expect(srcFiles).toEqual(["real.ts"]);
    },
  );

  it.runIf(canSymlink)(
    "ATTACK: livewiki/leaf is a file symlink to ../src/secret.ts",
    async () => {
      await nodeFs.mkdir(nodePath.join(repoRoot, "src"));
      await nodeFs.writeFile(nodePath.join(repoRoot, "src", "secret.ts"), "secret");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // File symlink instead of directory
      await nodeFs.symlink(
        nodePath.join(repoRoot, "src", "secret.ts"),
        nodePath.join(repoRoot, "livewiki", "leaf"),
        "file",
      );

      // writeText will find the deepest existing ancestor (the leaf file),
      // resolve its realpath, see that it points to src/secret.ts (outside), and reject.
      await expect(
        writeText(repoRoot, "livewiki/leaf", "x"),
      ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
    },
  );

  it.runIf(canSymlink)(
    "ATTACK: readText via an outward symlink also rejects",
    async () => {
      await nodeFs.writeFile(nodePath.join(repoRoot, "package.json"), "{}");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));
      await nodeFs.symlink(
        nodePath.join(repoRoot, "package.json"),
        nodePath.join(repoRoot, "livewiki", "fake.json"),
        "file",
      );

      await expect(readText(repoRoot, "livewiki/fake.json")).rejects.toBeInstanceOf(
        PathOutsideAllowlistError,
      );
    },
  );

  it.runIf(canSymlink)(
    "ATTACK: exists() also goes through validation — does not leak info",
    async () => {
      await nodeFs.writeFile(nodePath.join(repoRoot, "secret.txt"), "x");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));
      await nodeFs.symlink(
        nodePath.join(repoRoot, "secret.txt"),
        nodePath.join(repoRoot, "livewiki", "leak.txt"),
        "file",
      );

      // exists() must throw PathOutsideAllowlistError, not return true
      // (knowing that a file "secret.txt" exists in the repo is already an info leak).
      await expect(exists(repoRoot, "livewiki/leak.txt")).rejects.toBeInstanceOf(
        PathOutsideAllowlistError,
      );
    },
  );

  it.runIf(canSymlink)(
    "ALLOWED: livewiki/data is a symlink to .livewiki/data (internal)",
    async () => {
      await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki", "data"), { recursive: true });
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // Symlink that points to another location INSIDE the allowlist
      await nodeFs.symlink(
        nodePath.join(repoRoot, ".livewiki", "data"),
        nodePath.join(repoRoot, "livewiki", "data"),
        "dir",
      );

      // Writing must work: final realpath lands in .livewiki/data, which is in allowlist.
      await writeText(repoRoot, "livewiki/data/x.json", "{}");
      expect(
        await nodeFs.readFile(
          nodePath.join(repoRoot, ".livewiki", "data", "x.json"),
          "utf8",
        ),
      ).toBe("{}");
    },
  );

  it.runIf(canSymlink)(
    "ALLOWED: readText via internal symlink (livewiki/data → .livewiki/data)",
    async () => {
      await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki", "data"), { recursive: true });
      await nodeFs.writeFile(
        nodePath.join(repoRoot, ".livewiki", "data", "y.txt"),
        "content-y",
      );
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));
      await nodeFs.symlink(
        nodePath.join(repoRoot, ".livewiki", "data"),
        nodePath.join(repoRoot, "livewiki", "data"),
        "dir",
      );

      const got = await readText(repoRoot, "livewiki/data/y.txt");
      expect(got).toBe("content-y");
    },
  );

  it.runIf(canSymlink)(
    "ALLOWED: repoRoot passed THROUGH a symlink (macOS /var → /private/var)",
    async () => {
      // Reproduces the macOS CI mass failure (run 29445115951): mkdtemp
      // returns /var/folders/... but realpath is /private/var/folders/... —
      // the realpath'd target never matched the lexical root and EVERY write
      // fell into PathOutsideAllowlistError ("failed to create .livewiki/").
      const linkRoot = nodePath.join(nodeOs.tmpdir(), `livewiki-rootlink-${process.pid}`);
      await nodeFs.symlink(repoRoot, linkRoot, "dir");
      try {
        await mkdir(linkRoot, ".livewiki");
        await writeText(linkRoot, "livewiki/page.md", "# Hi\n");
        expect(
          await nodeFs.readFile(nodePath.join(repoRoot, "livewiki", "page.md"), "utf8"),
        ).toBe("# Hi\n");
        expect(await exists(linkRoot, ".livewiki")).toBe(true);
      } finally {
        await nodeFs.rm(linkRoot, { force: true });
      }
    },
  );

  it.runIf(canSymlink)(
    "deepest existing ancestor: target new, parent is outward symlink",
    async () => {
      // Scenario: livewiki/novo-dir/file.md
      //   - livewiki/novo-dir does NOT exist (we are about to create it)
      //   - livewiki EXISTS
      //   - But livewiki is a symlink to OUTSIDE
      // Expected: rejects because realpath(livewiki) falls outside the allowlist
      const outsideDir = await nodeFs.mkdtemp(
        nodePath.join(nodeOs.tmpdir(), "livewiki-outside2-"),
      );
      try {
        await nodeFs.symlink(outsideDir, nodePath.join(repoRoot, "livewiki"), "dir");
        await expect(
          writeText(repoRoot, "livewiki/novo-dir/file.md", "x"),
        ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
      } finally {
        await nodeFs.rm(outsideDir, { recursive: true, force: true });
      }
    },
  );

  it("skip notice when symlinks are not supported on the host", () => {
    // Shows in the test log why these were skipped, if that is the case.
    if (!canSymlink) {
      // eslint-disable-next-line no-console
      console.warn(
        "[safe-io] symlink tests skipped — host does not allow creating symlinks (Windows without Developer Mode / without admin)",
      );
    }
    expect(true).toBe(true);
  });
});

describe("I/O operations (writeText / readText / exists / mkdir / remove)", () => {
  it("writeText + readText roundtrip in livewiki/", async () => {
    await writeText(repoRoot, "livewiki/quickstart.md", "# hello");
    const got = await readText(repoRoot, "livewiki/quickstart.md");
    expect(got).toBe("# hello");
  });

  it("writeText creates intermediate directories", async () => {
    await writeText(repoRoot, "livewiki/architecture/deep/nested/file.md", "x");
    const exists1 = await exists(repoRoot, "livewiki/architecture/deep/nested/file.md");
    expect(exists1).toBe(true);
  });

  it("writeText in .livewiki/ works", async () => {
    await writeText(repoRoot, ".livewiki/config.json", "{}");
    expect(await exists(repoRoot, ".livewiki/config.json")).toBe(true);
  });

  it("writeText REJECTS writing outside the allowlist (rule #1)", async () => {
    await expect(
      writeText(repoRoot, "src/index.ts", "console.log('pwned')"),
    ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
  });

  it("writeText REJECTS an escape via .. (rule #1, traversal)", async () => {
    await expect(
      writeText(repoRoot, "livewiki/../../../etc/passwd", "x"),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("exists returns false for a nonexistent path inside the allowlist", async () => {
    expect(await exists(repoRoot, "livewiki/nope.md")).toBe(false);
  });

  it("mkdir creates a nested directory", async () => {
    await mkdir(repoRoot, "livewiki/decisions");
    expect(await exists(repoRoot, "livewiki/decisions")).toBe(true);
  });

  it("mkdir REJECTS outside the allowlist", async () => {
    await expect(mkdir(repoRoot, "src/novo")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("readText REJECTS reading outside the allowlist", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "package.json"), "{}");
    await expect(readText(repoRoot, "package.json")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("remove deletes inside the allowlist", async () => {
    await writeText(repoRoot, "livewiki/temp.md", "x");
    expect(await exists(repoRoot, "livewiki/temp.md")).toBe(true);
    await remove(repoRoot, "livewiki/temp.md");
    expect(await exists(repoRoot, "livewiki/temp.md")).toBe(false);
  });

  it("remove REJECTS outside the allowlist", async () => {
    await expect(remove(repoRoot, "src/index.ts")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });
});

describe("integration with cwd (does not leak outside the passed repoRoot)", () => {
  it("when repoRoot = cwd, validate against cwd and not against the system", async () => {
    process.chdir(repoRoot);
    await writeText(repoRoot, "livewiki/ok.md", "ok");
    expect(await exists(repoRoot, "livewiki/ok.md")).toBe(true);
    // Trying to escape repoRoot even using an "internal" path must fail.
    await expect(writeText(repoRoot, "../../../tmp/escape.md", "x")).rejects.toThrow();
  });
});

// Final sanity check: confirms that existSync is available (used internally).
it("smoke: existSync importable via node:fs", () => {
  expect(typeof nodeFsSync.existsSync).toBe("function");
});

describe("writeTextAtomic", () => {
  it("replaces an allowlisted file and removes its derived lock", async () => {
    await writeText(repoRoot, "livewiki/state.json", "old");
    await writeTextAtomic(repoRoot, "livewiki/state.json", "new", {
      expected: "old",
      lockRelPath: ".livewiki/state.lock",
    });
    expect(await readText(repoRoot, "livewiki/state.json")).toBe("new");
    expect(await exists(repoRoot, ".livewiki/state.lock")).toBe(false);
  });

  it("fails compare-and-swap without changing the file", async () => {
    await writeText(repoRoot, "livewiki/state.json", "current");
    await expect(writeTextAtomic(repoRoot, "livewiki/state.json", "new", {
      expected: "stale",
      lockRelPath: ".livewiki/state.lock",
    })).rejects.toBeInstanceOf(CompareAndSwapConflictError);
    expect(await readText(repoRoot, "livewiki/state.json")).toBe("current");
    expect(await exists(repoRoot, ".livewiki/state.lock")).toBe(false);
  });
});

describe("writeTextAtomic lock recovery", () => {
  it("reclaims a stale lock left behind by a killed process", async () => {
    await writeText(repoRoot, "livewiki/state.json", "old");
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    const lockAbs = nodePath.join(repoRoot, ".livewiki", "state.lock");
    await nodeFs.writeFile(lockAbs, "", "utf8");
    const stale = new Date(Date.now() - 120_000);
    await nodeFs.utimes(lockAbs, stale, stale);

    await writeTextAtomic(repoRoot, "livewiki/state.json", "new", {
      expected: "old",
      lockRelPath: ".livewiki/state.lock",
    });

    expect(await readText(repoRoot, "livewiki/state.json")).toBe("new");
    expect(await exists(repoRoot, ".livewiki/state.lock")).toBe(false);
  });

  it("refuses a fresh lock and names the remedy", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, ".livewiki", "state.lock"), "", "utf8");

    await expect(writeTextAtomic(repoRoot, "livewiki/state.json", "new", {
      lockRelPath: ".livewiki/state.lock",
    })).rejects.toThrow(WriteLockBusyError);
    await expect(writeTextAtomic(repoRoot, "livewiki/state.json", "new", {
      lockRelPath: ".livewiki/state.lock",
    })).rejects.toThrow(
      "write lock is busy: .livewiki/state.lock. If no livewiki process is running, " +
      "delete the lock file .livewiki/state.lock and retry.",
    );
    // A fresh lock is never reclaimed silently.
    expect(await exists(repoRoot, ".livewiki/state.lock")).toBe(true);
  });
});
