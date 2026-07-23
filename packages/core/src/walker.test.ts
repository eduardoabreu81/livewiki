import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { walkRepo, EXTENSION_LANG } from "./walker.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-walker-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function write(rel: string, content = ""): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("EXTENSION_LANG", () => {
  it("cobre TS/TSX/JS/JSX/Python", () => {
    expect(EXTENSION_LANG[".ts"]).toBe("typescript");
    expect(EXTENSION_LANG[".tsx"]).toBe("tsx");
    expect(EXTENSION_LANG[".js"]).toBe("javascript");
    expect(EXTENSION_LANG[".jsx"]).toBe("tsx");
    expect(EXTENSION_LANG[".py"]).toBe("python");
  });
});

describe("walkRepo", () => {
  it("retorna arquivos indexáveis com lang correta", async () => {
    await write("src/foo.ts", "export const x = 1");
    await write("src/bar.py", "def f(): pass");
    await write("README.md", "# readme");

    const result = await walkRepo(repoRoot);
    const paths = result.map((r) => r.path).sort();

    // README.md is tier-2 prose (SPEC coverage ladder): walked with lang "md".
    expect(paths).toEqual(["README.md", "src/bar.py", "src/foo.ts"]);
    expect(result.find((r) => r.path === "src/foo.ts")?.lang).toBe("typescript");
    expect(result.find((r) => r.path === "src/bar.py")?.lang).toBe("python");
    expect(result.find((r) => r.path === "README.md")?.lang).toBe("md");
  });

  it("ignora node_modules/ por default (defesa em profundidade)", async () => {
    await write("src/foo.ts");
    await write("node_modules/lib/index.js");
    await write("node_modules/lib/types.d.ts"); // arquivos irrelevantes tb

    const result = await walkRepo(repoRoot);
    const paths = result.map((r) => r.path);
    expect(paths).toEqual(["src/foo.ts"]);
  });

  it("ignora .git/ por default", async () => {
    await write("src/foo.ts");
    await write(".git/HEAD", "ref: refs/heads/main");

    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
  });

  it("ignora dist/ e coverage/ por default", async () => {
    await write("src/foo.ts");
    await write("dist/bundle.js");
    await write("coverage/lcov.info");

    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
  });

  it("respeita .gitignore do repo", async () => {
    await write("src/foo.ts");
    await write("src/skipme.ts");
    await write("build/output.js");
    await write("node_modules/x.js", ""); // ignorado pelo default tb
    await write(".gitignore", "src/skipme.ts\nbuild/\n");

    const result = await walkRepo(repoRoot);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(["src/foo.ts"]);
  });

  it("extraIgnores sobrepõe ao .gitignore", async () => {
    await write("src/foo.ts");
    await write("src/special.ts");
    await write(".gitignore", "src/special.ts\n");

    const result = await walkRepo(repoRoot, { extraIgnores: ["src/special.ts"] });
    // src/special.ts já é ignorado pelo .gitignore; foo.ts deveria passar
    expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
  });

  it("retorna paths relativos com forward slashes (cross-platform)", async () => {
    await write("src/sub/deep/file.ts");
    const result = await walkRepo(repoRoot);
    expect(result[0]?.path).toBe("src/sub/deep/file.ts");
    expect(result[0]?.path).not.toContain("\\");
  });

  it("ordem é estável (ordenado por path)", async () => {
    await write("z.ts");
    await write("a.ts");
    await write("m.ts");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("walks unknown text extensions with the extension-derived lang (tier 2)", async () => {
    await write("foo.ts");
    await write("notes.txt", "some notes");
    await write("config.json", "{}");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["config.json", "foo.ts", "notes.txt"]);
    expect(result.find((r) => r.path === "notes.txt")?.lang).toBe("txt");
    expect(result.find((r) => r.path === "config.json")?.lang).toBe("json");
  });

  it("walks code extensions without a grammar (.go .rs .java .rb .zig)", async () => {
    await write("cmd/main.go", "package main");
    await write("src/lib.rs", "fn main() {}");
    await write("App.java", "class App {}");
    await write("app.rb", "puts 1");
    await write("build.zig", "pub fn build() void {}");
    const result = await walkRepo(repoRoot);
    const byPath = new Map(result.map((r) => [r.path, r.lang]));
    expect(byPath.get("cmd/main.go")).toBe("go");
    expect(byPath.get("src/lib.rs")).toBe("rs");
    expect(byPath.get("App.java")).toBe("java");
    expect(byPath.get("app.rb")).toBe("rb");
    expect(byPath.get("build.zig")).toBe("zig");
  });

  it("skips denylist extensions (archives, binaries, media, fonts, maps)", async () => {
    await write("foo.ts");
    await write("lib.dll");
    await write("photo.png");
    await write("app.wasm");
    await write("bundle.js.map");
    await write("font.woff2");
    await write("doc.pdf");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["foo.ts"]);
  });

  it("skips lockfiles by exact basename (case-insensitive)", async () => {
    await write("foo.ts");
    await write("package-lock.json");
    await write("pnpm-lock.yaml");
    await write("yarn.lock");
    await write("Cargo.lock");
    await write("Gemfile.lock");
    await write("poetry.lock");
    await write("go.sum");
    await write("composer.lock");
    await write("other.json", "{}"); // regular .json is still walked
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["foo.ts", "other.json"]);
  });

  it("skips minified bundles but keeps regular .js/.css", async () => {
    await write("app.js");
    await write("app.min.js");
    await write("styles.css");
    await write("styles.min.css");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["app.js", "styles.css"]);
    expect(result.find((r) => r.path === "styles.css")?.lang).toBe("css");
  });

  it("never walks livewiki/ (the generated wiki is not indexed)", async () => {
    await write("src/foo.ts");
    await write("livewiki/quickstart.md", "# quickstart");
    await write("livewiki/architecture/overview.md", "# overview");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
  });

  it("skips extensionless files (no meaningful lang)", async () => {
    await write("foo.ts");
    await write("Makefile", "all:");
    await write("LICENSE", "MIT");
    await write(".gitignore", "dist/\n");
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["foo.ts"]);
  });

  it("walk funciona sem .gitignore (repo fresco)", async () => {
    await write("src/foo.ts");
    await write("node_modules/x.js"); // ainda ignorado pelos defaults
    const result = await walkRepo(repoRoot);
    expect(result.map((r) => r.path)).toEqual(["src/foo.ts"]);
  });
});