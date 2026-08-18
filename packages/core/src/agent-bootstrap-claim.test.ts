/**
 * Claim/lease regression suite for the agent bootstrap queue.
 *
 * Two agents pointed at the same repo used to be handed the same task: the
 * queue re-offered anything in 'running', and the one guarded UPDATE it did
 * run never had its result checked. These tests pin the atomic claim, the
 * lease expiry that allows a genuine re-claim, and the schema migration that
 * carries pre-v10 databases across.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  AGENT_CLAIM_LEASE_MS,
  nextAgentBootstrapTask,
  renewAgentBootstrapClaim,
  submitAgentBootstrapTask,
} from "./agent-bootstrap.js";
import { CURRENT_SCHEMA_VERSION, openIndex } from "./db.js";

let repoRoot: string;

/**
 * Best-effort teardown. WAL leaves `-shm`/`-wal` siblings that Windows can
 * still hold for a moment after close; the OS reclaims the temp dir either
 * way, and a cleanup race must never be reported as a test failure.
 */
async function removeDir(dir: string): Promise<void> {
  await nodeFs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Minimal page that satisfies a `file-page` task contract: frontmatter with
 * the closed anchor list, then one section per assigned anchor group. Only the
 * first phase is exercised here, so the other task kinds are out of scope.
 */
function renderAcceptableSubmission(task: {
  kind: string;
  targetPath: string;
  closedKeys: string[];
  validation: { sectionByKey?: Record<string, string>; moduleDiagramPath?: string };
}): string {
  if (task.kind !== "file-page") {
    throw new Error(`this fixture only renders file-page tasks, got ${task.kind}`);
  }
  const title = task.targetPath.split("/").pop()!.replace(/\.md$/, "");
  const grouped = new Map<string, string[]>();
  for (const key of task.closedKeys) {
    const heading = task.validation.sectionByKey?.[key] ?? "Implementation";
    grouped.set(heading, [...(grouped.get(heading) ?? []), key]);
  }
  return [
    "---",
    `title: ${title} implementation`,
    "owner: generated",
    ...(task.closedKeys.length === 0
      ? ["anchors: []"]
      : ["anchors:", ...task.closedKeys.map((k) => `  - ${k}`)]),
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
    "The file provides one part of the repository's implementation.",
    "",
    ...(task.validation.moduleDiagramPath
      ? ["## Diagram", "", "```mermaid", "flowchart LR", "  Input --> Output", "```", ""]
      : []),
    ...[...grouped].flatMap(([heading, keys]) => [
      `## ${heading}`,
      `<!-- lw:anchors ${keys.join(" ")} -->`,
      "",
      `This section explains ${heading.toLowerCase()} using the indexed implementation evidence.`,
      "",
    ]),
  ].join("\n");
}

function dbPath(root: string): string {
  return nodePath.join(root, ".livewiki", "index.db");
}

function withDb<T>(root: string, fn: (db: Database.Database) => T): T {
  const db = openIndex(dbPath(root));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function expireLease(root: string, taskId: number): void {
  withDb(root, (db) => {
    db.prepare("UPDATE batch_tasks SET lease_expires_at = ? WHERE id = ?")
      .run(Date.now() - 1000, taskId);
  });
}

function claimRow(root: string, taskId: number): {
  status: string;
  claim_id: string | null;
  lease_expires_at: number | null;
} {
  return withDb(root, (db) =>
    db.prepare("SELECT status, claim_id, lease_expires_at FROM batch_tasks WHERE id = ?")
      .get(taskId) as { status: string; claim_id: string | null; lease_expires_at: number | null });
}

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-claim-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "README.md"),
    "# Claim fixture\n\nA small repo used to exercise the agent queue.\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src", "alpha.ts"),
    "export function alpha(): number {\n  return 1;\n}\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src", "beta.ts"),
    "export function beta(): number {\n  return 2;\n}\n",
  );
});

afterEach(async () => {
  await removeDir(repoRoot);
});

describe("agent bootstrap — concurrent claim", () => {
  it("never hands the same task to two callers", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const second = await nextAgentBootstrapTask(repoRoot);

    expect(first.status).toBe("task");
    expect(second.status).toBe("task");
    expect(second.task?.taskId).not.toBe(first.task?.taskId);
    expect(second.task?.claimId).not.toBe(first.task?.claimId);
  }, 60_000);

  it("two concurrent callers get two different tasks and two different claims", async () => {
    // Prime the run so both calls race over an already-populated queue.
    const primed = await nextAgentBootstrapTask(repoRoot);
    expect(primed.status).toBe("task");
    expireLease(repoRoot, primed.task!.taskId);

    const [a, b] = await Promise.all([
      nextAgentBootstrapTask(repoRoot),
      nextAgentBootstrapTask(repoRoot),
    ]);

    expect(a.task?.taskId).not.toBe(b.task?.taskId);
    expect(a.task?.claimId).not.toBe(b.task?.claimId);
    expect(a.task?.claimId).toBeTruthy();
    expect(b.task?.claimId).toBeTruthy();
  }, 60_000);

  it("hands out a lease roughly one lease-length into the future", async () => {
    const before = Date.now();
    const result = await nextAgentBootstrapTask(repoRoot);
    const task = result.task!;

    expect(task.leaseExpiresAt).toBeGreaterThanOrEqual(before + AGENT_CLAIM_LEASE_MS);
    expect(task.leaseExpiresAt).toBeLessThanOrEqual(Date.now() + AGENT_CLAIM_LEASE_MS);

    const row = claimRow(repoRoot, task.taskId);
    expect(row.status).toBe("running");
    expect(row.claim_id).toBe(task.claimId);
    expect(row.lease_expires_at).toBe(task.leaseExpiresAt);
  }, 60_000);

  it("does not re-offer a task whose lease is still alive", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const held = first.task!.taskId;

    for (let i = 0; i < 3; i++) {
      const next = await nextAgentBootstrapTask(repoRoot);
      expect(next.task?.taskId).not.toBe(held);
    }
  }, 60_000);

  it("allows a re-claim once the lease expired, with a fresh claimId", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const task = first.task!;
    expireLease(repoRoot, task.taskId);

    const second = await nextAgentBootstrapTask(repoRoot);
    expect(second.task?.taskId).toBe(task.taskId);
    expect(second.task?.claimId).not.toBe(task.claimId);
    expect(claimRow(repoRoot, task.taskId).claim_id).toBe(second.task?.claimId);
  }, 60_000);
});

describe("agent bootstrap — a fully leased phase is not a finished phase", () => {
  /** Repo with a single source file, so the first phase holds exactly one task. */
  async function singleTaskRepo(): Promise<string> {
    const root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-solo-"));
    await nodeFs.mkdir(nodePath.join(root, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(root, "README.md"),
      "# Solo fixture\n\nOne file, one task, one claim.\n",
    );
    await nodeFs.writeFile(
      nodePath.join(root, "src", "only.ts"),
      "export function only(): number {\n  return 1;\n}\n",
    );
    return root;
  }

  function runState(root: string): { status: string; phase: string; taskCount: number } {
    return withDb(root, (db) => {
      const run = db.prepare(
        "SELECT id, status, config_json FROM batch_runs WHERE started_by = 'agent' ORDER BY id DESC LIMIT 1",
      ).get() as { id: number; status: string; config_json: string };
      const tasks = db.prepare("SELECT COUNT(*) AS n FROM batch_tasks WHERE run_id = ?")
        .get(run.id) as { n: number };
      return {
        status: run.status,
        phase: (JSON.parse(run.config_json) as { phase: string }).phase,
        taskCount: tasks.n,
      };
    });
  }

  it("does not advance the phase or finish the run while the only task is leased", async () => {
    const root = await singleTaskRepo();
    try {
      // Caller A claims the one task in this phase.
      const a = await nextAgentBootstrapTask(root);
      expect(a.status).toBe("task");
      const before = runState(root);

      // Caller B arrives before A submits. The candidate SELECT is empty for
      // B — but that must not be read as "phase complete".
      const b = await nextAgentBootstrapTask(root);

      expect(b.status).toBe("busy");
      expect(b.task).toBeUndefined();
      expect(b.leased?.tasks).toBeGreaterThan(0);

      const after = runState(root);
      expect(after.phase).toBe(before.phase);          // no phase advanced
      expect(after.taskCount).toBe(before.taskCount);  // no new phase materialized
      expect(after.status).toBe("running");            // run did not finish
      expect(after.status).not.toBe("completed");
      expect(after.status).not.toBe("completed_with_failures");
    } finally {
      await removeDir(root);
    }
  }, 120_000);

  it("stays busy across repeated polls and never leaks the leased task", async () => {
    const root = await singleTaskRepo();
    try {
      const a = await nextAgentBootstrapTask(root);
      const held = a.task!;

      for (let i = 0; i < 3; i++) {
        const b = await nextAgentBootstrapTask(root);
        expect(b.status).toBe("busy");
        expect(b.task?.taskId).not.toBe(held.taskId);
        expect(runState(root).status).toBe("running");
      }
    } finally {
      await removeDir(root);
    }
  }, 120_000);

  it("resumes normal progression only after the held task is submitted", async () => {
    const root = await singleTaskRepo();
    try {
      const a = await nextAgentBootstrapTask(root);
      const task = a.task!;
      const before = runState(root);

      expect((await nextAgentBootstrapTask(root)).status).toBe("busy");

      // A finishes its work for real.
      const submitted = await submitAgentBootstrapTask({
        repoRoot: root,
        taskId: task.taskId,
        claimId: task.claimId,
        path: task.targetPath,
        content: renderAcceptableSubmission(task),
      });
      expect(submitted.errors).toEqual([]);
      expect(submitted.ok).toBe(true);

      // Only now may the queue move on: a new task, or a finished run —
      // anything except the "busy" hold it was in before.
      const next = await nextAgentBootstrapTask(root);
      expect(next.status).not.toBe("busy");
      const after = runState(root);
      expect(after.phase !== before.phase || after.taskCount > before.taskCount).toBe(true);
    } finally {
      await removeDir(root);
    }
  }, 120_000);
});

describe("agent bootstrap — claim validation on submit", () => {
  it("refuses a submission carrying the replaced claim and writes nothing", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const stale = first.task!;
    expireLease(repoRoot, stale.taskId);
    const second = await nextAgentBootstrapTask(repoRoot);
    expect(second.task?.taskId).toBe(stale.taskId);

    const result = await submitAgentBootstrapTask({
      repoRoot,
      taskId: stale.taskId,
      claimId: stale.claimId,
      path: stale.targetPath,
      content: "# whatever\n",
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("stale_claim");
    // Nothing was written and no retry was consumed on the live claim's behalf.
    await expect(nodeFs.access(nodePath.join(repoRoot, stale.targetPath))).rejects.toThrow();
    expect(result.attempts.used).toBe(0);
  }, 60_000);

  it("refuses a submission whose lease lapsed even when nobody re-claimed it", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const task = first.task!;
    expireLease(repoRoot, task.taskId);

    const result = await submitAgentBootstrapTask({
      repoRoot,
      taskId: task.taskId,
      claimId: task.claimId,
      path: task.targetPath,
      content: "# whatever\n",
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("stale_claim");
    await expect(nodeFs.access(nodePath.join(repoRoot, task.targetPath))).rejects.toThrow();
  }, 60_000);

  it("accepts the current claim: a wrong-content submission reaches validation, not the claim gate", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const task = first.task!;

    const result = await submitAgentBootstrapTask({
      repoRoot,
      taskId: task.taskId,
      claimId: task.claimId,
      path: task.targetPath,
      content: "# deliberately invalid\n",
    });

    // The point is that the claim gate let it through — it failed on content.
    expect(result.errors.every((e) => e.code !== "stale_claim")).toBe(true);
    expect(result.attempts.used).toBeGreaterThan(0);
  }, 60_000);
});

describe("agent bootstrap — claim renewal", () => {
  it("extends a live lease", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const task = first.task!;

    const renewed = await renewAgentBootstrapClaim({
      repoRoot,
      taskId: task.taskId,
      claimId: task.claimId,
    });

    expect(renewed.ok).toBe(true);
    expect(renewed.leaseExpiresAt).not.toBeNull();
    expect(renewed.leaseExpiresAt!).toBeGreaterThanOrEqual(task.leaseExpiresAt);
    expect(claimRow(repoRoot, task.taskId).lease_expires_at).toBe(renewed.leaseExpiresAt);
  }, 60_000);

  it("refuses to renew a claim that a re-claim replaced", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const stale = first.task!;
    expireLease(repoRoot, stale.taskId);
    const second = await nextAgentBootstrapTask(repoRoot);

    const renewed = await renewAgentBootstrapClaim({
      repoRoot,
      taskId: stale.taskId,
      claimId: stale.claimId,
    });

    expect(renewed.ok).toBe(false);
    expect(renewed.error?.code).toBe("stale_claim");
    // The live claim is untouched by the refused renewal.
    expect(claimRow(repoRoot, stale.taskId).claim_id).toBe(second.task?.claimId);
  }, 60_000);

  it("refuses to renew an expired lease even before anyone re-claims it", async () => {
    const first = await nextAgentBootstrapTask(repoRoot);
    const task = first.task!;
    expireLease(repoRoot, task.taskId);

    const renewed = await renewAgentBootstrapClaim({
      repoRoot,
      taskId: task.taskId,
      claimId: task.claimId,
    });

    expect(renewed.ok).toBe(false);
    expect(renewed.error?.code).toBe("stale_claim");
  }, 60_000);
});

describe("schema migration v9 → v10", () => {
  /** Builds a v9-shaped batch_tasks table: no claim columns, no claim index. */
  function seedLegacyDb(file: string): void {
    const db = new Database(file);
    try {
      db.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE batch_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          started_by TEXT NOT NULL DEFAULT 'cli',
          status TEXT NOT NULL,
          config_json TEXT NOT NULL,
          summary_json TEXT
        );
        CREATE TABLE batch_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
          stage INTEGER NOT NULL,
          target TEXT NOT NULL,
          status TEXT NOT NULL,
          checkpoint_json TEXT,
          updated_at INTEGER NOT NULL
        );
      `);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '9')").run();
      db.prepare(
        "INSERT INTO batch_runs (id, started_at, started_by, status, config_json) " +
          "VALUES (1, 1, 'agent', 'running', '{}')",
      ).run();
      db.prepare(
        "INSERT INTO batch_tasks (id, run_id, stage, target, status, checkpoint_json, updated_at) " +
          "VALUES (7, 1, 5, 'livewiki/legacy.md', 'running', '{\"attempt\":2}', 42)",
      ).run();
    } finally {
      db.close();
    }
  }

  it("adds the claim columns and index to an existing database without losing rows", async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-migrate-"));
    try {
      await nodeFs.mkdir(nodePath.join(dir, ".livewiki"), { recursive: true });
      const file = dbPath(dir);
      seedLegacyDb(file);

      const db = openIndex(file);
      try {
        const cols = new Set(
          (db.prepare("PRAGMA table_info(batch_tasks)").all() as Array<{ name: string }>)
            .map((c) => c.name),
        );
        expect(cols.has("claim_id")).toBe(true);
        expect(cols.has("lease_expires_at")).toBe(true);

        const indexes = (db.prepare("PRAGMA index_list(batch_tasks)").all() as Array<{ name: string }>)
          .map((i) => i.name);
        expect(indexes).toContain("idx_batch_tasks_claim");

        const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'")
          .get() as { value: string };
        expect(Number.parseInt(version.value, 10)).toBe(CURRENT_SCHEMA_VERSION);

        // The pre-existing row survives untouched, with NULL claim state.
        const row = db.prepare("SELECT * FROM batch_tasks WHERE id = 7").get() as {
          target: string;
          status: string;
          checkpoint_json: string;
          updated_at: number;
          claim_id: string | null;
          lease_expires_at: number | null;
        };
        expect(row.target).toBe("livewiki/legacy.md");
        expect(row.status).toBe("running");
        expect(row.checkpoint_json).toBe('{"attempt":2}');
        expect(row.updated_at).toBe(42);
        expect(row.claim_id).toBeNull();
        expect(row.lease_expires_at).toBeNull();
      } finally {
        db.close();
      }
    } finally {
      await removeDir(dir);
    }
  });

  it("is idempotent: re-opening a migrated database changes nothing", async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-migrate-"));
    try {
      await nodeFs.mkdir(nodePath.join(dir, ".livewiki"), { recursive: true });
      const file = dbPath(dir);
      seedLegacyDb(file);

      for (let i = 0; i < 3; i++) {
        const db = openIndex(file);
        try {
          const cols = (db.prepare("PRAGMA table_info(batch_tasks)").all() as Array<{ name: string }>)
            .filter((c) => c.name === "claim_id" || c.name === "lease_expires_at");
          // Re-running must not duplicate columns or throw.
          expect(cols).toHaveLength(2);
        } finally {
          db.close();
        }
      }
    } finally {
      await removeDir(dir);
    }
  });

  it("treats a pre-v10 'running' row as unclaimed so it can be picked up again", async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-migrate-"));
    try {
      await nodeFs.mkdir(nodePath.join(dir, ".livewiki"), { recursive: true });
      const file = dbPath(dir);
      seedLegacyDb(file);

      const db = openIndex(file);
      try {
        // The claim predicate the queue uses: NULL claim state means unowned.
        const unclaimed = db.prepare(
          "SELECT id FROM batch_tasks WHERE run_id = 1 AND " +
            "(status = 'pending' OR (status = 'running' AND " +
            "(claim_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)))",
        ).all(Date.now()) as Array<{ id: number }>;
        expect(unclaimed.map((r) => r.id)).toContain(7);
      } finally {
        db.close();
      }
    } finally {
      await removeDir(dir);
    }
  });
});
