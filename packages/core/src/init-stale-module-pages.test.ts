/**
 * init-stale-module-pages.test.ts — #29 (2026-08-08): generated-only stale
 * page-unit cleanup (migration path for partition changes). The keep-set
 * is RESOLVED PAGE PATHS, never module ids.
 *
 * Contracts covered:
 *   - a page whose unit is gone from the plan is removed ONLY when it
 *     parses and declares exactly `owner: generated`;
 *   - current unit pages (folder index + file pages), human/mixed/
 *     ownerless/unparseable pages, the deterministic root pages, and the
 *     reserved hubs are preserved byte-for-byte;
 *   - legacy root-level module pages (`livewiki/<id>.md`) are stale under
 *     #29 and removed;
 *   - emptied folder shells are removed with their last stale page.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { syncStaleModulePages } from "./init.js";

function page(owner: string): string {
  return ["---", "title: X", `owner: ${owner}`, "---", "", "# X", "", "Body.", ""].join("\n");
}

const KEEP = new Set([
  "livewiki/core-src/index.md",
  "livewiki/core-src/batch.md",
]);

describe("syncStaleModulePages (#29)", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-stale-pages-"));
    await nodeFs.mkdir(nodePath.join(root, "livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  async function write(rel: string, content: string): Promise<void> {
    await nodeFs.mkdir(nodePath.dirname(nodePath.join(root, rel)), { recursive: true });
    await nodeFs.writeFile(nodePath.join(root, rel), content, "utf8");
  }

  async function exists(rel: string): Promise<boolean> {
    return nodeFs.access(nodePath.join(root, rel)).then(() => true).catch(() => false);
  }

  it("removes ONLY stale generated pages; everything else is preserved", async () => {
    await write("livewiki/core-src/index.md", page("generated")); // current folder page
    await write("livewiki/core-src/batch.md", page("generated")); // current file page
    await write("livewiki/core-src/view.md", page("generated")); // stale file page
    await write("livewiki/core-src.md", page("generated")); // legacy root module page (stale under #29)
    await write("livewiki/old-src/index.md", page("generated")); // stale folder page
    await write("livewiki/old-src/a.md", page("generated")); // stale file page
    await write("livewiki/old-thing.md", page("human")); // protected (rule #6)
    await write("livewiki/mixed-legacy.md", page("mixed")); // protected (rule #6)
    await write("livewiki/ownerless.md", "# No frontmatter at all\n");
    await write("livewiki/quickstart.md", page("generated"));
    await write("livewiki/tasks.md", page("generated"));
    await write("livewiki/understanding.md", page("generated"));
    await write("livewiki/flows/some-flow.md", page("generated")); // reserved hub: untouched
    await write("livewiki/topics/some-topic.md", page("generated")); // reserved hub: untouched

    const result = await syncStaleModulePages(root, KEEP);

    expect(result.removed).toEqual([
      "livewiki/core-src.md",
      "livewiki/core-src/view.md",
      "livewiki/old-src/a.md",
      "livewiki/old-src/index.md",
    ]);
    for (const kept of [
      "livewiki/core-src/index.md",
      "livewiki/core-src/batch.md",
      "livewiki/old-thing.md",
      "livewiki/mixed-legacy.md",
      "livewiki/ownerless.md",
      "livewiki/quickstart.md",
      "livewiki/tasks.md",
      "livewiki/understanding.md",
      "livewiki/flows/some-flow.md",
      "livewiki/topics/some-topic.md",
    ]) {
      expect(await exists(kept), `${kept} must be preserved`).toBe(true);
    }
  });

  it("removes the emptied folder shell with its last stale page", async () => {
    await write("livewiki/old-src/index.md", page("generated"));
    await write("livewiki/old-src/a.md", page("generated"));
    const result = await syncStaleModulePages(root, KEEP);
    expect(result.removed.length).toBe(2);
    expect(await exists("livewiki/old-src")).toBe(false);
    // a folder that still holds a kept page survives
    await write("livewiki/core-src/index.md", page("generated"));
    await write("livewiki/core-src/stale.md", page("generated"));
    const second = await syncStaleModulePages(root, KEEP);
    expect(second.removed).toEqual(["livewiki/core-src/stale.md"]);
    expect(await exists("livewiki/core-src/index.md")).toBe(true);
  });

  it("is idempotent: a second run removes nothing", async () => {
    await write("livewiki/core-src-01.md", page("generated"));
    const first = await syncStaleModulePages(root, KEEP);
    expect(first.removed).toEqual(["livewiki/core-src-01.md"]);
    const second = await syncStaleModulePages(root, KEEP);
    expect(second.removed).toEqual([]);
  });
});
