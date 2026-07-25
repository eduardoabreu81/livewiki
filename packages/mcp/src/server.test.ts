/**
 * E2E Fase 4 — MCP server com InMemoryTransport (não precisa de stdio real).
 *
 * Conecta um McpServer (livewiki) com um Client (mock agent) via par de
 * InMemoryTransport. Valida:
 *   - handshake (initialize)
 *   - tools/list retorna as 6 tools
 *   - tools/call pra cada uma com input válido
 *   - write_doc rejeita path fora de livewiki/ (regra #1 SPEC)
 *   - write_doc rejeita conteúdo com broken_anchor (verify pós-escrita)
 *   - read retorna páginas
 *   - quickstart retorna o arquivo
 *   - search retorna hits FTS5
 *   - debt retorna relatório do status
 *   - resolve_debt fecha dívidas
 *
 * Critério de aceite (SPEC §"Fase 4"): conectado a um client MCP real,
 * write_doc rejeita path fora de livewiki/ e conteúdo que não passa no verify.
 *
 * IMPORTANTE — Windows file locking: better-sqlite3 abre o search.db com
 * WAL (search.db-shm / search.db-wal). O afterEach roda nodeFs.rm
 * recursivo, que pode falhar com EBUSY se o DB ainda estiver aberto.
 * Por isso cada teste fecha server + client no finally.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type CreateServerOptions } from "./server.js";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-mcp-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/utils"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'ok'; }\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/utils/helper.ts"),
    "export function help() { return 'utils'; }\n",
  );
  // Init programático (não passa pelo CLI pra ser mais rápido/controlado)
  const { runInit } = await import("@livewiki/core/init");
  await runInit({ repoRoot, quiet: true });
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

interface Connected {
  client: Client;
  server: McpServer;
}

/** Helper: conecta server + client via InMemoryTransport.
 *  Retorna ambos pra fechar antes do afterEach (libera FTS5 no Windows). */
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> {
  const server = await createServer({ repoRoot, ...opts });
  const client = new Client({ name: "test-agent", version: "0.0.0" }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client, server };
}

async function teardown(c: Connected): Promise<void> {
  await c.client.close();
  await c.server.close();
}

describe("MCP server — Fase 4", () => {
  it("tools/list retorna as 7 tools (SPEC + Phase 3 livewiki_impact)", async () => {
    const c = await connect();
    try {
      const { tools } = await c.client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "livewiki_debt",
        "livewiki_impact",
        "livewiki_quickstart",
        "livewiki_read",
        "livewiki_resolve_debt",
        "livewiki_search",
        "livewiki_write_doc",
      ]);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_quickstart retorna o conteúdo do arquivo", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_quickstart", arguments: {} });
      const text = extractText(r);
      expect(text).toMatch(/Quickstart|Guia/);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read lê uma página da wiki", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "livewiki/quickstart.md" },
      });
      const text = extractText(r);
      expect(text).toMatch(/Quickstart|Guia/);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read rejeita path fora de livewiki/ (regra #1 da SPEC)", async () => {
    const c = await connect();
    try {
      // Server retorna isError=true (não throw) com mensagem clara — mais
      // útil para o client MCP que um stack trace de McpError.
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "src/auth/login.ts" },
      });
      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toMatch(/allowlist|outside|livewiki/i);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_search retorna hits via FTS5", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: "modules", limit: 10 },
      });
      const text = extractText(r);
      const parsed = JSON.parse(text);
      expect(Array.isArray(parsed.hits)).toBe(true);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_debt retorna o status JSON do repo", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_debt", arguments: {} });
      const text = extractText(r);
      const report = JSON.parse(text);
      expect(report.files).toBeDefined();
      expect(report.symbols).toBeDefined();
      expect(report.debt).toBeDefined();
      expect(report.undocumented).toBeDefined();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact reports a direct caller and the pages that cite it", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/utils/helper.ts"),
      "export function help() { return 'utils'; }\nexport function useHelp() { return help(); }\n",
    );
    const { run: runIndexer } = await import("@livewiki/core/indexer");
    await runIndexer(repoRoot, { quiet: true });

    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/utils/helper.ts#help" },
      });
      const parsed = JSON.parse(extractText(r));
      expect(parsed.symbolKey).toBe("src/utils/helper.ts#help");
      expect(parsed.directCallers).toContain("src/utils/helper.ts#useHelp");
      expect(parsed.truncated).toBe(false);
      expect(Array.isArray(parsed.affectedPages)).toBe(true);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact returns empty callers for a symbol nothing calls", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/auth/login.ts#login" },
      });
      const parsed = JSON.parse(extractText(r));
      expect(parsed.directCallers).toEqual([]);
      expect(parsed.transitiveCallers).toEqual([]);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc aceita conteúdo válido e atualiza índice FTS5", async () => {
    const c = await connect();
    try {
      // Página sem anchor = verify OK (sem broken_anchor)
      const content = `---
title: scratch
owner: generated
---

# scratch

Notes aqui.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/scratch.md", content },
      });
      const text = extractText(r);
      expect(text).toMatch(/wrote livewiki\/scratch\.md/);
      const onDisk = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/scratch.md"),
        "utf8",
      );
      expect(onDisk).toContain("# scratch");
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rejeita path fora de livewiki/ (regra #1)", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "src/evil.ts", content: "export {}" },
      });
      // Server retorna isError=true com McpError InvalidParams (path fora
      // da allowlist é input inválido do ponto de vista do MCP).
      // O client SDK pode envelopar como throw OU retornar isError —
      // aceitamos os dois, mas o resultado precisa sinalizar rejeição.
      const rejected = r.isError === true;
      if (!rejected) {
        // Fallback: tentar detectar via thrown McpError
        let threw = false;
        try {
          await c.client.callTool({
            name: "livewiki_write_doc",
            arguments: { path: "src/evil2.ts", content: "export {}" },
          });
        } catch {
          threw = true;
        }
        expect(threw, "write_doc deveria rejeitar path fora de livewiki/").toBe(true);
      }
      // Garante que o arquivo NÃO foi criado
      await expect(
        nodeFs.access(nodePath.join(repoRoot, "src/evil.ts")),
      ).rejects.toThrow();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rejeita conteúdo com anchor quebrada (verify)", async () => {
    const c = await connect();
    try {
      // Anchor pra um symbol que NÃO existe no índice
      const broken = `---
title: broken
owner: generated
anchors:
  - src/auth/login.ts#symbolQueNaoExiste
---

# broken

Referencia um symbol que nao existe.

<!-- lw:anchors src/auth/login.ts#symbolQueNaoExiste -->

Conteudo.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/broken.md", content: broken },
      });
      // Resultado vem com isError=true (não joga, mas marca erro)
      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toMatch(/verify rejected/);
      // Garante que o arquivo NÃO foi escrito (rollback)
      await expect(
        nodeFs.access(nodePath.join(repoRoot, "livewiki/broken.md")),
      ).rejects.toThrow();
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc rolls back and fails closed when verify crashes", async () => {
    const crashMessage = "synthetic verifier crash";
    const path = "livewiki/verify-crash.md";
    const sentinel = "lotkverifycrashsentinel";
    const c = await connect({
      verify: async () => {
        throw new Error(crashMessage);
      },
    });
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path, content: `# Verify crash\n\n${sentinel}\n` },
      });

      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toContain(crashMessage);
      expect(text).toMatch(/not kept/i);
      await expect(nodeFs.access(nodePath.join(repoRoot, path))).rejects.toThrow();

      const searchResult = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: sentinel },
      });
      const parsed = JSON.parse(extractText(searchResult)) as { hits: unknown[] };
      expect(parsed.hits).toEqual([]);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc warns about an UNVERIFIED path when crash rollback fails", async () => {
    const crashMessage = "synthetic verifier crash after external removal";
    const path = "livewiki/rollback-failure.md";
    const c = await connect({
      verify: async () => {
        await nodeFs.unlink(nodePath.join(repoRoot, path));
        throw new Error(crashMessage);
      },
    });
    try {
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path, content: "# Rollback failure\n" },
      });

      expect(r.isError).toBe(true);
      const text = extractText(r);
      expect(text).toContain(crashMessage);
      expect(text).toContain("UNVERIFIED");
      expect(text).toContain(path);
      expect(text).toMatch(/inspect/i);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc aceita com skipVerify=true (escape documentado)", async () => {
    const c = await connect();
    try {
      const content = `# skip verify ok\n`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: {
          path: "livewiki/skip.md",
          content,
          skipVerify: true,
        },
      });
      const text = extractText(r);
      expect(text).toMatch(/wrote livewiki\/skip\.md/);
      const onDisk = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki/skip.md"),
        "utf8",
      );
      expect(onDisk).toContain("skip verify ok");
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_resolve_debt fecha dívidas e reporta IDs inválidos", async () => {
    const c = await connect();
    try {
      // Sem dívidas abertas inicialmente → tentar resolver ID 9999 = notFound
      const r = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: { debtIds: [9999] },
      });
      const text = extractText(r);
      const parsed = JSON.parse(text);
      expect(parsed.resolved).toEqual([]);
      expect(parsed.notFound).toEqual([9999]);
    } finally {
      await teardown(c);
    }
  });

  it("search_db é criado em .livewiki/search.db (FTS5 schema)", async () => {
    const c = await connect();
    try {
      const exists = await nodeFs
        .access(nodePath.join(repoRoot, ".livewiki/search.db"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    } finally {
      await teardown(c);
    }
  });
});

/**
 * Etapa 2d — workflow-adjacency hints (capability backlog item 4).
 * Every SUCCESS tool response must carry a static `_hints` block suggesting
 * the next most useful tool calls; error responses carry no hints.
 */
describe("MCP server — workflow-adjacency hints (Etapa 2d)", () => {
  it("livewiki_quickstart suggests search and read", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_quickstart", arguments: {} });
      expect(hintTools(r)).toEqual(["livewiki_search", "livewiki_read"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_read suggests search and write_doc", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "livewiki/quickstart.md" },
      });
      expect(hintTools(r)).toEqual(["livewiki_search", "livewiki_write_doc"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_search suggests read and debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_search",
        arguments: { query: "modules", limit: 10 },
      });
      expect(hintTools(r)).toEqual(["livewiki_read", "livewiki_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_debt suggests write_doc and resolve_debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({ name: "livewiki_debt", arguments: {} });
      expect(hintTools(r)).toEqual(["livewiki_write_doc", "livewiki_resolve_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_impact suggests read and write_doc", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_impact",
        arguments: { symbolKey: "src/auth/login.ts#login" },
      });
      expect(hintTools(r)).toEqual(["livewiki_read", "livewiki_write_doc"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_write_doc suggests debt and resolve_debt on success", async () => {
    const c = await connect();
    try {
      const content = `---
title: hints-scratch
owner: generated
---

# hints-scratch

Notes.
`;
      const r = await c.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/hints-scratch.md", content },
      });
      expect(r.isError).toBeFalsy();
      expect(hintTools(r)).toEqual(["livewiki_debt", "livewiki_resolve_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("livewiki_resolve_debt suggests debt", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_resolve_debt",
        arguments: { debtIds: [9999] },
      });
      expect(hintTools(r)).toEqual(["livewiki_debt"]);
      assertWellFormedHints(r);
    } finally {
      await teardown(c);
    }
  });

  it("error responses carry no hints", async () => {
    const c = await connect();
    try {
      const r = await c.client.callTool({
        name: "livewiki_read",
        arguments: { path: "src/auth/login.ts" },
      });
      expect(r.isError).toBe(true);
      expect(extractHints(r)).toEqual([]);
    } finally {
      await teardown(c);
    }
  });
});

interface HintEntry {
  tool: string;
  when: string;
}

/** Extracts the `_hints` array from a tool result: parses each text block as
 *  JSON (plain-text blocks like raw markdown simply fail to parse) and
 *  returns the first block carrying a `_hints` array. Empty when absent. */
function extractHints(r: unknown): HintEntry[] {
  if (typeof r !== "object" || r === null) return [];
  const content = (r as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      try {
        const parsed = JSON.parse((block as { text: string }).text) as { _hints?: unknown };
        if (Array.isArray(parsed._hints)) return parsed._hints as HintEntry[];
      } catch {
        // Not a JSON block (e.g. raw page markdown) — keep scanning.
      }
    }
  }
  return [];
}

function hintTools(r: unknown): string[] {
  return extractHints(r).map((h) => h.tool);
}

/** Every hint entry must be a short `{ tool, when }` pair naming a real tool. */
function assertWellFormedHints(r: unknown): void {
  const hints = extractHints(r);
  expect(hints.length).toBeGreaterThan(0);
  for (const h of hints) {
    expect(h.tool).toMatch(/^livewiki_/);
    expect(typeof h.when).toBe("string");
    expect(h.when.length).toBeGreaterThan(0);
  }
}

/** Extrai texto do resultado MCP. callTool retorna tipo discriminado;
 *  aqui aceitamos qualquer objeto com `content: Array<{type, text?}>` e
 *  juntamos os blocos text. */
function extractText(r: unknown): string {
  if (typeof r !== "object" || r === null) return "";
  const content = (r as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (
      typeof c === "object" &&
      c !== null &&
      (c as { type?: unknown }).type === "text" &&
      typeof (c as { text?: unknown }).text === "string"
    ) {
      parts.push((c as { text: string }).text);
    }
  }
  return parts.join("\n");
}
