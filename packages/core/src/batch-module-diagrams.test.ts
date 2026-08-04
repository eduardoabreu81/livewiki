/**
 * batch-module-diagrams.test.ts — roadmap item 22 (CodeWiki-grade module
 * pages), stage-4 stub E2E with an injected MockLlm (zero paid calls):
 *
 *   - moduleDiagrams + deepHierarchy on: the model emits the diagram INLINE,
 *     the orchestrator extracts it to livewiki/diagrams/<slug>.mmd, the page
 *     keeps ONLY the %% placeholder, the .mmd passes the Mermaid parser,
 *     verify ends with zero issues, and the checkpoint records
 *     diagramPath/diagramHash;
 *   - a page without the Diagram section fails with
 *     module_diagram_placeholder, the repair prompt carries the classified
 *     ACTION directive, and the repaired attempt lands;
 *   - --only rerun: monotonic usage attempts, page + diagram rewritten
 *     transactionally and byte-identical under a deterministic mock;
 *   - flags off ⇒ byte-identical pre-#22 behavior: no extraction, no .mmd,
 *     no diagram rules in the prompt, page written exactly as emitted.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, runOnly } from "./batch.js";
import { run as runVerify } from "./verify.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";

// === Fixture helpers ===

/** Parse the closed key list out of any stage-4 user prompt. */
function parseClosedKeys(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

const INLINE_DIAGRAM = "flowchart LR\n  connect --> close";

/**
 * Valid stage-4 module page. When `withDiagram` the page carries the
 * model-emitted INLINE `## Diagram` mermaid block (roadmap #22 form); the
 * orchestrator substitutes the placeholder on disk.
 */
function makeModulePage(closedKeyList: string[], withDiagram: boolean): string {
  return [
    "---",
    "title: Core data layer",
    "owner: generated",
    "anchors:",
    ...closedKeyList.map((k) => `  - ${k}`),
    "---",
    "",
    "# Core data layer",
    "",
    "This page documents the module's indexed responsibilities.",
    "",
    "## When to use this page",
    "",
    "- Review this module's behavior.",
    "- Change this module's implementation.",
    "",
    "## How it fits",
    "",
    "This module provides one part of the repository implementation.",
    "",
    ...(withDiagram
      ? ["## Diagram", "", "```mermaid", INLINE_DIAGRAM, "```", ""]
      : []),
    "## Details",
    "",
    `<!-- lw:anchors ${closedKeyList.join(" ")} -->`,
    "",
    "The connect and close functions manage the data layer lifecycle.",
    "",
  ].join("\n");
}

class ModuleDiagramMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "mock-module-diagram";
  public callLog: Array<{ system: string; user: string; maxTokens: number | undefined }> = [];
  /** When true, the FIRST stage-4 response omits the Diagram section. */
  public failFirstWithoutDiagram = false;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callLog.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    const closedKeys = parseClosedKeys(req.user);
    const withDiagram = !(this.failFirstWithoutDiagram && this.callLog.length === 1);
    return { content: makeModulePage(closedKeys, withDiagram), usage };
  }
}

/** Single-module product repo: one `core` directory, two exported symbols. */
async function writeModuleRepo(root: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(root, "core"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, "core/db.ts"),
    'export function connect() { return "db"; }\nexport function close() { return true; }\n',
    "utf8",
  );
}

async function writeConfig(root: string, extra: Record<string, unknown>): Promise<void> {
  await nodeFs.mkdir(nodePath.join(root, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, ".livewiki/config.json"),
    JSON.stringify({
      maxFlows: 0,
      maxTopics: 0,
      understandingSynthesis: false,
      ...extra,
    }),
    "utf8",
  );
}

async function readTaskCheckpoint(
  root: string,
  stage: number,
  target: string,
): Promise<TaskCheckpoint | null> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), { readonly: true });
  try {
    const row = db
      .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = ? AND target = ?")
      .get(stage, target) as { checkpoint_json: string | null } | undefined;
    return row?.checkpoint_json ? (JSON.parse(row.checkpoint_json) as TaskCheckpoint) : null;
  } finally {
    db.close();
  }
}

async function readFile(root: string, rel: string): Promise<string | null> {
  return nodeFs.readFile(nodePath.join(root, rel), "utf8").catch(() => null);
}

const PAGE_PATH = "livewiki/core.md";
const DIAGRAM_PATH = "livewiki/diagrams/core.mmd";
const PLACEHOLDER = "%% livewiki/diagrams/core.mmd";

let repoRoot: string;
let llm: ModuleDiagramMockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-item22-"));
  llm = new ModuleDiagramMockLlm();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === E2E: flags on ===

describe("batch — moduleDiagrams + deepHierarchy (roadmap item 22)", () => {
  it("extracts the inline diagram, writes page + .mmd transactionally, verify zero", async () => {
    await writeModuleRepo(repoRoot);
    await writeConfig(repoRoot, { moduleDiagrams: true, deepHierarchy: true });

    const result = await runBatch({ repoRoot, llmClient: llm, noRefine: true, skipManifestWrite: true });
    expect(result.status).toBe("completed");
    expect(result.tasksDone).toBe(1);
    expect(result.tasksFailed).toBe(0);

    // The page carries ONLY the exact placeholder, never the inline diagram.
    const page = await readFile(repoRoot, PAGE_PATH);
    expect(page).not.toBeNull();
    expect(page).toContain(PLACEHOLDER);
    expect(page).not.toContain("connect --> close");

    // The .mmd holds the model-drawn source (never the placeholder) and parses.
    const diagram = await readFile(repoRoot, DIAGRAM_PATH);
    expect(diagram).not.toBeNull();
    expect(diagram).toContain("flowchart LR");
    expect(diagram).toContain("connect --> close");
    expect(diagram).not.toContain("%%");
    expect(await validateMermaidSyntax(diagram!)).toBeNull();

    // Verify: zero issues of any severity.
    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      verify.issues.filter((i) => i.wikiPath === PAGE_PATH || i.wikiPath === DIAGRAM_PATH),
    ).toEqual([]);

    // Checkpoint: done, with the diagram recorded in artifacts.
    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "core");
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.artifacts?.wikiPath).toBe(PAGE_PATH);
    expect(checkpoint?.artifacts?.diagramPath).toBe(DIAGRAM_PATH);
    expect(checkpoint?.artifacts?.diagramHash).toMatch(/^[0-9a-f]{64}$/);

    // The flags reached the prompt: diagram rules + hierarchy guidance.
    expect(llm.callLog.length).toBe(1);
    expect(llm.callLog[0]!.system).toContain("emit ONE H2 `Diagram` section");
    expect(llm.callLog[0]!.system).toContain("at most 12 nodes and 20 edges");
    expect(llm.callLog[0]!.system).toContain("concept-named H2 sections");
  });

  it("missing Diagram section → module_diagram_placeholder repair with ACTION directive, then lands", async () => {
    await writeModuleRepo(repoRoot);
    await writeConfig(repoRoot, { moduleDiagrams: true });
    llm.failFirstWithoutDiagram = true;

    const result = await runBatch({ repoRoot, llmClient: llm, noRefine: true, skipManifestWrite: true });
    expect(result.status).toBe("completed");
    expect(llm.callLog.length).toBe(2);

    // The repair prompt carries the structured code and the classified directive.
    const repairUser = llm.callLog[1]!.user;
    expect(repairUser).toContain("[module_diagram_placeholder]");
    expect(repairUser).toContain("ACTION:");
    expect(repairUser).toContain("## Diagram");

    // Final state is the full contract.
    const page = await readFile(repoRoot, PAGE_PATH);
    expect(page).toContain(PLACEHOLDER);
    const diagram = await readFile(repoRoot, DIAGRAM_PATH);
    expect(diagram).toContain("connect --> close");
    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      verify.issues.filter((i) => i.wikiPath === PAGE_PATH || i.wikiPath === DIAGRAM_PATH),
    ).toEqual([]);

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "core");
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.usageHistory.map((u) => u.attempt)).toEqual([1, 2]);
  });

  it("--only rerun: monotonic attempts, transactional rewrite, byte-identical under a deterministic mock", async () => {
    await writeModuleRepo(repoRoot);
    await writeConfig(repoRoot, { moduleDiagrams: true });

    await runBatch({ repoRoot, llmClient: llm, noRefine: true, skipManifestWrite: true });
    const pageBefore = await readFile(repoRoot, PAGE_PATH);
    const diagramBefore = await readFile(repoRoot, DIAGRAM_PATH);

    const rerun = await runOnly({ repoRoot, llmClient: llm, onlyTarget: "core", noRefine: true, skipManifestWrite: true });
    expect(rerun.status).toBe("completed");

    // Page and diagram rewritten consistently (same bytes — deterministic mock).
    expect(await readFile(repoRoot, PAGE_PATH)).toBe(pageBefore);
    expect(await readFile(repoRoot, DIAGRAM_PATH)).toBe(diagramBefore);

    // Usage attempts are monotonic across the rerun (checkpoint pattern).
    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "core");
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.usageHistory.map((u) => u.attempt)).toEqual([1, 2]);
    expect(checkpoint?.artifacts?.diagramPath).toBe(DIAGRAM_PATH);

    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      verify.issues.filter((i) => i.wikiPath === PAGE_PATH || i.wikiPath === DIAGRAM_PATH),
    ).toEqual([]);
  });
});

// === E2E: flags off ⇒ byte-identical pre-#22 behavior ===

describe("batch — module format flags off (pre-#22 contract)", () => {
  it("no extraction, no .mmd, no diagram rules in the prompt, page written as emitted", async () => {
    await writeModuleRepo(repoRoot);
    // Explicitly pinned off — the defaults flipped to ON after the #22 A/B.
    await writeConfig(repoRoot, { moduleDiagrams: false, deepHierarchy: false });

    // The mock emits an inline Diagram section anyway: with the flags off the
    // orchestrator must NOT touch it — the page lands exactly as emitted.
    const result = await runBatch({ repoRoot, llmClient: llm, noRefine: true, skipManifestWrite: true });
    expect(result.status).toBe("completed");

    const page = await readFile(repoRoot, PAGE_PATH);
    expect(page).toContain(INLINE_DIAGRAM);
    expect(page).not.toContain(PLACEHOLDER);
    expect(await readFile(repoRoot, DIAGRAM_PATH)).toBeNull();

    expect(llm.callLog[0]!.system).not.toContain("emit ONE H2 `Diagram` section");
    expect(llm.callLog[0]!.system).not.toContain("concept-named H2 sections");

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "core");
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.artifacts?.diagramPath).toBeUndefined();

    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      verify.issues.filter((i) => i.wikiPath === PAGE_PATH || i.wikiPath === DIAGRAM_PATH),
    ).toEqual([]);
  });
});
