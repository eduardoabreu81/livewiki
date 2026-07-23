import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  detectFlowCandidates,
  isTestPath,
  assignFlowKeySections,
  FLOW_MAX_PATH_LENGTH,
  FLOW_PER_ROOT_PATH_BUDGET,
  type FlowCandidate,
} from "./flows.js";
import type { Module, ModuleGraphEdge } from "./modules.js";

// Regression: flows.ts must not contain literal NUL (or other control) bytes
// in source — they break UTF-8 readers and tooling. Use `\0` escapes instead.
describe("flows.ts source hygiene", () => {
  it("contains no literal NUL bytes", () => {
    const source = readFileSync(new URL("./flows.ts", import.meta.url), "utf8");
    expect(source.includes("\0")).toBe(false);
  });
});

function mod(id: string, paths: string[], displayTitle?: string): Module {
  return { id, paths, symbolCount: 0, ...(displayTitle !== undefined ? { displayTitle } : {}) };
}

/** Deterministic Fisher–Yates shuffle (LCG) for input-reordering tests. */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V> {
  return new Map(shuffled(entries, seed));
}

describe("flows.detectFlowCandidates", () => {
  it("linear graph cli→core→db yields exactly one ordered candidate", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const symbolsByFile = new Map<string, string[]>([
      ["src/cli.ts", ["src/cli.ts#main"]],
      // Deliberately unsorted within the module + a key repeated in the db
      // module: output must be sorted per module and deduped across modules.
      ["src/core.ts", ["src/core.ts#run", "src/core.ts#helper"]],
      ["src/db.ts", ["src/db.ts#open", "src/core.ts#helper"]],
    ]);

    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile });
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.moduleIds).toEqual(["cli", "core", "db"]);
    expect(c.slug).toBe("cli-to-db");
    expect(c.titleSeed).toBe("cli to db");
    // R10.1 K two-pass fill: pass 1 reserves the entry (T1) and sink (T3)
    // keys, the K-b top-up and pass 2 pull the remaining product keys.
    expect(c.seedKeys).toEqual([
      "src/cli.ts#main",
      "src/db.ts#open",
      "src/core.ts#helper",
      "src/core.ts#run",
    ]);
    expect(c.entryKeys).toEqual(["src/cli.ts#main"]);
    expect(c.boundaryKeys).toEqual([]); // no resolvedEdges supplied
    expect(c.sinkKeys).toEqual(["src/db.ts#open"]);
    expect(c.otherProductKeys).toEqual(["src/core.ts#helper", "src/core.ts#run"]);
    expect(c.auxiliaryKeys).toEqual([]);
    expect(c.skip).toBeUndefined();
    expect(c.signals.entry).toContain("cli");
    expect(c.signals.entry).toContain("**/cli.*");
    expect(c.signals.persistence).toContain("db");
    expect(c.signals.persistence).toContain("**/db.*");
    expect(c.signals.external).toEqual([]);

    const capped = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile,
      flowMaxAnchors: 3,
    });
    expect(capped[0]!.seedKeys).toEqual([
      "src/cli.ts#main",
      "src/db.ts#open",
      "src/core.ts#helper",
    ]);
  });

  it("detects entry via pattern match when no module has in-degree 0", () => {
    const modules = [mod("www", ["bin/www.ts"]), mod("store", ["src/store/index.ts"])];
    const edges: ModuleGraphEdge[] = [
      { from: "www", to: "store" },
      { from: "store", to: "www" },
    ];
    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.moduleIds).toEqual(["www", "store"]);
    expect(candidates[0]!.signals.entry).toContain("www");
    expect(candidates[0]!.signals.entry).toContain("bin/**");
  });

  it("external boundary via externalImportsByFile; node: and relative specifiers never count", () => {
    const modules = [mod("app", ["src/app.ts"]), mod("sdk", ["src/sdk/client.ts"])];
    const edges: ModuleGraphEdge[] = [{ from: "app", to: "sdk" }];
    const externalImportsByFile = new Map<string, string[]>([
      [
        "src/sdk/client.ts",
        ["@modelcontextprotocol/sdk", "node:fs", "./helper", "../shared", ".local", "/abs/path"],
      ],
    ]);
    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.signals.external).toEqual(["@modelcontextprotocol/sdk"]);

    // Only node:/relative/absolute specifiers => no boundary => no candidate.
    const noBoundary = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile: new Map([["src/sdk/client.ts", ["node:fs", "./x", ".foo", "/abs"]]]),
    });
    expect(noBoundary).toEqual([]);

    // Absent map => no external signal at all.
    const absent = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(absent).toEqual([]);
  });

  it("resolved-internal occurrences are absent from external evidence (R10.1 J)", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const externalImportsByFile = new Map<string, string[]>([
      ["src/cli.ts", ["@acme/shared"]],
      ["src/core.ts", ["lodash"]],
    ]);
    const baseline = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
    });
    expect(baseline).toHaveLength(1);
    expect(baseline[0]!.signals.external).toEqual(["@acme/shared", "lodash"]);

    // cli's "@acme/shared" occurrence resolved internally: it disappears
    // from the evidence while core's "lodash" stays.
    const resolved = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
      resolvedEdges: [
        { fromFile: "src/cli.ts", toFile: "packages/shared/src/index.ts", source: "@acme/shared" },
      ],
    });
    expect(resolved[0]!.signals.external).toEqual(["lodash"]);
  });

  it("same specifier internal in file A, external in file B: counted only for B", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const externalImportsByFile = new Map<string, string[]>([
      ["src/cli.ts", ["@acme/shared"]],
      ["src/core.ts", ["@acme/shared"]],
    ]);
    // Only file B's (src/core.ts) occurrence lacks a resolved edge: the
    // specifier is still external evidence — a global specifier-level
    // filter would wrongly drop it.
    const partial = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
      resolvedEdges: [
        { fromFile: "src/cli.ts", toFile: "packages/shared/src/index.ts", source: "@acme/shared" },
      ],
    });
    expect(partial[0]!.signals.external).toEqual(["@acme/shared"]);

    // Both occurrences resolved internally: no external evidence at all.
    const all = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
      resolvedEdges: [
        { fromFile: "src/cli.ts", toFile: "packages/shared/src/index.ts", source: "@acme/shared" },
        { fromFile: "src/core.ts", toFile: "packages/shared/src/index.ts", source: "@acme/shared" },
      ],
    });
    expect(all[0]!.signals.external).toEqual([]);
  });

  it("returns zero candidates when no walk crosses a boundary module", () => {
    const modules = [mod("cli", ["src/cli.ts"]), mod("core", ["src/core.ts"])];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
    expect(detectFlowCandidates({ modules, edges, symbolsByFile: new Map() })).toEqual([]);
  });

  it("maxFlows 0 disables detection entirely", () => {
    const modules = [mod("cli", ["src/cli.ts"]), mod("db", ["src/db.ts"])];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "db" }];
    expect(
      detectFlowCandidates({ modules, edges, symbolsByFile: new Map(), maxFlows: 0 }),
    ).toEqual([]);
  });

  it("respects maxFlows with multiple candidates (slug asc breaks ties)", () => {
    const modules = [
      mod("a1", ["src/a1.ts"]),
      mod("a2", ["src/a2.ts"]),
      mod("a3", ["src/a3.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "a1", to: "db" },
      { from: "a2", to: "db" },
      { from: "a3", to: "db" },
    ];
    const all = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(all.map((c) => c.slug)).toEqual(["a1-to-db", "a2-to-db", "a3-to-db"]);

    const capped = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      maxFlows: 2,
    });
    expect(capped.map((c) => c.slug)).toEqual(["a1-to-db", "a2-to-db"]);
  });

  it("terminates on cycles and never repeats a module in a walk", () => {
    const modules = [
      mod("app", ["src/app.ts"]),
      mod("b", ["src/b.ts"]),
      mod("c", ["src/c.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "app", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "app" }, // back-edge: cycle
      { from: "c", to: "db" },
    ];
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.moduleIds).toEqual(["app", "b", "c", "db"]);
    expect(new Set(candidates[0]!.moduleIds).size).toBe(candidates[0]!.moduleIds.length);

    // Pure cycle, no boundary: terminates with zero candidates.
    const cyclic = detectFlowCandidates({
      modules: [mod("x", ["src/x.ts"]), mod("y", ["src/y.ts"])],
      edges: [
        { from: "x", to: "y" },
        { from: "y", to: "x" },
      ],
      symbolsByFile: new Map(),
    });
    expect(cyclic).toEqual([]);
  });

  it("drops a proper prefix path in favor of the longest qualified one", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("store", ["src/store/index.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "store" },
      { from: "store", to: "db" },
    ];
    // Both [cli,store] and [cli,store,db] qualify; only the longest survives.
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.moduleIds).toEqual(["cli", "store", "db"]);
  });

  it("keeps a single path per entry+sink pair (ties: lexicographically smallest)", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("m1", ["src/m1.ts"]),
      mod("m2", ["src/m2.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "m1" },
      { from: "cli", to: "m2" },
      { from: "m1", to: "db" },
      { from: "m2", to: "db" },
    ];
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.moduleIds).toEqual(["cli", "m1", "db"]);
  });

  it("is deterministic under input reordering (modules, edges, map insertion order)", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
      mod("store", ["src/store/index.ts"]),
      mod("extra", ["src/extra.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
      { from: "core", to: "store" },
      { from: "store", to: "db" },
      { from: "extra", to: "core" },
    ];
    const symbolEntries: Array<[string, string[]]> = [
      ["src/cli.ts", ["src/cli.ts#main"]],
      ["src/core.ts", ["src/core.ts#b", "src/core.ts#a"]],
      ["src/db.ts", ["src/db.ts#open"]],
      ["src/store/index.ts", ["src/store/index.ts#S"]],
      ["src/extra.ts", ["src/extra.ts#x"]],
    ];
    const externalEntries: Array<[string, string[]]> = [
      ["src/store/index.ts", ["some-sdk"]],
    ];

    const baseline = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      externalImportsByFile: new Map(externalEntries),
    });
    expect(baseline.map((c) => c.slug)).toEqual(["cli-to-db", "extra-to-db"]);
    expect(baseline[0]!.moduleIds).toEqual(["cli", "core", "store", "db"]);
    // R10.1 K fill order: entry key, sink key (store also matches the
    // persistence `**/store/**` default), then the remaining product keys.
    expect(baseline[0]!.seedKeys).toEqual([
      "src/cli.ts#main",
      "src/store/index.ts#S",
      "src/db.ts#open",
      "src/core.ts#a",
      "src/core.ts#b",
    ]);
    expect(baseline[0]!.signals.external).toEqual(["some-sdk"]);

    for (let seed = 1; seed <= 7; seed++) {
      const rerun = detectFlowCandidates({
        modules: shuffled(modules, seed),
        edges: shuffled(edges, seed + 100),
        symbolsByFile: shuffledMap(symbolEntries, seed + 200),
        externalImportsByFile: shuffledMap(externalEntries, seed + 300),
      });
      expect(rerun).toEqual(baseline);
    }
  });

  it("flowSignals replaces the default patterns per category", () => {
    // Entry override: in a pure cycle the only entry came from bin/**;
    // replacing entryPatterns removes it entirely.
    const cycleModules = [mod("www", ["bin/www.ts"]), mod("store", ["src/store/index.ts"])];
    const cycleEdges: ModuleGraphEdge[] = [
      { from: "www", to: "store" },
      { from: "store", to: "www" },
    ];
    const overridden = detectFlowCandidates({
      modules: cycleModules,
      edges: cycleEdges,
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: ["**/launch.ts"] },
    });
    expect(overridden).toEqual([]);

    // Persistence override: db no longer matches; core becomes the boundary.
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const noBoundary = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      flowSignals: { persistencePatterns: ["**/warehouse/**"] },
    });
    expect(noBoundary).toEqual([]);

    const coreBoundary = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      flowSignals: { persistencePatterns: ["**/core.*"] },
    });
    expect(coreBoundary).toHaveLength(1);
    expect(coreBoundary[0]!.signals.persistence).toContain("core");
    expect(coreBoundary[0]!.signals.persistence).toContain("**/core.*");
    expect(coreBoundary[0]!.signals.persistence).not.toContain("**/db.*");

    // Empty array disables the category.
    const disabled = detectFlowCandidates({
      modules: cycleModules,
      edges: cycleEdges,
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: [] },
    });
    expect(disabled).toEqual([]);
  });

  it("gitignore negations in flowSignals apply to the boolean and the evidence", () => {
    const cycleEdges: ModuleGraphEdge[] = [
      { from: "cli", to: "store" },
      { from: "store", to: "cli" },
    ];
    // Pure cycle: entry can only come from patterns. The negated-out
    // tests/cli.ts produces NO entry signal.
    const negated = detectFlowCandidates({
      modules: [mod("cli", ["tests/cli.ts"]), mod("store", ["src/store/index.ts"])],
      edges: cycleEdges,
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: ["**/cli.*", "!tests/**"] },
    });
    expect(negated).toEqual([]);

    // Same list, file outside the negation: the entry signal fires.
    const positive = detectFlowCandidates({
      modules: [mod("cli", ["src/cli.ts"]), mod("store", ["src/store/index.ts"])],
      edges: cycleEdges,
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: ["**/cli.*", "!tests/**"] },
    });
    expect(positive).toHaveLength(1);
    expect(positive[0]!.moduleIds).toEqual(["cli", "store"]);
    expect(positive[0]!.signals.entry).toContain("cli");
    expect(positive[0]!.signals.entry).toContain("**/cli.*");

    // A negated-out file contributes no evidence entry even when in-degree
    // makes the module an entry anyway.
    const byIndegree = detectFlowCandidates({
      modules: [mod("cli", ["tests/cli.ts"]), mod("store", ["src/store/index.ts"])],
      edges: [{ from: "cli", to: "store" }],
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: ["**/cli.*", "!tests/**"] },
    });
    expect(byIndegree).toHaveLength(1);
    expect(byIndegree[0]!.signals.entry).toContain("cli");
    expect(byIndegree[0]!.signals.entry).not.toContain("**/cli.*");

    // A negation-only list matches nothing.
    const negationOnly = detectFlowCandidates({
      modules: [mod("cli", ["src/cli.ts"]), mod("store", ["src/store/index.ts"])],
      edges: cycleEdges,
      symbolsByFile: new Map(),
      flowSignals: { entryPatterns: ["!**/cli.*"] },
    });
    expect(negationOnly).toEqual([]);
  });

  it("persistenceImportPatterns add a persistence channel over external specifiers", () => {
    const modules = [mod("cli", ["src/cli.ts"]), mod("core", ["src/core.ts"])];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
    const externalImportsByFile = new Map<string, string[]>([
      ["src/core.ts", ["@acme/sqlite", "lodash"]],
    ]);

    // Empty default: external imports alone never mark persistence.
    const baseline = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
    });
    expect(baseline).toHaveLength(1);
    expect(baseline[0]!.signals.persistence).toEqual([]);
    expect(baseline[0]!.signals.external).toEqual(["@acme/sqlite", "lodash"]);

    // G2: a matched specifier marks persistence; the matched pattern is
    // recorded as evidence exactly like the path-pattern channel.
    const withImportPatterns = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile,
      flowSignals: { persistenceImportPatterns: ["@acme/sqlite"] },
    });
    expect(withImportPatterns).toHaveLength(1);
    expect(withImportPatterns[0]!.signals.persistence).toContain("core");
    expect(withImportPatterns[0]!.signals.persistence).toContain("@acme/sqlite");
    // Per-category independence: the path-channel defaults still apply and
    // simply did not fire here.
    expect(withImportPatterns[0]!.signals.persistence).not.toContain("**/db.*");

    // Negation inside persistenceImportPatterns: the negated specifier
    // contributes no signal and no evidence entry.
    const negated = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile: new Map([["src/core.ts", ["@acme/internal"]]]),
      flowSignals: { persistenceImportPatterns: ["@acme/**", "!@acme/internal"] },
    });
    expect(negated).toHaveLength(1);
    expect(negated[0]!.signals.persistence).toEqual([]);

    // ...while a sibling specifier outside the negation still matches.
    const sibling = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      externalImportsByFile: new Map([["src/core.ts", ["@acme/db"]]]),
      flowSignals: { persistenceImportPatterns: ["@acme/**", "!@acme/internal"] },
    });
    expect(sibling).toHaveLength(1);
    expect(sibling[0]!.signals.persistence).toContain("core");
    expect(sibling[0]!.signals.persistence).toContain("@acme/**");
    expect(sibling[0]!.signals.persistence).not.toContain("!@acme/internal");
  });

  it("ranks a product-role-heavy path above a longer tooling path", () => {
    const modules = [
      mod("run", ["scripts/run.ts"]),
      mod("one", ["scripts/one.ts"]),
      mod("two", ["scripts/two.ts"]),
      mod("sdb", ["scripts/db.ts"]),
      mod("app", ["src/app.ts"]),
      mod("core", ["src/core.ts"]),
      mod("store", ["src/store/index.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "run", to: "one" },
      { from: "one", to: "two" },
      { from: "two", to: "sdb" },
      { from: "app", to: "core" },
      { from: "core", to: "store" },
    ];
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates.map((c) => c.slug)).toEqual(["app-to-store", "run-to-sdb"]);

    const onlyOne = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(),
      maxFlows: 1,
    });
    expect(onlyOne.map((c) => c.slug)).toEqual(["app-to-store"]);
  });

  it("disambiguates colliding slugs deterministically with -2, -3, ...", () => {
    const modules = [
      mod("Auth", ["src/Auth.ts"]),
      mod("auth", ["src/auth.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "Auth", to: "db" },
      { from: "auth", to: "db" },
    ];
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates).toHaveLength(2);
    const slugs = candidates.map((c) => c.slug).sort();
    expect(slugs).toEqual(["auth-to-db", "auth-to-db-2"]);
  });

  it("seeds the title from displayTitle when present", () => {
    const modules = [
      mod("cli", ["src/cli.ts"], "CLI Front"),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "db" }];
    const candidates = detectFlowCandidates({ modules, edges, symbolsByFile: new Map() });
    expect(candidates[0]!.titleSeed).toBe("CLI Front to db");
  });

  it("a root beyond the per-root budget does not prevent other roots' participation (R10.1 H1)", () => {
    // Binary DAG: 7 levels of 2 nodes below entry "a" => 255 simple paths
    // from "a" alone — beyond FLOW_PER_ROOT_PATH_BUDGET, so "a" is
    // truncated. Entry "b" still gets its own budget and participates;
    // a single global cap (the old behavior) could be consumed entirely
    // by the first root.
    expect(FLOW_PER_ROOT_PATH_BUDGET).toBe(64);
    const levelIds = [
      ["n1", "n2"],
      ["n3", "n4"],
      ["n5", "n6"],
      ["n7", "n8"],
      ["n9", "n10"],
      ["n11", "n12"],
      ["n13", "n14"],
    ];
    const modules = [
      mod("a", ["src/a.ts"]),
      mod("b", ["src/b.ts"]),
      mod("dbb", ["src/dbb.ts"]),
      ...levelIds.flat().map((id) => mod(id, [`src/${id}.ts`])),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "a", to: "n1" },
      { from: "a", to: "n2" },
      { from: "b", to: "dbb" },
    ];
    for (let i = 0; i < levelIds.length - 1; i++) {
      for (const from of levelIds[i]!) {
        for (const to of levelIds[i + 1]!) {
          edges.push({ from, to });
        }
      }
    }
    const symbolsByFile = new Map<string, string[]>([
      ["src/b.ts", ["src/b.ts#main", "src/b.ts#aux"]],
      ["src/dbb.ts", ["src/dbb.ts#open"]],
    ]);
    const externalImportsByFile = new Map<string, string[]>(
      modules.map((m) => [m.paths[0]!, ["some-pkg"]]),
    );

    const baseline = detectFlowCandidates({ modules, edges, symbolsByFile, externalImportsByFile });
    // Only maximal (length-capped) walks survive prefix dropping, one per
    // entry+sink pair; "b" contributes its own candidate (runnable: pass 1
    // plus the K-b top-up reaches 3 distinct keys).
    expect(baseline.map((c) => c.slug)).toEqual(["a-to-n13", "a-to-n14", "b-to-dbb"]);
    expect(baseline[2]!.moduleIds).toEqual(["b", "dbb"]);
    expect(baseline[2]!.skip).toBeUndefined();
    for (const candidate of baseline.slice(0, 2)) {
      expect(candidate.moduleIds).toHaveLength(FLOW_MAX_PATH_LENGTH);
      expect(new Set(candidate.moduleIds).size).toBe(candidate.moduleIds.length);
    }

    const rerun: FlowCandidate[] = detectFlowCandidates({
      modules: shuffled(modules, 42),
      edges: shuffled(edges, 43),
      symbolsByFile: shuffledMap([...symbolsByFile.entries()], 44),
      externalImportsByFile: shuffledMap([...externalImportsByFile.entries()], 45),
    });
    expect(rerun).toEqual(baseline);
  });
});

describe("flows.isTestPath (R10.1 K)", () => {
  it("detects .test./.spec. filenames and __tests__ segments deterministically", () => {
    expect(isTestPath("src/foo.test.ts")).toBe(true);
    expect(isTestPath("src/foo.spec.tsx")).toBe(true);
    expect(isTestPath("src/__tests__/foo.ts")).toBe(true);
    expect(isTestPath("packages/a/__tests__/unit/foo.py")).toBe(true);
    expect(isTestPath("src/foo.ts")).toBe(false);
    expect(isTestPath("src/contest.ts")).toBe(false); // no ".test." infix
    expect(isTestPath("src/latest/foo.ts")).toBe(false); // "latest" is not a "__tests__" segment
  });

  it("detects Python (pytest/unittest) and Go test-file naming conventions", () => {
    expect(isTestPath("test/services/test_llm.py")).toBe(true);
    expect(isTestPath("test_llm.py")).toBe(true);
    expect(isTestPath("services/llm_test.py")).toBe(true);
    expect(isTestPath("services/llm_test.go")).toBe(true);
    // Not a match: "test_" must be a whole-basename prefix, not a substring.
    expect(isTestPath("src/latest_report.py")).toBe(false);
    expect(isTestPath("src/contest_data.py")).toBe(false);
    expect(isTestPath("src/llm.py")).toBe(false);
    // A bare "test"/"tests" directory segment is deliberately NOT matched —
    // only the filename convention is (see the fix's own comment).
    expect(isTestPath("test/services/llm.py")).toBe(false);
    expect(isTestPath("tests/helpers.py")).toBe(false);
  });
});

describe("flows.detectFlowCandidates — seed tiers and groups (R10.1 K)", () => {
  it("R10-shaped repo: entry keys precede test helpers; groups populated; union = closed list", () => {
    const modules = [
      mod("cli", ["src/cli.test.ts", "src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const symbolEntries: Array<[string, string[]]> = [
      ["src/cli.test.ts", ["src/cli.test.ts#setup", "src/cli.test.ts#helperFn"]],
      ["src/cli.ts", ["src/cli.ts#run"]],
      ["src/core.ts", ["src/core.ts#process"]],
      ["src/db.ts", ["src/db.ts#open"]],
    ];
    const resolvedEdges = [{ fromFile: "src/cli.ts", toFile: "src/core.ts", source: "../core" }];

    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
    });
    expect(candidates).toHaveLength(1);
    const c = candidates[0]!;
    expect(c.skip).toBeUndefined();
    // Product entry/crossing evidence first; test helpers last (T5).
    expect(c.seedKeys).toEqual([
      "src/cli.ts#run",
      "src/db.ts#open",
      "src/core.ts#process",
      "src/cli.test.ts#helperFn",
      "src/cli.test.ts#setup",
    ]);
    expect(c.entryKeys).toEqual(["src/cli.ts#run"]);
    expect(c.boundaryKeys).toEqual(["src/cli.ts#run", "src/core.ts#process"]);
    expect(c.sinkKeys).toEqual(["src/db.ts#open"]);
    expect(c.otherProductKeys).toEqual([]);
    expect(c.auxiliaryKeys).toEqual(["src/cli.test.ts#helperFn", "src/cli.test.ts#setup"]);
    // The union of the five groups is the closed list (upper bound, unchanged).
    const union = [
      ...c.entryKeys,
      ...c.boundaryKeys,
      ...c.sinkKeys,
      ...c.otherProductKeys,
      ...c.auxiliaryKeys,
    ];
    expect([...new Set(union)].sort()).toEqual([...c.seedKeys].sort());

    // Stable under shuffled inputs.
    for (let seed = 1; seed <= 4; seed++) {
      const rerun = detectFlowCandidates({
        modules: shuffled(modules, seed),
        edges: shuffled(edges, seed + 50),
        symbolsByFile: shuffledMap(symbolEntries, seed + 90),
        resolvedEdges: shuffled(resolvedEdges, seed + 130),
      });
      expect(rerun).toEqual(candidates);
    }
  });

  it("T1 indegree fallback: first-edge origin file's symbols; deterministic fallback without edges", () => {
    const modules = [
      mod("start", ["src/helper.ts", "src/start.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "start", to: "core" },
      { from: "core", to: "db" },
    ];
    const symbolsByFile = new Map<string, string[]>([
      ["src/start.ts", ["src/start.ts#boot"]],
      ["src/helper.ts", ["src/helper.ts#aid"]],
      ["src/core.ts", ["src/core.ts#work"]],
      ["src/db.ts", ["src/db.ts#open"]],
    ]);

    // Root qualifies by in-degree 0 only (no entry-pattern match): the
    // walk's first ResolvedImportEdge picks the origin file's symbols.
    const withEdge = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile,
      resolvedEdges: [{ fromFile: "src/start.ts", toFile: "src/core.ts", source: "./core" }],
    });
    expect(withEdge[0]!.entryKeys).toEqual(["src/start.ts#boot"]);
    expect(withEdge[0]!.otherProductKeys).toContain("src/helper.ts#aid");

    // No resolved edges: deterministic fallback = the root's
    // non-auxiliary files (path order).
    const withoutEdges = detectFlowCandidates({ modules, edges, symbolsByFile });
    expect(withoutEdges[0]!.entryKeys).toEqual(["src/helper.ts#aid", "src/start.ts#boot"]);

    // An auxiliary first-edge origin falls back to the non-auxiliary files.
    const auxOrigin = detectFlowCandidates({
      modules: [
        mod("start", ["src/boot.test.ts", "src/start.ts"]),
        mod("core", ["src/core.ts"]),
        mod("db", ["src/db.ts"]),
      ],
      edges,
      symbolsByFile: new Map<string, string[]>([
        ["src/boot.test.ts", ["src/boot.test.ts#t"]],
        ["src/start.ts", ["src/start.ts#boot"]],
        ["src/core.ts", ["src/core.ts#work"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
      resolvedEdges: [{ fromFile: "src/boot.test.ts", toFile: "src/core.ts", source: "./core" }],
    });
    expect(auxOrigin[0]!.entryKeys).toEqual(["src/start.ts#boot"]);
  });

  it("pass 1 reserves one key per non-empty T1/T2/T3 group under a small cap", () => {
    const modules = [
      mod("cli", ["cli/cli.ts", "cli/run.ts"]),
      mod("core", ["core/db.ts", "core/proc.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
    const symbolsByFile = new Map<string, string[]>([
      ["cli/cli.ts", ["cli/cli.ts#e1", "cli/cli.ts#e2"]],
      ["cli/run.ts", ["cli/run.ts#r1"]],
      ["core/proc.ts", ["core/proc.ts#p1"]],
      ["core/db.ts", ["core/db.ts#close", "core/db.ts#open"]],
    ]);
    const resolvedEdges = [
      { fromFile: "cli/run.ts", toFile: "core/proc.ts", source: "../core/proc" },
    ];

    const c = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile,
      resolvedEdges,
      flowMaxAnchors: 4,
    })[0]!;
    expect(c.skip).toBeUndefined();
    expect(c.entryKeys).toEqual(["cli/cli.ts#e1", "cli/cli.ts#e2"]);
    // Revision 4: groups are capped to the closed list — p1/open were
    // truncated from seedKeys, so they leave their groups as well.
    expect(c.boundaryKeys).toEqual(["cli/run.ts#r1"]);
    expect(c.sinkKeys).toEqual(["core/db.ts#close"]);
    // Pass 1: e1 (T1), r1 (T2), close (T3); pass 2 fills to the cap.
    expect(c.seedKeys).toEqual([
      "cli/cli.ts#e1",
      "cli/run.ts#r1",
      "core/db.ts#close",
      "cli/cli.ts#e2",
    ]);
    // Each semantic group is represented even with cap 4 < total key count.
    expect(c.seedKeys.some((k) => c.entryKeys.includes(k))).toBe(true);
    expect(c.seedKeys.some((k) => c.boundaryKeys.includes(k))).toBe(true);
    expect(c.seedKeys.some((k) => c.sinkKeys.includes(k))).toBe(true);
  });

  it("groups are capped to the closed list: union === seedKeys, reservation keys survive", () => {
    const modules = [
      mod("cli", ["cli/cli.ts", "cli/run.ts"]),
      mod("core", ["core/db.ts", "core/proc.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
    const symbolsByFile = new Map<string, string[]>([
      ["cli/cli.ts", ["cli/cli.ts#e1", "cli/cli.ts#e2"]],
      ["cli/run.ts", ["cli/run.ts#r1"]],
      ["core/proc.ts", ["core/proc.ts#p1"]],
      ["core/db.ts", ["core/db.ts#close", "core/db.ts#open"]],
    ]);
    const resolvedEdges = [
      { fromFile: "cli/run.ts", toFile: "core/proc.ts", source: "../core/proc" },
    ];

    // The raw semantic groups hold 6 distinct keys; the cap keeps 4.
    const c = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile,
      resolvedEdges,
      flowMaxAnchors: 4,
    })[0]!;
    expect(c.skip).toBeUndefined();
    expect(c.seedKeys).toEqual([
      "cli/cli.ts#e1",
      "cli/run.ts#r1",
      "core/db.ts#close",
      "cli/cli.ts#e2",
    ]);
    const groups = [c.entryKeys, c.boundaryKeys, c.sinkKeys, c.otherProductKeys, c.auxiliaryKeys];
    // Every group key is inside the closed list...
    const seedSet = new Set(c.seedKeys);
    for (const group of groups) {
      for (const key of group) expect(seedSet.has(key)).toBe(true);
    }
    // ...and the union of the five groups IS the closed list, exactly.
    const union = new Set(groups.flat());
    expect([...union].sort()).toEqual([...c.seedKeys].sort());
    // Pass-1 reservation keys are never truncated away by pass 2: each
    // non-empty semantic group keeps its reserved key.
    expect(c.entryKeys).toContain("cli/cli.ts#e1");
    expect(c.boundaryKeys).toContain("cli/run.ts#r1");
    expect(c.sinkKeys).toContain("core/db.ts#close");
  });

  it("K-b top-up draws from the remaining pool (T1→T5): a third key in an already-reserved group does not skip", () => {
    // a1 holds T1 AND T2 (reserved for entry, covering boundary); open
    // holds T3. The ONLY available third key is a2 — another T1 key of
    // the same module, i.e. inside the ALREADY-RESERVED entry group. A
    // strictly-T4/T5 top-up would wrongly skip this real 3-key flow
    // (contract revision 4); the remaining-pool T1→T5 top-up must not.
    const c = detectFlowCandidates({
      modules: [
        mod("cli", ["src/cli.ts"]),
        mod("core", ["src/core.ts"]),
        mod("db", ["src/db.ts"]),
      ],
      edges: [
        { from: "cli", to: "core" },
        { from: "core", to: "db" },
      ],
      symbolsByFile: new Map<string, string[]>([
        ["src/cli.ts", ["src/cli.ts#a1", "src/cli.ts#a2"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
      resolvedEdges: [{ fromFile: "src/cli.ts", toFile: "src/core.ts", source: "../core" }],
    })[0]!;
    expect(c.skip).toBeUndefined();
    expect(c.seedKeys).toEqual(["src/cli.ts#a1", "src/db.ts#open", "src/cli.ts#a2"]);
    // Groups are capped to the closed list: entry keeps both cli keys.
    expect(c.entryKeys).toEqual(["src/cli.ts#a1", "src/cli.ts#a2"]);
    expect(c.sinkKeys).toEqual(["src/db.ts#open"]);
  });

  it("K-a skip: the cap cannot fit the mandatory group reservation", () => {
    const modules = [
      mod("cli", ["cli/cli.ts", "cli/run.ts"]),
      mod("core", ["core/db.ts", "core/proc.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
    const symbolsByFile = new Map<string, string[]>([
      ["cli/cli.ts", ["cli/cli.ts#e1"]],
      ["cli/run.ts", ["cli/run.ts#r1"]],
      ["core/proc.ts", ["core/proc.ts#p1"]],
      ["core/db.ts", ["core/db.ts#open"]],
    ]);
    const resolvedEdges = [
      { fromFile: "cli/run.ts", toFile: "core/proc.ts", source: "../core/proc" },
    ];

    const c = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile,
      resolvedEdges,
      flowMaxAnchors: 2,
    })[0]!;
    // Three non-empty groups need 3 distinct reserved keys > cap 2.
    expect(c.skip).toEqual(expect.objectContaining({ code: "insufficient_anchor_capacity" }));
    expect(c.skip!.message).toContain("flowMaxAnchors (2)");
    expect(c.seedKeys).toHaveLength(3); // the unfulfillable reservation
  });

  it("K-b skip: flowMaxAnchors 2 can never cover the three required sections", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const symbolsByFile = new Map<string, string[]>([
      ["src/cli.ts", ["src/cli.ts#main"]],
      ["src/core.ts", ["src/core.ts#work"]],
      ["src/db.ts", ["src/db.ts#open"]],
    ]);

    const c = detectFlowCandidates({ modules, edges, symbolsByFile, flowMaxAnchors: 2 })[0]!;
    // The reservation (T1 main + T3 open) fits the cap, so this is the
    // K-b guard (not K-a): 3 distinct keys are impossible within cap 2.
    expect(c.skip).toEqual(
      expect.objectContaining({ code: "insufficient_section_anchor_coverage" }),
    );
    expect(c.seedKeys).toEqual(["src/cli.ts#main", "src/db.ts#open"]);
  });

  it("a key holding two roles counts once toward the 3-distinct minimum", () => {
    const modules = [
      mod("cli", ["src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const resolvedEdges = [
      { fromFile: "src/cli.ts", toFile: "src/core.ts", source: "../core" },
      { fromFile: "src/core.ts", toFile: "src/db.ts", source: "../db" },
    ];

    // `a` holds T1 AND T2: pass 1 reserves it once (2 distinct keys for 3
    // groups) and the K-b top-up pulls the next tier key.
    const ok = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map<string, string[]>([
        ["src/cli.ts", ["src/cli.ts#a"]],
        ["src/core.ts", ["src/core.ts#c"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
      resolvedEdges,
    })[0]!;
    expect(ok.skip).toBeUndefined();
    expect(ok.seedKeys).toEqual(["src/cli.ts#a", "src/db.ts#open", "src/core.ts#c"]);

    // Same shape, nothing left to top up with: 3 role-memberships
    // (a∈T1, a∈T2, open∈T3) are only 2 distinct keys → skip.
    const short = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map<string, string[]>([
        ["src/cli.ts", ["src/cli.ts#a"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
      resolvedEdges,
    })[0]!;
    expect(short.skip).toEqual(
      expect.objectContaining({ code: "insufficient_section_anchor_coverage" }),
    );
    expect(short.seedKeys).toEqual(["src/cli.ts#a", "src/db.ts#open"]);
  });

  it("K-b top-up pulls from T4 then T5 after pass 1", () => {
    const c = detectFlowCandidates({
      modules: [
        mod("cli", ["src/cli.ts", "src/util.ts"]),
        mod("aux", ["src/helper.test.ts"]),
        mod("db", ["src/db.ts"]),
      ],
      edges: [
        { from: "cli", to: "aux" },
        { from: "aux", to: "db" },
      ],
      symbolsByFile: new Map<string, string[]>([
        ["src/cli.ts", ["src/cli.ts#a"]],
        ["src/util.ts", ["src/util.ts#u"]],
        ["src/helper.test.ts", ["src/helper.test.ts#t1"]],
        ["src/db.ts", ["src/db.ts#s"]],
      ]),
    })[0]!;
    expect(c.skip).toBeUndefined();
    expect(c.otherProductKeys).toEqual(["src/util.ts#u"]);
    expect(c.auxiliaryKeys).toEqual(["src/helper.test.ts#t1"]);
    // Pass 1 reserves T1/T3 only; the top-up to 3 takes the T4 key, and
    // pass 2 appends the T5 test key last.
    expect(c.seedKeys).toEqual([
      "src/cli.ts#a",
      "src/db.ts#s",
      "src/util.ts#u",
      "src/helper.test.ts#t1",
    ]);
  });

  it("a module made entirely of test files never qualifies as a walk root (2026-07-23 fix)", () => {
    // Before the fix, a module with zero indegree and NO product file
    // qualified as an entry root anyway (indegree 0 says nothing about
    // whether a module is test-only or a real entry point), and its test
    // methods were admitted straight into entryKeys. Confirmed via a real
    // E2E run that this produces an unusable flow (entry tier made of
    // unittest test methods, zero real product keys to fill the other
    // sections) — the module must not be a root at all now.
    const testEntry = detectFlowCandidates({
      modules: [mod("cli", ["tests/cli.test.ts"]), mod("db", ["src/db.ts"])],
      edges: [{ from: "cli", to: "db" }],
      symbolsByFile: new Map<string, string[]>([
        ["tests/cli.test.ts", ["tests/cli.test.ts#t1", "tests/cli.test.ts#t2"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
    });
    expect(testEntry).toEqual([]);
  });

  it("a mixed module (test + product files) still qualifies as a walk root", () => {
    // Only an ALL-test-files module is excluded — one real product file
    // is enough to keep the module eligible (the R10-shaped test above
    // already covers this via "cli": ["src/cli.test.ts", "src/cli.ts"]).
    const mixedEntry = detectFlowCandidates({
      modules: [mod("cli", ["tests/cli.test.ts", "src/cli.ts"]), mod("db", ["src/db.ts"])],
      edges: [{ from: "cli", to: "db" }],
      symbolsByFile: new Map<string, string[]>([
        ["tests/cli.test.ts", ["tests/cli.test.ts#t1"]],
        ["src/cli.ts", ["src/cli.ts#run"]],
        ["src/db.ts", ["src/db.ts#open"]],
      ]),
    })[0]!;
    expect(mixedEntry.skip).toBeUndefined();
    expect(mixedEntry.entryKeys).toEqual(["src/cli.ts#run"]);
  });
});

describe("flows.assignFlowKeySections", () => {
  it("R10-shaped repo: entry -> purpose, sink -> failure-and-recovery, everything else -> ordered-flow", () => {
    const modules = [
      mod("cli", ["src/cli.test.ts", "src/cli.ts"]),
      mod("core", ["src/core.ts"]),
      mod("db", ["src/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "cli", to: "core" },
      { from: "core", to: "db" },
    ];
    const symbolEntries: Array<[string, string[]]> = [
      ["src/cli.test.ts", ["src/cli.test.ts#setup", "src/cli.test.ts#helperFn"]],
      ["src/cli.ts", ["src/cli.ts#run"]],
      ["src/core.ts", ["src/core.ts#process"]],
      ["src/db.ts", ["src/db.ts#open"]],
    ];
    const resolvedEdges = [{ fromFile: "src/cli.ts", toFile: "src/core.ts", source: "../core" }];

    const c = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
    })[0]!;
    const map = assignFlowKeySections(c);

    // Total over seedKeys — every closed-list key has exactly one section.
    expect([...map.keys()].sort()).toEqual([...c.seedKeys].sort());

    // "src/cli.ts#run" is both entryKeys (T1) and boundaryKeys (T2): T1
    // priority wins, so it resolves to "purpose", not "ordered-flow".
    expect(map.get("src/cli.ts#run")).toBe("purpose");
    expect(map.get("src/db.ts#open")).toBe("failure-and-recovery");
    expect(map.get("src/core.ts#process")).toBe("ordered-flow");
    expect(map.get("src/cli.test.ts#helperFn")).toBe("ordered-flow");
    expect(map.get("src/cli.test.ts#setup")).toBe("ordered-flow");
  });

  it("a key in both T1 and T3 resolves to purpose (T1 beats T3 in priority)", () => {
    // Single-module walk where the only module is simultaneously entry
    // and sink: its keys land in both entryKeys and sinkKeys.
    const modules = [mod("solo", ["src/solo.ts"])];
    const c: FlowCandidate = {
      slug: "solo",
      titleSeed: "solo",
      moduleIds: ["solo"],
      seedKeys: ["src/solo.ts#a"],
      entryKeys: ["src/solo.ts#a"],
      boundaryKeys: [],
      sinkKeys: ["src/solo.ts#a"],
      otherProductKeys: [],
      auxiliaryKeys: [],
      signals: { entry: [], persistence: [], external: [] },
    };
    expect(modules.length).toBe(1); // fixture sanity, not exercised via detectFlowCandidates
    expect(assignFlowKeySections(c).get("src/solo.ts#a")).toBe("purpose");
  });
});

describe("flows.detectFlowCandidates — centrality ranking (R10.1 H)", () => {
  it("a late-root short candidate beats an early longer peripheral path; deterministic under shuffles", () => {
    // a1 → x → y → z → sink3 is the longer (5-module) peripheral path and
    // enumerates FIRST (a1 < e1); e1's two shorter candidates share their
    // hub with 2 qualified walks. Equal product-role count (3) ⇒
    // centrality decides, and the peripheral path ranks last.
    const modules = [
      mod("a1", ["src/start.ts"]),
      mod("x", ["scripts/x.ts"]),
      mod("y", ["scripts/y.ts"]),
      mod("z", ["src/z.ts"]),
      mod("sink3", ["src/sink3/db.ts"]),
      mod("e1", ["src/e1.ts"]),
      mod("hub", ["src/hub.ts"]),
      mod("s1", ["src/s1/db.ts"]),
      mod("s2", ["src/s2/db.ts"]),
    ];
    const edges: ModuleGraphEdge[] = [
      { from: "a1", to: "x" },
      { from: "x", to: "y" },
      { from: "y", to: "z" },
      { from: "z", to: "sink3" },
      { from: "e1", to: "hub" },
      { from: "hub", to: "s1" },
      { from: "hub", to: "s2" },
    ];
    const symbolEntries: Array<[string, string[]]> = [
      ["src/start.ts", ["src/start.ts#st"]],
      ["src/z.ts", ["src/z.ts#zz"]],
      ["src/sink3/db.ts", ["src/sink3/db.ts#d3"]],
      ["src/e1.ts", ["src/e1.ts#ee"]],
      ["src/hub.ts", ["src/hub.ts#hh"]],
      ["src/s1/db.ts", ["src/s1/db.ts#d1"]],
      ["src/s2/db.ts", ["src/s2/db.ts#d2"]],
    ];

    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
    });
    expect(candidates.map((c) => c.slug)).toEqual(["e1-to-s1", "e1-to-s2", "a1-to-sink3"]);
    expect(candidates[2]!.moduleIds).toHaveLength(5);

    // maxFlows applies only after ranking.
    const capped = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      maxFlows: 2,
    });
    expect(capped.map((c) => c.slug)).toEqual(["e1-to-s1", "e1-to-s2"]);

    for (let seed = 3; seed <= 6; seed++) {
      const rerun = detectFlowCandidates({
        modules: shuffled(modules, seed),
        edges: shuffled(edges, seed + 40),
        symbolsByFile: shuffledMap(symbolEntries, seed + 80),
      });
      expect(rerun).toEqual(candidates);
    }
  });
});

// Priority-0 Phase 3: resolvedCrossModuleCallees only re-orders WITHIN the
// T2 (crossing) group when 2+ keys tie on role/product/module — it must
// never change group membership, seedKeys size, or behavior when absent.
describe("detectFlowCandidates — resolvedCrossModuleCallees (symbol call graph, additive)", () => {
  // Sink file matches the DEFAULT persistence pattern "**/db.*" so the walk
  // crosses a boundary without needing any extra signal config.
  const modules = [mod("cli", ["src/cli.ts"]), mod("core", ["src/db.ts"])];
  const edges: ModuleGraphEdge[] = [{ from: "cli", to: "core" }];
  const symbolEntries: Array<[string, string[]]> = [
    ["src/cli.ts", ["src/cli.ts#altRun", "src/cli.ts#run"]],
    ["src/db.ts", ["src/db.ts#process"]],
  ];
  const resolvedEdges = [{ fromFile: "src/cli.ts", toFile: "src/db.ts", source: "../db" }];

  it("without the option: alphabetical order within the tied T2 module (unchanged baseline)", () => {
    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
    });
    expect(candidates[0]!.boundaryKeys).toEqual([
      "src/cli.ts#altRun",
      "src/cli.ts#run",
      "src/db.ts#process",
    ]);
  });

  it("promotes the key with a proven resolved cross-module call ahead of its alphabetical tie", () => {
    const candidates = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
      resolvedCrossModuleCallees: new Set(["src/cli.ts#run"]),
    });
    expect(candidates[0]!.boundaryKeys).toEqual([
      "src/cli.ts#run",
      "src/cli.ts#altRun",
      "src/db.ts#process",
    ]);
  });

  it("never changes seedKeys size or group membership, only order", () => {
    const withoutSignal = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
    })[0]!;
    const withSignal = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
      resolvedCrossModuleCallees: new Set(["src/cli.ts#run"]),
    })[0]!;
    expect(withSignal.seedKeys.length).toBe(withoutSignal.seedKeys.length);
    expect([...withSignal.boundaryKeys].sort()).toEqual([...withoutSignal.boundaryKeys].sort());
    expect(withSignal.entryKeys).toEqual(withoutSignal.entryKeys);
    expect(withSignal.sinkKeys).toEqual(withoutSignal.sinkKeys);
  });

  it("has no effect when the set does not name any candidate key", () => {
    const withoutSignal = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
    })[0]!;
    const withUnrelatedSignal = detectFlowCandidates({
      modules,
      edges,
      symbolsByFile: new Map(symbolEntries),
      resolvedEdges,
      resolvedCrossModuleCallees: new Set(["some/other.ts#unrelated"]),
    })[0]!;
    expect(withUnrelatedSignal).toEqual(withoutSignal);
  });

  it("has no effect on T1 (entry) or T3 (sink) groups even when they tie", () => {
    const entryTieModules = [mod("cli", ["src/cli.ts"]), mod("db", ["src/db.ts"])];
    const entryTieEdges: ModuleGraphEdge[] = [{ from: "cli", to: "db" }];
    const entryTieSymbols: Array<[string, string[]]> = [
      ["src/cli.ts", ["src/cli.ts#altEntry", "src/cli.ts#entry"]],
      ["src/db.ts", ["src/db.ts#open"]],
    ];
    const withoutSignal = detectFlowCandidates({
      modules: entryTieModules,
      edges: entryTieEdges,
      symbolsByFile: new Map(entryTieSymbols),
      flowSignals: { entryPatterns: ["cli/**", "src/cli.ts"] },
    })[0]!;
    const withSignal = detectFlowCandidates({
      modules: entryTieModules,
      edges: entryTieEdges,
      symbolsByFile: new Map(entryTieSymbols),
      flowSignals: { entryPatterns: ["cli/**", "src/cli.ts"] },
      resolvedCrossModuleCallees: new Set(["src/cli.ts#entry"]),
    })[0]!;
    expect(withSignal.entryKeys).toEqual(withoutSignal.entryKeys);
  });
});
