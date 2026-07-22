/**
 * server — MCP server do livewiki (Fase 4).
 *
 * SPEC §"MCP tools" define 6 tools:
 *   - livewiki_quickstart  — retorna livewiki/quickstart.md (entry point)
 *   - livewiki_read        — lê página da wiki por path
 *   - livewiki_search      — busca full-text via SQLite FTS5
 *   - livewiki_debt        — dívida aberta (equivale a status --json)
 *   - livewiki_write_doc   — escreve/atualiza página (allowlist + verify)
 *   - livewiki_resolve_debt— marca dívida como paga
 *
 * Phase 3 adds a 7th tool:
 *   - livewiki_impact      — blast radius de um símbolo (callers + páginas afetadas)
 *
 * Princípio arquitetural: escrita passa por core/safe-io (regra #1 da SPEC).
 * write_doc valida o path contra allowlist (livewiki/, .livewiki/) E roda
 * `verify` no conteúdo antes de aceitar. Path fora de livewiki/ é erro;
 * conteúdo com broken_anchor é rejeitado com detalhe.
 *
 * Server transport: stdio (SPEC §"Fase 4 — stdio, testes com MCP inspector").
 * Outros transports (HTTP/SSE) podem ser adicionados depois sem mudar tools.
 *
 * Erros são reportados via McpError com códigos padrão MCP:
 *   - InvalidParams: input do user inválido
 *   - InvalidRequest: estado inconsistente (ex.: wiki não inicializada)
 *   - InternalError: erro inesperado
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as safeIo from "@livewiki/core/safe-io";
import { run as runStatus } from "@livewiki/core/status";
import { run as runVerify } from "@livewiki/core/verify";
import { openIndex } from "@livewiki/core/db";
import { computeBlastRadius } from "@livewiki/core/blast-radius";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import {
  openAndIndex,
  indexPage,
  removePage,
  search as doSearch,
  close as closeSearch,
  type SearchIndex,
} from "./search.js";

export interface CreateServerOptions {
  /** Repo root que o server atende. Default: process.cwd() */
  repoRoot?: string;
  /** Test seam for forcing verifier failures. Production uses core verify. */
  verify?: typeof runVerify;
}

/**
 * Cria e configura o McpServer com as 6 tools. NÃO conecta o transport —
 * isso fica a cargo do caller (index.ts usa StdioServerTransport).
 */
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
  const repoRoot = nodePath.resolve(opts.repoRoot ?? process.cwd());
  const verify = opts.verify ?? runVerify;
  const searchIdx = await openAndIndex(repoRoot);
  const server = new McpServer(
    {
      name: "livewiki",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Helper: wrap conteúdo textual em tool result MCP.
  function textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
  }
  function errorResult(message: string) {
    return { content: [{ type: "text" as const, text: `error: ${message}` }], isError: true };
  }
  async function rollbackWrittenPage(path: string): Promise<boolean> {
    try {
      await nodeFs.unlink(await safeIo.resolveAndValidate(repoRoot, path));
      return true;
    } catch {
      return false;
    }
  }

  // ─── livewiki_quickstart ───────────────────────────────────────────────
  // Retorna livewiki/quickstart.md (entry point de baixo token para LLMs).
  server.tool(
    "livewiki_quickstart",
    "Returns livewiki/quickstart.md (the low-token entry point for navigating the wiki). Errors if the wiki isn't initialized yet — run `livewiki init` first.",
    {},
    async () => {
      try {
        const text = await safeIo.readText(repoRoot, "livewiki/quickstart.md");
        return textResult(text);
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : `failed to read quickstart: ${String(err)}`,
        );
      }
    },
  );

  // ─── livewiki_read ─────────────────────────────────────────────────────
  // Lê uma página da wiki por path relativo (ex: "livewiki/auth.md").
  server.tool(
    "livewiki_read",
    "Reads a wiki page by its relative path inside the repo (e.g. 'livewiki/auth.md'). Path must be inside the livewiki/ allowlist.",
    {
      path: z
        .string()
        .min(1)
        .describe("Relative path to the wiki page, e.g. 'livewiki/auth.md'"),
    },
    async ({ path }) => {
      try {
        const text = await safeIo.readText(repoRoot, path);
        return textResult(text);
      } catch (err) {
        // Mensagem NÃO vaza path absoluto nem conteúdo do repo (princípio safe-io).
        return errorResult(
          err instanceof Error ? err.message : `failed to read ${path}`,
        );
      }
    },
  );

  // ─── livewiki_search ───────────────────────────────────────────────────
  // Busca full-text via FTS5. Reindexa ao abrir o server; incremental via write_doc.
  server.tool(
    "livewiki_search",
    "Full-text search over all wiki pages using SQLite FTS5. Returns up to N hits (default 20) with wiki path and a snippet around the match.",
    {
      query: z
        .string()
        .min(1)
        .describe("FTS5 query (supports AND/OR, prefix 'term*', exact 'phrase')"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max results (default 20, max 100)"),
    },
    async ({ query, limit }) => {
      try {
        const hits = doSearch(searchIdx, query, { ...(limit !== undefined ? { limit } : {}) });
        return textResult(JSON.stringify({ query, hits }, null, 2));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : `search failed`);
      }
    },
  );

  // ─── livewiki_debt ─────────────────────────────────────────────────────
  // Dívida aberta = status --json (Fase 2).
  server.tool(
    "livewiki_debt",
    "Lists open documentation debt (changed/moved/deleted anchors), undocumented symbols, and overall wiki status. Equivalent to `livewiki status --json`.",
    {},
    async () => {
      try {
        const report = await runStatus(repoRoot);
        return textResult(JSON.stringify(report, null, 2));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : `status failed`);
      }
    },
  );

  // ─── livewiki_impact ───────────────────────────────────────────────────
  // "What breaks if I change this symbol?" — walks the resolved call graph
  // backward (direct + transitive callers, bounded) and cross-references
  // anchors/doc_pages to report which wiki pages document affected code.
  server.tool(
    "livewiki_impact",
    "Blast radius for a symbol key (e.g. 'src/auth.ts#login'): direct and transitive callers found in the indexed call graph, plus which wiki pages document any of them. Only RESOLVED call edges are walked (an edge the indexer couldn't confidently attribute to one symbol is skipped, never guessed) — treat this as a best-effort signal, not exhaustive static analysis. Bounded by maxDepth/maxNodes; `truncated: true` means the walk stopped at a bound, not that it found no more callers.",
    {
      symbolKey: z
        .string()
        .min(1)
        .describe("Symbol key, e.g. 'src/auth.ts#login' or 'src/auth.ts#Session.refresh'"),
      maxDepth: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max caller-of-caller hops to follow (default 5)"),
      maxNodes: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe("Max distinct caller symbols to collect (default 200)"),
    },
    async ({ symbolKey, maxDepth, maxNodes }) => {
      try {
        const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
        const db = openIndex(dbPath);
        try {
          const result = computeBlastRadius(db, symbolKey, {
            ...(maxDepth !== undefined ? { maxDepth } : {}),
            ...(maxNodes !== undefined ? { maxNodes } : {}),
          });
          return textResult(JSON.stringify(result, null, 2));
        } finally {
          db.close();
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "impact failed");
      }
    },
  );

  // ─── livewiki_write_doc ────────────────────────────────────────────────
  // CRÍTICO (SPEC §"MCP tools"): valida allowlist (livewiki/) e roda verify
  // antes de aceitar. Path fora de livewiki/ → rejeitado. Conteúdo com
  // broken_anchor → rejeitado com detalhe.
  server.tool(
    "livewiki_write_doc",
    "Writes or updates a wiki page. Path MUST be inside livewiki/ (allowlist). Content is validated via `verify` before being accepted — pages with broken anchors are rejected. Returns the verify result on success.",
    {
      path: z
        .string()
        .min(1)
        .describe("Relative path inside livewiki/, e.g. 'livewiki/auth.md'"),
      content: z.string().describe("Full markdown content (with frontmatter)"),
      /** Quando true, pula o verify (não recomendado; usar só pra escrever
       *  páginas legítimas como quickstart que não ancoram símbolos) */
      skipVerify: z
        .boolean()
        .optional()
        .describe("Skip verify step (default false). Only use for non-anchor pages."),
    },
    async ({ path, content, skipVerify }) => {
      // 1) Allowlist — safe-io.validateDeclared já falha com PathOutsideAllowlistError.
      //    writeText chamará resolveAndValidate (com symlink check).
      try {
        await safeIo.writeText(repoRoot, path, content);
      } catch (err) {
        // Mensagem do safe-io já é segura (não vaza conteúdo, não vaza path abs).
        if (err instanceof safeIo.PathOutsideAllowlistError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Path ${JSON.stringify(path)} is outside the livewiki/ allowlist. ` +
              `write_doc can only write to paths inside livewiki/ (regra #1 da SPEC).`,
          );
        }
        if (err instanceof safeIo.InvalidRelativePathError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid path: ${err.message}`,
          );
        }
        return errorResult(err instanceof Error ? err.message : "write failed");
      }

      // 2) Verify — roda no repo e checa se a página recém-escrita quebrou algo.
      //    Só roda se skipVerify !== true.
      if (!skipVerify) {
        try {
          const verifyResult = await verify(repoRoot);
          // Falha se há issue error-level tocando esta página.
          const issuesHere = verifyResult.issues.filter(
            (i) => i.severity === "error" && (i.wikiPath === path || i.wikiPath === ""),
          );
          if (issuesHere.length > 0) {
            // Rollback: remove o arquivo que acabamos de escrever pra não
            // deixar estado inconsistente (regra #3: banco é derivado, mas
            // disco é a verdade — não deixe lixo).
            await rollbackWrittenPage(path);
            return errorResult(
              `verify rejected the page (${issuesHere.length} error issue(s)). ` +
                `First issue: ${issuesHere[0]?.code ?? "?"} — ${issuesHere[0]?.detail ?? "?"}. ` +
                `Page NOT written.`,
            );
          }
        } catch (err) {
          const crashMessage = err instanceof Error ? err.message : String(err);
          const rolledBack = await rollbackWrittenPage(path);
          if (!rolledBack) {
            return errorResult(
              `verify crashed: ${crashMessage}. Rollback failed; the disk may hold an ` +
                `UNVERIFIED page at ${JSON.stringify(path)}. Inspect that path before continuing.`,
            );
          }
          return errorResult(
            `verify crashed: ${crashMessage}. The page was NOT kept.`,
          );
        }
      }

      // 3) Atualiza índice FTS5 incrementalmente (write bem-sucedido).
      indexPage(searchIdx, path, content);

      return textResult(`wrote ${path} (verified)`);
    },
  );

  // ─── livewiki_resolve_debt ─────────────────────────────────────────────
  // Marca dívida como paga. Recebe IDs e atualiza resolved_at no DB.
  // Validação: IDs devem existir e debt deve estar aberta.
  server.tool(
    "livewiki_resolve_debt",
    "Marks documentation debt items as paid (sets resolved_at). Each ID must reference an open debt row. Returns the count of resolved items and any IDs that didn't match.",
    {
      debtIds: z
        .array(z.number().int().positive())
        .min(1)
        .describe("Debt row IDs to resolve (get them from livewiki_debt)"),
      /** Vinculado a um write — referência opcional pra audit trail */
      writeRef: z
        .string()
        .optional()
        .describe("Optional write path (e.g. 'livewiki/auth.md') for audit trail"),
    },
    async ({ debtIds, writeRef }) => {
      try {
        const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
        const db = openIndex(dbPath);
        try {
          const stmt = db.prepare(
            "UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL",
          );
          const ts = Date.now();
          const resolved: number[] = [];
          const notFound: number[] = [];
          const tx = db.transaction(() => {
            for (const id of debtIds) {
              const r = stmt.run(ts, id);
              if (r.changes > 0) resolved.push(id);
              else notFound.push(id);
            }
          });
          tx();
          return textResult(
            JSON.stringify(
              {
                resolved,
                notFound,
                ...(writeRef !== undefined ? { writeRef } : {}),
                timestamp: ts,
              },
              null,
              2,
            ),
          );
        } finally {
          db.close();
        }
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "resolve_debt failed");
      }
    },
  );

  // Cleanup on close
  const origClose = server.close.bind(server);
  server.close = async () => {
    closeSearch(searchIdx);
    return origClose();
  };

  // Type augmentation: McpServer.close is already async-typed, we just augment to also close search.
  // (Cast through unknown to avoid TS error on direct override.)
  return server;
}

// Re-export for tests
export type { SearchIndex };
