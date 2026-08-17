import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Published tarballs must never ship compiled test artifacts. `tsc` emits
 * `dist/*.test.js` / `.test.d.ts` / `.js.map` / `.d.ts.map` because
 * `*.test.ts` is part of the build graph, and `files: ["dist"]` used to pack
 * them (core alone grew to 324 test-file entries). The fix is the
 * `!dist/**\/*.test.*` negation in each package's `files` field. This test
 * locks BOTH the config and the real `npm pack --dry-run` contents so the
 * defect cannot silently return.
 */
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const repoRoot = nodePath.resolve(here, "..", "..", "..");

const PACKAGES = [
  {
    name: "core",
    runtime: ["dist/index.js"],
    also: "grammars/tree-sitter-typescript.wasm",
  },
  {
    name: "cli",
    runtime: ["dist/index.js", "dist/cli.js"],
    also: "skills/document-as-you-go/SKILL.md",
  },
  {
    name: "mcp",
    runtime: ["dist/index.js", "dist/server.js"],
    also: "dist/stdio.js",
  },
] as const;

function packFilePaths(pkgDir: string): string[] {
  // Single-string form: avoids the DEP0190 "args + shell:true" warning while
  // staying cross-platform (shell resolves `npm` → `npm.cmd` on Windows).
  const result = spawnSync("npm pack --dry-run --json", {
    cwd: pkgDir,
    shell: true,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const first = (list[0] as { files?: { path: string }[] } | undefined) ?? {};
  return (first.files ?? []).map((entry) => entry.path);
}

for (const pkg of PACKAGES) {
  const dir = nodePath.join(repoRoot, "packages", pkg.name);

  describe(`@livewiki/${pkg.name} tarball`, () => {
    it("files field excludes compiled test artifacts", () => {
      const pkgJson = JSON.parse(
        nodeFs.readFileSync(nodePath.join(dir, "package.json"), "utf8"),
      ) as { files?: string[] };
      expect(pkgJson.files).toContain("!dist/**/*.test.*");
    });

    it("npm pack ships no test files and keeps runtime entries", () => {
      // Requires a prior `pnpm -r build`, like the CLI E2E suites.
      expect(
        nodeFs.existsSync(nodePath.join(dir, "dist", "index.js")),
        `${pkg.name}: run \`pnpm -r build\` before the pack test`,
      ).toBe(true);

      const paths = packFilePaths(dir);
      expect(
        paths.filter((p) => /\.test\./.test(p)),
        "compiled test artifacts leaked into the tarball",
      ).toEqual([]);
      for (const runtime of pkg.runtime) {
        expect(paths, `missing runtime entry ${runtime}`).toContain(runtime);
      }
      expect(paths, `missing ${pkg.also}`).toContain(pkg.also);
    });
  });
}
