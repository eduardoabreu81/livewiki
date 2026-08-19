/**
 * server — the livewiki MCP server (Phase 4).
 *
 * SPEC §"MCP tools" defines 6 tools:
 *   - livewiki_quickstart  — returns livewiki/quickstart.md (entry point)
 *   - livewiki_read        — reads a wiki page by path
 *   - livewiki_search      — full-text search via SQLite FTS5
 *   - livewiki_debt        — open debt (equivalent to status --json)
 *   - livewiki_write_doc   — writes/updates a page (allowlist + verify)
 *   - livewiki_resolve_debt— marks debt as paid
 *
 * Phase 3 adds a 7th tool:
 *   - livewiki_impact      — blast radius of a symbol (callers + affected pages)
 *
 * Agent bootstrap adds an 8th tool:
 *   - livewiki_next_task   — hands out the next validated task from the MCP queue
 *
 * Architectural principle: writes go through core/safe-io (SPEC rule #1).
 * write_doc validates the path against the allowlist (livewiki/, .livewiki/) AND runs
 * `verify` on the content before accepting. A path outside livewiki/ is an error;
 * content with broken_anchor is rejected with detail.
 *
 * Server transport: stdio (SPEC §"Phase 4 — stdio, tests with the MCP inspector").
 * Other transports (HTTP/SSE) can be added later without changing the tools.
 *
 * Errors are reported via McpError with the standard MCP codes:
 *   - InvalidParams: invalid user input
 *   - InvalidRequest: inconsistent state (e.g. wiki not initialized)
 *   - InternalError: unexpected error
 *
 * Workflow-adjacency hints (Step 2d): every SUCCESS tool response also
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
  livewiki_next_task: [
    { tool: "livewiki_write_doc", when: "to submit the task result with the returned taskId AND claimId" },
    { tool: "livewiki_renew_task_claim", when: "to extend the lease when the work outlives leaseExpiresAt" },
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
import { openIndexReadOnly } from "@livewiki/core/db";
import { computeBlastRadius } from "@livewiki/core/blast-radius";
import { computeChangeImpact } from "@livewiki/core/change-impact";
import { recordUpdateMetric } from "@livewiki/core/update-metrics";
import { CHARS_PER_TOKEN } from "@livewiki/core/update";
import { run as runIndexer } from "@livewiki/core/indexer";
import { run as runLedger } from "@livewiki/core/anchor-ledger";
import { acceptBaseline } from "@livewiki/core/baseline-operations";
import {
  nextAgentBootstrapTask,
  renewAgentBootstrapClaim,
  submitAgentBootstrapTask,
} from "@livewiki/core/agent-bootstrap";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { watch, realpathSync, type FSWatcher } from "node:fs";
import {
  openAndIndex,
  indexPage,
  removePage,
  reindexAllPages,
  search as doSearch,
  close as closeSearch,
  type SearchIndex,
} from "./search.js";
import { createSyncQueue, type SyncQueueOptions } from "./watch-queue.js";

export interface CreateServerOptions {
  /** Repo root the server serves. Default: process.cwd() */
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

interface WatcherHandle {
  /** Stops the watcher, clears the pending debounce/retry, awaits any in-flight sync. */
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
 *
 * A sync that FAILS keeps its work pending and reschedules itself — see
 * `createSyncQueue`, which owns that state machine. This file is only the
 * fs.watch plumbing: it turns OS events into `notify()` and hands the queue
 * the actual sync to run.
 *
 * `opts` exists for tests, which substitute the sync and drive time by hand
 * instead of waiting on real timers.
 */
export function startWatcher(
  repoRoot: string,
  searchIdx: SearchIndex,
  opts: { sync?: () => Promise<void>; queue?: Partial<SyncQueueOptions> } = {},
): WatcherHandle {
  let watcher: FSWatcher | null = null;

  const sync =
    opts.sync ??
    (async (): Promise<void> => {
      await runIndexer(repoRoot, { quiet: true });
      await runLedger(repoRoot, { quiet: true });
      await reindexAllPages(searchIdx, repoRoot);
    });

  const queue = createSyncQueue({ run: sync, ...opts.queue });

  async function stop(): Promise<void> {
    // Stop the queue FIRST: it disarms any pending debounce or retry, so no
    // sync can start while the watch handle is being torn down.
    const queueStopped = queue.stop();
    if (watcher) {
      const w = watcher;
      watcher = null;
      // Await the OS-level close: watcher.close() only REQUESTS it, and on
      // Windows libuv can still deliver events (e.g. the repo dir being
      // removed right after close) to the dying handle — the fs-event.c
      // assertion that killed CI run 30761374513's mcp workers.
      await new Promise<void>((resolve) => {
        w.once("close", () => resolve());
        w.close();
      });
    }
    // Awaited last, so the OS handle is already released by the time we block
    // on whatever sync was still running.
    await queueStopped;
  }

  try {
    // Canonicalize the watched path: on Windows CI the temp root arrives
    // in 8.3 form (RUNNER~1) while the OS reports events with long names —
    // the mismatch is the prime suspect for libuv's win fs-event assert.
    // realpathSync.native resolves 8.3 aliases and fixes casing; on any
    // failure we keep the lexical path (watch errors degrade gracefully).
    let watchRoot = repoRoot;
    try {
      watchRoot = realpathSync.native(repoRoot);
    } catch {
      watchRoot = repoRoot;
    }
    watcher = watch(watchRoot, { recursive: true }, (_eventType, filename) => {
      // filename may be null on some platforms — treat as "sync anyway".
      if (filename !== null && isWatchDenied(filename)) return;
      queue.notify();
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
 * Creates and configures the McpServer with the 8 tools. Does NOT connect the transport —
 * that is the caller's job (index.ts uses StdioServerTransport).
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

  // Helper: wrap textual content in an MCP tool result.
  function textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
  }
  // Helper: textResult + trailing `_hints` block (Step 2d) for tools whose
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
  // Returns livewiki/quickstart.md (low-token entry point for LLMs).
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
  // Reads a wiki page by relative path (e.g. "livewiki/auth.md").
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
        // The message does NOT leak the absolute path or repo content (safe-io principle).
        return errorResult(
          err instanceof Error ? err.message : `failed to read ${path}`,
        );
      }
    },
  );

  // ─── livewiki_search ───────────────────────────────────────────────────
  // Full-text search via FTS5. Reindexes on server open; incremental via write_doc.
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
  // Open debt = status --json (Phase 2).
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
        const db = openIndexReadOnly(dbPath);
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

  // ─── livewiki_next_task ────────────────────────────────────────────────
  // Starts or resumes the deterministic agent bootstrap queue. The response
  // carries source paths, never source bytes; the connected agent reads the
  // checkout with its own tools and submits Markdown through write_doc.
  server.tool(
    "livewiki_next_task",
    "Starts or resumes a full wiki bootstrap written by this MCP client. Returns the next prioritized Markdown task with its target path, complete closed symbol-key list, source file paths, and canonical format contract. No provider, model, or API credential is required.",
    {},
    async () => {
      try {
        const result = await nextAgentBootstrapTask(repoRoot);
        // Only a finished run warrants the full rebuild. "busy" means another
        // executor holds the remaining work — the run is still going.
        if (result.status === "completed" || result.status === "completed_with_failures") {
          await reindexAllPages(searchIdx, repoRoot);
        }
        return textResult(
          JSON.stringify(
            { ...result, _hints: TOOL_HINTS.livewiki_next_task },
            null,
            2,
          ),
        );
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : "failed to load the agent bootstrap queue",
        );
      }
    },
  );

  // ─── livewiki_renew_task_claim ─────────────────────────────────────────
  // Explicit lease extension for a task that is taking longer than the
  // default lease. There is no heartbeat: an executor that needs more time
  // asks for it. A lapsed lease is never renewable — the task is already
  // back in the pool by then.
  server.tool(
    "livewiki_renew_task_claim",
    "Extends the lease on a task claimed through livewiki_next_task. Pass the taskId and the claimId you were given. Returns the new leaseExpiresAt, or a stale_claim error when the lease already expired or another execution re-claimed the task.",
    {
      taskId: z
        .number()
        .int()
        .positive()
        .describe("Task ID returned by livewiki_next_task"),
      claimId: z
        .string()
        .min(1)
        .describe("The claimId returned with that task"),
    },
    async ({ taskId, claimId }) => {
      try {
        const result = await renewAgentBootstrapClaim({ repoRoot, taskId, claimId });
        if (!result.ok) {
          return errorResult(JSON.stringify(result, null, 2));
        }
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return errorResult(
          err instanceof Error ? err.message : `failed to renew the claim on task #${taskId}`,
        );
      }
    },
  );

  // ─── livewiki_write_doc ────────────────────────────────────────────────
  // CRITICAL (SPEC §"MCP tools"): validates the allowlist (livewiki/) and runs verify
  // before accepting. Path outside livewiki/ → rejected. Content with
  // broken_anchor → rejected with detail.
  server.tool(
    "livewiki_write_doc",
    "Writes or updates a wiki page. Path MUST be inside livewiki/ (allowlist). Content is validated via `verify` before being accepted — pages with broken anchors are rejected. Never include reasoning or <think> blocks in the content; verify rejects them. Pass the taskId returned by livewiki_next_task to validate against that task's full page contract and complete it atomically.",
    {
      path: z
        .string()
        .min(1)
        .describe("Relative path inside livewiki/, e.g. 'livewiki/auth.md'"),
      content: z.string().describe("Full markdown content (with frontmatter)"),
      taskId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional task ID returned by livewiki_next_task"),
      claimId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The claimId returned with the task by livewiki_next_task. Required whenever taskId is set.",
        ),
      /** When true, skips verify (not recommended; use only to write
       *  legitimate pages like quickstart that don't anchor symbols) */
      skipVerify: z
        .boolean()
        .optional()
        .describe("Skip verify step (default false). Only use for non-anchor pages."),
    },
    async ({ path, content, taskId, claimId, skipVerify }) => {
      if (taskId !== undefined) {
        if (skipVerify === true) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "skipVerify cannot be used with an agent bootstrap task",
          );
        }
        if (claimId === undefined) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "claimId is required when taskId is set; use the claimId returned by livewiki_next_task",
          );
        }
        try {
          const result = await submitAgentBootstrapTask({
            repoRoot,
            taskId,
            path,
            content,
            claimId,
            verify,
          });
          if (!result.ok) {
            return errorResult(JSON.stringify(result, null, 2));
          }
          // Queue writes can also synchronize deterministic hubs. Rebuild the
          // small local FTS index so those companion changes are visible too.
          await reindexAllPages(searchIdx, repoRoot);
          return hintedTextResult(
            "livewiki_write_doc",
            `wrote ${result.writtenPaths.join(", ")} and completed task #${taskId} (verified)`,
          );
        } catch (err) {
          return errorResult(
            err instanceof Error ? err.message : `failed to submit task #${taskId}`,
          );
        }
      }

      // 1) Allowlist — safe-io.validateDeclared already fails with PathOutsideAllowlistError.
      //    writeText will call resolveAndValidate (with symlink check).
      try {
        await safeIo.writeText(repoRoot, path, content);
      } catch (err) {
        // The safe-io message is already safe (leaks no content, leaks no absolute path).
        if (err instanceof safeIo.PathOutsideAllowlistError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Path ${JSON.stringify(path)} is outside the livewiki/ allowlist. ` +
              `write_doc can only write to paths inside livewiki/ (SPEC rule #1).`,
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

      // 2) Verify — runs on the repo and checks whether the freshly-written page broke something.
      //    Only runs if skipVerify !== true.
      if (!skipVerify) {
        try {
          const verifyResult = await verify(repoRoot);
          // Fails if there is an error-level issue touching this page.
          const issuesHere = verifyResult.issues.filter(
            (i) => i.severity === "error" && (i.wikiPath === path || i.wikiPath === ""),
          );
          if (issuesHere.length > 0) {
            // Rollback: remove the file we just wrote so we don't
            // leave an inconsistent state (rule #3: the database is derived, but
            // disk is the truth — don't leave junk).
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

      // 3) Update the FTS5 index incrementally (successful write).
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
  // Accepts the current code/document alignment into the portable baseline.
  // Local SQLite debt IDs are projections only and are never durable proof.
  server.tool(
    "livewiki_resolve_debt",
    "Explicitly accepts the current code/document alignment into the versioned baseline. Choose one wiki page and either specific anchored symbol keys or every anchor on that page. Local SQLite debt IDs are not accepted because they are disposable projections.",
    {
      page: z
        .string()
        .min(1)
        .describe("Wiki page whose current anchored symbols are being accepted"),
      symbols: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe("Exact anchored symbol keys to accept; mutually exclusive with all=true"),
      all: z
        .boolean()
        .optional()
        .describe("Accept every current anchor on the page; mutually exclusive with symbols"),
    },
    async ({ page, symbols, all }) => {
      try {
        if (Boolean(all) === Boolean(symbols?.length)) {
          throw new Error("choose either symbols or all=true");
        }
        const accepted = await acceptBaseline(repoRoot, {
          page,
          ...(symbols !== undefined ? { symbols } : {}),
          ...(all !== undefined ? { all } : {}),
        });
        const ledger = await runLedger(repoRoot, { quiet: true });
        if (ledger.status === "aborted") {
          // The baseline was accepted on disk but the debt tables were NOT
          // reconciled. Saying "resolved" here would be a lie the caller
          // cannot detect.
          return errorResult(
            JSON.stringify(
              {
                page: accepted.page,
                accepted: accepted.accepted,
                ledgerApplied: false,
                error: ledger.reason ?? "the ledger did not apply",
                hint: "the baseline was updated; re-run to reconcile once the wiki is stable",
              },
              null,
              2,
            ),
          );
        }
        const ts = Date.now();
        await recordUpdateMetric(repoRoot, {
          kind: "debt_resolved",
          timestamp: ts,
          count: accepted.accepted.length,
          source: "mcp",
        });
        return textResult(
          JSON.stringify(
            {
              page: accepted.page,
              accepted: accepted.accepted,
              written: accepted.written,
              timestamp: ts,
              _hints: TOOL_HINTS.livewiki_resolve_debt,
            },
            null,
            2,
          ),
        );
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
