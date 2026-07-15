/**
 * Regression: `.livewiki/config.json` `ignores` must exclude the listed
 * paths from the indexed inventory, the module plan, the batch tasks,
 * the LLM work, and the generated pages — across `livewiki init`
 * and a new `livewiki batch` run.
 *
 * The product handles messy repositories itself; benchmark harnesses
 * must not rewrite or strip repository contents to compensate. The
 * single source of truth for `ignores` semantics is
 * `config.ts:resolveExtraIgnores`. The walker is the ONLY consumer
 * of the ignore list — this file only asserts propagation.
 *
 * Resume / `--only` do NOT rescan: they operate on the existing
 * run's snapshot (SQLite index + checkpoints), so a configured
 * ignored path cannot re-enter via resume. The init --batch path is
 * covered through the existing CLI stub E2E (see
 * `packages/cli/src/cli-batch-e2e.test.ts`). The CLI index
 * config + flag merging is covered in
 * `packages/cli/src/cli-e2e.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runInit } from "./init.js";
import { runBatch } from "./batch.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";

/**
 * Mock LLM that returns a page covering every closed-list key in both
 * the frontmatter anchors list AND a single section marker (the
 * minimum valid artifact the stage-4 normalizer accepts). The existing
 * `MockLlm` in `batch.test.ts` only covers single-key pages and would
 * fail closed-list validation on this fixture.
 */
class FullMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public readonly documentedModules: string[] = [];

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const moduleId = req.user.match(/# Module: ([^\s]+)/)?.[1] ?? "unknown";
    this.documentedModules.push(moduleId);
    const closedKeys: string[] = [];
    let collecting = false;
    for (const line of req.user.split(/\r?\n/)) {
      if (/Closed list of canonical keys/.test(line)) {
        collecting = true;
        continue;
      }
      if (collecting) {
        if (line.startsWith("- ")) closedKeys.push(line.slice(2).trim());
        else if (line.trim() !== "") break;
      }
    }
    const keys = closedKeys.length > 0 ? closedKeys : [`${moduleId}.ts#placeholder`];
    const anchorsYaml = keys.map((k) => `  - ${k}`).join("\n");
    const marker = keys.join(" ");
    const title = `${moduleId} responsibilities`;
    // Page-opening contract (Lot N): H1, one responsibility sentence,
    // H2 "When to use this page" with 2-4 verb-led bullets, H2 "How it
    // fits" with prose paragraphs. NO `lw:anchors` marker in the opening
    // (the validator rejects that placement).
    const content = `---
title: ${title}
owner: generated
anchors:
${anchorsYaml}
---

# ${title}

This page documents the responsibilities of the ${moduleId} module.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides part of the repository implementation described by the indexed source. It sits beside the surrounding source files that the planner grouped with it.

## Details
<!-- lw:anchors ${marker} -->

Some prose about ${moduleId}.
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

let repoRoot: string;
let mockLlm: FullMockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-ignores-"));
  mockLlm = new FullMockLlm();
  // Product source — must be indexed and documented.
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'ok'; }\nexport class AuthService {}\n",
    "utf8",
  );
  // Ignored directories — must NOT enter the inventory, plan, tasks,
  // LLM work, or generated pages.
  await nodeFs.mkdir(nodePath.join(repoRoot, "benchmarks/tooling"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "benchmarks/tooling/harness.ts"),
    "export function runHarness() { return 'bench'; }\n",
    "utf8",
  );
  await nodeFs.mkdir(nodePath.join(repoRoot, "raw/openwiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "raw/openwiki/peer.ts"),
    "export function peerImpl() { return 'peer'; }\n",
    "utf8",
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeIgnores(ignores: string[]): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify({ ignores }),
    "utf8",
  );
}

async function activeFilePaths(root: string): Promise<string[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), { readonly: true });
  try {
    return (
      db.prepare("SELECT path FROM files WHERE status = 'active'").all() as Array<{ path: string }>
    ).map((r) => r.path);
  } finally {
    db.close();
  }
}

describe("config.ignores propagation", () => {
  it("base init excludes configured paths and retains ordinary source", async () => {
    await writeIgnores(["benchmarks/", "raw/openwiki/"]);

    const result = await runInit({ repoRoot, quiet: true });
    expect(result.plan).toBeUndefined(); // base flow, not --plan
    expect(result.filesWritten).toContain("livewiki/architecture/overview.md");

    // Indexed inventory: only the product source survives.
    const paths = (await activeFilePaths(repoRoot)).sort();
    expect(paths).toEqual(["src/auth/login.ts"]);

    // No overview, structure, or tasks mention the ignored dirs.
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    const structure = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/structure.mmd"),
      "utf8",
    );
    expect(overview).not.toMatch(/benchmarks|openwiki/);
    expect(structure).not.toMatch(/benchmarks|openwiki/);

    // --plan reports the same exclusion (deterministic source of truth).
    const planResult = await runInit({ repoRoot, plan: true, quiet: true });
    const planPaths = planResult.plan!.modules.flatMap((m) => m.paths);
    expect(planPaths).toEqual(["src/auth/login.ts"]);
  });

  it("direct batch.runBatch excludes configured paths from inventory, tasks, and LLM work", async () => {
    await writeIgnores(["benchmarks/", "raw/openwiki/"]);

    const result = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    // Inventory: only the product source.
    expect((await activeFilePaths(repoRoot)).sort()).toEqual(["src/auth/login.ts"]);

    // Batch tasks: no target references an ignored path.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), { readonly: true });
    try {
      const tasks = db
        .prepare("SELECT target FROM batch_tasks WHERE stage = 4")
        .all() as Array<{ target: string }>;
      expect(tasks.map((t) => t.target)).toEqual(["auth"]);
    } finally {
      db.close();
    }

    // LLM work: the LLM was only asked to document `auth` (the
    // configured-ignored modules were never seen).
    expect(mockLlm.documentedModules).toEqual(["auth"]);
  });
});
