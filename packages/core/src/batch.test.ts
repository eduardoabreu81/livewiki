import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, runOnly } from "./batch.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";

/**
 * Mock LLM que devolve um Markdown válido com frontmatter + anchor.
 * Usado pra testar o orchestrator sem chamadas reais.
 */
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string; maxTokens: number | undefined }> = [];

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    this.callCount++;
    this.callLog.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    // Extrai o nome do módulo do user prompt (linha "# Module: <id>")
    const match = req.user.match(/# Module: ([^\s]+)/);
    const moduleId = match ? match[1] : "unknown";
    // Extrai a primeira chave canônica do user prompt
    const keyMatch = req.user.match(/^- (.+?#[\w.]+)$/m);
    const firstKey = keyMatch ? keyMatch[1] : `${moduleId}.ts#placeholder`;
    const content = `---
title: ${moduleId} responsibilities
owner: generated
anchors:
  - ${firstKey}
---

# ${moduleId} responsibilities

This page documents the responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides part of the repository implementation described by the indexed source.

## Details
<!-- lw:anchors ${firstKey} -->

Some prose about ${moduleId}.
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

let repoRoot: string;
let mockLlm: MockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-"));
  // Cria estrutura mínima de repo: 1 arquivo com 1 função
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'auth'; }",
    "utf8",
  );
  mockLlm = new MockLlm();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("batch.runBatch — orquestrador end-to-end com mock LLM", () => {
  it("roda o pipeline completo: cria batch_run + tasks + manifest", async () => {
    const result = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true, // pula refinamento da etapa 2 (determinístico)
      skipManifestWrite: false,
    });

    expect(result.status).toBe("completed");
    expect(result.runId).toBeGreaterThan(0);
    expect(result.byModule.length).toBeGreaterThan(0);

    // Wiki page gerada
    const wikiPath = nodePath.join(repoRoot, "livewiki/auth.md");
    expect(await nodeFs.readFile(wikiPath, "utf8")).toMatch(/title: auth/);

    // Manifest escrito
    const manifestPath = nodePath.join(repoRoot, "livewiki/.manifest.json");
    expect(await nodeFs.readFile(manifestPath, "utf8")).toMatch(/"version": 1/);
  });

  it("--no-refine (default): etapa 2 só roda heurística, sem LLM call", async () => {
    const before = mockLlm.callCount;
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    // Mock só foi chamado pra stage 4 (1 módulo = 1 chamada). Sem etapa 2.
    expect(mockLlm.callCount - before).toBe(1);
    expect(mockLlm.callLog.at(-1)?.user).not.toContain("# Suggested display title");
  });

  it("com LLM refine: etapa 2 faz 1 chamada adicional", async () => {
    // Setup: precisa de config válida pro cliente poder ser criado lazy
    // Aqui injetamos o mock — então o config check é skipado
    const before = mockLlm.callCount;
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: false, // tenta refinar (1 chamada extra na etapa 2)
      skipManifestWrite: true,
    });
    // Etapa 2 (1) + etapa 4 (1) = 2 chamadas
    expect(mockLlm.callCount - before).toBe(2);
  });

  it("checkpoint de cada task tem usageHistory populado", async () => {
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const tasks = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4")
        .all() as Array<{ checkpoint_json: string | null }>;
      expect(tasks.length).toBeGreaterThan(0);
      for (const t of tasks) {
        const cp = JSON.parse(t.checkpoint_json!) as {
          usageHistory: Array<{ usage: { model: string; inputTokens: number; outputTokens: number }; costUsd: unknown }>;
        };
        expect(cp.usageHistory).toHaveLength(1);
        expect(cp.usageHistory[0]!.usage.model).toBe("claude-test-mock");
        expect(cp.usageHistory[0]!.usage.inputTokens).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });
});

describe("batch.runOnly — re-roda 1 task", () => {
  it("incrementa attempt no checkpoint existente", async () => {
    // Run inicial
    const r1 = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(r1.byModule.length).toBeGreaterThan(0);
    const moduleId = r1.byModule[0]!.module;

    // Re-roda 1 task
    const r2 = await runOnly({
      repoRoot,
      llmClient: mockLlm,
      onlyTarget: moduleId,
    });

    // usageHistory tem 2 entries (1 original + 1 do retry)
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE target = ? AND stage = 4")
        .get(moduleId) as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        attempt: number;
        usageHistory: unknown[];
      };
      expect(cp.attempt).toBe(2); // 1 inicial + 1 retry
      expect(cp.usageHistory).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("batch.runBatch — dynamic output-token budget (Priority-0 fix)", () => {
  it("a module with many exported symbols gets a maxTokens budget larger than the old flat 8192 default", async () => {
    // 40 exported functions in one file -> a closed key list large enough
    // that the dynamic formula (base 2048 + 300/anchor) clears 8192.
    const lines = Array.from({ length: 40 }, (_, i) => `export function fn${i}() { return ${i}; }`);
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/big"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/big/many.ts"), lines.join("\n") + "\n", "utf8");

    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    const bigModuleCall = mockLlm.callLog.find((c) => c.user.includes("# Module: big"));
    expect(bigModuleCall).toBeDefined();
    expect(bigModuleCall!.maxTokens).toBeGreaterThan(8192);
  });

  it("a tiny module stays near the floor, well below the old flat 8192 default", async () => {
    // The default fixture (src/auth/login.ts, 1 function) already exercises
    // the small-module path via beforeEach.
    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    const authModuleCall = mockLlm.callLog.find((c) => c.user.includes("# Module: auth"));
    expect(authModuleCall).toBeDefined();
    expect(authModuleCall!.maxTokens).toBeLessThan(8192);
  });

  it("outputTokenStrategy: 'fixed' sends the configured ceiling literally, ignoring content size", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `export function fn${i}() { return ${i}; }`);
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/big"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/big/many.ts"), lines.join("\n") + "\n", "utf8");
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ outputTokenStrategy: "fixed", stage4MaxOutputTokens: 8192 }),
      "utf8",
    );

    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    for (const call of mockLlm.callLog) {
      expect(call.maxTokens).toBe(8192);
    }
  });
});
