import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { applyInstall, planInstall } from "./install.js";

describe("credential-store install actions", () => {
  let home: string;
  let repoRoot: string;

  beforeEach(async () => {
    home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-credential-plan-home-"));
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-credential-plan-repo-"));
  });

  afterEach(async () => {
    await nodeFs.rm(home, { recursive: true, force: true });
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("plans and applies the credential write through planInstall/applyInstall", async () => {
    const plan = await planInstall({
      repoRoot,
      home,
      credential: { envVar: "ANTHROPIC_API_KEY", value: "secret-value" },
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: "credentials",
      status: "write",
      sensitive: true,
    });
    expect(plan[0]?.targetPath).toBe(
      nodePath.join(home, ".livewiki", "credentials.json"),
    );

    const result = await applyInstall(plan, repoRoot);
    expect(result[0]?.applied).toBe(true);
    const stored = JSON.parse(
      await nodeFs.readFile(nodePath.join(home, ".livewiki", "credentials.json"), "utf8"),
    );
    expect(stored).toEqual({ ANTHROPIC_API_KEY: "secret-value" });
  });

  it("preserves existing credentials while replacing the selected env-var entry", async () => {
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(
      storePath,
      JSON.stringify({ OPENAI_API_KEY: "keep-me", ANTHROPIC_API_KEY: "old" }),
      "utf8",
    );

    const plan = await planInstall({
      repoRoot,
      home,
      credential: { envVar: "ANTHROPIC_API_KEY", value: "new" },
    });
    await applyInstall(plan, repoRoot);

    expect(JSON.parse(await nodeFs.readFile(storePath, "utf8"))).toEqual({
      OPENAI_API_KEY: "keep-me",
      ANTHROPIC_API_KEY: "new",
    });
  });

  it("fails clearly on corrupt JSON and leaves the user's file untouched", async () => {
    const storePath = nodePath.join(home, ".livewiki", "credentials.json");
    const corrupt = "{ not-json";
    await nodeFs.mkdir(nodePath.dirname(storePath), { recursive: true });
    await nodeFs.writeFile(storePath, corrupt, "utf8");

    await expect(
      planInstall({
        repoRoot,
        home,
        credential: { envVar: "ANTHROPIC_API_KEY", value: "new" },
      }),
    ).rejects.toThrow(/credentials\.json.*valid JSON/i);
    expect(await nodeFs.readFile(storePath, "utf8")).toBe(corrupt);
  });

  it.skipIf(process.platform === "win32")(
    "writes mode 0600 on POSIX (Windows is skipped because the profile ACL is inherited)",
    async () => {
      const plan = await planInstall({
        repoRoot,
        home,
        credential: { envVar: "ANTHROPIC_API_KEY", value: "secret-value" },
      });
      await applyInstall(plan, repoRoot);
      const stat = await nodeFs.stat(nodePath.join(home, ".livewiki", "credentials.json"));
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );
});
