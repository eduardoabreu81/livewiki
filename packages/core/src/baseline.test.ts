import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  BASELINE_REL_PATH,
  BASELINE_SCHEMA_VERSION,
  collectBaselineDocumentationInventory,
  emptyBaseline,
  evaluateBaseline,
  extractionVersionForSymbolKey,
  parseBaseline,
  readBaseline,
  serializeBaseline,
  writeBaseline,
  type BaselineEntry,
  type BaselineSymbol,
} from "./baseline.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-baseline-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

function entry(overrides: Partial<BaselineEntry> = {}): BaselineEntry {
  return {
    wikiPath: "livewiki/core/db.md",
    symbolKey: "packages/core/src/db.ts#openIndex",
    hash: HASH_A,
    extraction: "ts-v1",
    provenance: "accepted",
    ...overrides,
  };
}

function symbol(overrides: Partial<BaselineSymbol> = {}): BaselineSymbol {
  return {
    key: "packages/core/src/db.ts#openIndex",
    name: "openIndex",
    content_hash: HASH_A,
    ...overrides,
  };
}

describe("baseline canonical format", () => {
  it("serializes one sorted compact entry per line", () => {
    const serialized = serializeBaseline({
      schemaVersion: BASELINE_SCHEMA_VERSION,
      entries: [
        entry({ symbolKey: "packages/core/src/db.ts#z", hash: HASH_B }),
        entry({ symbolKey: "packages/core/src/db.ts#a" }),
      ],
    });
    expect(serialized).toBe(
      "{\n" +
      "\"schemaVersion\":1,\n" +
      "\"entries\":[\n" +
      `${JSON.stringify(entry({ symbolKey: "packages/core/src/db.ts#a" }))},\n` +
      `${JSON.stringify(entry({ symbolKey: "packages/core/src/db.ts#z", hash: HASH_B }))}\n` +
      "]\n" +
      "}\n",
    );
  });

  it("accepts canonical bytes and rejects pretty-but-noncanonical JSON", () => {
    const canonical = serializeBaseline({ schemaVersion: 1, entries: [entry()] });
    expect(parseBaseline(canonical).state).toBe("available");

    const pretty = `${JSON.stringify(JSON.parse(canonical), null, 2)}\n`;
    const parsed = parseBaseline(pretty);
    expect(parsed.state).toBe("incompatible");
    expect(parsed.issues.map((issue) => issue.code)).toContain("noncanonical_serialization");
  });

  it("rejects duplicate composite identities", () => {
    const raw = serializeBaseline({ schemaVersion: 1, entries: [entry(), entry()] });
    const parsed = parseBaseline(raw);
    expect(parsed.state).toBe("incompatible");
    expect(parsed.issues.map((issue) => issue.code)).toContain("duplicate_entry");
  });

  it.each([
    ["unknown schema", { schemaVersion: 2, entries: [] }, "unsupported_schema"],
    ["unknown extraction", { schemaVersion: 1, entries: [entry({ extraction: "ts-v99" })] }, "unsupported_extraction"],
    ["uppercase hash", { schemaVersion: 1, entries: [entry({ hash: "A".repeat(64) })] }, "invalid_hash"],
    ["path traversal", { schemaVersion: 1, entries: [entry({ wikiPath: "livewiki/../x.md" })] }, "invalid_wiki_path"],
    ["backslash", { schemaVersion: 1, entries: [entry({ symbolKey: "src\\x.ts#x" })] }, "invalid_symbol_key"],
  ])("rejects %s", (_label, value, code) => {
    const parsed = parseBaseline(`${JSON.stringify(value)}\n`);
    expect(parsed.state).toBe("incompatible");
    expect(parsed.issues.map((issue) => issue.code)).toContain(code);
  });
});

describe("baseline disk I/O", () => {
  it("reports unavailable without a file", async () => {
    expect(await readBaseline(repoRoot)).toEqual({ state: "unavailable", issues: [] });
  });

  it("writes canonical bytes idempotently through safe-io", async () => {
    const baseline = { schemaVersion: 1, entries: [entry()] };
    expect(await writeBaseline(repoRoot, baseline)).toBe(true);
    expect(await writeBaseline(repoRoot, baseline)).toBe(false);
    expect(await readBaseline(repoRoot)).toEqual({
      state: "available",
      issues: [],
      baseline,
    });
    expect(await nodeFs.readFile(nodePath.join(repoRoot, BASELINE_REL_PATH), "utf8"))
      .toBe(serializeBaseline(baseline));
  });

  it("writes and reads an empty baseline", async () => {
    await writeBaseline(repoRoot, emptyBaseline());
    expect((await readBaseline(repoRoot)).state).toBe("available");
  });
});

describe("extraction versions", () => {
  it.each([
    ["src/a.ts#a", "ts-v1"],
    ["src/a.tsx#a", "tsx-v1"],
    ["src/a.jsx#a", "tsx-v1"],
    ["src/a.mjs#a", "js-v1"],
    ["src/a.py#a", "py-v1"],
    ["src/a.go#a", "go-v1"],
    ["src/a.rs#a", "rust-v1"],
    ["src/a.java#a", "java-v1"],
  ])("maps %s", (symbolKey, expected) => {
    expect(extractionVersionForSymbolKey(symbolKey)).toBe(expected);
  });

  it("returns null for a prose-tier source", () => {
    expect(extractionVersionForSymbolKey("README.md#intro")).toBeNull();
  });
});

describe("baseline health evaluation", () => {
  it("derives clean, changed, deleted, inferred, and unbaselined separately", () => {
    const baseline = {
      schemaVersion: 1,
      entries: [
        entry(),
        entry({ symbolKey: "src/changed.ts#changed", hash: HASH_A }),
        entry({ symbolKey: "src/deleted.ts#deleted", hash: HASH_A }),
        entry({
          symbolKey: "src/inferred.ts#inferred",
          hash: HASH_A,
          provenance: "inferred" as const,
        }),
      ],
    };
    const obligations = baseline.entries.map((item) => ({
      wikiPath: item.wikiPath,
      symbolKey: item.symbolKey,
      assignee: "agent" as const,
    }));
    obligations.push({
      wikiPath: "livewiki/core/db.md",
      symbolKey: "src/new.ts#newSymbol",
      assignee: "agent",
    });
    const health = evaluateBaseline(
      baseline,
      [
        symbol(),
        symbol({ key: "src/changed.ts#changed", name: "changed", content_hash: HASH_B }),
        symbol({ key: "src/inferred.ts#inferred", name: "inferred" }),
        symbol({ key: "src/new.ts#newSymbol", name: "newSymbol" }),
      ],
      { obligations, ownerByWikiPath: new Map(), malformedPages: [] },
    );
    expect(health.counts).toMatchObject({
      clean: 1,
      changed: 1,
      deleted: 1,
      inferred: 1,
      unbaselined: 1,
    });
  });

  it("proposes only a unique exact-hash move and excludes it from deleted count", () => {
    const movedEntry = entry({
      symbolKey: "src/old.ts#run",
      hash: HASH_A,
      extraction: "ts-v1",
    });
    const health = evaluateBaseline(
      { schemaVersion: 1, entries: [movedEntry] },
      [symbol({ key: "src/new.ts#run", name: "run", content_hash: HASH_A })],
      {
        obligations: [{
          wikiPath: movedEntry.wikiPath,
          symbolKey: movedEntry.symbolKey,
          assignee: "agent",
        }],
        ownerByWikiPath: new Map(),
        malformedPages: [],
      },
    );
    expect(health.moves).toEqual([{
      wikiPath: movedEntry.wikiPath,
      oldKey: "src/old.ts#run",
      newKey: "src/new.ts#run",
      hash: HASH_A,
      assignee: "agent",
    }]);
    expect(health.counts).toMatchObject({ moved: 1, deleted: 0 });
  });

  it("fails closed when an active homonym survives", () => {
    const movedEntry = entry({ symbolKey: "src/old.ts#run" });
    const health = evaluateBaseline(
      { schemaVersion: 1, entries: [movedEntry] },
      [
        symbol({ key: "src/new.ts#run", name: "run", content_hash: HASH_A }),
        symbol({ key: "src/provider.ts#run", name: "run", content_hash: HASH_B }),
      ],
      {
        obligations: [{
          wikiPath: movedEntry.wikiPath,
          symbolKey: movedEntry.symbolKey,
          assignee: "agent",
        }],
        ownerByWikiPath: new Map(),
        malformedPages: [],
      },
    );
    expect(health.moves).toEqual([]);
    expect(health.counts.deleted).toBe(1);
  });

  it("reports removal of a baseline anchor instead of silently dropping it", () => {
    const health = evaluateBaseline(
      { schemaVersion: 1, entries: [entry()] },
      [symbol()],
      { obligations: [], ownerByWikiPath: new Map(), malformedPages: [] },
    );
    expect(health.removedAnchors).toEqual([entry()]);
    expect(health.counts.removedAnchors).toBe(1);
  });
});

describe("documentation inventory", () => {
  it("collapses duplicate occurrences and promotes the obligation to human", async () => {
    await writeLivewikiFile(
      "livewiki/core/db.md",
      "---\n" +
      "title: DB\n" +
      "owner: generated\n" +
      "anchors:\n" +
      "  - src/db.ts#open\n" +
      "---\n\n" +
      "## Manual\n" +
      "<!-- lw:manual -->\n" +
      "<!-- lw:anchors src/db.ts#open -->\n" +
      "<!-- /lw:manual -->\n",
    );
    const inventory = await collectBaselineDocumentationInventory(repoRoot);
    expect(inventory.obligations).toEqual([{
      wikiPath: "livewiki/core/db.md",
      symbolKey: "src/db.ts#open",
      assignee: "human",
    }]);
  });

  it("skips invalid anchor keys instead of letting them reach source reads", async () => {
    await writeLivewikiFile(
      "livewiki/core/db.md",
      "---\n" +
      "title: DB\n" +
      "owner: generated\n" +
      "anchors:\n" +
      "  - ../../outside.ts#escape\n" +
      "  - src/db.ts#open\n" +
      "---\n\n" +
      "# DB\n",
    );
    const inventory = await collectBaselineDocumentationInventory(repoRoot);
    expect(inventory.obligations).toEqual([{
      wikiPath: "livewiki/core/db.md",
      symbolKey: "src/db.ts#open",
      assignee: "agent",
    }]);
  });

  it("reports an unparseable page instead of dropping it out of the inventory", async () => {
    await writeLivewikiFile(
      "livewiki/core/broken.md",
      "---\n" +
      "title: Broken\n" +
      "anchors:\n" +
      "  - src/db.ts#open\n",  // frontmatter never closed
    );
    await writeLivewikiFile(
      "livewiki/core/db.md",
      "---\n" +
      "title: DB\n" +
      "owner: generated\n" +
      "anchors:\n" +
      "  - src/db.ts#open\n" +
      "---\n\n" +
      "# DB\n",
    );

    const inventory = await collectBaselineDocumentationInventory(repoRoot);

    expect(inventory.malformedPages).toHaveLength(1);
    expect(inventory.malformedPages[0]?.wikiPath).toBe("livewiki/core/broken.md");
    expect(inventory.malformedPages[0]?.detail).toContain("Frontmatter parse error");
    // The readable page still produces its obligation.
    expect(inventory.obligations).toEqual([{
      wikiPath: "livewiki/core/db.md",
      symbolKey: "src/db.ts#open",
      assignee: "agent",
    }]);
    expect(
      evaluateBaseline(emptyBaseline(), [], inventory).malformedPages,
    ).toEqual(inventory.malformedPages);
  });
});

async function writeLivewikiFile(relPath: string, content: string): Promise<void> {
  const absolute = nodePath.join(repoRoot, relPath);
  await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
  await nodeFs.writeFile(absolute, content, "utf8");
}
