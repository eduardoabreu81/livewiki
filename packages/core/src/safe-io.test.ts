import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

let repoRoot: string;
let cwdSnapshot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-safeio-"));
  cwdSnapshot = process.cwd();
});

afterEach(async () => {
  process.chdir(cwdSnapshot);
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/**
 * Em Windows, criar symlinks exige privilégio (admin ou Developer Mode).
 * Detectamos uma vez no boot do test run — se não consegue, pulamos testes
 * sensíveis a symlinks via `it.runIf(canSymlink)`.
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
  it("contém livewiki e .livewiki (regra #1)", () => {
    expect(ALLOWED_DIRS).toEqual(["livewiki", ".livewiki"]);
  });
});

describe("isInsideAllowlist", () => {
  it("aceita livewiki/ na raiz", () => {
    const target = nodePath.join(repoRoot, "livewiki", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(true);
  });

  it("aceita .livewiki/ na raiz", () => {
    const target = nodePath.join(repoRoot, ".livewiki", "index.db");
    expect(isInsideAllowlist(repoRoot, target)).toBe(true);
  });

  it("rejeita src/ (fora da allowlist)", () => {
    const target = nodePath.join(repoRoot, "src", "index.ts");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("rejeita caminho fora do repoRoot", async () => {
    const other = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-other-"));
    try {
      const target = nodePath.join(other, "livewiki", "foo.md");
      expect(isInsideAllowlist(repoRoot, target)).toBe(false);
    } finally {
      await nodeFs.rm(other, { recursive: true, force: true });
    }
  });

  it("NÃO confunde livewiki com livewiki-evil (prefixo não é substring)", () => {
    const target = nodePath.join(repoRoot, "livewiki-evil", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("NÃO confunde .livewiki com .livewiki-evil", () => {
    const target = nodePath.join(repoRoot, ".livewiki-evil", "foo.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("com allowPointer=true aceita AGENTS.md na raiz", () => {
    const target = nodePath.join(repoRoot, "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(true);
  });

  it("com allowPointer=true aceita CLAUDE.md na raiz", () => {
    const target = nodePath.join(repoRoot, "CLAUDE.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(true);
  });

  it("com allowPointer=true rejeita subdir/AGENTS.md (só na raiz)", () => {
    const target = nodePath.join(repoRoot, "subdir", "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target, { allowPointer: true })).toBe(false);
  });

  it("com allowPointer=false (default) rejeita AGENTS.md na raiz", () => {
    const target = nodePath.join(repoRoot, "AGENTS.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });

  it("com allowReadme=true aceita README.md na raiz", () => {
    const target = nodePath.join(repoRoot, "README.md");
    expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(true);
  });

  it("com allowReadme=true rejeita outros arquivos da raiz", () => {
    for (const name of ["CONTRIBUTING.md", "package.json", "AGENTS.md"]) {
      const target = nodePath.join(repoRoot, name);
      expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(false);
    }
  });

  it("com allowReadme=true rejeita subdir/README.md (só na raiz)", () => {
    const target = nodePath.join(repoRoot, "subdir", "README.md");
    expect(isInsideAllowlist(repoRoot, target, { allowReadme: true })).toBe(false);
  });

  it("com allowReadme=false (default) rejeita README.md na raiz", () => {
    const target = nodePath.join(repoRoot, "README.md");
    expect(isInsideAllowlist(repoRoot, target)).toBe(false);
  });
});

describe("resolveAndValidate (declared path, sem symlinks)", () => {
  it("rejeita path absoluto", async () => {
    await expect(
      resolveAndValidate(repoRoot, nodePath.join(repoRoot, "livewiki", "x.md")),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("rejeita path com .. (traversal)", async () => {
    await expect(resolveAndValidate(repoRoot, "../etc/passwd")).rejects.toBeInstanceOf(
      InvalidRelativePathError,
    );
    await expect(
      resolveAndValidate(repoRoot, "livewiki/../../etc/passwd"),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("rejeita path fora da allowlist", async () => {
    await expect(resolveAndValidate(repoRoot, "src/index.ts")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
    await expect(resolveAndValidate(repoRoot, "package.json")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("aceita path dentro de livewiki/", async () => {
    const abs = await resolveAndValidate(repoRoot, "livewiki/architecture/overview.md");
    // The returned path is canonicalized: realpath(repoRoot) + relPath.
    // On macOS (/var → /private/var) and Windows (8.3 RUNNER~1) the two
    // forms differ; compare against the realpath'd root.
    const realRoot = await nodeFs.realpath(repoRoot);
    expect(abs).toBe(
      nodePath.join(realRoot, "livewiki", "architecture", "overview.md"),
    );
  });

  it("aceita path dentro de .livewiki/", async () => {
    const abs = await resolveAndValidate(repoRoot, ".livewiki/index.db");
    const realRoot = await nodeFs.realpath(repoRoot);
    expect(abs).toBe(nodePath.join(realRoot, ".livewiki", "index.db"));
  });

  it("erros têm nome e contexto útil", async () => {
    try {
      await resolveAndValidate(repoRoot, "src/x.ts");
      expect.fail("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(PathOutsideAllowlistError);
      expect((err as PathOutsideAllowlistError).name).toBe("PathOutsideAllowlistError");
      expect((err as PathOutsideAllowlistError).allowlist).toContain("livewiki");
      expect((err as PathOutsideAllowlistError).allowlist).toContain(".livewiki");
    }
  });
});

describe("symlink attack defense (realpath do ancestral existente + revalidação)", () => {
  // Estes testes exercem o ponto crítico da defesa: o path declarado está
  // dentro da allowlist, mas o realpath não. Devem todos rejeitar.

  it.runIf(canSymlink)(
    "ATAQUE: livewiki é symlink para diretório FORA do repo → writeText rejeita",
    async () => {
      // Cria um diretório completamente fora do repoRoot
      const outsideDir = await nodeFs.mkdtemp(
        nodePath.join(nodeOs.tmpdir(), "livewiki-outside-"),
      );
      try {
        // Remove livewiki (que não existe ainda) e cria como symlink
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
    "ATAQUE: livewiki/sub é symlink para ../src (dentro do repo, fora da allowlist)",
    async () => {
      // Setup: cria src/ dentro do repo (fora da allowlist) e livewiki/
      await nodeFs.mkdir(nodePath.join(repoRoot, "src"));
      await nodeFs.writeFile(nodePath.join(repoRoot, "src", "real.ts"), "real content");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // livewiki/sub → ../src (escapa do livewiki/ para src/)
      await nodeFs.symlink(
        nodePath.join(repoRoot, "src"),
        nodePath.join(repoRoot, "livewiki", "sub"),
        "dir",
      );

      await expect(
        writeText(repoRoot, "livewiki/sub/pwned.md", "x"),
      ).rejects.toBeInstanceOf(PathOutsideAllowlistError);

      // Garante que nada foi escrito no src/
      const srcFiles = await nodeFs.readdir(nodePath.join(repoRoot, "src"));
      expect(srcFiles).toEqual(["real.ts"]);
    },
  );

  it.runIf(canSymlink)(
    "ATAQUE: livewiki/leaf é symlink de arquivo para ../src/secret.ts",
    async () => {
      await nodeFs.mkdir(nodePath.join(repoRoot, "src"));
      await nodeFs.writeFile(nodePath.join(repoRoot, "src", "secret.ts"), "secret");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // Arquivo symlink em vez de diretório
      await nodeFs.symlink(
        nodePath.join(repoRoot, "src", "secret.ts"),
        nodePath.join(repoRoot, "livewiki", "leaf"),
        "file",
      );

      // writeText vai achar o ancestral existente mais profundo (o arquivo leaf),
      // fazer realpath dele, ver que aponta pra src/secret.ts (fora), e rejeitar.
      await expect(
        writeText(repoRoot, "livewiki/leaf", "x"),
      ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
    },
  );

  it.runIf(canSymlink)(
    "ATAQUE: readText via symlink para fora também rejeita",
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
    "ATAQUE: exists() também passa pela validação — não vaza info",
    async () => {
      await nodeFs.writeFile(nodePath.join(repoRoot, "secret.txt"), "x");
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));
      await nodeFs.symlink(
        nodePath.join(repoRoot, "secret.txt"),
        nodePath.join(repoRoot, "livewiki", "leak.txt"),
        "file",
      );

      // exists() deve lançar PathOutsideAllowlistError, não retornar true
      // (saber que existe um arquivo "secret.txt" no repo já é leak).
      await expect(exists(repoRoot, "livewiki/leak.txt")).rejects.toBeInstanceOf(
        PathOutsideAllowlistError,
      );
    },
  );

  it.runIf(canSymlink)(
    "PERMITIDO: livewiki/data é symlink para .livewiki/data (interno)",
    async () => {
      await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki", "data"), { recursive: true });
      await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"));

      // Symlink que aponta para outro ponto DENTRO da allowlist
      await nodeFs.symlink(
        nodePath.join(repoRoot, ".livewiki", "data"),
        nodePath.join(repoRoot, "livewiki", "data"),
        "dir",
      );

      // Escrever deve funcionar: o realpath final cai em .livewiki/data,
      // que está na allowlist.
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
    "PERMITIDO: readText via symlink interno (livewiki/data → .livewiki/data)",
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
    "PERMITIDO: repoRoot passado ATRAVÉS de um symlink (macOS /var → /private/var)",
    async () => {
      // Reproduz a falha em massa do CI macOS (run 29445115951): mkdtemp
      // devolve /var/folders/... mas realpath é /private/var/folders/... —
      // o target realpathado nunca batia com o root lexical e TODA escrita
      // caía em PathOutsideAllowlistError ("failed to create .livewiki/").
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
    "ancestral existente mais profundo: target novo, parent é symlink para fora",
    async () => {
      // Cenário: livewiki/novo-dir/file.md
      //   - livewiki/novo-dir NÃO existe (vamos criar)
      //   - livewiki EXISTE
      //   - Mas livewiki é symlink para FORA
      // Esperado: rejeita porque realpath(livewiki) cai fora da allowlist
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

  it("skip notice quando symlinks não são suportados no host", () => {
    // Mostra no log de teste por que esses foram pulados, se for o caso.
    if (!canSymlink) {
      // eslint-disable-next-line no-console
      console.warn(
        "[safe-io] symlink tests skipped — host não permite criar symlinks (Windows sem Developer Mode / sem admin)",
      );
    }
    expect(true).toBe(true);
  });
});

describe("I/O operations (writeText / readText / exists / mkdir / remove)", () => {
  it("writeText + readText roundtrip em livewiki/", async () => {
    await writeText(repoRoot, "livewiki/quickstart.md", "# hello");
    const got = await readText(repoRoot, "livewiki/quickstart.md");
    expect(got).toBe("# hello");
  });

  it("writeText cria diretórios intermediários", async () => {
    await writeText(repoRoot, "livewiki/architecture/deep/nested/file.md", "x");
    const exists1 = await exists(repoRoot, "livewiki/architecture/deep/nested/file.md");
    expect(exists1).toBe(true);
  });

  it("writeText em .livewiki/ funciona", async () => {
    await writeText(repoRoot, ".livewiki/config.json", "{}");
    expect(await exists(repoRoot, ".livewiki/config.json")).toBe(true);
  });

  it("writeText REJEITA escrever fora da allowlist (regra #1)", async () => {
    await expect(
      writeText(repoRoot, "src/index.ts", "console.log('pwned')"),
    ).rejects.toBeInstanceOf(PathOutsideAllowlistError);
  });

  it("writeText REJEITA escape via .. (regra #1, traversal)", async () => {
    await expect(
      writeText(repoRoot, "livewiki/../../../etc/passwd", "x"),
    ).rejects.toBeInstanceOf(InvalidRelativePathError);
  });

  it("exists retorna false para path inexistente dentro da allowlist", async () => {
    expect(await exists(repoRoot, "livewiki/nope.md")).toBe(false);
  });

  it("mkdir cria diretório aninhado", async () => {
    await mkdir(repoRoot, "livewiki/decisions");
    expect(await exists(repoRoot, "livewiki/decisions")).toBe(true);
  });

  it("mkdir REJEITA fora da allowlist", async () => {
    await expect(mkdir(repoRoot, "src/novo")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("readText REJEITA ler fora da allowlist", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "package.json"), "{}");
    await expect(readText(repoRoot, "package.json")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });

  it("remove apaga dentro da allowlist", async () => {
    await writeText(repoRoot, "livewiki/temp.md", "x");
    expect(await exists(repoRoot, "livewiki/temp.md")).toBe(true);
    await remove(repoRoot, "livewiki/temp.md");
    expect(await exists(repoRoot, "livewiki/temp.md")).toBe(false);
  });

  it("remove REJEITA fora da allowlist", async () => {
    await expect(remove(repoRoot, "src/index.ts")).rejects.toBeInstanceOf(
      PathOutsideAllowlistError,
    );
  });
});

describe("integração com cwd (não vaza fora do repoRoot passado)", () => {
  it("quando repoRoot = cwd, validar contra cwd e não contra o sistema", async () => {
    process.chdir(repoRoot);
    await writeText(repoRoot, "livewiki/ok.md", "ok");
    expect(await exists(repoRoot, "livewiki/ok.md")).toBe(true);
    // Tentar escapar do repoRoot mesmo usando caminho "interno" deve falhar.
    await expect(writeText(repoRoot, "../../../tmp/escape.md", "x")).rejects.toThrow();
  });
});

// Sanity check final: confirma que existSync está disponível (usado internamente).
it("smoke: existSync importável via node:fs", () => {
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
