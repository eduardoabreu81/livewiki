import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  loadEffectiveTsconfig,
  loadGoModulePath,
  loadPackageTsconfig,
  loadRustCrateName,
  loadWorkspacePackages,
  resolveImportEdges,
  type PackageTsconfig,
  type ResolvedImportEdge,
  type WorkspacePackage,
} from "./import-resolution.js";
import { resolveModuleEdges, type Module } from "./modules.js";
import type { ExtractedImport } from "./imports.js";

function imp(source: string): ExtractedImport {
  return { source, kind: "ts-import" };
}

function edgesOf(
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
  workspacePackages: WorkspacePackage[],
  tsconfigs?: Record<string, PackageTsconfig>,
): ResolvedImportEdge[] {
  return resolveImportEdges({
    importsByFile,
    knownFiles,
    workspacePackages,
    // Per-package layouts keyed by package dir; a package with no entry
    // gets NO compiled-target mapping (strict, no guessing).
    tsconfig: tsconfigs === undefined ? undefined : new Map(Object.entries(tsconfigs)),
  });
}

/** Neutral two-package workspace fixture (NOT livewiki-shaped). */
const ACME_CORE: WorkspacePackage = {
  name: "@acme/core",
  dir: "packages/core",
  main: "dist/index.js",
  exports: {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./sub": { import: "./dist/sub.js" },
  },
};
const ACME_CLI: WorkspacePackage = {
  name: "@acme/cli",
  dir: "packages/cli",
  main: "dist/cli.js",
};
const ACME_WEB: WorkspacePackage = { name: "@acme/web", dir: "packages/web" };

/** Per-package layouts for the ACME fixture (no entry ⇒ no mapping). */
const ACME_TSCONFIGS: Record<string, PackageTsconfig> = {
  "packages/core": { rootDir: "src", outDir: "dist" },
  "packages/cli": { rootDir: "src", outDir: "dist" },
  "packages/web": { rootDir: "src", outDir: "dist" },
};

const ACME_FILES = new Set([
  "packages/cli/src/cli.ts",
  "packages/cli/src/run.ts",
  "packages/core/src/index.ts",
  "packages/core/src/sub.ts",
  "packages/web/src/web.ts",
]);

describe("import-resolution.resolveImportEdges (workspace specifiers)", () => {
  it("resolves bare-name (main/exports) and explicit-subpath specifiers to source", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "packages/cli/src/cli.ts",
        [
          imp("@acme/core"), // bare → exports "." → dist/index.js → src/index.ts
          imp("@acme/core/sub"), // exports "./sub" → dist/sub.js → src/sub.ts
          imp("./run"), // relative, same package
          imp("node:fs"), // builtin: never an edge
          imp("express"), // undeclared third-party: never an edge
          imp("@acme/undeclared"), // undeclared lookalike name: never an edge
        ],
      ],
      ["packages/web/src/web.ts", [imp("@acme/core")]],
    ]);
    const edges = edgesOf(importsByFile, ACME_FILES, [ACME_CORE, ACME_CLI, ACME_WEB], ACME_TSCONFIGS);
    expect(edges).toEqual([
      { fromFile: "packages/cli/src/cli.ts", toFile: "packages/cli/src/run.ts", source: "./run" },
      { fromFile: "packages/cli/src/cli.ts", toFile: "packages/core/src/index.ts", source: "@acme/core" },
      { fromFile: "packages/cli/src/cli.ts", toFile: "packages/core/src/sub.ts", source: "@acme/core/sub" },
      { fromFile: "packages/web/src/web.ts", toFile: "packages/core/src/index.ts", source: "@acme/core" },
    ]);
  });

  it("falls back to package.json main (then index) when no exports map exists", () => {
    const legacy: WorkspacePackage = {
      name: "@acme/legacy",
      dir: "packages/legacy",
      main: "dist/main.js",
    };
    const knownFiles = new Set(["packages/legacy/src/main.ts", "src/app.ts"]);
    const importsByFile = new Map([["src/app.ts", [imp("@acme/legacy")]]]);
    expect(
      edgesOf(importsByFile, knownFiles, [legacy], {
        "packages/legacy": { rootDir: "src", outDir: "dist" },
      }),
    ).toEqual([
      { fromFile: "src/app.ts", toFile: "packages/legacy/src/main.ts", source: "@acme/legacy" },
    ]);
  });

  it("matches only exact name or name + '/' (no folder-name inference)", () => {
    const coreUtils: WorkspacePackage = {
      name: "@acme/core-utils",
      dir: "packages/core-utils",
      main: "dist/index.js",
    };
    const knownFiles = new Set([
      "packages/core-utils/src/index.ts",
      "packages/core/src/index.ts",
      "src/app.ts",
    ]);
    const importsByFile = new Map([["src/app.ts", [imp("@acme/core-utils")]]]);
    // "@acme/core-utils" must NOT resolve into @acme/core's directory.
    expect(
      edgesOf(importsByFile, knownFiles, [ACME_CORE, coreUtils], {
        "packages/core": { rootDir: "src", outDir: "dist" },
        "packages/core-utils": { rootDir: "src", outDir: "dist" },
      }),
    ).toEqual([
      { fromFile: "src/app.ts", toFile: "packages/core-utils/src/index.ts", source: "@acme/core-utils" },
    ]);
  });

  it("ambiguous source candidate (sub.ts AND sub.tsx) stays external", () => {
    const knownFiles = new Set([
      ...ACME_FILES,
      "packages/core/src/sub.tsx", // now dist/sub.js maps to TWO candidates
    ]);
    const importsByFile = new Map([["packages/cli/src/cli.ts", [imp("@acme/core/sub"), imp("@acme/core")]]]);
    expect(
      edgesOf(importsByFile, knownFiles, [ACME_CORE], {
        "packages/core": { rootDir: "src", outDir: "dist" },
      }),
    ).toEqual([
      // Only the unambiguous bare-name edge survives.
      { fromFile: "packages/cli/src/cli.ts", toFile: "packages/core/src/index.ts", source: "@acme/core" },
    ]);
  });

  it("unsupported exports forms stay external (wildcards, arrays, nested, missing key)", () => {
    const knownFiles = new Set(["packages/core/src/index.ts", "src/app.ts"]);
    // A valid per-package layout is present: the failures below come from
    // the unsupported exports forms, not from a missing mapping.
    const layouts = { "packages/core": { rootDir: "src", outDir: "dist" } };
    const cases: Array<{ exports: unknown; spec: string }> = [
      { exports: { "./features/*": "./dist/features/*.js" }, spec: "@acme/core/features/x" },
      { exports: { ".": ["./dist/index.js"] }, spec: "@acme/core" },
      { exports: { ".": { import: { node: "./dist/node.js" } } }, spec: "@acme/core" },
      // exports map present but the subpath key is missing: encapsulated, no main fallback.
      { exports: { ".": "./dist/index.js" }, spec: "@acme/core/other" },
    ];
    for (const { exports, spec } of cases) {
      const pkg: WorkspacePackage = { name: "@acme/core", dir: "packages/core", main: "dist/index.js", exports };
      const importsByFile = new Map([["src/app.ts", [imp(spec)]]]);
      expect(edgesOf(importsByFile, knownFiles, [pkg], layouts), spec).toEqual([]);
    }
    // ...while the `default` condition IS a supported form.
    const withDefault: WorkspacePackage = {
      name: "@acme/core",
      dir: "packages/core",
      exports: { ".": { default: "./dist/index.js" } },
    };
    const importsByFile = new Map([["src/app.ts", [imp("@acme/core")]]]);
    expect(edgesOf(importsByFile, knownFiles, [withDefault], layouts)).toEqual([
      { fromFile: "src/app.ts", toFile: "packages/core/src/index.ts", source: "@acme/core" },
    ]);
  });

  it("maps compiled targets back via the package's OWN rootDir/outDir (strict, no guessing)", () => {
    const pkg: WorkspacePackage = { name: "@acme/lib", dir: "packages/lib", main: "build/main.js" };
    const knownFiles = new Set(["packages/lib/lib/main.ts", "src/app.ts"]);
    const importsByFile = new Map([["src/app.ts", [imp("@acme/lib")]]]);
    expect(
      edgesOf(importsByFile, knownFiles, [pkg], {
        "packages/lib": { rootDir: "lib", outDir: "build" },
      }),
    ).toEqual([
      { fromFile: "src/app.ts", toFile: "packages/lib/lib/main.ts", source: "@acme/lib" },
    ]);
    // Without a layout ENTRY for this package there is no compiled-target
    // mapping at all — inferred src/dist defaults are never applied.
    expect(edgesOf(importsByFile, knownFiles, [pkg])).toEqual([]);
    // A layout keyed to ANOTHER package's dir does not leak in either.
    expect(
      edgesOf(importsByFile, knownFiles, [pkg], {
        "packages/other": { rootDir: "lib", outDir: "build" },
      }),
    ).toEqual([]);
  });
});

describe("import-resolution.resolveImportEdges (relative + bookkeeping)", () => {
  it("NodeNext .js relative specifier resolves to the TS source (regression)", () => {
    const importsByFile = new Map([["src/auth/login.ts", [imp("../utils/crypto.js")]]]);
    const knownFiles = new Set(["src/auth/login.ts", "src/utils/crypto.ts"]);
    expect(edgesOf(importsByFile, knownFiles, [])).toEqual([
      { fromFile: "src/auth/login.ts", toFile: "src/utils/crypto.ts", source: "../utils/crypto.js" },
    ]);
  });

  it("dedupes repeated occurrences, drops self-edges, is deterministic under reordering", () => {
    const knownFiles = new Set(["src/a/x.ts", "src/a/y.ts", "src/b/y.ts"]);
    const imports: ExtractedImport[] = [
      imp("./y"),
      imp("./y"), // duplicate occurrence
      imp("../b/y"),
      imp("./x"), // self-edge
    ];
    const expected: ResolvedImportEdge[] = [
      { fromFile: "src/a/x.ts", toFile: "src/a/y.ts", source: "./y" },
      { fromFile: "src/a/x.ts", toFile: "src/b/y.ts", source: "../b/y" },
    ];
    expect(edgesOf(new Map([["src/a/x.ts", imports]]), knownFiles, [])).toEqual(expected);
    // Insertion order of the input map cannot leak into the sorted output.
    const reordered = new Map<string, ExtractedImport[]>([
      ["src/b/y.ts", []],
      ["src/a/x.ts", [...imports].reverse()],
    ]);
    expect(edgesOf(reordered, knownFiles, [])).toEqual(expected);
  });
});

describe("modules.resolveModuleEdges on top of resolveImportEdges", () => {
  it("projects resolved file edges to module edges (workspace scenario)", () => {
    const modules: Module[] = [
      { id: "cli", paths: ["packages/cli/src/cli.ts"], symbolCount: 0 },
      { id: "core", paths: ["packages/core/src/index.ts", "packages/core/src/sub.ts"], symbolCount: 0 },
      { id: "web", paths: ["packages/web/src/web.ts"], symbolCount: 0 },
    ];
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["packages/cli/src/cli.ts", [imp("@acme/core"), imp("@acme/core/sub")]],
      ["packages/web/src/web.ts", [imp("@acme/core")]],
    ]);
    const resolvedEdges = edgesOf(importsByFile, ACME_FILES, [ACME_CORE, ACME_CLI, ACME_WEB], ACME_TSCONFIGS);
    // One cli→core edge despite two file edges; same dedup/sort as today.
    expect(resolveModuleEdges(modules, importsByFile, ACME_FILES, resolvedEdges)).toEqual([
      { from: "cli", to: "core" },
      { from: "web", to: "core" },
    ]);
  });
});

describe("import-resolution workspace/tsconfig loading (fixture repo)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-import-resolution-"));
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const abs = nodePath.join(repoRoot, rel);
    await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
    await nodeFs.writeFile(abs, content);
  }

  async function writeAcmeCoreManifest(): Promise<void> {
    await writeFile(
      "packages/core/package.json",
      JSON.stringify({
        name: "@acme/core",
        main: "dist/index.js",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./sub": { import: "./dist/sub.js" },
        },
      }),
    );
  }

  it("expands pnpm-workspace.yaml globs to declared packages with manifests", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile("packages/cli/package.json", JSON.stringify({ name: "@acme/cli", main: "dist/cli.js" }));
    await writeAcmeCoreManifest();
    await writeFile("packages/no-manifest/keep.txt", "not a package\n");

    const packages = await loadWorkspacePackages(repoRoot);
    expect(packages).toEqual([
      { name: "@acme/cli", dir: "packages/cli", main: "dist/cli.js" },
      {
        name: "@acme/core",
        dir: "packages/core",
        main: "dist/index.js",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./sub": { import: "./dist/sub.js" },
        },
      },
    ]);
  });

  it("falls back to root package.json workspaces (array and { packages } forms)", async () => {
    await writeFile(
      "package.json",
      JSON.stringify({ name: "root", workspaces: ["modules/*"] }),
    );
    await writeFile("modules/left/package.json", JSON.stringify({ name: "@acme/left" }));
    expect(await loadWorkspacePackages(repoRoot)).toEqual([
      { name: "@acme/left", dir: "modules/left" },
    ]);

    await writeFile(
      "package.json",
      JSON.stringify({ name: "root", workspaces: { packages: ["modules/*"] } }),
    );
    expect(await loadWorkspacePackages(repoRoot)).toEqual([
      { name: "@acme/left", dir: "modules/left" },
    ]);
  });

  it("returns [] when no workspace file declares packages (no crash)", async () => {
    expect(await loadWorkspacePackages(repoRoot)).toEqual([]);
    await writeFile("package.json", JSON.stringify({ name: "root" }));
    expect(await loadWorkspacePackages(repoRoot)).toEqual([]);
  });

  it("does NOT infer a similarly-named package/folder missing from the workspace map", async () => {
    // Only packages/cli is declared (literal entry, no glob).
    await writeFile("pnpm-workspace.yaml", "packages:\n  - packages/cli\n");
    await writeFile("packages/cli/package.json", JSON.stringify({ name: "@acme/cli" }));
    await writeAcmeCoreManifest(); // exists on disk but is NOT declared

    const packages = await loadWorkspacePackages(repoRoot);
    expect(packages).toEqual([{ name: "@acme/cli", dir: "packages/cli" }]);

    const importsByFile = new Map([["packages/cli/src/cli.ts", [imp("@acme/core")]]]);
    expect(edgesOf(importsByFile, ACME_FILES, packages)).toEqual([]);
  });

  it("loadEffectiveTsconfig returns undefined without any package tsconfig", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile("packages/cli/package.json", JSON.stringify({ name: "@acme/cli" }));
    const packages = await loadWorkspacePackages(repoRoot);
    expect(await loadEffectiveTsconfig(repoRoot, packages)).toBeUndefined();
  });

  it("loadPackageTsconfig reads ONLY the package's own tsconfig, direct compilerOptions", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile("packages/cli/package.json", JSON.stringify({ name: "@acme/cli" }));
    await writeAcmeCoreManifest();
    await writeFile(
      "packages/core/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" } }),
    );
    // A partial layout (missing outDir) disables the package's mapping.
    await writeFile(
      "packages/cli/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "src" } }),
    );
    expect(await loadPackageTsconfig(repoRoot, "packages/core")).toEqual({
      rootDir: "src",
      outDir: "dist",
    });
    expect(await loadPackageTsconfig(repoRoot, "packages/cli")).toBeUndefined();
    expect(await loadPackageTsconfig(repoRoot, "packages/absent")).toBeUndefined();

    // The batch loader keys each usable layout by its own package dir.
    const packages = await loadWorkspacePackages(repoRoot);
    expect(await loadEffectiveTsconfig(repoRoot, packages)).toEqual(
      new Map([["packages/core", { rootDir: "src", outDir: "dist" }]]),
    );
  });

  it("two packages with DIFFERENT layouts (src/dist vs source/build) both resolve", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile(
      "packages/pkg-a/package.json",
      JSON.stringify({ name: "@acme/pkg-a", main: "dist/index.js" }),
    );
    await writeFile(
      "packages/pkg-a/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" } }),
    );
    await writeFile(
      "packages/pkg-b/package.json",
      JSON.stringify({ name: "@acme/pkg-b", main: "build/index.js" }),
    );
    await writeFile(
      "packages/pkg-b/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "source", outDir: "build" } }),
    );
    const packages = await loadWorkspacePackages(repoRoot);
    const tsconfig = await loadEffectiveTsconfig(repoRoot, packages);

    const knownFiles = new Set([
      "packages/pkg-a/src/index.ts",
      "packages/pkg-b/source/index.ts",
      "packages/consumer/src/use.ts",
    ]);
    const importsByFile = new Map([
      ["packages/consumer/src/use.ts", [imp("@acme/pkg-a"), imp("@acme/pkg-b")]],
    ]);
    expect(resolveImportEdges({ importsByFile, knownFiles, workspacePackages: packages, tsconfig }))
      .toEqual([
        {
          fromFile: "packages/consumer/src/use.ts",
          toFile: "packages/pkg-a/src/index.ts",
          source: "@acme/pkg-a",
        },
        {
          fromFile: "packages/consumer/src/use.ts",
          toFile: "packages/pkg-b/source/index.ts",
          source: "@acme/pkg-b",
        },
      ]);
  });

  it("a package without a readable tsconfig resolves literal targets only (never src/dist guessing)", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile(
      "packages/raw/package.json",
      JSON.stringify({ name: "@acme/raw", main: "dist/index.js" }),
    ); // NO tsconfig.json for this package
    const packages = await loadWorkspacePackages(repoRoot);
    const tsconfig = await loadEffectiveTsconfig(repoRoot, packages);
    expect(tsconfig).toBeUndefined(); // no package yielded a usable layout

    const importsByFile = new Map([["src/app.ts", [imp("@acme/raw")]]]);
    // Literal target present in knownFiles: resolves.
    expect(
      resolveImportEdges({
        importsByFile,
        knownFiles: new Set(["packages/raw/dist/index.js", "src/app.ts"]),
        workspacePackages: packages,
        tsconfig,
      }),
    ).toEqual([{ fromFile: "src/app.ts", toFile: "packages/raw/dist/index.js", source: "@acme/raw" }]);
    // Only the src/dist-shaped source exists: an inferred default would
    // resolve it — the strict resolver must NOT.
    expect(
      resolveImportEdges({
        importsByFile,
        knownFiles: new Set(["packages/raw/src/index.ts", "src/app.ts"]),
        workspacePackages: packages,
        tsconfig,
      }),
    ).toEqual([]);
  });

  it("a target that would only resolve under ANOTHER package's layout stays external", async () => {
    await writeFile("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    await writeFile(
      "packages/pkg-a/package.json",
      JSON.stringify({ name: "@acme/pkg-a", main: "dist/index.js" }),
    );
    await writeFile(
      "packages/pkg-a/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" } }),
    );
    await writeFile(
      "packages/pkg-b/package.json",
      JSON.stringify({ name: "@acme/pkg-b", main: "build/index.js" }),
    );
    await writeFile(
      "packages/pkg-b/tsconfig.json",
      JSON.stringify({ compilerOptions: { rootDir: "source", outDir: "build" } }),
    );
    const packages = await loadWorkspacePackages(repoRoot);
    const tsconfig = await loadEffectiveTsconfig(repoRoot, packages);

    // pkg-b's target build/index.js maps to source/index.ts under pkg-b's
    // OWN layout. Only the src/-shaped file exists — present solely under
    // pkg-a's (src/dist) layout, which must never leak into pkg-b.
    const knownFiles = new Set(["packages/pkg-b/src/index.ts", "src/app.ts"]);
    const importsByFile = new Map([["src/app.ts", [imp("@acme/pkg-b")]]]);
    expect(
      resolveImportEdges({ importsByFile, knownFiles, workspacePackages: packages, tsconfig }),
    ).toEqual([]);
  });
});

describe("import-resolution.resolveImportEdges (Python)", () => {
  // Priority-0 fix (v-next paid E2E on MoneyPrinterTurbo-Plus): Python
  // import resolution was previously unimplemented at this layer — every
  // `py-from`/`py-import` occurrence fell through to `null` (external),
  // so a Python repo's internal module graph was always empty regardless
  // of its real imports (the "0 edges" finding from the blind A/B eval).
  const PY_FILES = new Set([
    "app/services/task.py",
    "app/services/bgm.py",
    "app/services/llm.py",
    "app/services/__init__.py",
    "app/config/config.py",
    "app/config/__init__.py",
    "app/models/const.py",
  ]);

  it("resolves 'from pkg.sub import name' to the submodule file (absolute dotted)", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "app/services/task.py",
        [{ source: "app.services", kind: "py-from", names: ["bgm as bgm_service", "llm"] }],
      ],
    ]);
    const edges = resolveImportEdges({ importsByFile, knownFiles: PY_FILES, workspacePackages: [] });
    expect(edges.map((e) => e.toFile).sort()).toEqual([
      "app/services/bgm.py",
      "app/services/llm.py",
    ]);
  });

  it("resolves 'import pkg.sub.mod' (no from) to the leaf module file", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["app/services/task.py", [{ source: "app.services.bgm", kind: "py-import" }]],
    ]);
    const edges = resolveImportEdges({ importsByFile, knownFiles: PY_FILES, workspacePackages: [] });
    expect(edges).toEqual([{ fromFile: "app/services/task.py", toFile: "app/services/bgm.py", source: "app.services.bgm" }]);
  });

  it("falls back to the 'from' package itself when no imported name is its own submodule file", () => {
    // `config` here names an attribute defined inside app/config/__init__.py,
    // not a sibling app/config/config_helper.py file.
    const files = new Set(["app/services/task.py", "app/config/__init__.py"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["app/services/task.py", [{ source: "app.config", kind: "py-from", names: ["config"] }]],
    ]);
    const edges = resolveImportEdges({ importsByFile, knownFiles: files, workspacePackages: [] });
    expect(edges).toEqual([{ fromFile: "app/services/task.py", toFile: "app/config/__init__.py", source: "app.config" }]);
  });

  it("resolves Python's own relative imports: '.' (current package) and '..pkg' (parent package)", () => {
    const files = new Set([
      "app/services/task.py",
      "app/services/bgm.py",
      "app/services/__init__.py",
      "app/models/const.py",
    ]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "app/services/task.py",
        [
          { source: ".", kind: "py-from", names: ["bgm"] }, // 1 dot: current package (app/services)
          { source: "..models", kind: "py-from", names: ["const"] }, // 2 dots: parent package (app), submodule models
        ],
      ],
    ]);
    const edges = resolveImportEdges({ importsByFile, knownFiles: files, workspacePackages: [] });
    expect(edges.map((e) => e.toFile).sort()).toEqual([
      "app/models/const.py",
      "app/services/bgm.py",
    ]);
  });

  it("an import with no resolvable target (real third-party package) stays external", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["app/services/task.py", [{ source: "loguru", kind: "py-from", names: ["logger"] }]],
    ]);
    expect(
      resolveImportEdges({ importsByFile, knownFiles: PY_FILES, workspacePackages: [] }),
    ).toEqual([]);
  });

  it("modules.resolveModuleEdges groups resolved Python file edges into module edges", () => {
    const modules: Module[] = [
      { id: "services", paths: ["app/services/task.py", "app/services/bgm.py"], symbolCount: 2 },
      { id: "models", paths: ["app/models/const.py"], symbolCount: 1 },
    ];
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["app/services/task.py", [{ source: "app.models", kind: "py-from", names: ["const"] }]],
    ]);
    const fileEdges = resolveImportEdges({ importsByFile, knownFiles: PY_FILES, workspacePackages: [] });
    const moduleEdges = resolveModuleEdges(modules, importsByFile, PY_FILES, fileEdges);
    expect(moduleEdges).toEqual([{ from: "services", to: "models" }]);
  });
});

describe("import-resolution.resolveImportEdges (Go, roadmap item 19)", () => {
  const GO_MODULE = "example.com/fixture";
  const GO_FILES = new Set([
    "cmd/main.go",
    "server/server.go",
    "server/server_test.go",
    "server/internal/hidden/hidden.go",
  ]);

  it("resolves an intra-module import to every direct .go file of the package dir", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["cmd/main.go", [{ source: "example.com/fixture/server", kind: "go-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: GO_FILES, workspacePackages: [], goModulePath: GO_MODULE,
    });
    expect(edges.map((e) => e.toFile).sort()).toEqual([
      "server/server.go",
      "server/server_test.go",
    ]);
    expect(edges.every((e) => e.fromFile === "cmd/main.go")).toBe(true);
  });

  it("does NOT resolve into nested subdirectories (an import names exactly one dir)", () => {
    const files = new Set(["cmd/main.go", "server/internal/hidden/hidden.go"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      // importing the PARENT package must not pull files from child dirs
      ["cmd/main.go", [{ source: "example.com/fixture/server/internal", kind: "go-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: files, workspacePackages: [], goModulePath: GO_MODULE,
    });
    expect(edges).toEqual([]);
  });

  it("resolves the bare module path to root-directory .go files", () => {
    const files = new Set(["main.go", "util.go", "cmd/tool/main.go"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["cmd/tool/main.go", [{ source: "example.com/fixture", kind: "go-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: files, workspacePackages: [], goModulePath: GO_MODULE,
    });
    expect(edges.map((e) => e.toFile)).toEqual(["main.go", "util.go"]);
  });

  it("stdlib and third-party imports stay external (no edge)", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "cmd/main.go",
        [
          { source: "fmt", kind: "go-import" },
          { source: "github.com/other/lib", kind: "go-import" },
        ],
      ],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: GO_FILES, workspacePackages: [], goModulePath: GO_MODULE,
    });
    expect(edges).toEqual([]);
  });

  it("without a go.mod every import stays external", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["cmd/main.go", [{ source: "example.com/fixture/server", kind: "go-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: GO_FILES, workspacePackages: [], goModulePath: null,
    });
    expect(edges).toEqual([]);
    // and the option is optional — omitting it behaves like "no go.mod"
    expect(
      resolveImportEdges({ importsByFile, knownFiles: GO_FILES, workspacePackages: [] }),
    ).toEqual([]);
  });

  it("modules.resolveModuleEdges groups Go package edges into module edges", () => {
    const modules: Module[] = [
      { id: "cmd", paths: ["cmd/main.go"], symbolCount: 1 },
      { id: "server", paths: ["server/server.go"], symbolCount: 3 },
    ];
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["cmd/main.go", [{ source: "example.com/fixture/server", kind: "go-import" }]],
    ]);
    const fileEdges = resolveImportEdges({
      importsByFile, knownFiles: GO_FILES, workspacePackages: [], goModulePath: GO_MODULE,
    });
    const moduleEdges = resolveModuleEdges(modules, importsByFile, GO_FILES, fileEdges);
    expect(moduleEdges).toEqual([{ from: "cmd", to: "server" }]);
  });
});

describe("import-resolution.loadGoModulePath (roadmap item 19)", () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-gomod-"));
  });
  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("reads the module directive from a root go.mod", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "go.mod"),
      "module example.com/fixture\n\ngo 1.22\n\nrequire github.com/x/y v1.0.0\n",
    );
    expect(await loadGoModulePath(repoRoot)).toBe("example.com/fixture");
  });

  it("tolerates a trailing line comment on the module directive", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "go.mod"),
      "module example.com/fixture // pinned\n",
    );
    expect(await loadGoModulePath(repoRoot)).toBe("example.com/fixture");
  });

  it("returns null when go.mod is missing", async () => {
    expect(await loadGoModulePath(repoRoot)).toBeNull();
  });

  it("returns null when go.mod has no module directive", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "go.mod"), "go 1.22\n");
    expect(await loadGoModulePath(repoRoot)).toBeNull();
  });
});

describe("import-resolution.resolveImportEdges (Rust, roadmap item 20)", () => {
  const RS_FILES = new Set([
    "src/main.rs",
    "src/server.rs",
    "src/models.rs",
    "src/server/handler.rs",
    "src/legacy/mod.rs",
    "tests/api.rs",
  ]);

  function rsEdges(
    importsByFile: Map<string, ExtractedImport[]>,
    knownFiles: ReadonlySet<string> = RS_FILES,
    rustCrateName: string | null = "fixture",
  ): ResolvedImportEdge[] {
    return resolveImportEdges({
      importsByFile, knownFiles, workspacePackages: [], rustCrateName,
    });
  }

  it("mod foo; resolves to foo.rs under the current file's module dir", () => {
    const edges = rsEdges(new Map([
      ["src/main.rs", [{ source: "server", kind: "rust-mod" }]],
    ]));
    expect(edges).toEqual([
      { fromFile: "src/main.rs", toFile: "src/server.rs", source: "server" },
    ]);
  });

  it("mod foo; resolves to foo/mod.rs when only that form exists", () => {
    const edges = rsEdges(new Map([
      ["src/main.rs", [{ source: "legacy", kind: "rust-mod" }]],
    ]));
    expect(edges).toEqual([
      { fromFile: "src/main.rs", toFile: "src/legacy/mod.rs", source: "legacy" },
    ]);
  });

  it("mod foo; inside src/server.rs resolves under src/server/ (stem dir)", () => {
    const edges = rsEdges(new Map([
      ["src/server.rs", [{ source: "handler", kind: "rust-mod" }]],
    ]));
    expect(edges).toEqual([
      { fromFile: "src/server.rs", toFile: "src/server/handler.rs", source: "handler" },
    ]);
  });

  it("crate::a::Item resolves to the file owning the longest module prefix", () => {
    const edges = rsEdges(new Map([
      ["src/main.rs", [
        { source: "crate::server::Server", kind: "rust-use" },
        { source: "crate::server::handler::run", kind: "rust-use" },
      ]],
    ]));
    expect(edges).toEqual([
      { fromFile: "src/main.rs", toFile: "src/server.rs", source: "crate::server::Server" },
      { fromFile: "src/main.rs", toFile: "src/server/handler.rs", source: "crate::server::handler::run" },
    ]);
  });

  it("self:: resolves relative to the current file's module dir", () => {
    const edges = rsEdges(new Map([
      ["src/server.rs", [{ source: "self::handler::run", kind: "rust-use" }]],
    ]));
    expect(edges).toEqual([
      { fromFile: "src/server.rs", toFile: "src/server/handler.rs", source: "self::handler::run" },
    ]);
  });

  it("super:: climbs one module dir per super segment", () => {
    const edges = rsEdges(new Map([
      ["src/server/handler.rs", [
        { source: "super::models::Request", kind: "rust-use" },
        { source: "super::super::models::Request", kind: "rust-use" },
      ]],
    ]));
    // super:: from src/server/handler.rs climbs to src/ (moduleDir is
    // src/server/handler; one super → src/server — models is NOT there, so
    // only the two-super form reaching src/ resolves).
    expect(edges).toEqual([
      { fromFile: "src/server/handler.rs", toFile: "src/models.rs", source: "super::super::models::Request" },
    ]);
  });

  it("the crate's own name resolves like crate:: (integration-test form)", () => {
    const edges = rsEdges(new Map([
      ["tests/api.rs", [{ source: "fixture::server::Server", kind: "rust-use" }]],
    ]));
    expect(edges).toEqual([
      { fromFile: "tests/api.rs", toFile: "src/server.rs", source: "fixture::server::Server" },
    ]);
  });

  it("a hyphenated package name matches its underscored use path", () => {
    const edges = rsEdges(new Map([
      ["tests/api.rs", [{ source: "my_fixture::server::Server", kind: "rust-use" }]],
    ]), RS_FILES, "my-fixture");
    expect(edges).toEqual([
      { fromFile: "tests/api.rs", toFile: "src/server.rs", source: "my_fixture::server::Server" },
    ]);
  });

  it("external crates (std, third-party) stay external; unknown paths too", () => {
    const edges = rsEdges(new Map([
      ["src/main.rs", [
        { source: "std::fmt", kind: "rust-use" },
        { source: "tokio::runtime::Runtime", kind: "rust-use" },
        { source: "crate::nonexistent::Thing", kind: "rust-use" },
      ]],
    ]));
    expect(edges).toEqual([]);
  });

  it("without Cargo.toml the own-name form stays external but crate/self/super still resolve", () => {
    const edges = rsEdges(new Map([
      ["src/main.rs", [
        { source: "fixture::server::Server", kind: "rust-use" },
        { source: "crate::server::Server", kind: "rust-use" },
      ]],
    ]), RS_FILES, null);
    expect(edges).toEqual([
      { fromFile: "src/main.rs", toFile: "src/server.rs", source: "crate::server::Server" },
    ]);
    // and the option is optional — omitting it behaves like "no Cargo.toml"
    expect(
      resolveImportEdges({
        importsByFile: new Map([
          ["src/main.rs", [{ source: "crate::server::Server", kind: "rust-use" }]],
        ]),
        knownFiles: RS_FILES, workspacePackages: [],
      }),
    ).toEqual([
      { fromFile: "src/main.rs", toFile: "src/server.rs", source: "crate::server::Server" },
    ]);
  });

  it("crate:: falls back to the repo root when no src/lib.rs or src/main.rs exists", () => {
    const files = new Set(["lib.rs", "server.rs"]);
    const edges = rsEdges(new Map([
      ["lib.rs", [{ source: "crate::server::Server", kind: "rust-use" }]],
    ]), files, null);
    expect(edges).toEqual([
      { fromFile: "lib.rs", toFile: "server.rs", source: "crate::server::Server" },
    ]);
  });

  it("modules.resolveModuleEdges groups Rust file edges into module edges", () => {
    const modules: Module[] = [
      { id: "main", paths: ["src/main.rs"], symbolCount: 1 },
      { id: "server", paths: ["src/server.rs"], symbolCount: 3 },
    ];
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main.rs", [
        { source: "server", kind: "rust-mod" },
        { source: "crate::server::Server", kind: "rust-use" },
      ]],
    ]);
    const fileEdges = resolveImportEdges({
      importsByFile, knownFiles: RS_FILES, workspacePackages: [], rustCrateName: "fixture",
    });
    const moduleEdges = resolveModuleEdges(modules, importsByFile, RS_FILES, fileEdges);
    expect(moduleEdges).toEqual([{ from: "main", to: "server" }]);
  });
});

describe("import-resolution.loadRustCrateName (roadmap item 20)", () => {
  let repoRoot: string;
  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-cargo-"));
  });
  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("reads the package name from a root Cargo.toml", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "Cargo.toml"),
      '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
    );
    expect(await loadRustCrateName(repoRoot)).toBe("fixture");
  });

  it("tolerates comments and ignores name keys outside [package]", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "Cargo.toml"),
      '# top comment\n[package] # the package section\nname = "fixture" # pinned\n\n[lib]\nname = "other"\n',
    );
    expect(await loadRustCrateName(repoRoot)).toBe("fixture");
  });

  it("returns null when Cargo.toml is missing", async () => {
    expect(await loadRustCrateName(repoRoot)).toBeNull();
  });

  it("returns null when [package] has no name", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "Cargo.toml"),
      '[package]\nversion = "0.1.0"\n',
    );
    expect(await loadRustCrateName(repoRoot)).toBeNull();
  });
});

describe("import-resolution.resolveImportEdges (Java, roadmap item 21)", () => {
  const JAVA_FILES = new Set([
    "src/main/java/com/fixture/Main.java",
    "src/main/java/com/fixture/server/Server.java",
    "src/main/java/com/fixture/server/Handler.java",
    "src/main/java/com/fixture/server/Mode.java",
    "src/main/java/com/fixture/model/Item.java",
  ]);

  it("resolves a plain import to the direct .java files of the package dir", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/fixture/Main.java", [{ source: "com.fixture.server.Server", kind: "java-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    expect(edges.map((e) => e.toFile)).toEqual([
      "src/main/java/com/fixture/server/Handler.java",
      "src/main/java/com/fixture/server/Mode.java",
      "src/main/java/com/fixture/server/Server.java",
    ]);
    expect(edges.every((e) => e.fromFile === "src/main/java/com/fixture/Main.java")).toBe(true);
  });

  it("resolves a wildcard import to the package dir itself", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/fixture/Main.java", [{ source: "com.fixture.model", kind: "java-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    expect(edges.map((e) => e.toFile)).toEqual(["src/main/java/com/fixture/model/Item.java"]);
  });

  it("resolves a static import dropping the member via the longest-prefix walk", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/fixture/Main.java", [{ source: "com.fixture.server.Server.create", kind: "java-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    expect(edges.map((e) => e.toFile)).toEqual([
      "src/main/java/com/fixture/server/Handler.java",
      "src/main/java/com/fixture/server/Mode.java",
      "src/main/java/com/fixture/server/Server.java",
    ]);
  });

  it("java.* and unknown packages stay external (no edge)", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      [
        "src/main/java/com/fixture/Main.java",
        [
          { source: "java.util.List", kind: "java-import" },
          { source: "javax.net.ssl.SSLSocket", kind: "java-import" },
          { source: "com.fixture.missing.Thing", kind: "java-import" },
          { source: "org.springframework.boot.SpringApplication", kind: "java-import" },
        ],
      ],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    expect(edges).toEqual([]);
  });

  it("does NOT resolve into nested subdirectories (an import names exactly one package)", () => {
    const files = new Set([
      "src/main/java/com/acme/Main.java",
      "src/main/java/com/acme/server/internal/Hidden.java",
    ]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      // importing the PARENT package must not pull files from child dirs
      ["src/main/java/com/acme/Main.java", [{ source: "com.acme.server", kind: "java-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: files, workspacePackages: [],
    });
    expect(edges).toEqual([]);
  });

  it("drops the self-edge when a file imports its own package", () => {
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/fixture/server/Server.java", [{ source: "com.fixture.server.Handler", kind: "java-import" }]],
    ]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    expect(edges.map((e) => e.toFile)).toEqual([
      "src/main/java/com/fixture/server/Handler.java",
      "src/main/java/com/fixture/server/Mode.java",
    ]);
  });

  it("source-root order: src/main/java wins over src/ and the repo root", () => {
    const files = new Set([
      "src/main/java/com/acme/server/FromMaven.java",
      "src/com/acme/server/FromSrc.java",
      "com/acme/server/FromRoot.java",
    ]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/acme/Main.java", [{ source: "com.acme.server.Server", kind: "java-import" }]],
    ]);
    // Main.java itself is only a path in the map; knownFiles drives the root
    // pick and the package walk.
    const known = new Set([...files, "src/main/java/com/acme/Main.java"]);
    const edges = resolveImportEdges({
      importsByFile, knownFiles: known, workspacePackages: [],
    });
    expect(edges.map((e) => e.toFile)).toEqual(["src/main/java/com/acme/server/FromMaven.java"]);
  });

  it("falls back to src/ when no src/main/java file exists, then to the repo root", () => {
    const srcFiles = new Set(["src/com/acme/Main.java", "src/com/acme/server/Server.java"]);
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/com/acme/Main.java", [{ source: "com.acme.server.Server", kind: "java-import" }]],
    ]);
    expect(
      resolveImportEdges({ importsByFile, knownFiles: srcFiles, workspacePackages: [] }).map((e) => e.toFile),
    ).toEqual(["src/com/acme/server/Server.java"]);

    const rootFiles = new Set(["com/acme/Main.java", "com/acme/server/Server.java"]);
    const rootImports = new Map<string, ExtractedImport[]>([
      ["com/acme/Main.java", [{ source: "com.acme.server.Server", kind: "java-import" }]],
    ]);
    expect(
      resolveImportEdges({ importsByFile: rootImports, knownFiles: rootFiles, workspacePackages: [] }).map((e) => e.toFile),
    ).toEqual(["com/acme/server/Server.java"]);
  });

  it("modules.resolveModuleEdges groups Java package edges into module edges", () => {
    const modules: Module[] = [
      { id: "app", paths: ["src/main/java/com/fixture/Main.java"], symbolCount: 1 },
      { id: "server", paths: ["src/main/java/com/fixture/server/Server.java"], symbolCount: 3 },
    ];
    const importsByFile = new Map<string, ExtractedImport[]>([
      ["src/main/java/com/fixture/Main.java", [{ source: "com.fixture.server.Server", kind: "java-import" }]],
    ]);
    const fileEdges = resolveImportEdges({
      importsByFile, knownFiles: JAVA_FILES, workspacePackages: [],
    });
    const moduleEdges = resolveModuleEdges(modules, importsByFile, JAVA_FILES, fileEdges);
    expect(moduleEdges).toEqual([{ from: "app", to: "server" }]);
  });
});
