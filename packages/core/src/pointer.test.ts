import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  POINTER_START,
  POINTER_END,
  POINTER_FILES,
  pickPointerFile,
  buildPointerBlock,
  findPointerBlock,
  applyPointerReplace,
  applyPointerRemove,
  insertPointer,
  removePointer,
  readPointerStatus,
  ensurePointerFile,
  type PointerFile,
} from "./pointer.js";
import * as safeIo from "./safe-io.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-pointer-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("pointer — constantes", () => {
  it("marcadores são estáveis (parsers externos podem depender)", () => {
    expect(POINTER_START).toBe("<!-- livewiki:start -->");
    expect(POINTER_END).toBe("<!-- livewiki:end -->");
  });

  it("POINTER_FILES contém apenas AGENTS.md e CLAUDE.md (regra #2)", () => {
    expect(POINTER_FILES).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });
});

describe("pointer.pickPointerFile", () => {
  it("retorna file solicitado se passado", () => {
    expect(pickPointerFile(false, false, "AGENTS.md")).toBe("AGENTS.md");
    expect(pickPointerFile(false, false, "CLAUDE.md")).toBe("CLAUDE.md");
  });

  it("prefere AGENTS.md quando ambos existem", () => {
    expect(pickPointerFile(true, true)).toBe("AGENTS.md");
  });

  it("usa AGENTS.md se só ele existe", () => {
    expect(pickPointerFile(true, false)).toBe("AGENTS.md");
  });

  it("usa CLAUDE.md se só ele existe", () => {
    expect(pickPointerFile(false, true)).toBe("CLAUDE.md");
  });

  it("cria AGENTS.md (default) se nenhum existe", () => {
    expect(pickPointerFile(false, false)).toBe("AGENTS.md");
  });
});

describe("pointer.buildPointerBlock", () => {
  it("contém os marcadores start e end", () => {
    const block = buildPointerBlock();
    expect(block).toContain(POINTER_START);
    expect(block).toContain(POINTER_END);
  });

  it("linka para ./livewiki/quickstart.md", () => {
    const block = buildPointerBlock();
    expect(block).toMatch(/\.\/livewiki\/quickstart\.md/);
  });

  it("é curto (não duplica conteúdo da wiki)", () => {
    const block = buildPointerBlock();
    // Defesa: se alguém tentar adicionar muita coisa, falhamos
    expect(block.length).toBeLessThan(800);
  });
});

describe("pointer.findPointerBlock", () => {
  it("retorna null se bloco não existe", () => {
    expect(findPointerBlock("# My README\nSome content\n")).toBeNull();
  });

  it("encontra bloco presente", () => {
    const content = `# Header\n\n${POINTER_START}\nPointer content\n${POINTER_END}\n\n# Footer`;
    const found = findPointerBlock(content);
    expect(found).not.toBeNull();
    expect(found!.inner.trim()).toBe("Pointer content");
  });

  it("tolera whitespace nos marcadores (BOM/CRLF/defensive)", () => {
    const content = `prefix\n\n<!-- livewiki:start  -->\nX\n<!--  livewiki:end -->\n`;
    const found = findPointerBlock(content);
    expect(found).not.toBeNull();
    expect(found!.inner.trim()).toBe("X");
  });

  it("retorna null se só tem start (bloco truncado — não corrompe)", () => {
    const content = `${POINTER_START}\nsem end\n`;
    expect(findPointerBlock(content)).toBeNull();
  });

  it("retorna null se só tem end (sem start)", () => {
    const content = `${POINTER_END}\n`;
    expect(findPointerBlock(content)).toBeNull();
  });
});

describe("pointer.applyPointerReplace (puro)", () => {
  it("insere quando não existe bloco (arquivo vazio)", () => {
    const block = buildPointerBlock();
    const { content, action } = applyPointerReplace("", block);
    expect(action).toBe("inserted");
    expect(content).toContain(POINTER_START);
    expect(content).toContain(POINTER_END);
  });

  it("insere quando arquivo tem conteúdo mas sem bloco", () => {
    const block = buildPointerBlock();
    const { content, action } = applyPointerReplace(
      "# My AGENTS.md\n\nExisted content.\n",
      block,
    );
    expect(action).toBe("inserted");
    expect(content).toMatch(/^# My AGENTS\.md[\s\S]*<!-- livewiki:start/m);
  });

  it("substitui bloco existente in-place (idempotência)", () => {
    const oldBlock = `${POINTER_START}\nOld content\n${POINTER_END}`;
    const newBlock = `${POINTER_START}\nNew content\n${POINTER_END}`;
    const content = `# Header\n\n${oldBlock}\n\n# Footer\n`;
    const { content: replaced, action } = applyPointerReplace(content, newBlock);
    expect(action).toBe("replaced");
    expect(replaced).toContain("New content");
    expect(replaced).not.toContain("Old content");
    // Preserva conteúdo adjacente (header/footer)
    expect(replaced).toMatch(/^# Header/);
    expect(replaced).toMatch(/# Footer\n$/);
    // Bloco aparece UMA vez (não duplicou)
    const occurrences = (replaced.match(/<!-- livewiki:start -->/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("retorna 'unchanged' quando novo bloco é byte-idêntico ao atual", () => {
    const block = buildPointerBlock();
    const content = `# Header\n\n${block}\n`;
    const { action } = applyPointerReplace(content, block);
    expect(action).toBe("unchanged");
  });
});

describe("pointer.applyPointerRemove (puro)", () => {
  it("remove bloco existente", () => {
    const block = buildPointerBlock();
    const content = `# Header\n\n${block}\n\n# Footer\n`;
    const { content: cleaned, removed } = applyPointerRemove(content);
    expect(removed).toBe(true);
    expect(cleaned).not.toContain(POINTER_START);
    expect(cleaned).not.toContain(POINTER_END);
    expect(cleaned).toMatch(/^# Header/);
    expect(cleaned).toMatch(/# Footer\n$/);
  });

  it("no-op quando bloco não existe", () => {
    const content = `# Only header\n`;
    const { content: same, removed } = applyPointerRemove(content);
    expect(removed).toBe(false);
    expect(same).toBe(content);
  });
});

describe("pointer.insertPointer (com disco)", () => {
  it("cria AGENTS.md com bloco quando arquivo não existe", async () => {
    const result = await insertPointer(repoRoot);
    expect(result.file).toBe("AGENTS.md");
    expect(result.action).toBe("inserted");

    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain(POINTER_START);
    expect(written).toContain(POINTER_END);
    expect(written).toMatch(/\.\/livewiki\/quickstart\.md/);
  });

  it("cria CLAUDE.md se file=CLAUDE.md forçado", async () => {
    const result = await insertPointer(repoRoot, { file: "CLAUDE.md" });
    expect(result.file).toBe("CLAUDE.md");
    expect(result.action).toBe("inserted");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "CLAUDE.md"), "utf8");
    expect(written).toContain(POINTER_START);
  });

  it("preserva conteúdo existente do AGENTS.md", async () => {
    const original = `# My Project\n\nPre-existing instructions.\n`;
    await nodeFs.writeFile(nodePath.join(repoRoot, "AGENTS.md"), original, "utf8");
    await insertPointer(repoRoot);
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("# My Project");
    expect(written).toContain("Pre-existing instructions.");
    expect(written).toContain(POINTER_START);
  });

  it("substitui bloco existente (não duplica)", async () => {
    const oldBlock = `${POINTER_START}\nOld\n${POINTER_END}\n`;
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "AGENTS.md"),
      `# Header\n\n${oldBlock}\n`,
      "utf8",
    );

    const result = await insertPointer(repoRoot);
    expect(result.action).toBe("replaced");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).not.toContain("Old");
    const occurrences = (written.match(/<!-- livewiki:start -->/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("idempotente: rodar 2x resulta em 'replaced' no 2º (bloco atualizado é diferente) ou 'unchanged'", async () => {
    await insertPointer(repoRoot);
    // 2ª chamada com mesmo block default = unchanged
    const result = await insertPointer(repoRoot);
    expect(result.action).toBe("unchanged");
  });

  it("idempotente: rodar 2x com block custom é replaced no 2º", async () => {
    await insertPointer(repoRoot, { block: `${POINTER_START}\nA\n${POINTER_END}` });
    const result = await insertPointer(repoRoot, { block: `${POINTER_START}\nB\n${POINTER_END}` });
    expect(result.action).toBe("replaced");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("B");
    expect(written).not.toContain("\nA\n");
  });

  it("recusa arquivo fora de POINTER_FILES mesmo com allowPointer (defesa em profundidade)", async () => {
    await expect(
      insertPointer(repoRoot, { file: "README.md" as PointerFile }),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});

describe("pointer.removePointer", () => {
  it("remove bloco se existir", async () => {
    await insertPointer(repoRoot);
    const result = await removePointer(repoRoot);
    expect(result.action).toBe("replaced");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).not.toContain(POINTER_START);
  });

  it("no-op se bloco não existe", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "AGENTS.md"), "# Only header\n", "utf8");
    const result = await removePointer(repoRoot);
    expect(result.action).toBe("unchanged");
  });

  it("recusa arquivo inválido", async () => {
    await expect(
      removePointer(repoRoot, { file: "README.md" as PointerFile }),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});

describe("pointer.readPointerStatus", () => {
  it("reporta 'not present' se nenhum arquivo de pointer existe", async () => {
    const status = await readPointerStatus(repoRoot);
    expect(status.file).toBeNull();
    expect(status.present).toBe(false);
  });

  it("reporta 'present' com conteúdo extraído", async () => {
    await insertPointer(repoRoot);
    const status = await readPointerStatus(repoRoot);
    expect(status.present).toBe(true);
    expect(status.file).toBe("AGENTS.md");
    expect(status.inner).toBeTruthy();
  });
});

describe("pointer — integração com safe-io", () => {
  it("safe-io recusa escrita fora de AGENTS.md/CLAUDE.md mesmo com allowPointer", async () => {
    // Pointer em outro nome (mesmo allowPointer=true) — safe-io tem que recusar.
    // Testamos via isInsideAllowlist que é o coração da defesa.
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "README.md"), {
      allowPointer: true,
    });
    expect(result).toBe(false);
  });

  it("safe-io aceita AGENTS.md com allowPointer=true", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "AGENTS.md"), {
      allowPointer: true,
    });
    expect(result).toBe(true);
  });

  it("safe-io aceita CLAUDE.md com allowPointer=true", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "CLAUDE.md"), {
      allowPointer: true,
    });
    expect(result).toBe(true);
  });

  it("safe-io recusa AGENTS.md SEM allowPointer (regra #1)", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "AGENTS.md"));
    expect(result).toBe(false);
  });

  it("ensurePointerFile recusa nome inválido", async () => {
    await expect(
      ensurePointerFile(repoRoot, "README.md" as PointerFile),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});