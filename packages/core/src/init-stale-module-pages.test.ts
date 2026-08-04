/**
 * init-stale-module-pages.test.ts — #24 (2026-08-04): generated-only stale
 * module-page cleanup (migration path for partition changes).
 *
 * Contracts covered:
 *   - a root-level page whose module is gone from the partition is removed
 *     ONLY when it parses and declares exactly `owner: generated`;
 *   - current module pages, human/mixed/ownerless/unparseable pages, and
 *     the deterministic root pages (quickstart/tasks/understanding) are
 *     preserved byte-for-byte;
 *   - dotfile module pages (hidden source files) are ordinary artifacts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { syncStaleModulePages } from "./init.js";
import type { Module } from "./modules.js";

function page(owner: string): string {
  return ["---", "title: X", `owner: ${owner}`, "---", "", "# X", "", "Body.", ""].join("\n");
}

const MODULES: Module[] = [
  { id: "core-src", paths: ["packages/core/src/a.ts"], symbolCount: 1 },
  { id: "core-src-tests", paths: ["packages/core/src/a.test.ts"], symbolCount: 1 },
];

describe("syncStaleModulePages (#24)", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-stale-pages-"));
    await nodeFs.mkdir(nodePath.join(root, "livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  async function write(rel: string, content: string): Promise<void> {
    await nodeFs.writeFile(nodePath.join(root, rel), content, "utf8");
  }

  async function exists(rel: string): Promise<boolean> {
    return nodeFs.access(nodePath.join(root, rel)).then(() => true).catch(() => false);
  }

  it("removes ONLY stale generated pages; everything else is preserved", async () => {
    await write("livewiki/core-src.md", page("generated")); // current module
    await write("livewiki/core-src-tests.md", page("generated")); // current test module
    await write("livewiki/core-src-01.md", page("generated")); // stale partition leftover
    await write("livewiki/core-src-13.md", page("generated")); // stale partition leftover
    await write("livewiki/old-thing.md", page("human")); // protected (rule #6)
    await write("livewiki/mixed-legacy.md", page("mixed")); // protected (rule #6)
    await write("livewiki/ownerless.md", "# No frontmatter at all\n");
    await write("livewiki/quickstart.md", page("generated"));
    await write("livewiki/tasks.md", page("generated"));
    await write("livewiki/understanding.md", page("generated"));

    const result = await syncStaleModulePages(root, MODULES);

    expect(result.removed).toEqual(["livewiki/core-src-01.md", "livewiki/core-src-13.md"]);
    expect(await exists("livewiki/core-src-01.md")).toBe(false);
    expect(await exists("livewiki/core-src-13.md")).toBe(false);
    for (const kept of [
      "livewiki/core-src.md",
      "livewiki/core-src-tests.md",
      "livewiki/old-thing.md",
      "livewiki/mixed-legacy.md",
      "livewiki/ownerless.md",
      "livewiki/quickstart.md",
      "livewiki/tasks.md",
      "livewiki/understanding.md",
    ]) {
      expect(await exists(kept), `${kept} must be preserved`).toBe(true);
    }
  });

  it("dotfile module pages are ordinary artifacts (kept when current, removed when stale)", async () => {
    await write("livewiki/.claude.md", page("generated"));
    const withDotModule: Module[] = [
      ...MODULES,
      { id: ".claude", paths: [".claude/thing.md"], symbolCount: 0 },
    ];
    const kept = await syncStaleModulePages(root, withDotModule);
    expect(kept.removed).toEqual([]);
    expect(await exists("livewiki/.claude.md")).toBe(true);

    const removed = await syncStaleModulePages(root, MODULES);
    expect(removed.removed).toEqual(["livewiki/.claude.md"]);
    expect(await exists("livewiki/.claude.md")).toBe(false);
  });

  it("is idempotent: a second run removes nothing", async () => {
    await write("livewiki/core-src-01.md", page("generated"));
    const first = await syncStaleModulePages(root, MODULES);
    expect(first.removed).toEqual(["livewiki/core-src-01.md"]);
    const second = await syncStaleModulePages(root, MODULES);
    expect(second.removed).toEqual([]);
  });
});
