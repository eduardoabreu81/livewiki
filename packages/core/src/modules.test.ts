import { describe, it, expect } from "vitest";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
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