import { describe, it, expect } from "vitest";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  assertUniqueModuleIds,
  DuplicateModuleIdError,
  splitOversizedModules,
} from "./modules.js";
import type { ExtractedImport } from "./imports.js";

describe("modules.identifyModulesHeuristic", () => {
  it("agrupa arquivos por diretório top-level", () => {
    const mods = identifyModulesHeuristic([
      "src/auth/foo.ts",
      "src/auth/bar.ts",
      "src/utils/helper.ts",
    ]);
    expect(mods.map((m) => m.id).sort()).toEqual(["auth", "utils"]);
    expect(mods.find((m) => m.id === "auth")?.paths).toHaveLength(2);
    expect(mods.find((m) => m.id === "utils")?.paths).toHaveLength(1);
  });

  it("arquivo na raiz vai pro módulo 'root'", () => {
    const mods = identifyModulesHeuristic(["index.ts", "src/foo.ts"]);
    const root = mods.find((m) => m.id === "root");
    expect(root).toBeDefined();
    expect(root?.paths).toContain("index.ts");
  });

  it("arquivo único na raiz usa basename como id (sem extensão)", () => {
    const mods = identifyModulesHeuristic(["index.ts"]);
    expect(mods[0]?.id).toBe("index");
  });

  it("conta símbolos ativos por módulo (entrada opcional)", () => {
    const symbolCount = new Map([
      ["src/auth/foo.ts", 3],
      ["src/auth/bar.ts", 5],
      ["src/utils/helper.ts", 2],
    ]);
    const mods = identifyModulesHeuristic(
      ["src/auth/foo.ts", "src/auth/bar.ts", "src/utils/helper.ts"],
      symbolCount,
    );
    expect(mods.find((m) => m.id === "auth")?.symbolCount).toBe(8);
    expect(mods.find((m) => m.id === "utils")?.symbolCount).toBe(2);
  });

  it("ordenado por id (saída determinística)", () => {
    const mods = identifyModulesHeuristic(["src/zzz/a.ts", "src/aaa/b.ts"]);
    expect(mods.map((m) => m.id)).toEqual(["aaa", "zzz"]);
  });
});

describe("modules.resolveModuleEdges", () => {
  it("gera edges entre módulos diferentes via imports relativos", () => {
    const mods = identifyModulesHeuristic([
      "src/auth/login.ts",
      "src/auth/session.ts",
      "src/utils/helper.ts",
    ]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/auth/login.ts", [{ source: "./session", kind: "ts-import" }]],
      ["src/auth/session.ts", [{ source: "../utils/helper", kind: "ts-import" }]],
    ]);
    const knownFiles = new Set([
      "src/auth/login.ts",
      "src/auth/session.ts",
      "src/utils/helper.ts",
    ]);
    const edges = resolveModuleEdges(mods, importsByFile, knownFiles);
    expect(edges).toEqual([
      { from: "auth", to: "utils" }, // session.ts → helper.ts
    ]);
  });

  it("ignora imports absolutos/node_modules (não viram edges internos)", () => {
    const mods = identifyModulesHeuristic(["src/foo.ts", "src/utils/bar.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/foo.ts", [{ source: "express", kind: "ts-import" }]],
    ]);
    const knownFiles = new Set(["src/foo.ts", "src/utils/bar.ts"]);
    expect(resolveModuleEdges(mods, importsByFile, knownFiles)).toEqual([]);
  });

  it("ignora self-loops (imports dentro do mesmo módulo)", () => {
    const mods = identifyModulesHeuristic(["src/auth/login.ts", "src/auth/session.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/auth/login.ts", [{ source: "./session", kind: "ts-import" }]],
    ]);
    const knownFiles = new Set(["src/auth/login.ts", "src/auth/session.ts"]);
    expect(resolveModuleEdges(mods, importsByFile, knownFiles)).toEqual([]);
  });

  it("dedup de edges paralelos (A→B aparece 1x mesmo com N imports)", () => {
    const mods = identifyModulesHeuristic(["src/a/x.ts", "src/b/y.ts"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "src/a/x.ts",
        [
          { source: "./y", kind: "ts-import" },
          { source: "./y", kind: "ts-import" },
          { source: "../b/y", kind: "ts-import" },
        ],
      ],
    ]);
    const knownFiles = new Set(["src/a/x.ts", "src/b/y.ts"]);
    const edges = resolveModuleEdges(mods, importsByFile, knownFiles);
    expect(edges).toEqual([{ from: "a", to: "b" }]);
  });
});

describe("modules.prioritizeModules", () => {
  it("ordena por centralidade (indegree) decrescente", () => {
    const mods = identifyModulesHeuristic(["src/a/x.ts", "src/b/y.ts", "src/c/z.ts"]);
    const edges = [
      { from: "a", to: "c" },
      { from: "b", to: "c" },
    ];
    // c tem indegree 2, a e b tem 0. c primeiro.
    const ordered = prioritizeModules(mods, edges);
    expect(ordered[0]?.id).toBe("c");
  });

  it("empate em centralidade: maior symbolCount primeiro", () => {
    const mods = identifyModulesHeuristic([
      "src/small/x.ts",
      "src/big/y.ts",
      "src/dep/z.ts",
    ]);
    // symbolCount customizado via id (a heurística já ordenou alfabeticamente)
    mods.find((m) => m.id === "small")!.symbolCount = 1;
    mods.find((m) => m.id === "big")!.symbolCount = 100;
    mods.find((m) => m.id === "dep")!.symbolCount = 0;
    // sem edges → todos centralidade 0; empate vai pro maior symbolCount
    const ordered = prioritizeModules(mods, []);
    expect(ordered[0]?.id).toBe("big");
  });
});

// === W — unique deterministic module IDs (Phase-5 plan) ===
// Baseline findings 3-5: five directories with leaf "src" in livewiki
// (packages/core/src, packages/cli/src, packages/mcp/src, ...) received
// the same module ID. They shared one batch_task, overwrote
// livewiki/src.md and corrupted accounting.
describe("modules — splitOversizedModules", () => {
  it("leaves small modules unchanged", () => {
    const mods = [
      { id: "auth", paths: ["src/auth/a.ts", "src/auth/b.ts"], symbolCount: 4 },
    ];
    const out = splitOversizedModules(mods, { maxFiles: 12, maxSymbols: 80 });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("auth");
  });

  it("chunks a flat oversized directory by maxFiles with stable stems", () => {
    const paths = Array.from({ length: 25 }, (_, i) =>
      `packages/core/src/f${String(i).padStart(2, "0")}.ts`,
    );
    const mods = [{ id: "core-src", paths, symbolCount: 25 }];
    const out = splitOversizedModules(mods, { maxFiles: 12, maxSymbols: 80 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((m) => m.paths.length <= 12)).toBe(true);
    const allPaths = out.flatMap((m) => m.paths).sort();
    expect(allPaths).toEqual([...paths].sort());
    // ids are distinct prefixes of core-src-
    const ids = new Set(out.map((m) => m.id));
    expect(ids.size).toBe(out.length);
    for (const m of out) expect(m.id.startsWith("core-src-")).toBe(true);
  });

  it("splits by next path segment when structure exists", () => {
    const mods = [
      {
        id: "pkg",
        paths: [
          "pkg/a/x.ts",
          "pkg/a/y.ts",
          "pkg/b/z.ts",
          "pkg/b/w.ts",
          "pkg/b/v.ts",
        ],
        symbolCount: 5,
      },
    ];
    const out = splitOversizedModules(mods, { maxFiles: 2, maxSymbols: 80 });
    expect(out.length).toBeGreaterThan(1);
    // each sub-group further chunked if needed
    expect(out.every((m) => m.paths.length <= 2)).toBe(true);
  });
});

describe("modules W — makeUniqueDeterministicIds", () => {
  it("unique leaf is preserved", () => {
    const mods = [
      { id: "auth", paths: ["src/auth/a.ts"], symbolCount: 1 },
      { id: "utils", paths: ["src/utils/b.ts"], symbolCount: 1 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    expect(out.map((m) => m.id)).toEqual(["auth", "utils"]);
  });

  it("leaf collision is resolved by expanding the path (core-src, cli-src, mcp-src)", () => {
    // Reproduces the livewiki × OpenWiki benchmark scenario:
    // three packages with leaf "src".
    const mods = [
      { id: "src", paths: ["packages/core/src/index.ts"], symbolCount: 1 },
      { id: "src", paths: ["packages/cli/src/index.ts"], symbolCount: 1 },
      { id: "src", paths: ["packages/mcp/src/index.ts"], symbolCount: 1 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const ids = out.map((m) => m.id).sort();
    expect(ids).toEqual(["cli-src", "core-src", "mcp-src"]);
  });

  it("5 collisions — all resolved deterministically", () => {
    const dirs = ["packages/core", "packages/cli", "packages/mcp", "tests/fixtures/fase2", "scripts"];
    const mods = dirs.map((d) => ({
      id: "src",
      paths: [`${d}/src/auth.ts`],
      symbolCount: 1,
    }));
    const out = makeUniqueDeterministicIds(mods);
    const ids = out.map((m) => m.id).sort();
    expect(ids).toEqual([
      "cli-src",
      "core-src",
      "fase2-src",
      "mcp-src",
      "scripts-src",
    ]);
  });

  it("output is deterministic regardless of input order", () => {
    const a = [
      { id: "src", paths: ["packages/core/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/cli/src/x.ts"], symbolCount: 0 },
    ];
    const b = [
      { id: "src", paths: ["packages/cli/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/core/src/x.ts"], symbolCount: 0 },
    ];
    const outA = makeUniqueDeterministicIds(a).map((m) => m.id).sort();
    const outB = makeUniqueDeterministicIds(b).map((m) => m.id).sort();
    expect(outA).toEqual(outB);
  });

  it("stable fallback: 2 modules with same id AND same path get ids with hash + counter", () => {
    // We force an impossible collision: the same `id` and the same `paths`
    // entering twice. Path expansion does not disambiguate (all
    // wave-loop candidates collide). The fallback uses the path slug +
    // hash of the path + counter, stable regardless of input order.
    const mods = [
      { id: "src", paths: ["dup/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["dup/src/x.ts"], symbolCount: 0 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const ids = out.map((m) => m.id).sort();
    // First: "dup-src" (path slug); second: "dup-src-<hash>-1" (path slug +
    // hash + counter, since the base is already taken).
    expect(ids[0]).toBe("dup-src");
    expect(ids[1]).toMatch(/^dup-src-[0-9a-f]{8}-1$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("fallback depends on path, not input order (stable path→id)", () => {
    const modsA = [
      { id: "src", paths: ["dup/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["dup/src/x.ts"], symbolCount: 0 },
    ];
    const modsB = [...modsA].reverse();
    const idsA = makeUniqueDeterministicIds(modsA).map((m) => m.id).sort();
    const idsB = makeUniqueDeterministicIds(modsB).map((m) => m.id).sort();
    expect(idsA).toEqual(idsB);
  });

  it("does NOT mutate input modules", () => {
    const mods = [
      { id: "src", paths: ["packages/core/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/cli/src/x.ts"], symbolCount: 0 },
    ];
    const snapshot = JSON.parse(JSON.stringify(mods));
    makeUniqueDeterministicIds(mods);
    expect(mods).toEqual(snapshot);
  });

  it("preserves paths and symbolCount in unique modules", () => {
    const mods = [
      { id: "src", paths: ["packages/core/src/x.ts"], symbolCount: 7 },
      { id: "src", paths: ["packages/cli/src/y.ts"], symbolCount: 3 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const core = out.find((m) => m.id === "core-src");
    expect(core?.paths).toEqual(["packages/core/src/x.ts"]);
    expect(core?.symbolCount).toBe(7);
  });
});

describe("modules W — assertUniqueModuleIds (defensive gate)", () => {
  it("passes when all IDs are unique", () => {
    const mods = [
      { id: "a", paths: [], symbolCount: 0 },
      { id: "b", paths: [], symbolCount: 0 },
    ];
    expect(() => assertUniqueModuleIds(mods)).not.toThrow();
  });

  it("throws DuplicateModuleIdError when there is a collision (benchmark scenario)", () => {
    // Reproduces baseline findings 3-5 — 5 identical "src" directories.
    const mods = [
      { id: "src", paths: ["packages/core/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/cli/src/x.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/mcp/src/x.ts"], symbolCount: 0 },
    ];
    let captured: Error | null = null;
    try {
      assertUniqueModuleIds(mods);
    } catch (e) {
      captured = e as Error;
    }
    expect(captured).toBeInstanceOf(DuplicateModuleIdError);
    expect(captured?.message).toMatch(/Module ID collision/);
    expect(captured?.message).toMatch(/"src" appears 3 times/);
  });

  it("message lists example paths for debug", () => {
    const mods = [
      { id: "src", paths: ["packages/core/src/a.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/cli/src/b.ts"], symbolCount: 0 },
    ];
    try {
      assertUniqueModuleIds(mods);
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("packages/core/src/a.ts");
      expect(msg).toContain("packages/cli/src/b.ts");
    }
  });
});

// === Revision path→id mapping (revision #1) ===
// Path→id mapping table that the algorithm MUST respect. These
// tests are specific checks (not set comparison) — any
// change to the algorithm must update this table and justify it.
describe("modules W — path→id mapping table (revision #1)", () => {
  function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string {
    const out = makeUniqueDeterministicIds([mod]);
    return out[0]!.id;
  }

  it("single root file → id = basename without extension (m.id)", () => {
    // Heuristic: m.id = "index" (basename of the single file in the root)
    expect(idFor({ id: "index", paths: ["index.ts"], symbolCount: 0 })).toBe("index");
  });

  it("single file in subdir → id = m.id (no expansion)", () => {
    // m.id = "auth" (heuristic), unique path → m.id is preserved
    expect(idFor({ id: "auth", paths: ["src/auth/login.ts"], symbolCount: 0 })).toBe("auth");
  });

  it("colliding leaf heuristic → expands right-to-left: core-src, cli-src, mcp-src", () => {
    // Benchmark scenario: 3 packages with leaf "src" and m.id = "src"
    const mods = [
      { id: "src", paths: ["packages/core/src/a.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/cli/src/a.ts"], symbolCount: 0 },
      { id: "src", paths: ["packages/mcp/src/a.ts"], symbolCount: 0 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const byPath = new Map(out.map((m) => [m.paths[0]!, m.id]));
    expect(byPath.get("packages/core/src/a.ts")).toBe("core-src");
    expect(byPath.get("packages/cli/src/a.ts")).toBe("cli-src");
    expect(byPath.get("packages/mcp/src/a.ts")).toBe("mcp-src");
  });

  it("unique refined ID is preserved (m.id = 'core-src' beats 'src' from leaf)", () => {
    // Scenario: LLM refined "src" to "core-src" in packages/core/src.
    // m.id "core-src" is unique, so it is preserved (does not revert to leaf "src").
    expect(
      idFor({ id: "core-src", paths: ["packages/core/src/a.ts"], symbolCount: 0 }),
    ).toBe("core-src");
  });

  it("unique refined ID beats path candidate in a different module (no id collision)", () => {
    // m1: id="auth" (refined), path "src/auth/login.ts"
    // m2: id="auth" (heuristic), path "packages/auth/src/x.ts"
    // BOTH have id "auth" → collision at level 0 → both advance. Revision
    // #1: "preserve refined IDs that are already unique" — UNIQUE here
    // means not colliding with ANY other id. If the refined id
    // collides with the heuristic id of another module, it loses (both
    // advance to path expansion).
    const mods = [
      { id: "auth", paths: ["src/auth/login.ts"], symbolCount: 0 },
      { id: "auth", paths: ["packages/auth/src/x.ts"], symbolCount: 0 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const byPath = new Map(out.map((m) => [m.paths[0]!, m.id]));
    // m1: segments ["src","auth"]; level 0 "auth" colide, level 1
    // tail="auth" (dup, skip), level 2 tail="src-auth" — unique.
    expect(byPath.get("src/auth/login.ts")).toBe("src-auth");
    // m2: segments ["packages","auth","src"]; level 0 "auth" collides,
    // level 1 tail="src" — unique.
    expect(byPath.get("packages/auth/src/x.ts")).toBe("src");
  });

  it("unique refined ID (no collision with any other) is preserved vs path expansion", () => {
    // m1: id="auth" (refined), path "src/auth/login.ts"
    // m2: id="utils" (heuristic), path "packages/utils/helper.ts"
    // m1 id="auth" does not collide with anyone → preserved.
    // m2 id="utils" does not collide → preserved.
    const mods = [
      { id: "auth", paths: ["src/auth/login.ts"], symbolCount: 0 },
      { id: "utils", paths: ["packages/utils/helper.ts"], symbolCount: 0 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const byPath = new Map(out.map((m) => [m.paths[0]!, m.id]));
    expect(byPath.get("src/auth/login.ts")).toBe("auth");
    expect(byPath.get("packages/utils/helper.ts")).toBe("utils");
  });

  it("5 collisions: each path has its unique id, no 'src' as leaf", () => {
    const dirs = [
      "packages/core",
      "packages/cli",
      "packages/mcp",
      "tests/fixtures/fase2",
      "scripts",
    ];
    const mods = dirs.map((d) => ({
      id: "src",
      paths: [`${d}/src/a.ts`],
      symbolCount: 0,
    }));
    const out = makeUniqueDeterministicIds(mods);
    const byPath = new Map(out.map((m) => [m.paths[0]!, m.id]));
    expect(byPath.get("packages/core/src/a.ts")).toBe("core-src");
    expect(byPath.get("packages/cli/src/a.ts")).toBe("cli-src");
    expect(byPath.get("packages/mcp/src/a.ts")).toBe("mcp-src");
    expect(byPath.get("tests/fixtures/fase2/src/a.ts")).toBe("fase2-src");
    expect(byPath.get("scripts/src/a.ts")).toBe("scripts-src");
    // Nenhum id tem o leaf "src" sozinho
    for (const m of out) expect(m.id).not.toBe("src");
  });

  it("never assigns candidate already in taken (idempotency under iteration)", () => {
    // Scenario: 3 modules with nested paths where the second has a path
    // equal to the first one's expanded form. Verifies that the algorithm does
    // not assign the same id to 2 different modules.
    const mods = [
      { id: "x", paths: ["a/b/x.ts"], symbolCount: 0 },
      { id: "y", paths: ["a/b/y.ts"], symbolCount: 0 },
      { id: "x", paths: ["a/b/x.ts"], symbolCount: 0 }, // same id + path as 1st
    ];
    const out = makeUniqueDeterministicIds(mods);
    const ids = new Set(out.map((m) => m.id));
    expect(ids.size).toBe(3); // ALL unique
    // Algorithm found distinct IDs (even if the exact fallback depends
    // on the hash, we know there are 3 distinct ones)
    for (const m of out) {
      const dupes = out.filter((other) => other.id === m.id);
      expect(dupes.length).toBe(1);
    }
  });

  it("P0-1 EXACT: tools/core-src/x.ts → core-src; packages/core/src/x.ts → NOT core-src; packages/cli/src/x.ts → cli-src", () => {
    // Reviewer reproduction: 3 modules with the same leaf id "x" and
    // paths that share a "core-src" segment via different positions. The
    // algorithm must produce these EXACT ids (not just "all unique"):
    //   - tools/core-src/x.ts     → core-src  (locked at level 1: only A
    //                                       has "core-src" as tail-1;
    //                                       taken has nothing yet)
    //   - packages/core/src/x.ts  → packages-core-src  (B's "core-src" at
    //                                       level 2 is rejected because
    //                                       taken.has("core-src")=true;
    //                                       B advances to level 3)
    //   - packages/cli/src/x.ts   → cli-src  (C's "cli-src" at level 2
    //                                       locks, taken doesn't have it)
    //
    // Without the `taken.has(c)` guard in the wave, B would lock at
    // "core-src" at level 2 — colliding with A. The fix is exactly
    // "ONLY lock if indices.length === 1 && !taken.has(c)".
    const mods: Array<{ id: string; paths: string[]; symbolCount: number }> = [
      { id: "x", paths: ["tools/core-src/x.ts"], symbolCount: 1 },
      { id: "x", paths: ["packages/core/src/x.ts"], symbolCount: 1 },
      { id: "x", paths: ["packages/cli/src/x.ts"], symbolCount: 1 },
    ];
    const out = makeUniqueDeterministicIds(mods);
    const byPath = new Map(out.map((m) => [m.paths[0]!, m.id]));
    expect(byPath.get("tools/core-src/x.ts")).toBe("core-src");
    expect(byPath.get("packages/cli/src/x.ts")).toBe("cli-src");
    // B must NOT be "core-src" — must expand further. Stable form is
    // "packages-core-src" (full path, all 3 segments).
    expect(byPath.get("packages/core/src/x.ts")).toBe("packages-core-src");
    expect(byPath.get("packages/core/src/x.ts")).not.toBe("core-src");
    // And the 3 ids are globally unique.
    const ids = new Set(out.map((m) => m.id));
    expect(ids.size).toBe(3);
  });
});