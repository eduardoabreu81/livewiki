/**
 * MCP agent bootstrap queue — end-to-end contract.
 *
 * The client supplies the prose with its own model. Livewiki supplies only
 * deterministic task metadata and validates every submitted artifact. No
 * provider config, model, API key, or external agent process participates.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import { buildStatusReport } from "@livewiki/core/batch-status";
import { openIndex } from "@livewiki/core/db";
import { run as runVerify } from "@livewiki/core/verify";
import { run as runIndexer } from "@livewiki/core/indexer";
import { run as runStatus } from "@livewiki/core/status";
import { markDegradedArtifact } from "@livewiki/core/artifact";
import { prompts } from "@livewiki/core";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

type TaskKind = "file-page" | "folder-page" | "flow" | "topic" | "understanding";

interface QueueTask {
  taskId: number;
  kind: TaskKind;
  targetPath: string;
  closedKeys: string[];
  sourcePaths: string[];
  formatContract: { system: string; user: string };
  validation: {
    moduleDiagramPath?: string;
    title?: string;
    order?: number;
    intent?: string;
    modules?: string[];
    flows?: string[];
    sectionByKey?: Record<string, string>;
  };
  attempts: { used: number; limit: number };
  claimId: string;
  leaseExpiresAt: number;
}

interface QueueResponse {
  runId: number;
  status: "task" | "completed" | "completed_with_failures";
  task?: QueueTask;
  accounting: "unavailable";
  topicRefine: "not-run";
}

/**
 * Forces a claim to lapse. The lease is 30 minutes of wall clock, so tests
 * move the deadline into the past instead of waiting or faking timers — the
 * production code reads Date.now() at the moment of the query, so this
 * exercises the real expiry predicate.
 */
function expireLease(root: string, taskId: number): void {
  const db = openIndex(nodePath.join(root, ".livewiki", "index.db"));
  try {
    db.prepare("UPDATE batch_tasks SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1000, taskId);
  } finally {
    db.close();
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-agent-bootstrap-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src", "api"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src", "service"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src", "store"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "README.md"),
    "# Queue fixture\n\nA small service used to prove agent-written bootstrap.\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src", "api", "request.ts"),
    [
      "import { processValue } from '../service/process.js';",
      "export function handleRequest(value: string) { return processValue(value); }",
      "export function validateRequest(value: string) { return value.length > 0; }",
      "",
    ].join("\n"),
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src", "service", "process.ts"),
    [
      "import { persist } from '../store/state.js';",
      "export function processValue(value: string) { return persist(value); }",
      "export function normalizeValue(value: string) { return value.trim(); }",
      "",
    ].join("\n"),
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src", "store", "state.ts"),
    [
      "export function persist(value: string) { return value; }",
      "export function loadState() { return 'ready'; }",
      "",
    ].join("\n"),
  );
  // Format features stay enabled. There is deliberately no provider/model
  // and no credential file or environment variable configured.
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki", "config.json"),
    JSON.stringify({ language: "en", maxRepairAttempts: 1 }, null, 2) + "\n",
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function connect(verify?: typeof runVerify): Promise<{ client: Client; server: McpServer }> {
  const server = await createServer({ repoRoot, ...(verify !== undefined ? { verify } : {}) });
  const client = new Client(
    { name: "bootstrap-test-agent", version: "0.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

async function close(connection: { client: Client; server: McpServer }): Promise<void> {
  await connection.client.close();
  await connection.server.close();
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function nextTask(client: Client): Promise<QueueResponse> {
  const result = await client.callTool({ name: "livewiki_next_task", arguments: {} });
  expect(result.isError).toBeFalsy();
  return JSON.parse(text(result)) as QueueResponse;
}

function yamlList(name: string, values: readonly string[]): string[] {
  return values.length === 0
    ? [`${name}: []`]
    : [`${name}:`, ...values.map((value) => `  - ${value}`)];
}

function markerSections(task: QueueTask, defaultHeading: string): string[] {
  const grouped = new Map<string, string[]>();
  for (const key of task.closedKeys) {
    const heading = task.validation.sectionByKey?.[key] ?? defaultHeading;
    const values = grouped.get(heading) ?? [];
    values.push(key);
    grouped.set(heading, values);
  }
  return [...grouped].flatMap(([heading, keys]) => [
    `## ${heading}`,
    `<!-- lw:anchors ${keys.join(" ")} -->`,
    "",
    `This section explains ${heading.toLowerCase()} using the indexed implementation evidence.`,
    "",
  ]);
}

function keysForSection(task: QueueTask, heading: string): string[] {
  return task.closedKeys.filter(
    (key) => (task.validation.sectionByKey?.[key] ?? "Implementation") === heading,
  );
}

function markerForSection(task: QueueTask, heading: string): string {
  return `<!-- lw:anchors ${keysForSection(task, heading).join(" ")} -->`;
}

function renderSubmission(task: QueueTask): string {
  if (task.kind === "folder-page") {
    return "This directory groups the implementation files that cooperate to provide its repository responsibility.";
  }
  if (task.kind === "understanding") {
    const title = task.validation.title ?? "Queue fixture";
    return [
      "---",
      `title: ${title}`,
      "owner: generated",
      "kind: understanding",
      `updated: ${new Date().toISOString().slice(0, 10)}`,
      "---",
      "",
      `# ${title}`,
      "",
      "This repository demonstrates a complete agent-written documentation bootstrap whose pages are checked against indexed source symbols before they are accepted.",
      "",
      "## Where to look in the code",
      "",
      "- src/api/request.ts handles and validates incoming values.",
      "- src/store/state.ts persists and retrieves state.",
      "",
    ].join("\n");
  }
  if (task.kind === "flow") {
    const modules = task.validation.modules ?? [];
    const title = task.validation.title ?? "Request flow";
    for (const heading of ["Purpose", "Ordered flow", "Failure and recovery"]) {
      if (keysForSection(task, heading).length === 0) {
        throw new Error(
          `flow task has no assigned key for ${heading}: ${JSON.stringify(task.validation.sectionByKey)}`,
        );
      }
    }
    return [
      "---",
      `title: ${title}`,
      "owner: generated",
      ...yamlList("anchors", task.closedKeys),
      `updated: ${new Date().toISOString().slice(0, 10)}`,
      ...yamlList("modules", modules),
      "---",
      "",
      `# ${title}`,
      "",
      "This flow explains how a validated request reaches persistent repository state.",
      "",
      "## Purpose",
      markerForSection(task, "Purpose"),
      "",
      "The flow begins when a caller submits a value and ends when the repository state records the accepted value.",
      "",
      "## Ordered flow",
      markerForSection(task, "Ordered flow"),
      "",
      "1. The entry module validates the value.",
      "2. The storage module persists the accepted value.",
      "",
      "## Invariants",
      "",
      "Only indexed modules and symbols are cited.",
      "",
      "## Failure and recovery",
      markerForSection(task, "Failure and recovery"),
      "",
      "Invalid input is rejected before persistence and callers can retry with a valid value.",
      "",
      "## Related pages",
      "",
      ...modules.map((moduleId) => `- [${moduleId}](../${moduleId}/index.md)`),
      "- [How it works](index.md)",
      "",
    ].join("\n");
  }
  if (task.kind === "topic") {
    const title = task.validation.title ?? "Repository behavior";
    const modules = task.validation.modules ?? [];
    const flows = task.validation.flows ?? [];
    return [
      "---",
      `title: ${title}`,
      "owner: generated",
      "kind: topic",
      `order: ${task.validation.order ?? 1}`,
      `intent: ${task.validation.intent ?? "Understand repository behavior"}`,
      ...yamlList("modules", modules),
      ...yamlList("flows", flows),
      ...yamlList("anchors", task.closedKeys),
      `updated: ${new Date().toISOString().slice(0, 10)}`,
      "---",
      "",
      `# ${title}`,
      "",
      "This page helps readers trace the repository behavior across request handling and state persistence.",
      "",
      "## Purpose",
      markerForSection(task, "Purpose"),
      "",
      "The topic connects the user-facing request boundary to the state operation that follows it. Readers can use this view to understand why validation and persistence remain separate responsibilities, how data moves between them, and which indexed symbols provide the concrete implementation evidence. The page focuses on observable relationships in the repository and keeps each claim tied to the accepted module and flow inventory.",
      "",
      "## When to use this page",
      markerForSection(task, "When to use this page"),
      "",
      "Use this page before changing request acceptance, state transitions, or the connection between those areas. It gives reviewers a shared map for checking whether a proposed change remains local or crosses an established boundary. It is also useful when investigating an unexpected value because it separates the point where input is examined from the point where accepted state is recorded.",
      "",
      "## Behavioral contract",
      markerForSection(task, "Behavioral contract"),
      "",
      "The request side receives a value, applies its visible checks, and delegates accepted work to the state side. The state side owns persistence and retrieval behavior. This division lets callers reason about acceptance without assuming storage details, while state operations can remain focused on their recorded values. The cited implementation symbols establish the available operations; this page does not add behavior beyond those indexed facts.",
      "",
      "## Failure and recovery",
      markerForSection(task, "Failure and recovery"),
      "",
      "A value that does not satisfy request validation should not be treated as accepted state. The caller can correct the input and invoke the request path again. The visible source does not establish a broader rollback protocol, so recovery here is limited to retrying the rejected request before persistence. Errors introduced inside state operations need to remain visible to their caller instead of being described as successful completion.",
      "",
      "## Change map",
      markerForSection(task, "Change map"),
      "",
      "Changes to request validation affect the entry boundary and may alter which values can reach storage. Changes to persistence or retrieval affect the state responsibility and may alter what later callers observe. A signature change on either side can affect their connection and should be reviewed against the participating module pages. Documentation changes should keep the closed symbol keys synchronized with the index rather than substituting guessed identifiers.",
      "",
      "Together these surfaces describe a compact but complete path through the fixture repository. The request module explains how work enters, the state module explains where accepted data goes, and the flow page records their order. Maintaining those distinctions makes future edits easier to review because the reader can identify the affected responsibility before opening individual files. The links below provide the narrower module and flow views when implementation detail is needed.",
      "",
      "## Related pages",
      "",
      "- [All topics](index.md)",
      ...modules.map((moduleId) => `- [${moduleId}](../${moduleId}/index.md)`),
      ...flows.map((slug) => `- [${slug}](../flows/${slug}.md)`),
      ...flows.map((slug) => `- [${slug} diagram](../diagrams/flow-${slug}.mmd)`),
      "",
    ].join("\n");
  }

  const title = task.targetPath.split("/").pop()!.replace(/\.md$/, "");
  const lines = [
    "---",
    `title: ${title} implementation`,
    "owner: generated",
    ...yamlList("anchors", task.closedKeys),
    "---",
    "",
    `# ${title} implementation`,
    "",
    "This page explains the file responsibility and its place in the repository implementation.",
    "",
    "## When to use this page",
    "",
    "- Review the file responsibility before changing it.",
    "- Trace the indexed symbols implemented by this file.",
    "",
    "## How it fits",
    "",
    "The file provides one part of the repository's request and state flow.",
    "",
  ];
  if (task.validation.moduleDiagramPath) {
    lines.push(
      "## Diagram",
      "",
      "```mermaid",
      "flowchart LR",
      "  Input --> Output",
      "```",
      "",
    );
  }
  lines.push(...markerSections(task, "Implementation"));
  return lines.join("\n");
}

describe("MCP agent bootstrap queue", () => {
  it("bootstraps from an empty queue without credentials and finishes with a clean verify", async () => {
    const connection = await connect();
    let connectionClosed = false;
    let recoveredConnection: Awaited<ReturnType<typeof connect>> | null = null;
    const seenKinds = new Set<TaskKind>();
    const seenTaskIds = new Set<number>();
    const observedFilePaths: string[] = [];
    let checkedStage4PromptReuse = false;
    let runId = 0;
    try {
      for (let guard = 0; guard < 30; guard++) {
        const response = await nextTask(connection.client);
        runId = response.runId;
        expect(response.accounting).toBe("unavailable");
        expect(response.topicRefine).toBe("not-run");
        if (response.status !== "task") {
          expect(response.status).toBe("completed");
          break;
        }
        const task = response.task!;
        seenKinds.add(task.kind);
        expect(seenTaskIds.has(task.taskId)).toBe(false);
        seenTaskIds.add(task.taskId);

        const serialized = JSON.stringify(task);
        expect(serialized).not.toContain("return persist(value)");
        expect(serialized).not.toContain("return 'ready'");
        expect(task.sourcePaths.length).toBeGreaterThan(0);
        expect(new Set(task.closedKeys).size).toBe(task.closedKeys.length);
        expect(task.formatContract.system.length).toBeGreaterThan(100);
        // No empty evidence heading may reach the executor: a heading with
        // nothing under it reads as "the payload is incomplete" and sends the
        // agent hunting through the codebase (benchmark 0.2.1).
        for (const heading of [
          "# Symbol table",
          "# Source code (truncated",
          "# Participating module pages digest",
          "# Accepted module/flow digest",
          "# Source evidence",
          "# Closed evidence inventory",
          "# Directory evidence",
        ]) {
          expect(task.formatContract.user).not.toContain(heading);
        }
        expect(task.formatContract.user).toContain(
          "# Evidence retrieval (this payload carries NO inline evidence)",
        );
        expect(task.formatContract.user).toContain("`closedKeys`");

        const queueDb = openIndex(nodePath.join(repoRoot, ".livewiki", "index.db"));
        try {
          const row = queueDb
            .prepare("SELECT checkpoint_json FROM batch_tasks WHERE id = ?")
            .get(task.taskId) as { checkpoint_json: string };
          const checkpoint = JSON.parse(row.checkpoint_json) as {
            agentTask: {
              kind: TaskKind;
              closedKeys: string[];
              moduleRole: "product" | "test" | "fixture" | "tooling" | "docs";
              module?: { id: string; paths: string[]; symbolCount: number };
            };
          };
          expect(task.closedKeys).toEqual(checkpoint.agentTask.closedKeys);
          if (task.kind === "file-page" && !checkedStage4PromptReuse) {
            const builderContract = prompts.buildStage4Prompt(
              checkpoint.agentTask.module!,
              checkpoint.agentTask.closedKeys,
              "",
              "",
              "en",
              checkpoint.agentTask.moduleRole,
              undefined,
              {
                moduleDiagrams: { maxNodes: 24, maxEdges: 32 },
                deepHierarchy: true,
              },
            );
            // The contract itself is the batch's, byte-for-byte. The payload
            // then appends the evidence-retrieval block: agent mode ships no
            // inline evidence, and that has to be stated, not implied.
            expect(task.formatContract.system).toEqual(builderContract.system);
            expect(task.formatContract.user.startsWith(builderContract.user)).toBe(true);
            expect(task.formatContract.user).toContain(
              "# Evidence retrieval (this payload carries NO inline evidence)",
            );
            checkedStage4PromptReuse = true;
          }
        } finally {
          queueDb.close();
        }

        if (task.kind === "file-page") {
          observedFilePaths.push(task.sourcePaths[0]!);
        }

        const write = await connection.client.callTool({
          name: "livewiki_write_doc",
          arguments: {
            taskId: task.taskId,
            claimId: task.claimId,
            path: task.targetPath,
            content: renderSubmission(task),
          },
        });
        expect(write.isError, text(write)).toBeFalsy();
      }

      expect(seenKinds.has("file-page")).toBe(true);
      expect(seenKinds.has("folder-page")).toBe(true);
      expect(seenKinds.has("flow")).toBe(true);
      expect(seenKinds.has("topic")).toBe(true);
      expect(seenKinds.has("understanding")).toBe(true);
      expect(checkedStage4PromptReuse).toBe(true);
      const verify = await runVerify(repoRoot);
      expect(verify.issues).toEqual([]);

      const status = await buildStatusReport(repoRoot, runId);
      expect(status.run.startedBy).toBe("agent");
      expect(status.run.summary?.accounting).toBe("unavailable");
      expect(status.run.summary?.topicRefine).toBe("not-run");
      expect(status.totals.usageIncomplete).toBe(true);
      expect(status.totals.inputTokens).toBe(0);
      expect(status.totals.outputTokens).toBe(0);

      const db = openIndex(nodePath.join(repoRoot, ".livewiki", "index.db"));
      try {
        const run = db
          .prepare("SELECT config_json FROM batch_runs WHERE id = ?")
          .get(runId) as { config_json: string };
        const state = JSON.parse(run.config_json) as {
          ordered: Array<{ id: string }>;
          fileUnits: Array<{ folderId: string; filePath: string; symbolCount: number; id: string }>;
        };
        const priority = new Map(state.ordered.map((module, index) => [module.id, index]));
        const expectedFilePaths = [...state.fileUnits]
          .sort((a, b) =>
            (priority.get(a.folderId) ?? Number.MAX_SAFE_INTEGER) -
              (priority.get(b.folderId) ?? Number.MAX_SAFE_INTEGER) ||
            b.symbolCount - a.symbolCount ||
            a.id.localeCompare(b.id),
          )
          .map((unit) => unit.filePath);
        expect(observedFilePaths).toEqual(expectedFilePaths);

        const checkpoints = db
          .prepare("SELECT checkpoint_json FROM batch_tasks WHERE run_id = ? AND checkpoint_json IS NOT NULL")
          .all(runId) as Array<{ checkpoint_json: string }>;
        const attempts = checkpoints.flatMap((row) => JSON.parse(row.checkpoint_json).usageHistory ?? []);
        expect(attempts.length).toBeGreaterThan(0);
        expect(attempts.every((attempt) => attempt.usage === null)).toBe(true);
      } finally {
        db.close();
      }

      // The queue database is disposable. After losing it, the rebuilt run
      // must recover every completed task from the versioned baseline and
      // artifact receipts without asking the agent to write anything again.
      await close(connection);
      connectionClosed = true;
      for (const name of ["index.db", "index.db-shm", "index.db-wal"]) {
        await nodeFs.rm(nodePath.join(repoRoot, ".livewiki", name), { force: true });
      }
      recoveredConnection = await connect();
      const recovered = await nextTask(recoveredConnection.client);
      expect(recovered.status, JSON.stringify(recovered.task)).toBe("completed");
      expect(recovered.task).toBeUndefined();

      const rebuiltDb = openIndex(nodePath.join(repoRoot, ".livewiki", "index.db"));
      try {
        const rebuilt = rebuiltDb.prepare(
          "SELECT status, checkpoint_json FROM batch_tasks ORDER BY id",
        ).all() as Array<{ status: string; checkpoint_json: string }>;
        expect(rebuilt.length).toBeGreaterThan(0);
        expect(rebuilt.every((row) => row.status === "done")).toBe(true);
        expect(rebuilt.every((row) => JSON.parse(row.checkpoint_json).attempt === 0)).toBe(true);
      } finally {
        rebuiltDb.close();
      }
    } finally {
      if (recoveredConnection !== null) await close(recoveredConnection);
      if (!connectionClosed) await close(connection);
    }
  }, 60_000);

  it("recovers a relaxed-round (degraded) file page after SQLite loss without reoffering the task", async () => {
    const connection = await connect();
    let connectionClosed = false;
    let recoveredConnection: Awaited<ReturnType<typeof connect>> | null = null;
    let filePagePath: string | null = null;
    try {
      for (let guard = 0; guard < 30; guard++) {
        const response = await nextTask(connection.client);
        if (response.status !== "task") {
          expect(response.status).toBe("completed");
          break;
        }
        const task = response.task!;
        if (task.kind === "file-page" && filePagePath === null) {
          filePagePath = task.targetPath;
        }
        const write = await connection.client.callTool({
          name: "livewiki_write_doc",
          arguments: {
            taskId: task.taskId,
            claimId: task.claimId,
            path: task.targetPath,
            content: renderSubmission(task),
          },
        });
        expect(write.isError, text(write)).toBeFalsy();
      }
      expect(filePagePath).not.toBeNull();

      // A page completed under the relaxed round carries `quality: degraded`
      // + the reader notice and only passes the relaxed contract.
      const absPage = nodePath.join(repoRoot, ...filePagePath!.split("/"));
      const degraded = markDegradedArtifact(await nodeFs.readFile(absPage, "utf8"));
      expect(degraded).toContain("quality: degraded");
      await nodeFs.writeFile(absPage, degraded, "utf8");

      await close(connection);
      connectionClosed = true;
      for (const name of ["index.db", "index.db-shm", "index.db-wal"]) {
        await nodeFs.rm(nodePath.join(repoRoot, ".livewiki", name), { force: true });
      }
      recoveredConnection = await connect();
      const recovered = await nextTask(recoveredConnection.client);
      expect(recovered.status, JSON.stringify(recovered.task)).toBe("completed");
      expect(recovered.task).toBeUndefined();
    } finally {
      if (recoveredConnection !== null) await close(recoveredConnection);
      if (!connectionClosed) await close(connection);
    }
  }, 60_000);

  it("never baseline-accepts code that drifted between task completion and finalize", async () => {
    const connection = await connect();
    let flowPagePath: string | null = null;
    let driftedKey: string | null = null;
    try {
      for (let guard = 0; guard < 30; guard++) {
        const response = await nextTask(connection.client);
        if (response.status !== "task") {
          expect(response.status).toBe("completed");
          break;
        }
        const task = response.task!;
        const write = await connection.client.callTool({
          name: "livewiki_write_doc",
          arguments: {
            taskId: task.taskId,
            claimId: task.claimId,
            path: task.targetPath,
            content: renderSubmission(task),
          },
        });
        expect(write.isError, text(write)).toBeFalsy();

        // Drift one flow-covered symbol AFTER the flow task committed its
        // baseline but BEFORE finalize: finalize refreshes receipts only and
        // must leave the drift visible as `changed`, never accepted.
        if (task.kind === "flow" && driftedKey === null) {
          flowPagePath = task.targetPath;
          driftedKey = task.closedKeys[0]!;
          const sourceRel = driftedKey.split("#")[0]!;
          const absSource = nodePath.join(repoRoot, ...sourceRel.split("/"));
          const source = await nodeFs.readFile(absSource, "utf8");
          const drifted = source
            .replaceAll("{ return ", "{ return (")
            .replaceAll("; }", "); }");
          expect(drifted).not.toBe(source);
          await nodeFs.writeFile(absSource, drifted, "utf8");
          await runIndexer(repoRoot, { quiet: true });
        }
      }
      expect(driftedKey).not.toBeNull();

      const report = await runStatus(repoRoot);
      const changed = report.debt.repository?.items.filter(
        (item) => item.event === "changed" &&
          item.symbol_key === driftedKey &&
          item.wiki_path === flowPagePath,
      ) ?? [];
      expect(changed).toHaveLength(1);
    } finally {
      await close(connection);
    }
  }, 60_000);

  it("bounds invalid writes on the server, reports actionable errors, and advances the queue", async () => {
    const connection = await connect();
    try {
      const first = await nextTask(connection.client);
      const task = first.task!;
      const invented = "src/api/request.ts#inventedByAgent";
      const invalid = renderSubmission({ ...task, closedKeys: [...task.closedKeys, invented] });

      for (let attempt = 1; attempt <= task.attempts.limit; attempt++) {
        const result = await connection.client.callTool({
          name: "livewiki_write_doc",
          arguments: { taskId: task.taskId, claimId: task.claimId, path: task.targetPath, content: invalid },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("anchor_outside_closed_list");
        expect(text(result)).toContain(invented);
      }

      const following = await nextTask(connection.client);
      expect(following.status).toBe("task");
      expect(following.task!.taskId).not.toBe(task.taskId);
      const report = await buildStatusReport(repoRoot, first.runId);
      expect(report.tasks.find((item) => item.taskId === task.taskId)?.status).toBe("failed");
    } finally {
      await close(connection);
    }
  }, 30_000);

  it("counts verifier rejections, exhausts the task, and moves to the next one", async () => {
    let rejectedPath = "";
    const injectedVerifier: typeof runVerify = async (root) => {
      const actual = await runVerify(root);
      return {
        ...actual,
        ok: false,
        issues: [
          ...actual.issues,
          {
            severity: "error",
            code: "broken_internal_link",
            wikiPath: rejectedPath,
            detail: "Related pages contains missing-page.md",
          },
        ],
      };
    };
    const connection = await connect(injectedVerifier);
    try {
      const first = await nextTask(connection.client);
      const task = first.task!;
      rejectedPath = task.targetPath;
      for (let attempt = 1; attempt <= task.attempts.limit; attempt++) {
        const result = await connection.client.callTool({
          name: "livewiki_write_doc",
          arguments: {
            taskId: task.taskId,
            claimId: task.claimId,
            path: task.targetPath,
            content: renderSubmission(task),
          },
        });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("broken_internal_link");
        expect(text(result)).toContain("missing-page.md");
      }
      const following = await nextTask(connection.client);
      expect(following.task?.taskId).not.toBe(task.taskId);
    } finally {
      await close(connection);
    }
  }, 30_000);

  // Abandoning the connection does NOT release the claim: livewiki cannot
  // tell a dropped client from a slow one, so the lease — not the socket — is
  // what decides. A fresh client gets different work until the lease lapses.
  it("does not reoffer an in-flight task while its lease is alive", async () => {
    const firstConnection = await connect();
    const first = await nextTask(firstConnection.client);
    await close(firstConnection);

    const secondConnection = await connect();
    try {
      const resumed = await nextTask(secondConnection.client);
      expect(resumed.runId).toBe(first.runId);
      expect(resumed.task?.taskId).not.toBe(first.task?.taskId);
      expect(resumed.task?.claimId).not.toBe(first.task?.claimId);
    } finally {
      await close(secondConnection);
    }
  });

  it("reoffers an abandoned task once its lease expires, under a new claim", async () => {
    const firstConnection = await connect();
    const first = await nextTask(firstConnection.client);
    await close(firstConnection);
    expireLease(repoRoot, first.task!.taskId);

    const secondConnection = await connect();
    try {
      const resumed = await nextTask(secondConnection.client);
      expect(resumed.runId).toBe(first.runId);
      expect(resumed.task?.taskId).toBe(first.task?.taskId);
      expect(resumed.task?.claimId).not.toBe(first.task?.claimId);
      expect(resumed.task?.attempts.used).toBe(0);
    } finally {
      await close(secondConnection);
    }
  });

  it("refuses a write from the claim the reclaim replaced, without touching the page", async () => {
    const firstConnection = await connect();
    const first = await nextTask(firstConnection.client);
    const stale = first.task!;
    await close(firstConnection);
    expireLease(repoRoot, stale.taskId);

    const secondConnection = await connect();
    try {
      const resumed = await nextTask(secondConnection.client);
      expect(resumed.task?.taskId).toBe(stale.taskId);

      const late = await secondConnection.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          taskId: stale.taskId,
          claimId: stale.claimId,
          path: stale.targetPath,
          content: renderSubmission(stale),
        },
      });
      expect(late.isError).toBe(true);
      expect(text(late)).toContain("stale_claim");
      // The losing executor must not have written the page.
      await expect(
        nodeFs.access(nodePath.join(repoRoot, stale.targetPath)),
      ).rejects.toThrow();

      // The current claim still works.
      const ok = await secondConnection.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          taskId: resumed.task!.taskId,
          claimId: resumed.task!.claimId,
          path: resumed.task!.targetPath,
          content: renderSubmission(resumed.task!),
        },
      });
      expect(ok.isError).toBeFalsy();
    } finally {
      await close(secondConnection);
    }
  }, 30_000);

  it("renews a live claim and refuses to renew one that was replaced", async () => {
    const connection = await connect();
    try {
      const first = await nextTask(connection.client);
      const task = first.task!;

      const renewed = await connection.client.callTool({
        name: "livewiki_renew_task_claim",
        arguments: { taskId: task.taskId, claimId: task.claimId },
      });
      expect(renewed.isError).toBeFalsy();
      const payload = JSON.parse(text(renewed)) as { ok: boolean; leaseExpiresAt: number };
      expect(payload.ok).toBe(true);
      expect(payload.leaseExpiresAt).toBeGreaterThanOrEqual(task.leaseExpiresAt);

      // Expire and let another execution take it: the old claim is dead.
      expireLease(repoRoot, task.taskId);
      const reclaimed = await nextTask(connection.client);
      expect(reclaimed.task?.taskId).toBe(task.taskId);

      const refused = await connection.client.callTool({
        name: "livewiki_renew_task_claim",
        arguments: { taskId: task.taskId, claimId: task.claimId },
      });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("stale_claim");
    } finally {
      await close(connection);
    }
  }, 30_000);

  it("preserves human ownership and manual blocks while completing queued writes", async () => {
    const connection = await connect();
    try {
      const first = await nextTask(connection.client);
      const humanTask = first.task!;
      const humanContent = renderSubmission(humanTask).replace("owner: generated", "owner: human");
      await nodeFs.mkdir(nodePath.dirname(nodePath.join(repoRoot, humanTask.targetPath)), { recursive: true });
      await nodeFs.writeFile(nodePath.join(repoRoot, humanTask.targetPath), humanContent);
      const refused = await connection.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          taskId: humanTask.taskId,
          claimId: humanTask.claimId,
          path: humanTask.targetPath,
          content: renderSubmission(humanTask),
        },
      });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toContain("refused_owned_page");
      expect(await nodeFs.readFile(nodePath.join(repoRoot, humanTask.targetPath), "utf8"))
        .toBe(humanContent);

      const next = await nextTask(connection.client);
      const task = next.task!;
      const manual = "<!-- lw:manual -->\nA human note with  two spaces.\n<!-- /lw:manual -->";
      const existing = renderSubmission(task)
        .replace("owner: generated", "owner: mixed")
        .replace("## Implementation", `${manual}\n\n## Implementation`);
      await nodeFs.mkdir(nodePath.dirname(nodePath.join(repoRoot, task.targetPath)), { recursive: true });
      await nodeFs.writeFile(nodePath.join(repoRoot, task.targetPath), existing);

      const result = await connection.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          taskId: task.taskId,
          claimId: task.claimId,
          path: task.targetPath,
          content: renderSubmission(task),
        },
      });
      expect(result.isError, text(result)).toBeFalsy();
      const final = await nodeFs.readFile(nodePath.join(repoRoot, task.targetPath), "utf8");
      expect(final).toContain("owner: mixed");
      expect(final).toContain(manual);
    } finally {
      await close(connection);
    }
  });
});
