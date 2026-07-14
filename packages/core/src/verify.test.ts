import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, formatHuman } from "./verify.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(
      process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp",
      "livewiki-verify-",
    ),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("verify — CRITÉRIO: âncora quebrada", () => {
  it("anchor para symbol inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#ghost   # symbol não existe
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    const broken = result.issues.filter((i) => i.code === "broken_anchor");
    expect(broken.length).toBeGreaterThanOrEqual(1);
    expect(broken[0]?.detail).toContain("src/foo.ts#ghost");
  });

  it("anchor para arquivo inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/nonexistent.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    const broken = result.issues.filter((i) => i.code === "broken_anchor");
    expect(broken.length).toBeGreaterThanOrEqual(1);
  });

  it("anchor válido: OK (sem broken_anchor)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.code === "broken_anchor")).toEqual([]);
  });

  it("ignores a fenced marker example in both the ledger and verify", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---

## Real section
<!-- lw:anchors src/foo.ts#bar -->

The page documents the marker syntax below.

\`\`\`markdown
<!-- lw:anchors src/foo.ts#ghost ... -->
\`\`\`
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);

    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.code === "broken_anchor")).toEqual([]);
  });
});

describe("verify — link interno aponta para página fora do allowlist", () => {
  it("link relativo que escapa do namespace livewiki/ (../../etc/secrets.md) é reportado como broken (não bloqueia)", async () => {
    // SPEC §safe-io: escrita restrita. Mas verify é leitura — não bloqueia
    // links que apontam para fora. Apenas reporta como broken_internal_link.
    // Q — fix: agora a resolução usa path.posix (resolve ".." corretamente)
    // e o allowlist check (isInsideWiki) pega tentativas de escape.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](../../etc/secrets.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.severity).toBe("warning");
    // detail mostra o wiki-path RESOLVIDO (sem ser livewiki/../etc/secrets.md)
    expect(broken[0]?.detail).toMatch(/fora de livewiki/);
  });
});

describe("verify — manual block byte-a-byte (regra #6)", () => {
  it("matches preserved manual blocks by hash after large offset shifts", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki(
      "livewiki/foo.md",
      "# Foo\n\n<!-- lw:manual -->\nPreserve me.\n<!-- /lw:manual -->\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const path = nodePath.join(repoRoot, "livewiki/foo.md");
    const original = await nodeFs.readFile(path, "utf8");
    await nodeFs.writeFile(path, `${"Generated prose. ".repeat(20)}\n\n${original}`, "utf8");

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((issue) => issue.code === "manual_block_altered")).toEqual([]);
  });

  it("detects when one of two byte-identical stored manual blocks disappears", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    const block = "<!-- lw:manual -->\nSame bytes.\n<!-- /lw:manual -->";
    await writeWiki("livewiki/foo.md", `# Foo\n\n${block}\n\n${block}\n`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeWiki("livewiki/foo.md", `# Foo\n\n${block}\n`);
    const result = await runVerify(repoRoot);
    expect(result.issues.filter((issue) => issue.code === "manual_block_altered")).toHaveLength(1);
  });

  it("bloco manual inalterado: OK", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
Texto manual sagrado.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "manual_block_altered")).toEqual([]);
  });

  it("bloco manual ALTERADO: detect (regra #6 — write rejeitado)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
Texto manual sagrado.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Altera o bloco (simulando bug do agente ou humano)
    const path = nodePath.join(repoRoot, "livewiki/foo.md");
    const original = await nodeFs.readFile(path, "utf8");
    await nodeFs.writeFile(
      path,
      original.replace("Texto manual sagrado.", "TEXTO MODIFICADO POR AGENTE"),
    );

    const result = await runVerify(repoRoot);
    const altered = result.issues.filter((i) => i.code === "manual_block_altered");
    expect(altered.length).toBe(1);
    expect(altered[0]?.severity).toBe("error");
  });
});

describe("verify — links internos", () => {
  it("link para página existente: OK", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Foo](foo.md).");
    await writeWiki("livewiki/foo.md", "# Foo\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("link para página inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](nope.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("nope.md");
  });

  it("link para #section inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Foo](foo.md#inexistente).");
    await writeWiki("livewiki/foo.md", "# Foo\n\n## Real\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("inexistente");
  });

  it("(Q) link relativo com '..' resolve corretamente para livewiki/ (overview → módulo)", async () => {
    // Cenário do achado Q (revisão Fase 4): overview em livewiki/architecture/
    // emite [page](../<modulo>.md) — antes do fix, verify normalizava como
    // "livewiki/../auth.md" e reportava broken_internal_link. Agora deve
    // resolver pra "livewiki/auth.md" e validar OK.
    await writeCode("src/auth/login.ts", "export function login() {}");
    await writeWiki(
      "livewiki/architecture/overview.md",
      `# Architecture overview

See [auth page](../auth.md) and [class diag](../diagrams/auth.classes.mmd).
`,
    );
    await writeWiki("livewiki/auth.md", "# auth\n");
    await writeWiki("livewiki/diagrams/auth.classes.mmd", "classDiagram\n  class auth\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken).toEqual([]);
  });

  it("(Q) link relativo com '..' para página inexistente reporta broken (não false negative)", async () => {
    // Garante que o fix não é "aceita qualquer '..'" — links relativos
    // devem ser validados corretamente mesmo após resolução.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/architecture/overview.md",
      "# Architecture overview\n\nSee [Nada](../nope.md).",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("livewiki/nope.md");
  });
});

describe("verify — links inside code are not navigable (verify.ts hardening)", () => {
  it("1. [text](missing.md) inside `backticks` (inline code) → zero warning", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/index.md",
      "# Home\n\nExample syntax: `[text](missing.md)` is just documentation.\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("2. [text](missing.md#section) inside inline code → zero warning", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/index.md",
      "# Home\n\nSyntax: `[text](missing.md#section)` links must resolve.\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("3. links inside fenced code blocks (``` and ~~~) → zero warning", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/index.md",
      [
        "# Home",
        "",
        "```markdown",
        "See [broken](missing.md) here.",
        "```",
        "",
        "~~~markdown",
        "Also [broken2](missing2.md#sec) here.",
        "~~~",
        "",
      ].join("\n"),
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("4. real link to missing.md outside code → warning", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nSee [Nothing](missing.md).\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("missing.md");
  });

  it("5. real link next to inline code → only the real one is validated", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki(
      "livewiki/index.md",
      "# Home\n\nSee `[example](missing.md)` and also [Foo](foo.md) and [Nothing](missing2.md).\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("missing2.md");
  });

  it("6. existing links and relative links with '..' keep working (regression)", async () => {
    await writeCode("src/auth/login.ts", "export function login() {}");
    await writeWiki(
      "livewiki/architecture/overview.md",
      [
        "# Architecture overview",
        "",
        "See [auth page](../auth.md) — and an inline example `[fake](nope.md)` too.",
        "",
      ].join("\n"),
    );
    await writeWiki("livewiki/auth.md", "# auth\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("7. inline code with multiple backticks (2-backtick delimiter) → zero warning", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/index.md",
      "# Home\n\nDouble-backtick span: ``code with a ` backtick and [broken](missing.md)`` done.\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("broken_internal_link was NOT relaxed for real links outside code (explicit regression)", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nSee [Nothing](nope.md) and [Other](other.md).\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(2);
  });

  it("CRLF fenced block closes correctly and only the real link after it is reported", async () => {
    // Regression: a naive `split("\n")` on CRLF content leaves a trailing
    // "\r" on every line, so the closing-fence match (which anchors on
    // end-of-line) never fires — the fence stays "open" and swallows the
    // real link after it too.
    await writeCode("src/foo.ts", "export const x = 1");
    const crlf = [
      "# Home",
      "",
      "```markdown",
      "See [fake](missing.md) here.",
      "```",
      "",
      "See [Nothing](nope-for-real.md) too.",
      "",
    ].join("\r\n");
    await writeWiki("livewiki/index.md", crlf);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("nope-for-real.md");
  });
});

describe("verify — .mmd diagrams are checkable link targets", () => {
  it("link to an existing .mmd diagram: OK", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nSee [diagram](diagrams/foo.classes.mmd).\n");
    await writeWiki("livewiki/diagrams/foo.classes.mmd", "classDiagram\n  class Foo\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("link to a missing .mmd diagram: broken_internal_link", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/architecture/overview.md",
      "# Overview\n\nSee [diagram](../diagrams/ghost.classes.mmd).\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("ghost.classes.mmd");
  });

  it("malformed .mmd diagram: invalid_mermaid_diagram", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n");
    await writeWiki(
      "livewiki/diagrams/broken.classes.mmd",
      "classDiagram\n  class Foo {\n    +bar()\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const invalid = result.issues.filter(
      (issue) => issue.code === "invalid_mermaid_diagram",
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.wikiPath).toBe("livewiki/diagrams/broken.classes.mmd");
  });
});

describe("formatHuman", () => {
  it("formats OK result", () => {
    const out = formatHuman({ ok: true, pagesChecked: 3, issues: [] });
    expect(out).toContain("OK");
    expect(out).toContain("3 pages");
    expect(out).toContain("no issues");
  });

  it("formats result with errors and warnings", () => {
    const out = formatHuman({
      ok: false,
      pagesChecked: 2,
      issues: [
        { severity: "error", code: "broken_anchor", wikiPath: "livewiki/foo.md", detail: "broken" },
        { severity: "warning", code: "broken_internal_link", wikiPath: "livewiki/bar.md", detail: "link" },
      ],
    });
    expect(out).toContain("FAILED");
    expect(out).toContain("1 errors");
    expect(out).toContain("1 warnings");
    expect(out).toContain("ERROR");
    expect(out).toContain("WARN");
  });
});
