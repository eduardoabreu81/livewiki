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
 *
 * Workflow-adjacency hints (Etapa 2d): every SUCCESS tool response also
 * carries a `_hints` block suggesting the next most useful tool calls, so
 * arbitrary MCP clients discover the livewiki loop
 * (quickstart → search → read → write_doc → debt) on their own. JSON
 * payloads gain a top-level `_hints` field; plain-text responses
 * (quickstart/read/write_doc) gain a trailing text block with
 * `{"_hints": [...]}`. Error responses carry no hints.
 *
 * Index freshness (backlog #3): while the server is alive, a recursive
 * fs.watch on the repo root (denylisted, 1.5s debounce) re-runs the
 * incremental indexer → ledger → search rebuild on each batch of working-
 * tree changes, so tool responses reflect the re-indexed state without a
 * restart. Watch failures degrade to startup-rebuild semantics with one
 * log line; `server.close()` stops the watcher and awaits any in-flight
 * sync (Windows handle discipline).
 */

/** One workflow-adjacency hint: a suggested next tool call and when to use it. */
export interface ToolHint {
  tool: string;
  when: string;
}

/**
 * Static presentation-layer hint table (capability backlog item 4,
 * docs/plans/2026-07-23-capability-backlog.md). Pure data — no config, no
 * state, no logic. Keys are tool names; values are the next most useful
 * tool calls after a successful response from that tool.
 */
const TOOL_HINTS: Record<string, ToolHint[]> = {
  livewiki_quickstart: [
    { tool: "livewiki_search", when: "to find wiki pages about a specific topic or symbol" },
    { tool: "livewiki_read", when: "to open in full a page linked from the quickstart" },
  ],
  livewiki_read: [
    { tool: "livewiki_search", when: "to find other pages covering related topics" },
    { tool: "livewiki_write_doc", when: "to update this page when the code it documents changed" },
  ],
  livewiki_search: [
    { tool: "livewiki_read", when: "to read the full page behind a search hit" },
    { tool: "livewiki_debt", when: "to check for open documentation debt before editing code" },
  ],
  livewiki_debt: [
    { tool: "livewiki_write_doc", when: "to pay open debt by writing or updating the page for a debt item" },
    { tool: "livewiki_resolve_debt", when: "to close debt items you have already addressed" },
  ],
  livewiki_impact: [
    { tool: "livewiki_read", when: "to read a wiki page listed among the affected pages" },
    { tool: "livewiki_write_doc", when: "to update an affected page after changing the code it documents" },
    { tool: "livewiki_debt", when: "to check open documentation debt for the changed symbols (repo-wide impact mode)" },
  ],
  livewiki_write_doc: [
    { tool: "livewiki_debt", when: "to re-check which debt items remain open after the write" },
    { tool: "livewiki_resolve_debt", when: "to close the debt items this write addressed" },
  ],
  livewiki_resolve_debt: [
    { tool: "livewiki_debt", when: "to confirm no debt items remain open" },
  ],
};

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as safeIo from "@livewiki/core/safe-io";
import { run as runStatus } from "@livewiki/core/status";
import { run as runVerify } from "@livewiki/core/verify";
import { openIndex } from "@livewiki/core/db";
import { computeBlastRadius } from "@livewiki/core/blast-radius";
import { computeChangeImpact } from "@livewiki/core/change-impact";
import { recordUpdateMetric } from "@livewiki/core/update-metrics";
import { CHARS_PER_TOKEN } from "@livewiki/core/update";
import { run as runIndexer } from "@livewiki/core/indexer";
import { run as runLedger } from "@livewiki/core/anchor-ledger";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import {
  openAndIndex,
  indexPage,
  removePage,
  reindexAllPages,
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
 * Watcher denylist (backlog #3) — deliberately tiny and documented.
 * Directory SEGMENTS: `.git` (VCS internals), `.livewiki` (the derived
 * cache — indexer/ledger/search writes must never retrigger the sync
 * loop), `node_modules`, `dist` (build output). Extensions: common
 * binary/media/font files that never carry symbols or prose. Anything
 * else flows into the debounce; the indexer itself applies its own
 * (richer) walk denylist, so a noisy-but-harmless event costs at most
 * one hash-incremental no-op sync.
 */
const WATCH_DENIED_SEGMENTS: ReadonlySet<string> = new Set([
  ".git",
  ".livewiki",
  "node_modules",
  "dist",
]);
const WATCH_DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".gz", ".tar",
  ".mp3", ".mp4", ".mov", ".avi",
  ".woff", ".woff2", ".ttf", ".eot",
]);

function isWatchDenied(filename: string): boolean {
  // Windows emits backslash separators; POSIX forward. Split on both.
  for (const segment of filename.split(/[\\/]/)) {
    if (WATCH_DENIED_SEGMENTS.has(segment)) return true;
  }
  return WATCH_DENIED_EXTENSIONS.has(nodePath.extname(filename).toLowerCase());
}

/** Debounce window for watcher-triggered syncs (backlog #3 design). */
const WATCH_DEBOUNCE_MS = 1500;

interface WatcherHandle {
  /** Stops the watcher, clears the pending debounce, awaits any in-flight sync. */
  stop(): Promise<void>;
}

/**
 * Backlog #3 (docs/plans/2026-07-28-change-impact-and-index-freshness.md,
 * item 3.2): recursive fs.watch on the repo root feeding a 1.5s debounce.
 * Per debounced batch: incremental `runIndexer` (hash-incremental —
 * unchanged files skip by design) → `runLedger` → full search.db rebuild
 * (the same sub-second, idempotent pass the startup rebuild uses —
 * preferred over per-page diffing as the simple correct option).
 *
 * Watch creation failures (recursive watch is unsupported on some
 * platforms/filesystems, e.g. Linux) and runtime errors (EMFILE, torn-
 * down fs) degrade to "no watcher, startup-rebuild semantics" with ONE
 * log line — never a crash. `stop()` releases the OS handle and awaits
 * the in-flight sync so a following search.db close + temp-dir removal
 * is EBUSY-safe on Windows.
 */
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle {
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  async function syncBatch(): Promise<void> {
    try {
      await runIndexer(repoRoot, { quiet: true });
      await runLedger(repoRoot, { quiet: true });
      await reindexAllPages(searchIdx, repoRoot);
    } catch (err) {
      // A failed sync never kills the server; the next event retries.
      // eslint-disable-next-line no-console
      console.error(
        `[livewiki] watcher sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function schedule(): void {
    if (stopped) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      // Serialize syncs: overlapping indexer/ledger runs on the same DB
      // are pointless — re-arm and let the in-flight one settle.
      if (inFlight) {
        schedule();
        return;
      }
      inFlight = syncBatch().finally(() => {
        inFlight = null;
      });
    }, WATCH_DEBOUNCE_MS);
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (inFlight) await inFlight;
  }

  try {
    watcher = watch(repoRoot, { recursive: true }, (_eventType, filename) => {
      // filename may be null on some platforms — treat as "sync anyway".
      if (filename !== null && isWatchDenied(filename)) return;
      schedule();
    });
    watcher.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error(
        `[livewiki] fs.watch failed (${err.message}); ` +
          "continuing without watcher (startup-rebuild semantics)",
      );
      void stop();
    });
  } catch (err) {
    watcher = null;
    // eslint-disable-next-line no-console
    console.error(
      `[livewiki] fs.watch unavailable (${err instanceof Error ? err.message : String(err)}); ` +
        "continuing without watcher (startup-rebuild semantics)",
    );
  }

  return { stop };
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
  // Helper: textResult + trailing `_hints` block (Etapa 2d) for tools whose
  // success response is plain text (quickstart/read/write_doc). The first
  // block stays byte-identical; hints are purely additive.
  function hintedTextResult(tool: string, text: string) {
    const result = textResult(text);
    result.content.push({
      type: "text" as const,
      text: JSON.stringify({ _hints: TOOL_HINTS[tool] ?? [] }),
    });
    return result;
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
        return hintedTextResult("livewiki_quickstart", text);
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
        return hintedTextResult("livewiki_read", text);
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
        return textResult(
          JSON.stringify({ query, hits, _hints: TOOL_HINTS.livewiki_search }, null, 2),
        );
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
        return textResult(
          JSON.stringify({ ...report, _hints: TOOL_HINTS.livewiki_debt }, null, 2),
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : `status failed`);
      }
    },
  );

  // ─── livewiki_impact ───────────────────────────────────────────────────
  // "What breaks if I change this symbol?" — walks the resolved call graph
  // backward (direct + transitive callers, bounded) and cross-references
  // anchors/doc_pages to report which wiki pages document affected code.
  // Backlog #2: an EMPTY symbolKey ("") returns the repo-wide change-impact
  // package instead (working-tree changed symbols, affected pages, direct
  // importers, bounded snippets — the same block `livewiki update` emits).
  server.tool(
    "livewiki_impact",
    "Blast radius for a symbol key (e.g. 'src/auth.ts#login'): direct and transitive callers found in the indexed call graph, plus which wiki pages document any of them. Only RESOLVED call edges are walked (an edge the indexer couldn't confidently attribute to one symbol is skipped, never guessed) — treat this as a best-effort signal, not exhaustive static analysis. Bounded by maxDepth/maxNodes; `truncated: true` means the walk stopped at a bound, not that it found no more callers. Pass an EMPTY symbolKey (\"\") for the repo-wide change-impact package instead: working-tree changed symbols, affected wiki pages, direct importers of the changed files, and bounded source snippets (read-only; degrades to `notGitRepo: true` outside a git repository).",
    {
      symbolKey: z
        .string()
        .describe("Symbol key, e.g. 'src/auth.ts#login' or 'src/auth.ts#Session.refresh'. Pass an empty string (\"\") for the repo-wide change-impact package."),
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
        // Backlog #2: empty symbolKey → repo-wide change-impact package.
        if (symbolKey === "") {
          const impact = await computeChangeImpact(repoRoot);
          return textResult(
            JSON.stringify({ ...impact, _hints: TOOL_HINTS.livewiki_impact }, null, 2),
          );
        }
        const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
        const db = openIndex(dbPath);
        try {
          const result = computeBlastRadius(db, symbolKey, {
            ...(maxDepth !== undefined ? { maxDepth } : {}),
            ...(maxNodes !== undefined ? { maxNodes } : {}),
          });
          return textResult(
            JSON.stringify({ ...result, _hints: TOOL_HINTS.livewiki_impact }, null, 2),
          );
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

      // 4) Roadmap item 14: record the write in the activity ledger.
      //    Awaited so the ledger is consistent when the tool returns (and
      //    temp-dir cleanup never races the write); recordUpdateMetric
      //    swallows its own errors, so this never fails the tool.
      await recordUpdateMetric(repoRoot, {
        kind: "write_received",
        timestamp: Date.now(),
        wikiPath: path,
        bytes: Buffer.byteLength(content, "utf8"),
        tokensEstimated: Math.ceil(content.length / CHARS_PER_TOKEN),
      });

      return hintedTextResult("livewiki_write_doc", `wrote ${path} (verified)`);
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
          // Roadmap item 14: record the resolution in the activity ledger
          // (only when at least one row was resolved; best-effort, the
          // recorder swallows its own errors).
          if (resolved.length > 0) {
            await recordUpdateMetric(repoRoot, {
              kind: "debt_resolved",
              timestamp: ts,
              count: resolved.length,
              source: "mcp",
            });
          }
          return textResult(
            JSON.stringify(
              {
                resolved,
                notFound,
                ...(writeRef !== undefined ? { writeRef } : {}),
                timestamp: ts,
                _hints: TOOL_HINTS.livewiki_resolve_debt,
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

  // Watcher (backlog #3): keeps the index/ledger/search in sync with the
  // working tree while the server is alive. Degrades to no-op when
  // recursive fs.watch is unavailable.
  const watcherHandle = startWatcher(repoRoot, searchIdx);

  // Cleanup on close
  const origClose = server.close.bind(server);
  server.close = async () => {
    // Stop the watcher FIRST and await any in-flight sync — otherwise the
    // in-flight indexer/ledger could hold index.db handles (and the FTS5
    // reindex could touch a closed search.db) past close(), which is the
    // EBUSY lesson on Windows when tests rm -rf the temp dir right after.
    await watcherHandle.stop();
    closeSearch(searchIdx);
    return origClose();
  };

  // Type augmentation: McpServer.close is already async-typed, we just augment to also close search.
  // (Cast through unknown to avoid TS error on direct override.)
  return server;
}

// Re-export for tests
export type { SearchIndex };
