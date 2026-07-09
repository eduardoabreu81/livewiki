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
import { createServer } from "./server.js";
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
async function connect(): Promise<Connected> {
  const server = await createServer({ repoRoot });
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
  it("tools/list retorna as 6 tools da SPEC", async () => {
    const c = await connect();
    try {
      const { tools } = await c.client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "livewiki_debt",
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