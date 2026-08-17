import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, formatHuman } from "./verify.js";
import { writeBaseline } from "./baseline.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(
      nodeOs.tmpdir(),
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

describe("verify — CRITERION: broken anchor", () => {
  it("anchor for a nonexistent symbol: detect", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#ghost   # symbol does not exist
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

  it("anchor for a nonexistent file: detect", async () => {
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

  it("valid anchor: OK (no broken_anchor)", async () => {
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

describe("verify — versioned documentation baseline", () => {
  it("fails closed on an unsupported extraction version", async () => {
    await runIndexer(repoRoot, { quiet: true });
    await writeWiki(
      "livewiki/.baseline.json",
      "{\n" +
      "\"schemaVersion\":1,\n" +
      "\"entries\":[\n" +
      `${JSON.stringify({
        wikiPath: "livewiki/a.md",
        symbolKey: "src/a.ts#a",
        hash: "a".repeat(64),
        extraction: "ts-v99",
        provenance: "accepted",
      })}\n` +
      "]\n" +
      "}\n",
    );
    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "unsupported_baseline_algorithm",
      wikiPath: "livewiki/.baseline.json",
    }));
  });

  it("catches an anchor removed without the explicit baseline operation", async () => {
    await writeCode("src/a.ts", "export function run() {}\n");
    await writeWiki(
      "livewiki/a.md",
      "---\ntitle: A\nowner: generated\nanchors:\n  - src/a.ts#run\n---\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    await writeBaseline(repoRoot, {
      schemaVersion: 1,
      entries: [{
        wikiPath: "livewiki/a.md",
        symbolKey: "src/a.ts#run",
        hash: "a".repeat(64),
        extraction: "ts-v1",
        provenance: "accepted",
      }],
    });
    await writeWiki(
      "livewiki/a.md",
      "---\ntitle: A\nowner: generated\nanchors: []\n---\n",
    );

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "baseline_entry_without_anchor",
      wikiPath: "livewiki/a.md",
    }));
  });
});

describe("verify — internal link points to a page outside the allowlist", () => {
  it("a relative link that escapes the livewiki/ namespace (../../etc/secrets.md) is reported as broken (does not block)", async () => {
    // SPEC §safe-io: restricted writes. But verify is read-only — it does not
    // block links that point outside. It only reports them as broken_internal_link.
    // Q — fix: now the resolution uses path.posix (resolves ".." correctly)
    // and the allowlist check (isInsideWiki) catches escape attempts.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](../../etc/secrets.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.severity).toBe("warning");
    // detail shows the RESOLVED wiki-path (without being livewiki/../etc/secrets.md)
    expect(broken[0]?.detail).toMatch(/outside of livewiki/i);
  });
});

describe("verify — dot-prefixed wiki pages (tier-2 hidden-dir modules)", () => {
  it("a link to an existing dot-page is not flagged, and the dot-page's anchors are validated", async () => {
    // Step 3 E2E finding: verify's artifact walker skipped dot entries,
    // so a legit generated page like livewiki/.github.md was reported as
    // "nonexistent page" (false positive broken_internal_link).
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/.github.md", `---
title: GH
owner: generated
anchors:
  - src/foo.ts#bar
---

Docs.
`);
    await writeWiki("livewiki/tasks.md", "# Tasks\n\nSee [GH](.github.md).\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    // Full zero-issues assertion: covers all THREE wiki walkers (verify's
    // page list, verify's artifact existence set, the ledger's page list)
    // — a dot-page must be parsed, linked, and validated like any other.
    expect(result.issues).toEqual([]);
  });
});

describe("verify — manual block byte-for-byte (rule #6)", () => {
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

  it("unchanged manual block: OK", async () => {
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

  it("ALTERED manual block: detect (rule #6 — write rejected)", async () => {
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

    // Alters the block (simulating agent or human bug)
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

describe("verify — internal links", () => {
  it("link to an existing page: OK", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Foo](foo.md).");
    await writeWiki("livewiki/foo.md", "# Foo\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("link to a nonexistent page: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](nope.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("nope.md");
  });

  it("link to a nonexistent #section: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nSee [Foo](foo.md#nonexistent).");
    await writeWiki("livewiki/foo.md", "# Foo\n\n## Real\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("nonexistent");
  });

  it("(Q) a relative link with '..' resolves correctly to livewiki/ (overview → module)", async () => {
    // Scenario of finding Q (Phase 4 review): overview in livewiki/architecture/
    // emits [page](../<module>.md) — before the fix, verify normalized it as
    // "livewiki/../auth.md" and reported broken_internal_link. Now it must
    // resolve to "livewiki/auth.md" and validate OK.
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

  it("(Q) a relative link with '..' to a nonexistent page reports broken (not a false negative)", async () => {
    // Guarantees that the fix is not "accept any '..'" — relative links must
    // be validated correctly even after resolution.
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

describe("verify — think_block_present (provider reasoning leak)", () => {
  it("<think> block in prose: error", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---

# Foo

Prose documenting \`bar\`.

<think>leaked reasoning</think>
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const think = result.issues.filter((i) => i.code === "think_block_present");
    expect(think).toHaveLength(1);
    expect(think[0]?.severity).toBe("error");
    expect(result.ok).toBe(false);
  });

  it("<think> inside a code fence: no issue", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---

# Foo

\`bar\` returns nothing.

\`\`\`xml
<think>quoted example</think>
\`\`\`
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "think_block_present")).toHaveLength(0);
  });
});
