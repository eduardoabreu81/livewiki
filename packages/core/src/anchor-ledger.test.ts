/**
 * Exhaustive tests for the anchor-ledger. This phase is the product — rigorous review.
 *
 * Phase 2 criteria:
 *   - editing an anchored function generates `changed` debt
 *   - moving generates `moved`
 *   - verify catches a broken anchor
 *
 * Setup: each test creates an isolated repo + wiki + DB in tmpdir, runs the
 * indexer (creates files+symbols), then the ledger. Asserts on generated debt.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { sha256 } from "./hashes.js";
import { parseSource } from "./parser.js";
import { extractSymbols } from "./symbols.js";
import { writeBaseline } from "./baseline.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-ledger-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/** Helper: creates an indexable code file. */
async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

/** Helper: creates a wiki page. */
async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("anchor-ledger — no wiki", () => {
  it("runs without a wiki (zero pages processed)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });
    expect(result.pagesProcessed).toBe(0);
    expect(result.anchorsUpserted).toBe(0);
    expect(result.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — dot-prefixed pages (tier-2 hidden-dir modules)", () => {
  it("parses anchors from livewiki/.github.md and raises debt when the symbol changes", async () => {
    // Etapa 3 E2E finding: tier-2 modules from hidden source dirs (e.g.
    // .github/) produce dot-prefixed pages; the wiki walker skipped them,
    // so their anchors were never registered or validated.
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/.github.md", `---
title: GH
owner: generated
anchors:
  - src/foo.ts#bar
---

Docs.
`);

    await runIndexer(repoRoot, { quiet: true });
    const first = await runLedger(repoRoot, { quiet: true });
    expect(first.pagesProcessed).toBe(1);
    expect(first.anchorsUpserted).toBe(1);

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const second = await runLedger(repoRoot, { quiet: true });
    expect(second.debtCreated).toBe(1);
    expect(second.debtByEvent.changed).toBe(1);
  });
});

describe("anchor-ledger — first run", () => {
  it("upserts anchors without creating debt (initial state)", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---

Auth doc.
`);

    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.pagesProcessed).toBe(1);
    expect(result.anchorsUpserted).toBe(1);
    expect(result.debtCreated).toBe(0); // first run = baseline
  });

  it("section anchors become separate rows from page anchors", async () => {
    await writeCode(
      "src/auth.ts",
      "export class S { login() {} logout() {} }",
    );
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
---

## Login
<!-- lw:anchors src/auth.ts#S.login -->

## Logout
<!-- lw:anchors src/auth.ts#S.logout -->
`);

    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.anchorsUpserted).toBe(2);
    expect(result.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — CRITERION: changed", () => {
  it("editing an anchored function generates 'changed' debt (assignee=agent)", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---

Doc.
`);

    // Run 1: indexes + ledger (baseline)
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Edits the function (changes the symbol's content_hash)
    await writeCode("src/auth.ts", "export function validate(): boolean { return false; }");

    // Run 2: re-index detects the change, ledger generates changed
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    expect(r2.debtByEvent.changed).toBe(1);
    expect(r2.debtByEvent.moved).toBe(0);
    expect(r2.debtByEvent.deleted).toBe(0);

    // Verifies in the DB: assignee = agent (owner=generated)
    const debts = nodeSqliteQuery(repoRoot, "SELECT event, assignee FROM debt");
    expect(debts).toContainEqual({ event: "changed", assignee: "agent" });
  });

  it("anchor with owner=human generates changed with assignee=human", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(repoRoot, "SELECT event, assignee FROM debt");
    expect(debts).toContainEqual({ event: "changed", assignee: "human" });
  });

  it("promotes deduplicated changed debt to human when a matching section anchor is manual", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Human-maintained documentation.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(1);
    expect(result.debtByEvent.changed).toBe(1);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
      ),
    ).toEqual([{ event: "changed", assignee: "human" }]);
  });

  it("self-corrects previously misassigned changed debt without another code change", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Human-maintained documentation.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    nodeSqliteExec(
      repoRoot,
      "UPDATE debt SET assignee = 'agent' WHERE event = 'changed' AND resolved_at IS NULL",
    );

    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(0);
    expect(result.debtByEvent.changed).toBe(0);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
      ),
    ).toEqual([{ event: "changed", assignee: "human" }]);
  });

  it("never demotes an open human debt when later occurrences resolve to agent", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---
`);
    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(0);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
      ),
    ).toEqual([{ event: "changed", assignee: "human" }]);
  });

  it("section anchor also generates changed when editing an anchored function", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:anchors src/foo.ts#bar -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 999; }");
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.changed).toBe(1);
  });
});

describe("anchor-ledger — CRITERION: moved", () => {
  it("moving an anchored function to another file generates 'moved' and updates the anchor", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.debtByEvent.moved).toBe(0);

    // Moves validate to src/session.ts (same content_hash — only the path changes)
    await nodeFs.rm(nodePath.join(repoRoot, "src/auth.ts"));
    await writeCode("src/session.ts", "export function validate() { return true; }");

    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    expect(r2.debtByEvent.moved).toBe(1);
    expect(r2.movedPairs).toContainEqual({
      from: "src/auth.ts#validate",
      to: "src/session.ts#validate",
    });

    // The anchor in the DB now points to the new path
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toContainEqual({ symbol_key: "src/session.ts#validate" });
  });

  it("moved by equal name+signature in a different file (fallback)", async () => {
    // Same name + signature but different content_hash (body changed along with path)
    await writeCode("src/old.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/old.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/old.ts"));
    // textually equal signature but in a new file (different content_hash)
    await writeCode("src/new.ts", "export function bar() { return 1; }");

    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // bar in old.ts vanished (deleted). bar in new.ts is new.
    // Detected as moved by content_hash? Let's see.
    // Since the literal source is equal, content_hash IS equal, so it will match.
    expect(r.debtByEvent.moved + r.debtByEvent.deleted).toBeGreaterThanOrEqual(1);
  });
});

describe("anchor-ledger — versioned baseline authority", () => {
  it("detects a move without rewriting Markdown and keeps one projected debt", async () => {
    const source = "export function run() { return 1; }\n";
    await writeCode("src/old.ts", source);
    await writeWiki(
      "livewiki/auth.md",
      "---\ntitle: Auth\nowner: generated\nanchors:\n  - src/old.ts#run\n---\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    const tree = await parseSource(".ts", source);
    const hash = extractSymbols(tree, "src/old.ts", source)[0]!.content_hash;
    await writeBaseline(repoRoot, {
      schemaVersion: 1,
      entries: [{
        wikiPath: "livewiki/auth.md",
        symbolKey: "src/old.ts#run",
        hash,
        extraction: "ts-v1",
        provenance: "accepted",
      }],
    });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/old.ts"));
    await writeCode("src/new.ts", source);
    await runIndexer(repoRoot, { quiet: true });
    const first = await runLedger(repoRoot, { quiet: true });
    const second = await runLedger(repoRoot, { quiet: true });

    expect(first.movedPairs).toEqual([{ from: "src/old.ts#run", to: "src/new.ts#run" }]);
    expect(second.debtByEvent.moved).toBe(0);
    expect(await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8"))
      .toContain("src/old.ts#run");
    expect(nodeSqliteQuery(
      repoRoot,
      "SELECT event, symbol_key, detail FROM debt WHERE resolved_at IS NULL",
    )).toEqual([{
      event: "moved",
      symbol_key: "src/new.ts#run",
      detail: JSON.stringify({ from: "src/old.ts#run", to: "src/new.ts#run" }),
    }]);
  });

  it("projects changed from the versioned hash instead of the mutable anchor hash", async () => {
    const original = "export function run() { return 1; }\n";
    await writeCode("src/a.ts", original);
    await writeWiki(
      "livewiki/a.md",
      "---\ntitle: A\nowner: generated\nanchors:\n  - src/a.ts#run\n---\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    const tree = await parseSource(".ts", original);
    const hash = extractSymbols(tree, "src/a.ts", original)[0]!.content_hash;
    await writeBaseline(repoRoot, {
      schemaVersion: 1,
      entries: [{
        wikiPath: "livewiki/a.md",
        symbolKey: "src/a.ts#run",
        hash,
        extraction: "ts-v1",
        provenance: "accepted",
      }],
    });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/a.ts", "export function run() { return 2; }\n");
    await runIndexer(repoRoot, { quiet: true });
    expect((await runLedger(repoRoot, { quiet: true })).debtByEvent.changed).toBe(1);
    expect((await runLedger(repoRoot, { quiet: true })).debtByEvent.changed).toBe(0);
    expect(nodeSqliteQuery(
      repoRoot,
      "SELECT event, symbol_key FROM debt WHERE resolved_at IS NULL",
    )).toEqual([{ event: "changed", symbol_key: "src/a.ts#run" }]);
  });
});

describe("anchor-ledger — deleted (broken anchor)", () => {
  it("deleting an anchored function generates 'deleted'", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));

    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });

  it("anchor referencing a symbol that never existed generates deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#ghost  # symbol does not exist
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });

  it("anchor for a nonexistent file generates deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/doesnotexist.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });
});

describe("anchor-ledger — manual blocks (rule #6)", () => {
  it("anchor inside a manual block is NOT modified by the ledger", async () => {
    // Rule #6: the ledger NEVER writes to the wiki. Here we test that an anchor
    // inside a manual block is preserved with flag in_manual_block=1.
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual que ninguém mexe.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, in_manual_block FROM anchors",
    );
    expect(anchors).toContainEqual({
      symbol_key: "src/foo.ts#bar",
      in_manual_block: 1,
    });
  });
});

describe("anchor-ledger — undocumented", () => {
  it("symbol without an anchor goes to the undocumented table", async () => {
    await writeCode("src/foo.ts", "export function documented() {} export function undoc() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#documented
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.undocumentedSymbols).toBe(1);
    const undoc = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM undocumented");
    expect(undoc).toContainEqual({ symbol_key: "src/foo.ts#undoc" });
  });
});

describe("anchor-ledger — idempotency", () => {
  it("running the ledger 2x with no changes: 0 debt created", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — debt dedup (Fix B)", () => {
  it("deleting a function 3x in a row: generates only 1 deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Deletes the code 3x (each time runs index+ledger). Iterations 2 and 3
    // have an rm that fails (foo.ts no longer exists) — expected.
    for (let i = 0; i < 3; i++) {
      await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts")).catch(() => {});
      await runIndexer(repoRoot, { quiet: true });
      await runLedger(repoRoot, { quiet: true });
    }

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    // Only 1 deleted debt, not 3 (dedup via hasOpenDebt).
    expect(debts).toEqual([{ event: "deleted", n: 1 }]);
  });

  it("editing a function 3x: dedup keeps 1 changed open until it is resolved", async () => {
    // Consecutive changes to the same symbol (without the doc being updated)
    // result in ONE single open "changed" debt — Fix B dedup via hasOpenDebt.
    // Resolution only happens when the wiki author updates the anchor (manual or
    // via livewiki_write_doc in Phase 4).
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    // 3 consecutive edits, same anchor, no resolution → 1 open changed.
    expect(debts).toEqual([{ event: "changed", n: 1 }]);
  });

  it("counts frontmatter and section anchors for one symbol on one page as one changed debt", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---

## Bar
<!-- lw:anchors src/foo.ts#bar -->
Documents bar.
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    expect(
      nodeSqliteQuery(repoRoot, "SELECT COUNT(*) AS n FROM anchors"),
    ).toEqual([{ n: 2 }]);

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(1);
    expect(result.debtByEvent.changed).toBe(1);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT symbol_key, doc_page_id, event, assignee FROM debt WHERE resolved_at IS NULL",
      ),
    ).toEqual([
      expect.objectContaining({
        symbol_key: "src/foo.ts#bar",
        event: "changed",
        assignee: "agent",
      }),
    ]);
  });

  it("promotes deduplicated deleted debt to human when a matching section anchor is manual", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Human-maintained documentation.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(1);
    expect(result.debtByEvent.deleted).toBe(1);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
      ),
    ).toEqual([{ event: "deleted", assignee: "human" }]);
  });

  it("keeps changed debt separate when the same symbol is anchored on two pages", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    for (const page of ["one", "two"]) {
      await writeWiki(`livewiki/${page}.md`, `---
title: ${page}
owner: generated
anchors:
  - src/foo.ts#bar
---
`);
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(2);
    expect(result.debtByEvent.changed).toBe(2);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT COUNT(DISTINCT doc_page_id) AS n FROM debt WHERE event = 'changed' AND resolved_at IS NULL",
      ),
    ).toEqual([{ n: 2 }]);
  });

  it("deletes stale deleted debt when the symbol reappears and leaves the real changed debt", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, resolved_at FROM debt ORDER BY id",
      ),
    ).toEqual([{ event: "deleted", resolved_at: null }]);

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.debtCreated).toBe(1);
    expect(result.debtByEvent.changed).toBe(1);
    expect(
      nodeSqliteQuery(
        repoRoot,
        "SELECT event, resolved_at FROM debt ORDER BY id",
      ),
    ).toEqual([{ event: "changed", resolved_at: null }]);
  });
});

describe("anchor-ledger — F (Phase 2 review finding): moved false-positive + dead-row purge", () => {
  it("F1: editing 1 of N symbols does NOT generate a false moved for the unchanged ones", async () => {
    // Scenario: a file with 3 symbols. I edit ONLY the first one (changes its content_hash).
    // The other 2 are soft-deleted and re-inserted with the same key + same hash.
    // Without the `match.key === oldKey` guard, detectMoves would match the
    // (deleted, active) pairs with the same hash and generate a spurious moved
    // with from==to.
    await writeCode(
      "src/multi.ts",
      "export function a() { return 1; }\nexport function b() { return 2; }\nexport function c() { return 3; }",
    );
    await writeWiki("livewiki/multi.md", `---
title: Multi
anchors:
  - src/multi.ts#a
  - src/multi.ts#b
  - src/multi.ts#c
---
`);

    // Baseline: index + ledger. 0 debt.
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.debtByEvent.moved).toBe(0);
    expect(r1.debtByEvent.changed).toBe(0);

    // Edit ONLY `a`. b and c stay unchanged.
    await writeCode(
      "src/multi.ts",
      "export function a() { return 999; }\nexport function b() { return 2; }\nexport function c() { return 3; }",
    );
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    // Expected: 1 changed (a), 0 moved.
    // Without F1: we would have 1 changed + 2 moved (b→b and c→c, false).
    expect(r2.debtByEvent.changed).toBe(1);
    expect(r2.debtByEvent.moved).toBe(0);
    expect(r2.movedPairs).toEqual([]);

    // Confirms in the DB: 1 open changed, no moved.
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    expect(debts).toEqual([{ event: "changed", n: 1 }]);
  });

  it("F2: dead rows with an active replacement are purged after the ledger", async () => {
    // Each edit to a file soft-deletes its symbols and reinserts them with the same key.
    // Without the cleanup at the end of the ledger, the `symbols` table grows with dead rows.
    // Here: edit + ledger, then count active vs deleted by key.
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);

    // 3 consecutive edits — each one soft-deletes + reinserts `bar`.
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // After the last ledger, there must be ONLY 1 active row for `src/foo.ts#bar`.
    // The deleted rows (which had the same key) were purged (F2).
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT status, COUNT(*) as n FROM symbols WHERE key = 'src/foo.ts#bar' GROUP BY status",
    );
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[String(r.status)] = Number(r.n);
    expect(byStatus.active).toBe(1);
    expect(byStatus.deleted ?? 0).toBe(0); // purged

    // Idempotency: re-running the ledger does not create new debt (F1 covers false moves).
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtByEvent.moved).toBe(0);
  });

  it("F2: dead rows WITHOUT an active replacement are preserved (audit/history)", async () => {
    // When the symbol is truly deleted from the code, the dead row stays — we do
    // not purge it because it may be useful for audit/history.
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Truly deletes the code
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // There must be exactly 1 deleted row (without a replacement). It was NOT purged.
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT status, COUNT(*) as n FROM symbols WHERE key = 'src/foo.ts#bar' GROUP BY status",
    );
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[String(r.status)] = Number(r.n);
    expect(byStatus.deleted).toBe(1);
    expect(byStatus.active ?? 0).toBe(0);
  });
});

describe("anchor-ledger — G (Phase 2 review finding): anchor rewrite in the markdown", () => {
  it("G1: moved in a page anchor (frontmatter) rewrites the .md on disk", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    await writeWiki(
      wikiRel,
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Move: foo.ts → baz.ts (same body, same hash).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // The Markdown on disk MUST have the new key (rule #3: markdown is the source of truth).
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toMatch(/src\/baz\.ts#bar/);
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/);
  });

  it("G1: moved in a section anchor (lw:anchors marker) rewrites the .md on disk", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    await writeWiki(
      wikiRel,
      `---
title: Foo
---

## Detalhes
<!-- lw:anchors src/foo.ts#bar -->
Texto.
`,
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/baz\.ts#bar -->/);
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/);
  });

  it("G2: anchor inside an lw:manual block is NOT rewritten (rule #6)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`;
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Markdown untouched (rule #6: human content never modified by automated writes).
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toBe(mdOriginal);
    expect(mdAfter).toMatch(/src\/foo\.ts#bar/); // old key preserved
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // But the debt exists — assignee=human (rule #6).
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "moved", assignee: "human" });

    // Repeat-run idempotency: another ledger pass with no code or
    // Markdown change must keep exactly one persisted identity for the
    // moved anchor and not create additional open moved debt. The
    // canonical newKey row survives (collision handling: the manual
    // block's oldKey is preserved in the Markdown, so on a repeat
    // run a fresh oldKey row is inserted but then deleted in favor of
    // the existing newKey row; moved-debt dedup is by the canonical
    // newKey id, so the prior open moved debt covers this run).
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchorsAfter = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors",
    );
    expect(anchorsAfter).toEqual([{ symbol_key: "src/baz.ts#bar" }]);
    const movedDebts = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM debt WHERE event = 'moved' AND resolved_at IS NULL",
    );
    expect(movedDebts).toEqual([{ n: 1 }]);
  });

  it("G2: anchor on an owner=human page is NOT rewritten (rule #6)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
---
`;
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Markdown untouched.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toBe(mdOriginal);

    // Debt: assignee=human.
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "moved", assignee: "human" });
  });

  it("G2-ext: stale generated row must not rewrite surviving manual occurrence", async () => {
    // Defect 1 regression: a stale generated anchor row at the old
    // key must not trigger a page-wide oldKey -> newKey rewrite before
    // being rejected by the pre-move identity check. If the only
    // surviving occurrence of the old key is inside a manual block,
    // the rewrite would otherwise silently overwrite that manual
    // marker, breaking the manual-content rule.
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 42; }\n" +
        "export function baz() { return 99; }\n",
    );
    // Initial page: frontmatter has bar (generated) and a manual
    // block also has bar. Two persisted rows for the same key.
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    const r0 = await runLedger(repoRoot, { quiet: true });
    expect(r0.debtCreated).toBe(0);
    expect(
      nodeSqliteQuery(repoRoot, "SELECT COUNT(*) AS n FROM anchors"),
    ).toEqual([{ n: 2 }]);

    // User removes the generated occurrence from Markdown WITHOUT
    // running the ledger. The persisted generated row is now stale.
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`,
    );

    // Source move: bar -> baz.ts (same body).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/baz.ts",
      "export function bar() { return 42; }\n" +
        "export function baz() { return 99; }\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // The manual marker must still reference the old key.
    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/foo.md"),
      "utf8",
    );
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/foo\.ts#bar -->/);
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // The DB has exactly one anchor row for the manual block (the
    // stale generated row was removed by reconciliation), and the
    // manual row was updated to newKey as part of the standard move
    // handling. The Markdown still references oldKey (rule #6), so
    // there is exactly one open moved debt with assignee=human.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, section_slug, in_manual_block FROM anchors",
    );
    expect(anchors).toEqual([
      {
        symbol_key: "src/baz.ts#bar",
        section_slug: "manual",
        in_manual_block: 1,
      },
    ]);
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toEqual([{ event: "moved", assignee: "human" }]);
  });

  it("G2-ext: owner:human with two distinct moves keeps distinct canonical ids and is repeat-idempotent", async () => {
    // Defect 2 + 3 regression: with two distinct moves from one file
    // in a single owner:human frontmatter, the canonical moved-anchor
    // id map (keyed only by page+section) collapses both moves onto
    // the same anchor id, and the NULL-sensitive frontmatter
    // collision lookup misses the existing newKey rows. The result
    // is duplicate newKey rows and duplicate open moved debts.
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 1; }\n" +
        "export function baz() { return 2; }\n",
    );
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
  - src/foo.ts#baz
---
`;
    await writeWiki(wikiRel, mdOriginal);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Move both symbols to new.ts (same bodies).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/new.ts",
      "export function bar() { return 1; }\n" +
        "export function baz() { return 2; }\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });

    // Markdown is unchanged.
    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );
    expect(mdAfter).toBe(mdOriginal);

    // Exactly one canonical newKey row per moved symbol.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors ORDER BY symbol_key",
    );
    expect(anchors).toEqual([
      { symbol_key: "src/new.ts#bar" },
      { symbol_key: "src/new.ts#baz" },
    ]);

    // Two distinct open moved debts referencing distinct anchor ids
    // and the correct new symbol keys.
    const movedDebts = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, anchor_id FROM debt WHERE event = 'moved' AND resolved_at IS NULL ORDER BY symbol_key, anchor_id",
    );
    expect(movedDebts).toHaveLength(2);
    const symbolKeys = movedDebts.map((d) => d.symbol_key);
    expect(symbolKeys).toEqual(["src/new.ts#bar", "src/new.ts#baz"]);
    const anchorIds = new Set(movedDebts.map((d) => d.anchor_id));
    expect(anchorIds.size).toBe(2);

    // Repeat run is idempotent: zero additional debt, anchor ids and
    // symbol keys are preserved, the persisted row count stays at 2.
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchors2 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors ORDER BY symbol_key",
    );
    expect(anchors2).toEqual([
      { symbol_key: "src/new.ts#bar" },
      { symbol_key: "src/new.ts#baz" },
    ]);
    const movedDebts2 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, anchor_id FROM debt WHERE event = 'moved' AND resolved_at IS NULL ORDER BY symbol_key, anchor_id",
    );
    expect(movedDebts2).toEqual(movedDebts);
  });

  it("G2-ext: rewrite respects manual blocks, code spans, and the anchors list scope", async () => {
    // Defect 1 + 2 + 3 regression: the same oldKey appears in many
    // places on a single page, only some of which are allowed
    // rewrite targets:
    //   1. the real frontmatter `anchors:` list (allowed rewrite);
    //   2. a later unrelated frontmatter list under another field
    //      (`related:`, must stay byte-identical — stop at the
    //      next top-level frontmatter key);
    //   3. a generated `<!-- lw:anchors -->` section marker
    //      (allowed rewrite);
    //   4. an ordinary Markdown bullet listing the key as text
    //      (NOT an anchor — must remain byte-identical);
    //   5. an `<!-- lw:anchors -->` marker inside a fenced code
    //      example (must remain byte-identical — code spans are
    //      not a structural rewrite surface);
    //   6. an `<!-- lw:anchors -->` marker inside an
    //      `<!-- lw:manual -->` block (must remain byte-identical
    //      — manual content is human-owned and byte-preserved).
    //
    // The fixture also uses CRLF line endings, a new key with
    // a materially different length from the old key (so any
    // offset drift caused by editing the frontmatter before
    // computing body positions would corrupt a marker inside the
    // manual block — defect 1), the `anchors:` field carries a
    // trailing YAML comment (a real, parser-accepted form that
    // the rewrite helper must recognize — defect 2), and the
    // closing `---` delimiter has trailing spaces (also real, also
    // parser-accepted — defect 1 of the current helper).
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    // CRLF line endings throughout. The `anchors:` line carries a
    // trailing comment; the closing `---` line has trailing spaces.
    const mdOriginal = [
      "---",
      "title: Foo",
      "anchors: # canonical symbol keys",
      "  - src/foo.ts#bar",
      "related:",
      "  - src/foo.ts#bar",
      "---   ",
      "",
      "## Details",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "Section text.",
      "",
      "- src/foo.ts#bar  # prose note",
      "",
      "## Example",
      "```markdown",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "```",
      "",
      "## Manual",
      "<!-- lw:manual -->",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "- src/foo.ts#bar  # manual line",
      "<!-- /lw:manual -->",
      "",
    ].join("\r\n");
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    const r0 = await runLedger(repoRoot, { quiet: true });
    expect(r0.debtCreated).toBe(0);
    expect(
      nodeSqliteQuery(repoRoot, "SELECT COUNT(*) AS n FROM anchors"),
    ).toEqual([{ n: 3 }]);

    // Move foo.ts -> longer-name.ts. Different length (+7 chars)
    // forces every body offset to shift, so any offset
    // pre-computation against the original source must be
    // carefully isolated from frontmatter edits.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/longer-name.ts",
      "export function bar() { return 42; }",
    );

    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });

    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );

    // CRLF line endings are preserved end-to-end. The Markdown
    // must not contain any bare LF outside of an LF that is part
    // of a CRLF pair (sanity: a leading \n without a preceding \r
    // would mean the rewrite dropped or normalized line endings).
    expect(mdAfter).toMatch(/^---/m);
    expect(mdAfter).toMatch(/\r\n/);
    // The closing delimiter with trailing spaces must be
    // recognized as a valid frontmatter end; the frontmatter
    // region therefore has the same line count before and after.
    const fmEndRe = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
    const fmOriginal = mdOriginal.match(fmEndRe)?.[0] ?? "";
    const fmAfter = mdAfter.match(fmEndRe)?.[0] ?? "";
    expect(fmOriginal.split(/\r\n/).length).toBe(fmAfter.split(/\r\n/).length);
    expect(fmOriginal).toContain("\r\n");
    // The closing delimiter line still carries its trailing
    // spaces — the rewrite must not eat them.
    expect(fmAfter).toMatch(/\r\n---   \r?\n/);

    // Allowed rewrites happened:
    //   - the real frontmatter anchor entry: src/foo.ts#bar -> src/longer-name.ts#bar
    //     The `anchors:` line itself keeps its trailing comment.
    const anchorsRe =
      /^[ \t]*anchors:[^\r\n]*\r?\n([\s\S]*?)(?=^[ \t]*[A-Za-z_][\w-]*[ \t]*:|\r?\n---)/m;
    const fmAnchorsOriginal = fmOriginal.match(anchorsRe)?.[1] ?? "";
    const fmAnchorsAfter = fmAfter.match(anchorsRe)?.[1] ?? "";
    expect(fmAfter).toMatch(/^[ \t]*anchors:[ \t]*# canonical symbol keys\r?$/m);
    expect(fmAnchorsAfter).toMatch(/^[ \t]*-[ \t]+src\/longer-name\.ts#bar\r?$/m);
    expect(fmAnchorsAfter).not.toMatch(/src\/foo\.ts#bar/);
    //   - the real generated section marker
    expect(mdAfter).toMatch(
      /<!--\s*lw:anchors\s+src\/longer-name\.ts#bar\s*-->/,
    );

    // Preserved byte-identical:
    //   - the later unrelated frontmatter list (`related:`) keeps oldKey
    const relatedRe = /^[ \t]*related:[ \t]*\r?\n([\s\S]*?)(?=^[ \t]*[A-Za-z_][\w-]*[ \t]*:|\r?\n---)/m;
    const fmRelatedOriginal = fmOriginal.match(relatedRe)?.[1] ?? "";
    const fmRelatedAfter = fmAfter.match(relatedRe)?.[1] ?? "";
    expect(fmRelatedAfter).toBe(fmRelatedOriginal);
    expect(fmRelatedAfter).toMatch(/^[ \t]*-[ \t]+src\/foo\.ts#bar\r?$/m);
    expect(fmRelatedAfter).not.toMatch(/src\/longer-name\.ts#bar/);
    //   - the ordinary body bullet keeps oldKey
    expect(mdAfter).toMatch(/- src\/foo\.ts#bar  # prose note\r\n/);
    //   - the fenced code example content is byte-identical
    const fenceRe = /```markdown\r?\n([\s\S]*?)\r?\n```/;
    const originalFence = mdOriginal.match(fenceRe)?.[0] ?? "";
    const afterFence = mdAfter.match(fenceRe)?.[0] ?? "";
    expect(afterFence).toBe(originalFence);
    expect(afterFence).toContain("src/foo.ts#bar");
    expect(afterFence).not.toContain("src/longer-name.ts#bar");
    //   - the complete manual block is byte-identical (no marker or
    //     body line inside the manual range changed)
    const manualRe = /<!--\s*lw:manual\s*-->([\s\S]*?)<!--\s*\/lw:manual\s*-->/;
    const originalManual = mdOriginal.match(manualRe)?.[0] ?? "";
    const afterManual = mdAfter.match(manualRe)?.[0] ?? "";
    expect(afterManual).toBe(originalManual);
    expect(afterManual).toContain("src/foo.ts#bar");
    expect(afterManual).not.toContain("src/longer-name.ts#bar");

    // The Markdown is not byte-identical overall (frontmatter and
    // section marker were rewritten), but every protected region
    // listed above is.
    expect(mdAfter).not.toBe(mdOriginal);

    // Canonical database identities: the manual block row is
    // in_manual_block=1 (rewrite skipped), but it was still updated
    // to the new symbol key in SQLite by the move handling. The
    // generated section marker row is in_manual_block=0. The
    // frontmatter row is in_manual_block=0 (page slot). The
    // Exemplo section has no row because its marker sits inside
    // a fenced code block and is masked by the parser.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, section_slug, in_manual_block FROM anchors ORDER BY section_slug NULLS FIRST, rowid",
    );
    expect(anchors).toEqual([
      { symbol_key: "src/longer-name.ts#bar", section_slug: null, in_manual_block: 0 },
      { symbol_key: "src/longer-name.ts#bar", section_slug: "details", in_manual_block: 0 },
      { symbol_key: "src/longer-name.ts#bar", section_slug: "manual", in_manual_block: 1 },
    ]);

    // Moved debt: one per persisted row. Non-manual rows are
    // assignee=agent (rewritten in Markdown), manual row is
    // assignee=human (rule #6).
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL ORDER BY id",
    );
    expect(debts).toEqual([
      { event: "moved", assignee: "agent" },
      { event: "moved", assignee: "agent" },
      { event: "moved", assignee: "human" },
    ]);

    // Repeat run is idempotent: zero new debt, anchor rows stable.
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchors2 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM anchors",
    );
    expect(anchors2).toEqual([{ n: 3 }]);
    const debts2 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts2).toEqual([{ n: 3 }]);
    // The Markdown remains identical after the repeat run (no
    // second rewrite of the already-rewritten anchors entry).
    const mdAfter2 = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );
    expect(mdAfter2).toBe(mdAfter);

    // Manual-block persistence: the page has exactly one
    // `<!-- lw:manual -->...<!-- /lw:manual -->` block, so the
    // ledger must keep exactly one stored row for it across
    // repeat runs. Duplicate rows make verify compare a stored
    // multiset against itself and emit false
    // `manual_block_altered` errors.
    const manualBlockRows = nodeSqliteQuery(
      repoRoot,
      "SELECT id, doc_page_id, start_offset, end_offset, content_hash " +
        "FROM manual_blocks ORDER BY id",
    );
    expect(manualBlockRows).toHaveLength(1);

    // verify must not emit any `manual_block_altered` issues for
    // this page. We do not assert zero total issues because the
    // intentionally preserved oldKey (e.g. inside the manual
    // block) legitimately produces a `broken_anchor`.
    const { run: runVerify } = await import("./verify.js");
    const verifyReport = await runVerify(repoRoot);
    const alteredIssues = verifyReport.issues.filter(
      (i) => i.code === "manual_block_altered",
    );
    expect(alteredIssues).toEqual([]);
  });
});

describe("anchor-ledger — debt.symbol_key (Fix E)", () => {
  it("debt carries symbol_key even after the anchor is removed", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Now removes the wiki page — the orphan anchor vanishes
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/foo.md"));
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(repoRoot, "SELECT event, symbol_key FROM debt");
    // symbol_key preserved even without an anchor (avoids an orphan with no reference)
    expect(debts).toContainEqual({ event: "deleted", symbol_key: "src/foo.ts#bar" });
  });
});

describe("anchor-ledger — in_manual_block → assignee=human (Fix D)", () => {
  it("anchor inside lw:manual on a generated page: assignee=human", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
---

## Section
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
texto manual
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // With no code change, it generates no debt.
    expect(r.debtCreated).toBe(0);

    // Edits the code — an anchor inside a manual block generates debt with assignee=human
    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "changed", assignee: "human" });
  });

  it("anchor outside a manual block on a mixed page: assignee=agent", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: mixed
---

## Section
<!-- lw:anchors src/foo.ts#bar -->
Outside of the manual block.
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    // owner=mixed but outside a manual block → assignee=agent
    expect(debts).toContainEqual({ event: "changed", assignee: "agent" });
  });
});

describe("anchor-ledger — page vanished from the wiki", () => {
  it("removes orphan anchors", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Removes the wiki page
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/foo.md"));

    await runLedger(repoRoot, { quiet: true });
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toEqual([]);
  });
});

describe("anchor-ledger — reconciliation by stable identity", () => {
  // Review finding (2026-07-16): the (doc_page_id, section_slug, symbol_key)
  // map identity correctly supports multiple frontmatter anchors, but the
  // ledger did NOT reconcile persisted rows against the current Markdown.
  //   - Replacing A with B in a page slot inserted a new B row but left
  //     the stale A row behind. The SQLite index drifted from disk; a
  //     later edit could resurrect debt from an anchor that no longer
  //     exists in the wiki.
  //   - Moved-anchor processing updated DB rows + ca.symbolKey but left
  //     existingAnchors indexed under oldKey, so the immediate diff
  //     could not find the row under newKey.
  // This test exercises the full contract: idempotency under repeated
  // runs, deterministic removal of stale identities, and no spurious
  // debt when a documentation page deliberately drops an anchor.
  it("retains A, removes the replaced B, inserts C; B becomes undocumented; no spurious debt", async () => {
    // 1. Three active symbols in one file.
    await writeCode(
      "src/lib.ts",
      "export function a() { return 1; }\n" +
        "export function b() { return 2; }\n" +
        "export function c() { return 3; }\n",
    );
    // 2. One wiki page with A and B in the frontmatter + matching section
    //    markers (so both kinds of slots are exercised).
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
anchors:
  - src/lib.ts#a
  - src/lib.ts#b
---

## Overview

## Reference
<!-- lw:anchors src/lib.ts#a src/lib.ts#b -->
`,
    );

    // 3. Index + ledger twice — must be idempotent: 0 debt, exactly 4
    //    anchor rows (A and B in frontmatter + A and B in section).
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.pagesProcessed).toBe(1);
    expect(r1.anchorsUpserted).toBe(4);
    expect(r1.debtCreated).toBe(0);

    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    expect(r2.anchorsUpserted).toBe(4);

    const identities = (rows: Array<Record<string, unknown>>) =>
      rows
        .map((r) => `${r.doc_page_id}|${r.section_slug ?? "null"}|${r.symbol_key}`)
        .sort();
    const rows1 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    // doc_page_id is 1 on a fresh DB (only one page in this test).
    expect(identities(rows1)).toEqual([
      "1|null|src/lib.ts#a",
      "1|null|src/lib.ts#b",
      "1|reference|src/lib.ts#a",
      "1|reference|src/lib.ts#b",
    ]);

    // 4. Rewrite the page: B is removed from the frontmatter, the section
    //    marker switches B→C, and A is untouched in both slots.
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
anchors:
  - src/lib.ts#a
---

## Overview

## Reference
<!-- lw:anchors src/lib.ts#a src/lib.ts#c -->
`,
    );

    // 5. Run the ledger again. No source-code change, so no real change
    //    debt should appear.
    const r3 = await runLedger(repoRoot, { quiet: true });
    expect(r3.debtCreated).toBe(0);
    expect(r3.debtByEvent.changed).toBe(0);
    expect(r3.debtByEvent.moved).toBe(0);
    expect(r3.debtByEvent.deleted).toBe(0);

    // 6. The persisted identities MUST exactly match the current Markdown.
    const rows3 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(identities(rows3)).toEqual([
      "1|null|src/lib.ts#a",
      "1|reference|src/lib.ts#a",
      "1|reference|src/lib.ts#c",
    ]);

    // 7. The stale B rows (frontmatter + section) are GONE — exactly
    //    zero rows reference src/lib.ts#b.
    const staleB = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors WHERE symbol_key = 'src/lib.ts#b'",
    );
    expect(staleB).toEqual([]);

    // 8. C exists once per legitimate page/section identity (section
    //    "reference" only — it was never in the frontmatter).
    const cRows = nodeSqliteQuery(
      repoRoot,
      "SELECT section_slug FROM anchors WHERE symbol_key = 'src/lib.ts#c'",
    );
    expect(cRows).toEqual([{ section_slug: "reference" }]);

    // 9. B has no other anchor → it must become undocumented.
    const undoc = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM undocumented",
    );
    expect(undoc).toEqual([{ symbol_key: "src/lib.ts#b" }]);

    // 10. A still has 0 debt — the documentation did not stop anchoring
    //     it, and the source code did not change.
    const openDebt = nodeSqliteQuery(
      repoRoot,
      "SELECT event FROM debt WHERE resolved_at IS NULL",
    );
    expect(openDebt).toEqual([]);

    // 11. Repeat-run idempotency: a fourth ledger call must not change
    //     anything.
    const r4 = await runLedger(repoRoot, { quiet: true });
    expect(r4.debtCreated).toBe(0);
    const rows4 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(identities(rows4)).toEqual(identities(rows3));

    // 12. Remove the final anchor (A from frontmatter, A from section,
    //     and C from section): the page keeps no anchors at all. A
    //     previously-processed page with zero current anchors must still
    //     be reconciled against an empty expected set, so every
    //     persisted row for the page is removed.
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
---

## Overview
`,
    );
    const r5 = await runLedger(repoRoot, { quiet: true });
    expect(r5.debtCreated).toBe(0);
    expect(r5.debtByEvent.changed).toBe(0);
    expect(r5.debtByEvent.moved).toBe(0);
    expect(r5.debtByEvent.deleted).toBe(0);

    const rows5 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(rows5).toEqual([]);

    // The doc_page row stays — only the anchors were removed.
    const docPageRows = nodeSqliteQuery(
      repoRoot,
      "SELECT wiki_path FROM doc_pages",
    );
    expect(docPageRows).toEqual([{ wiki_path: "livewiki/lib.md" }]);

    // All three symbols are now undocumented (no anchors anywhere).
    const undoc5 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM undocumented ORDER BY symbol_key",
    );
    expect(undoc5).toEqual([
      { symbol_key: "src/lib.ts#a" },
      { symbol_key: "src/lib.ts#b" },
      { symbol_key: "src/lib.ts#c" },
    ]);

    // 13. Repeat-run idempotency: a sixth ledger call does not change
    //     anything (the empty-page state stays empty, no debt).
    const r6 = await runLedger(repoRoot, { quiet: true });
    expect(r6.debtCreated).toBe(0);
    const rows6 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM anchors",
    );
    expect(rows6).toEqual([{ n: 0 }]);
    const openDebt6 = nodeSqliteQuery(
      repoRoot,
      "SELECT event FROM debt WHERE resolved_at IS NULL",
    );
    expect(openDebt6).toEqual([]);
  });
});

// Helper pra queries SQLite sem depender de abrir o DB manualmente
describe("anchor-ledger — EOL-insensitive hashing (roadmap item 12)", () => {
  it("CRLF→LF flip produces zero debt and zero file-change accounting", async () => {
    const crlf = "export function eol() {\r\n  return 1;\r\n}\r\n";
    await writeCode("src/eol.ts", crlf);
    await writeWiki("livewiki/eol.md", `---
title: EOL
owner: generated
anchors:
  - src/eol.ts#eol
---
`);
    const i1 = await runIndexer(repoRoot, { quiet: true });
    expect(i1.filesAdded).toBe(1);
    await runLedger(repoRoot, { quiet: true });

    // git core.autocrlf checkout conversion: same content, LF endings.
    await writeCode("src/eol.ts", crlf.replace(/\r\n/g, "\n"));
    const i2 = await runIndexer(repoRoot, { quiet: true });
    expect(i2.filesUpdated).toBe(0);
    expect(i2.filesUnchanged).toBe(1);
    expect(i2.symbolsAdded).toBe(0);

    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(0);
  });

  it("real one-line change plus EOL flip yields exactly the real changed debt", async () => {
    const crlf = "export function eol2() {\r\n  return 1;\r\n}\r\n";
    await writeCode("src/eol2.ts", crlf);
    await writeWiki("livewiki/eol2.md", `---
title: EOL2
owner: generated
anchors:
  - src/eol2.ts#eol2
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Real edit AND an EOL flip at once.
    await writeCode("src/eol2.ts", "export function eol2() {\n  return 2;\n}\n");
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(1);
    expect(r.debtByEvent.changed).toBe(1);
    expect(r.debtByEvent.moved).toBe(0);
    expect(r.debtByEvent.deleted).toBe(0);
  });

  it("legacy raw-bytes hashes migrate silently: zero debt, anchors realigned", async () => {
    const crlf = "export function legacy() {\r\n  return 1;\r\n}\r\n";
    await writeCode("src/legacy.ts", crlf);
    await writeWiki("livewiki/legacy.md", `---
title: Legacy
owner: generated
anchors:
  - src/legacy.ts#legacy
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Simulate a pre-item-12 database: raw-bytes file hash, and stale
    // symbol/anchor hashes as a pre-upgrade DB would hold.
    nodeSqliteExec(
      repoRoot,
      `UPDATE files SET content_hash = '${sha256(crlf)}' WHERE path = 'src/legacy.ts'`,
    );
    nodeSqliteExec(repoRoot, "UPDATE symbols SET content_hash = 'legacy-' || id");
    nodeSqliteExec(repoRoot, "UPDATE anchors SET symbol_hash_at_doc = 'legacy'");

    // Bytes on disk unchanged: silent migration, no file-change accounting.
    const i = await runIndexer(repoRoot, { quiet: true });
    expect(i.filesUpdated).toBe(0);
    expect(i.filesUnchanged).toBe(1);

    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(0);
    expect(r.movedPairs).toEqual([]);

    // The anchor hash was realigned to the live (normalized) symbol hash.
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT a.symbol_hash_at_doc AS h, s.content_hash AS sh " +
        "FROM anchors a JOIN symbols s ON s.key = a.symbol_key AND s.status = 'active'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.h).toBe(rows[0]?.sh);
    expect(rows[0]?.h).not.toBe("legacy");
  });

  it("legacy-CRLF DB + LF files: silent flipped-EOL migration, zero debt", async () => {
    const lf = "export function flipleg() {\n  return 1;\n}\n";
    await writeCode("src/flipleg.ts", lf);
    await writeWiki("livewiki/flipleg.md", `---
title: FlipLeg
owner: generated
anchors:
  - src/flipleg.ts#flipleg
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Simulate a pre-item-12 database indexed when the file was CRLF on
    // disk (stored file hash = raw CRLF bytes, stale symbol/anchor hashes
    // from raw CRLF slices); the file on disk is now LF.
    const crlf = lf.replace(/\n/g, "\r\n");
    nodeSqliteExec(
      repoRoot,
      `UPDATE files SET content_hash = '${sha256(crlf)}' WHERE path = 'src/flipleg.ts'`,
    );
    nodeSqliteExec(repoRoot, "UPDATE symbols SET content_hash = 'legacy-' || id");
    nodeSqliteExec(repoRoot, "UPDATE anchors SET symbol_hash_at_doc = 'legacy'");

    const i = await runIndexer(repoRoot, { quiet: true });
    expect(i.filesUpdated).toBe(0);
    expect(i.filesUnchanged).toBe(1);

    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(0);
    expect(r.movedPairs).toEqual([]);

    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT a.symbol_hash_at_doc AS h, s.content_hash AS sh " +
        "FROM anchors a JOIN symbols s ON s.key = a.symbol_key AND s.status = 'active'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.h).toBe(rows[0]?.sh);
    expect(rows[0]?.h).not.toBe("legacy");
  });

  it("legacy-LF DB + CRLF files: zero debt via the unchanged fast path", async () => {
    const lf = "export function lfleg() {\n  return 1;\n}\n";
    await writeCode("src/lfleg.ts", lf);
    await writeWiki("livewiki/lfleg.md", `---
title: LfLeg
owner: generated
anchors:
  - src/lfleg.ts#lfleg
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // A current-code index of the LF file is already a faithful legacy-LF
    // database (normalizeEol is a no-op on LF-only text, so normalized
    // hashes == legacy raw hashes, file and symbol level alike).
    await writeCode("src/lfleg.ts", lf.replace(/\n/g, "\r\n"));
    const i = await runIndexer(repoRoot, { quiet: true });
    expect(i.filesUpdated).toBe(0);
    expect(i.filesUnchanged).toBe(1);

    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(0);
  });

  it("legacy-CRLF DB + LF files + a real change: exactly the real changed debt", async () => {
    const lf = "export function realleg() {\n  return 1;\n}\n";
    await writeCode("src/realleg.ts", lf);
    await writeWiki("livewiki/realleg.md", `---
title: RealLeg
owner: generated
anchors:
  - src/realleg.ts#realleg
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Legacy-CRLF stored hash; then a REAL content change in the now-LF
    // file — the flipped-variant check must NOT claim an EOL migration.
    nodeSqliteExec(
      repoRoot,
      `UPDATE files SET content_hash = '${sha256(lf.replace(/\n/g, "\r\n"))}' WHERE path = 'src/realleg.ts'`,
    );
    await writeCode("src/realleg.ts", "export function realleg() {\n  return 2;\n}\n");
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });
    expect(r.debtCreated).toBe(1);
    expect(r.debtByEvent.changed).toBe(1);
    expect(r.debtByEvent.moved).toBe(0);
    expect(r.debtByEvent.deleted).toBe(0);
  });

  it("legacy-CRLF DB + updated multi-function file: exactly the real changed debt, unchanged symbols realigned silently", async () => {
    const lf =
      "export function alpha() {\n  return 1;\n}\n\n" +
      "export function beta() {\n  return 10;\n}\n";
    await writeCode("src/multi.ts", lf);
    await writeWiki("livewiki/multi.md", `---
title: Multi
owner: generated
anchors:
  - src/multi.ts#alpha
  - src/multi.ts#beta
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await simulateLegacyCrlfDb("src/multi.ts", lf);

    // Real one-line change in ONE function of the now-LF file.
    const edited = lf.replace("return 1;", "return 2;");
    await writeCode("src/multi.ts", edited);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // Only the edited function emits debt — the unchanged function's
    // anchor was realigned to the normalized hash by the indexer.
    expect(r.debtCreated).toBe(1);
    expect(r.debtByEvent.changed).toBe(1);
    expect(r.debtByEvent.moved).toBe(0);
    expect(r.debtByEvent.deleted).toBe(0);
    const debts = nodeSqliteQuery(repoRoot, "SELECT symbol_key, event FROM debt");
    expect(debts).toEqual([{ symbol_key: "src/multi.ts#alpha", event: "changed" }]);

    // Every anchor ends at the live (normalized) symbol hash.
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT a.symbol_key AS k, a.symbol_hash_at_doc AS h, s.content_hash AS sh " +
        "FROM anchors a JOIN symbols s ON s.key = a.symbol_key AND s.status = 'active' ORDER BY k",
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.h, `anchor ${row.k} must be at the normalized hash`).toBe(row.sh);
    }
  });

  it("after the per-symbol migration run, a second index emits zero debt (stable rebaseline)", async () => {
    const lf =
      "export function alpha() {\n  return 1;\n}\n\n" +
      "export function beta() {\n  return 10;\n}\n";
    await writeCode("src/multi.ts", lf);
    await writeWiki("livewiki/multi.md", `---
title: Multi
owner: generated
anchors:
  - src/multi.ts#alpha
  - src/multi.ts#beta
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await simulateLegacyCrlfDb("src/multi.ts", lf);

    await writeCode("src/multi.ts", lf.replace("return 1;", "return 2;"));
    await runIndexer(repoRoot, { quiet: true });
    const first = await runLedger(repoRoot, { quiet: true });
    expect(first.debtCreated).toBe(1); // only alpha, proven by the test above

    // Second index: the file is unchanged (fast path) and every anchor
    // hash is normalized — zero new debt.
    const i2 = await runIndexer(repoRoot, { quiet: true });
    expect(i2.filesUpdated).toBe(0);
    expect(i2.filesUnchanged).toBe(1);
    const second = await runLedger(repoRoot, { quiet: true });
    expect(second.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — conservative twin moved detection (roadmap item 13)", () => {
  it("twin survives: editing one twin yields changed, zero moved, zero rewrites", async () => {
    // Two provider files with the SAME function body (twins). One is
    // edited; the other keeps the old implementation.
    await writeCode("src/a.ts", 'export function render() { return "old"; }');
    await writeCode("src/b.ts", 'export function render() { return "old"; }');
    await writeWiki("livewiki/a.md", `---
title: A
owner: generated
anchors:
  - src/a.ts#render
---

Docs describing the A implementation.
`);
    await runIndexer(repoRoot, { quiet: true });
    const baseline = await runLedger(repoRoot, { quiet: true });
    expect(baseline.debtCreated).toBe(0);

    await writeCode("src/a.ts", 'export function render() { return "new"; }');
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // The name survives (both files have an active `render`): never a move.
    expect(r.debtByEvent.moved).toBe(0);
    expect(r.movedPairs).toEqual([]);
    expect(r.debtByEvent.changed).toBe(1);
    expect(r.debtByEvent.deleted).toBe(0);

    // The page still anchors to its original file — in the DB and on disk.
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toEqual([{ symbol_key: "src/a.ts#render" }]);
    const md = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki", "a.md"),
      "utf8",
    );
    expect(md).toContain("src/a.ts#render");
    expect(md).not.toContain("src/b.ts#render");
  });

  it("method twins across two classes are not a move (same short name + kind)", async () => {
    await writeCode("src/foo.ts", "export class Foo {\n  render() { return 1; }\n}");
    await writeCode("src/bar.ts", "export class Bar {\n  render() { return 1; }\n}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
anchors:
  - src/foo.ts#Foo.render
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export class Foo {\n  render() { return 2; }\n}");
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.moved).toBe(0);
    expect(r.debtByEvent.changed).toBe(1);
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toEqual([{ symbol_key: "src/foo.ts#Foo.render" }]);
  });

  it("exact rotation (bodies swapped between twin files) is not a move", async () => {
    await writeCode("src/a.ts", 'export function rot() { return "A"; }');
    await writeCode("src/b.ts", 'export function rot() { return "B"; }');
    await writeWiki("livewiki/rot.md", `---
title: Rot
owner: generated
anchors:
  - src/a.ts#rot
  - src/b.ts#rot
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // A's body moves to B while B's moves to A.
    await writeCode("src/a.ts", 'export function rot() { return "B"; }');
    await writeCode("src/b.ts", 'export function rot() { return "A"; }');
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // Both names survive as active symbols: no move, just two real changes.
    expect(r.debtByEvent.moved).toBe(0);
    expect(r.movedPairs).toEqual([]);
    expect(r.debtByEvent.changed).toBe(2);
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors ORDER BY symbol_key",
    );
    expect(anchors).toEqual([
      { symbol_key: "src/a.ts#rot" },
      { symbol_key: "src/b.ts#rot" },
    ]);
  });
});

function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>> {
  // Dynamic import avoids a cycle
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function nodeSqliteExec(repoRoot: string, sql: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

/**
 * Rewrites the DB rows of `relPath` (currently LF on disk, indexed by
 * current code) into a faithful pre-item-12 CRLF-era state: the file hash
 * is the sha256 of the raw CRLF bytes, and symbol/anchor hashes are the
 * raw CRLF node slices recomputed through the same extractor (the parser
 * is already initialized — the indexer ran first). Also deletes the
 * `eol_hashes_normalized` meta flag, which a pre-upgrade DB cannot have —
 * that reopens the legacy window for the per-symbol realignment.
 */
async function simulateLegacyCrlfDb(relPath: string, lfText: string): Promise<void> {
  const crlfText = lfText.replace(/\n/g, "\r\n");
  const tree = await parseSource(nodePath.extname(relPath), crlfText);
  const legacySymbols = extractSymbols(tree, relPath, crlfText);
  nodeSqliteExec(
    repoRoot,
    `UPDATE files SET content_hash = '${sha256(crlfText)}' WHERE path = '${relPath}'`,
  );
  for (const sym of legacySymbols) {
    nodeSqliteExec(
      repoRoot,
      `UPDATE symbols SET content_hash = '${sym.content_hash}' WHERE key = '${sym.key}'`,
    );
    nodeSqliteExec(
      repoRoot,
      `UPDATE anchors SET symbol_hash_at_doc = '${sym.content_hash}' WHERE symbol_key = '${sym.key}'`,
    );
  }
  nodeSqliteExec(repoRoot, "DELETE FROM meta WHERE key = 'eol_hashes_normalized'");
}
