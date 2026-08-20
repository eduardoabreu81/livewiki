/**
 * Published-bin contract for @livewiki/mcp (RC 0.3.0).
 *
 * Two defects this file exists to keep dead, both found while proving the
 * 0.3.0 tarballs and both invisible from a Windows workstation:
 *
 *   1. `dist/index.js` shipped with no `#!/usr/bin/env node`. On Windows npm
 *      writes .cmd/.ps1 shims that call node explicitly, so nothing broke
 *      locally; on POSIX npm creates a bare symlink and the shebang is the
 *      only thing that names an interpreter, so `livewiki-mcp` was handed to
 *      the shell and died on `syntax error near unexpected token`. The path
 *      that breaks is the documented one: `livewiki install` writes
 *      `npx -y @livewiki/mcp --repo …` into every agent config.
 *   2. The MCP handshake advertised `serverInfo.version: "0.0.0"` from 0.1.0
 *      through 0.2.1 — a literal in server.ts that no release ever touched.
 *
 * Everything here is asserted against the INSTALLED tarball, never against
 * `src/` or the workspace `dist/`, because both defects lived exactly in the
 * gap between what the repo has and what a user receives. The suite packs
 * core + mcp with pnpm (the only packer that resolves `workspace:*`) and
 * installs them into a throwaway prefix with npm, so the bin links are the
 * ones npm really creates.
 *
 * The exec-the-bin case is POSIX-only by nature: on Windows the shim, not the
 * shebang, chooses the interpreter, so there is no defect to observe. Same
 * gating rationale as watcher-retry-e2e.test.ts. The version assertions run
 * everywhere.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodeFsp from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const mcpDir = nodePath.resolve(here, "..");
const repoRoot = nodePath.resolve(mcpDir, "..", "..");
const coreDir = nodePath.join(repoRoot, "packages", "core");

const SHEBANG = "#!/usr/bin/env node";
const isWindows = process.platform === "win32";

// Packing core (294 files, 7 wasm grammars) plus a cold `npm install` that
// fetches better-sqlite3's prebuild is the dominant cost, and it is a network
// round trip on a cold CI cache.
vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

/** Version this checkout would publish — the value every assertion compares against. */
const packageVersion = (
  JSON.parse(nodeFs.readFileSync(nodePath.join(mcpDir, "package.json"), "utf8")) as {
    version: string;
  }
).version;

let workDir: string;
let hostDir: string;
let sampleRepo: string;
let installedMcpDir: string;
let installFailure: string | null = null;

function run(command: string, cwd: string): { status: number; output: string } {
  // Single-string form + shell: resolves `pnpm`/`npm` to their .cmd on
  // Windows and avoids the DEP0190 warning that args + shell:true triggers.
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

beforeAll(async () => {
  workDir = await nodeFsp.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-mcp-bin-"));
  hostDir = nodePath.join(workDir, "host");
  sampleRepo = nodePath.join(workDir, "sample-repo");
  await nodeFsp.mkdir(hostDir, { recursive: true });
  await nodeFsp.mkdir(nodePath.join(sampleRepo, "src"), { recursive: true });
  await nodeFsp.writeFile(
    nodePath.join(sampleRepo, "src", "sample.ts"),
    "export function sample(n: number): number {\n  return n + 1;\n}\n",
    "utf8",
  );

  // pnpm pack, not npm pack: only pnpm rewrites `workspace:*` to the exact
  // version, and an unresolved specifier makes the install unsatisfiable.
  for (const dir of [coreDir, mcpDir]) {
    const packed = run(`pnpm pack --pack-destination "${workDir}"`, dir);
    if (packed.status !== 0) {
      installFailure = `pnpm pack failed in ${dir}:\n${packed.output}`;
      return;
    }
  }

  const coreTarball = nodePath.join(workDir, `livewiki-core-${packageVersion}.tgz`);
  const mcpTarball = nodePath.join(workDir, `livewiki-mcp-${packageVersion}.tgz`);

  run("npm init -y", hostDir);
  // npm 11.17 refuses to run a dependency's install scripts unless the
  // project opts in, and better-sqlite3 plus the tree-sitter grammars are
  // native: without this the install succeeds and the server then dies at
  // require() time. The CLI flag is rejected for project-scoped installs, so
  // the opt-in has to be config. Older npm ignores the unknown key.
  await nodeFsp.writeFile(nodePath.join(hostDir, ".npmrc"), "allow-scripts=true\n", "utf8");
  const installed = run(
    `npm install "${coreTarball}" "${mcpTarball}" --no-audit --no-fund`,
    hostDir,
  );
  if (installed.status !== 0) {
    installFailure = `npm install failed:\n${installed.output}`;
    return;
  }
  installedMcpDir = nodePath.join(hostDir, "node_modules", "@livewiki", "mcp");
});

afterAll(async () => {
  if (!workDir) return;
  // Windows keeps a deleted-but-open SQLite -shm/-wal locked until the last
  // handle goes away, and the server holds one until the OS finishes
  // reaping it. Retry rather than fail the suite on a temp directory.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await nodeFsp.rm(workDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
});

/**
 * Starts `command` and completes an MCP `initialize`, returning serverInfo.
 *
 * `command` is executed as a program with no interpreter in front of it, so
 * for the bin case the kernel — not this test — has to resolve the shebang.
 */
async function handshake(
  command: string,
  args: readonly string[],
): Promise<{ name: string; version: string }> {
  const child: ChildProcess = spawn(command, [...args, "--repo", sampleRepo], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));

  const spawnError = new Promise<never>((_, reject) => {
    child.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
  });

  child.stdin?.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "bin-e2e", version: "1.0.0" },
      },
    })}\n`,
  );

  try {
    return await Promise.race([
      spawnError,
      new Promise<{ name: string; version: string }>((resolve, reject) => {
        const deadline = setTimeout(() => {
          reject(
            new Error(
              `no initialize response within 60s\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
            ),
          );
        }, 60_000);
        const poll = setInterval(() => {
          const line = stdout.split("\n").find((l) => l.includes('"id":1'));
          if (!line) return;
          clearInterval(poll);
          clearTimeout(deadline);
          try {
            const msg = JSON.parse(line) as {
              result?: { serverInfo?: { name: string; version: string } };
            };
            const info = msg.result?.serverInfo;
            if (!info) throw new Error(`no serverInfo in: ${line}`);
            resolve(info);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }, 50);
      }),
    ]);
  } finally {
    // The stdio server deliberately outlives stdin EOF, so a real client
    // terminates it. Roadmap P2 item 12 tracks that.
    child.kill("SIGKILL");
    // Wait for the reap, not just the signal: the index handles this process
    // holds are released on exit, and the temp-dir cleanup runs right after.
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once("close", resolve));
    }
  }
}

describe("@livewiki/mcp published bin", () => {
  it("installs cleanly from the packed tarballs", () => {
    expect(installFailure, installFailure ?? "").toBeNull();
    expect(nodeFs.existsSync(installedMcpDir)).toBe(true);
  });

  it("the installed entry point starts with the node shebang, byte for byte", () => {
    expect(installFailure, installFailure ?? "").toBeNull();
    const entry = nodePath.join(installedMcpDir, "dist", "index.js");
    // Read bytes, not lines: a BOM or a CRLF ahead of `#!` is invisible in a
    // trimmed string comparison and fatal to execve.
    const head = nodeFs.readFileSync(entry).subarray(0, SHEBANG.length + 1);
    expect(head.toString("utf8")).toBe(`${SHEBANG}\n`);
  });

  it("declares the bin that entry point backs", () => {
    expect(installFailure, installFailure ?? "").toBeNull();
    const pkg = JSON.parse(
      nodeFs.readFileSync(nodePath.join(installedMcpDir, "package.json"), "utf8"),
    ) as { version: string; bin: Record<string, string> };
    expect(pkg.version).toBe(packageVersion);
    expect(pkg.bin).toEqual({ "livewiki-mcp": "dist/index.js" });
  });

  it("reports the package version in the MCP handshake, never 0.0.0", async () => {
    expect(installFailure, installFailure ?? "").toBeNull();
    const entry = nodePath.join(installedMcpDir, "dist", "index.js");
    const info = await handshake(process.execPath, [entry]);
    expect(info.name).toBe("livewiki");
    expect(info.version).toBe(packageVersion);
    expect(info.version).not.toBe("0.0.0");
  });

  // On Windows the .cmd shim names node explicitly, so neither the shebang
  // nor the exec bit is load-bearing and there is nothing here to regress.
  describe.skipIf(isWindows)("POSIX bin link", () => {
    const binPath = () => nodePath.join(hostDir, "node_modules", ".bin", "livewiki-mcp");

    it("is executable after pack + install", () => {
      expect(installFailure, installFailure ?? "").toBeNull();
      // statSync follows the symlink npm creates, so this is the mode of the
      // file execve will actually load.
      const mode = nodeFs.statSync(binPath()).mode;
      expect(mode & 0o111).not.toBe(0);
    });

    it("starts over its own shebang, with no `node` in front of it", async () => {
      expect(installFailure, installFailure ?? "").toBeNull();
      // No interpreter argument anywhere: if the shebang is missing, the
      // shell takes the file and this fails on a syntax error instead.
      const info = await handshake(binPath(), []);
      expect(info.name).toBe("livewiki");
      expect(info.version).toBe(packageVersion);
      expect(info.version).not.toBe("0.0.0");
    });
  });
});
