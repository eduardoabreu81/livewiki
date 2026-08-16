import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { writeBaseline } from "@livewiki/core/baseline";
import { createProgram } from "./cli.js";

let repoRoot: string;
let previousExitCode: number | string | null | undefined;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-cli-baseline-"));
  previousExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("baseline command", () => {
  it("registers the closed lifecycle subcommands", () => {
    const command = createProgram().commands.find((item) => item.name() === "baseline");
    expect(command?.commands.map((item) => item.name()))
      .toEqual(["status", "bootstrap", "accept", "move", "remove", "relocate"]);
  });

  it("accepts all anchors on an explicitly named page and emits JSON", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src", "service.ts"),
      "export function run() { return 1; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki", "service.md"),
      "---\ntitle: Service\nowner: generated\nanchors:\n" +
        "  - src/service.ts#run\n---\n\n# Service\n",
      "utf8",
    );
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await createProgram().parseAsync([
      "node",
      "livewiki",
      "--repo",
      repoRoot,
      "--json",
      "baseline",
      "accept",
      "--page",
      "livewiki/service.md",
      "--all",
    ]);

    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      page: "livewiki/service.md",
      accepted: ["src/service.ts#run"],
    });
  });
});
