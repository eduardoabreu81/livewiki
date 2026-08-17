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

describe("pointer — constants", () => {
  it("markers are stable (external parsers may depend on them)", () => {
    expect(POINTER_START).toBe("<!-- livewiki:start -->");
    expect(POINTER_END).toBe("<!-- livewiki:end -->");
  });

  it("POINTER_FILES contains only AGENTS.md and CLAUDE.md (rule #2)", () => {
    expect(POINTER_FILES).toEqual(["AGENTS.md", "CLAUDE.md"]);
  });
});

describe("pointer.pickPointerFile", () => {
  it("returns the requested file if passed", () => {
    expect(pickPointerFile(false, false, "AGENTS.md")).toBe("AGENTS.md");
    expect(pickPointerFile(false, false, "CLAUDE.md")).toBe("CLAUDE.md");
  });

  it("prefers AGENTS.md when both exist", () => {
    expect(pickPointerFile(true, true)).toBe("AGENTS.md");
  });

  it("uses AGENTS.md if only it exists", () => {
    expect(pickPointerFile(true, false)).toBe("AGENTS.md");
  });

  it("uses CLAUDE.md if only it exists", () => {
    expect(pickPointerFile(false, true)).toBe("CLAUDE.md");
  });

  it("creates AGENTS.md (default) if none exists", () => {
    expect(pickPointerFile(false, false)).toBe("AGENTS.md");
  });
});

describe("pointer.buildPointerBlock", () => {
  it("contains the start and end markers", () => {
    const block = buildPointerBlock();
    expect(block).toContain(POINTER_START);
    expect(block).toContain(POINTER_END);
  });

  it("links to ./livewiki/quickstart.md", () => {
    const block = buildPointerBlock();
    expect(block).toMatch(/\.\/livewiki\/quickstart\.md/);
  });

  it("is short (does not duplicate wiki content)", () => {
    const block = buildPointerBlock();
    // Defense: if someone tries to add too much, we fail
    expect(block.length).toBeLessThan(800);
  });
});

describe("pointer.findPointerBlock", () => {
  it("returns null if the block does not exist", () => {
    expect(findPointerBlock("# My README\nSome content\n")).toBeNull();
  });

  it("finds a present block", () => {
    const content = `# Header\n\n${POINTER_START}\nPointer content\n${POINTER_END}\n\n# Footer`;
    const found = findPointerBlock(content);
    expect(found).not.toBeNull();
    expect(found!.inner.trim()).toBe("Pointer content");
  });

  it("tolerates whitespace in the markers (BOM/CRLF/defensive)", () => {
    const content = `prefix\n\n<!-- livewiki:start  -->\nX\n<!--  livewiki:end -->\n`;
    const found = findPointerBlock(content);
    expect(found).not.toBeNull();
    expect(found!.inner.trim()).toBe("X");
  });

  it("returns null if there is only a start (truncated block — does not corrupt)", () => {
    const content = `${POINTER_START}\nwithout end\n`;
    expect(findPointerBlock(content)).toBeNull();
  });

  it("returns null if there is only an end (no start)", () => {
    const content = `${POINTER_END}\n`;
    expect(findPointerBlock(content)).toBeNull();
  });
});

describe("pointer.applyPointerReplace (pure)", () => {
  it("inserts when there is no block (empty file)", () => {
    const block = buildPointerBlock();
    const { content, action } = applyPointerReplace("", block);
    expect(action).toBe("inserted");
    expect(content).toContain(POINTER_START);
    expect(content).toContain(POINTER_END);
  });

  it("inserts when the file has content but no block", () => {
    const block = buildPointerBlock();
    const { content, action } = applyPointerReplace(
      "# My AGENTS.md\n\nExisted content.\n",
      block,
    );
    expect(action).toBe("inserted");
    expect(content).toMatch(/^# My AGENTS\.md[\s\S]*<!-- livewiki:start/m);
  });

  it("replaces an existing block in-place (idempotency)", () => {
    const oldBlock = `${POINTER_START}\nOld content\n${POINTER_END}`;
    const newBlock = `${POINTER_START}\nNew content\n${POINTER_END}`;
    const content = `# Header\n\n${oldBlock}\n\n# Footer\n`;
    const { content: replaced, action } = applyPointerReplace(content, newBlock);
    expect(action).toBe("replaced");
    expect(replaced).toContain("New content");
    expect(replaced).not.toContain("Old content");
    // Preserves adjacent content (header/footer)
    expect(replaced).toMatch(/^# Header/);
    expect(replaced).toMatch(/# Footer\n$/);
    // Block appears ONCE (did not duplicate)
    const occurrences = (replaced.match(/<!-- livewiki:start -->/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it("returns 'unchanged' when the new block is byte-identical to the current one", () => {
    const block = buildPointerBlock();
    const content = `# Header\n\n${block}\n`;
    const { action } = applyPointerReplace(content, block);
    expect(action).toBe("unchanged");
  });
});

describe("pointer.applyPointerRemove (pure)", () => {
  it("removes an existing block", () => {
    const block = buildPointerBlock();
    const content = `# Header\n\n${block}\n\n# Footer\n`;
    const { content: cleaned, removed } = applyPointerRemove(content);
    expect(removed).toBe(true);
    expect(cleaned).not.toContain(POINTER_START);
    expect(cleaned).not.toContain(POINTER_END);
    expect(cleaned).toMatch(/^# Header/);
    expect(cleaned).toMatch(/# Footer\n$/);
  });

  it("no-op when the block does not exist", () => {
    const content = `# Only header\n`;
    const { content: same, removed } = applyPointerRemove(content);
    expect(removed).toBe(false);
    expect(same).toBe(content);
  });
});

describe("pointer.insertPointer (with disk)", () => {
  it("creates AGENTS.md with a block when the file does not exist", async () => {
    const result = await insertPointer(repoRoot);
    expect(result.file).toBe("AGENTS.md");
    expect(result.action).toBe("inserted");

    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain(POINTER_START);
    expect(written).toContain(POINTER_END);
    expect(written).toMatch(/\.\/livewiki\/quickstart\.md/);
  });

  it("creates CLAUDE.md if file=CLAUDE.md is forced", async () => {
    const result = await insertPointer(repoRoot, { file: "CLAUDE.md" });
    expect(result.file).toBe("CLAUDE.md");
    expect(result.action).toBe("inserted");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "CLAUDE.md"), "utf8");
    expect(written).toContain(POINTER_START);
  });

  it("preserves existing AGENTS.md content", async () => {
    const original = `# My Project\n\nPre-existing instructions.\n`;
    await nodeFs.writeFile(nodePath.join(repoRoot, "AGENTS.md"), original, "utf8");
    await insertPointer(repoRoot);
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("# My Project");
    expect(written).toContain("Pre-existing instructions.");
    expect(written).toContain(POINTER_START);
  });

  it("replaces an existing block (does not duplicate)", async () => {
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

  it("idempotent: running 2x results in 'replaced' on the 2nd (updated block is different) or 'unchanged'", async () => {
    await insertPointer(repoRoot);
    // 2nd call with the same default block = unchanged
    const result = await insertPointer(repoRoot);
    expect(result.action).toBe("unchanged");
  });

  it("idempotent: running 2x with a custom block is replaced on the 2nd", async () => {
    await insertPointer(repoRoot, { block: `${POINTER_START}\nA\n${POINTER_END}` });
    const result = await insertPointer(repoRoot, { block: `${POINTER_START}\nB\n${POINTER_END}` });
    expect(result.action).toBe("replaced");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).toContain("B");
    expect(written).not.toContain("\nA\n");
  });

  it("refuses a file outside POINTER_FILES even with allowPointer (defense in depth)", async () => {
    await expect(
      insertPointer(repoRoot, { file: "README.md" as PointerFile }),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});

describe("pointer.removePointer", () => {
  it("removes the block if it exists", async () => {
    await insertPointer(repoRoot);
    const result = await removePointer(repoRoot);
    expect(result.action).toBe("replaced");
    const written = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(written).not.toContain(POINTER_START);
  });

  it("no-op if the block does not exist", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "AGENTS.md"), "# Only header\n", "utf8");
    const result = await removePointer(repoRoot);
    expect(result.action).toBe("unchanged");
  });

  it("refuses an invalid file", async () => {
    await expect(
      removePointer(repoRoot, { file: "README.md" as PointerFile }),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});

describe("pointer.readPointerStatus", () => {
  it("reports 'not present' if no pointer file exists", async () => {
    const status = await readPointerStatus(repoRoot);
    expect(status.file).toBeNull();
    expect(status.present).toBe(false);
  });

  it("reports 'present' with extracted content", async () => {
    await insertPointer(repoRoot);
    const status = await readPointerStatus(repoRoot);
    expect(status.present).toBe(true);
    expect(status.file).toBe("AGENTS.md");
    expect(status.inner).toBeTruthy();
  });
});

describe("pointer — safe-io integration", () => {
  it("safe-io refuses a write outside AGENTS.md/CLAUDE.md even with allowPointer", async () => {
    // Pointer under another name (even allowPointer=true) — safe-io must refuse.
    // We test via isInsideAllowlist which is the heart of the defense.
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "README.md"), {
      allowPointer: true,
    });
    expect(result).toBe(false);
  });

  it("safe-io accepts AGENTS.md with allowPointer=true", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "AGENTS.md"), {
      allowPointer: true,
    });
    expect(result).toBe(true);
  });

  it("safe-io accepts CLAUDE.md with allowPointer=true", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "CLAUDE.md"), {
      allowPointer: true,
    });
    expect(result).toBe(true);
  });

  it("safe-io refuses AGENTS.md WITHOUT allowPointer (rule #1)", () => {
    const result = safeIo.isInsideAllowlist(repoRoot, nodePath.join(repoRoot, "AGENTS.md"));
    expect(result).toBe(false);
  });

  it("ensurePointerFile refuses an invalid name", async () => {
    await expect(
      ensurePointerFile(repoRoot, "README.md" as PointerFile),
    ).rejects.toThrow(/Invalid pointer file/);
  });
});