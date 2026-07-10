// Local pass-through proxy to an OpenAI-compatible upstream (default: MiniMax).
// Measures token usage at the wire — same instrument for livewiki and OpenWiki.
// Never needs the API key: it forwards the Authorization header untouched.
//
// Per-call log (handoff U–X follow-up):
//   - timestamps (start/end ISO + durationMs)
//   - HTTP status
//   - stream flag
//   - prompt / completion / total tokens
//   - cached prompt tokens (when the provider reports them)
//   - reasoning / completion-detail tokens (when reported)
//   - errors (upstream, parse, or transport)
//
// Usage:
//   node token-proxy.mjs [label]
//   LIVEWIKI_PROXY_PORT=8900 LIVEWIKI_PROXY_UPSTREAM=https://api.minimax.io \
//     LIVEWIKI_PROXY_OUT_DIR=./out node token-proxy.mjs livewiki-rerun
//
// Point a tool's base URL at http://127.0.0.1:<port>/v1
// Writes:
//   <outDir>/token-proxy-<label>.json      — summary + all calls
//   <outDir>/token-proxy-<label>.jsonl     — one JSON object per call (append-friendly)

import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = Number(process.env.LIVEWIKI_PROXY_PORT ?? process.env.PORT ?? 8900);
const UPSTREAM = process.env.LIVEWIKI_PROXY_UPSTREAM ?? "https://api.minimax.io";
const LABEL = process.argv[2] ?? "run";
const OUT_DIR =
  process.env.LIVEWIKI_PROXY_OUT_DIR ??
  process.env.TEMP ??
  process.env.TMP ??
  ".";
const OUT_JSON = path.join(OUT_DIR, `token-proxy-${LABEL}.json`);
const OUT_JSONL = path.join(OUT_DIR, `token-proxy-${LABEL}.jsonl`);

/** @typedef {{
 *   promptTokens: number,
 *   completionTokens: number,
 *   totalTokens: number,
 *   cachedPromptTokens: number | null,
 *   reasoningTokens: number | null,
 *   raw: Record<string, unknown> | null,
 * }} NormalizedUsage */

/** @typedef {{
 *   id: number,
 *   startedAt: string,
 *   endedAt: string,
 *   durationMs: number,
 *   method: string,
 *   path: string,
 *   model: string | null,
 *   stream: boolean,
 *   statusCode: number | null,
 *   ok: boolean,
 *   usage: NormalizedUsage | null,
 *   error: string | null,
 * }} CallRecord */

const state = {
  label: LABEL,
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedPromptTokens: 0,
  reasoningTokens: 0,
  callsWithoutUsage: 0,
  callsWithError: 0,
  /** @type {CallRecord[]} */
  callLog: [],
  updatedAt: new Date().toISOString(),
};

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function save() {
  ensureOutDir();
  state.updatedAt = new Date().toISOString();
  // Summary keeps the legacy 2026-07-10 field names (calls, promptTokens, …)
  // plus cache/reasoning/error counters and the full callLog for reruns.
  const summary = {
    label: state.label,
    calls: state.calls,
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    totalTokens: state.totalTokens,
    cachedPromptTokens: state.cachedPromptTokens,
    reasoningTokens: state.reasoningTokens,
    callsWithoutUsage: state.callsWithoutUsage,
    callsWithError: state.callsWithError,
    updatedAt: state.updatedAt,
    callLog: state.callLog,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
}

/**
 * Normalize provider-specific usage shapes into a stable record.
 * Supports OpenAI-style fields and common MiniMax/Anthropic-compat variants.
 * @param {any} usage
 * @returns {NormalizedUsage | null}
 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const promptTokens =
    num(usage.prompt_tokens) ??
    num(usage.input_tokens) ??
    num(usage.promptTokens) ??
    0;
  const completionTokens =
    num(usage.completion_tokens) ??
    num(usage.output_tokens) ??
    num(usage.completionTokens) ??
    0;
  const totalTokens =
    num(usage.total_tokens) ??
    num(usage.totalTokens) ??
    promptTokens + completionTokens;

  const cachedPromptTokens =
    num(usage.prompt_tokens_details?.cached_tokens) ??
    num(usage.input_tokens_details?.cached_tokens) ??
    num(usage.cache_read_input_tokens) ??
    num(usage.cached_tokens) ??
    num(usage.prompt_cache_hit_tokens) ??
    null;

  const reasoningTokens =
    num(usage.completion_tokens_details?.reasoning_tokens) ??
    num(usage.output_tokens_details?.reasoning_tokens) ??
    num(usage.reasoning_tokens) ??
    num(usage.thinking_tokens) ??
    null;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedPromptTokens,
    reasoningTokens,
    raw: usage,
  };
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @param {Buffer} buf
 * @param {boolean} isStream
 */
function extractUsageFromBody(buf, isStream) {
  const text = buf.toString("utf8");
  try {
    if (!isStream) {
      const j = JSON.parse(text);
      return { usage: j.usage ?? null, parseError: null, bodyError: extractBodyError(j) };
    }
    let usage = null;
    let bodyError = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(\{.*\})\s*$/);
      if (!m) continue;
      try {
        const j = JSON.parse(m[1]);
        if (j.usage) usage = j.usage;
        const err = extractBodyError(j);
        if (err) bodyError = err;
      } catch {
        /* ignore partial SSE chunks */
      }
    }
    return { usage, parseError: null, bodyError };
  } catch (e) {
    return { usage: null, parseError: String(e?.message ?? e), bodyError: null };
  }
}

function extractBodyError(j) {
  if (!j || typeof j !== "object") return null;
  if (typeof j.error === "string") return j.error;
  if (j.error && typeof j.error === "object") {
    return j.error.message ?? j.error.code ?? JSON.stringify(j.error);
  }
  if (typeof j.message === "string" && j.type === "error") return j.message;
  return null;
}

/**
 * @param {Buffer} bodyBuf
 */
function peekRequestMeta(bodyBuf) {
  if (!bodyBuf.length) return { model: null, stream: false, bodyBuf, isStream: false };
  try {
    const j = JSON.parse(bodyBuf.toString("utf8"));
    let isStream = j.stream === true;
    let next = bodyBuf;
    if (isStream) {
      // Force usage on the final SSE chunk when the provider supports it.
      j.stream_options = { ...(j.stream_options || {}), include_usage: true };
      next = Buffer.from(JSON.stringify(j));
    }
    return {
      model: typeof j.model === "string" ? j.model : null,
      stream: isStream,
      bodyBuf: next,
      isStream,
    };
  } catch {
    return { model: null, stream: false, bodyBuf, isStream: false };
  }
}

/**
 * @param {CallRecord} record
 */
function recordCall(record) {
  state.calls += 1;
  state.callLog.push(record);
  if (record.error) state.callsWithError += 1;
  if (record.usage) {
    state.promptTokens += record.usage.promptTokens;
    state.completionTokens += record.usage.completionTokens;
    state.totalTokens += record.usage.totalTokens;
    if (record.usage.cachedPromptTokens != null) {
      state.cachedPromptTokens += record.usage.cachedPromptTokens;
    }
    if (record.usage.reasoningTokens != null) {
      state.reasoningTokens += record.usage.reasoningTokens;
    }
  } else if (!record.error || record.ok) {
    // Count missing usage only when the call otherwise looked successful.
    if (record.ok) state.callsWithoutUsage += 1;
  }
  ensureOutDir();
  fs.appendFileSync(OUT_JSONL, JSON.stringify(record) + "\n");
  save();

  const u = record.usage;
  const cache =
    u?.cachedPromptTokens != null ? ` cache=${u.cachedPromptTokens}` : "";
  const reason =
    u?.reasoningTokens != null ? ` reasoning=${u.reasoningTokens}` : "";
  if (record.error) {
    console.log(
      `[${LABEL}] call ${record.id}: ERROR status=${record.statusCode} ${record.error} (${record.durationMs}ms)`,
    );
  } else if (u) {
    console.log(
      `[${LABEL}] call ${record.id}: status=${record.statusCode} in=${u.promptTokens} out=${u.completionTokens}${cache}${reason} | cum total=${state.totalTokens} (${record.durationMs}ms)`,
    );
  } else {
    console.log(
      `[${LABEL}] call ${record.id}: status=${record.statusCode} NO USAGE stream=${record.stream} (${record.durationMs}ms)`,
    );
  }
}

const server = http.createServer((req, res) => {
  const startedAt = new Date();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let bodyBuf = Buffer.concat(chunks);
    const isChat =
      req.method === "POST" && /\/chat\/completions/.test(req.url ?? "");
    let model = null;
    let isStream = false;
    if (isChat && bodyBuf.length) {
      const meta = peekRequestMeta(bodyBuf);
      bodyBuf = meta.bodyBuf;
      model = meta.model;
      isStream = meta.isStream;
    }

    let u;
    try {
      u = new URL(req.url ?? "/", UPSTREAM);
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `bad url: ${String(e)}` }));
      return;
    }

    const headers = { ...req.headers, host: u.host };
    delete headers["content-length"];
    // Force uncompressed upstream response so we can parse `usage`.
    delete headers["accept-encoding"];

    const upReq = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: req.method,
        headers,
      },
      (upRes) => {
        const respChunks = [];
        upRes.on("data", (c) => {
          respChunks.push(c);
        });
        upRes.on("end", () => {
          const endedAt = new Date();
          const respBuf = Buffer.concat(respChunks);
          const statusCode = upRes.statusCode ?? null;

          if (isChat) {
            const { usage, parseError, bodyError } = extractUsageFromBody(
              respBuf,
              isStream,
            );
            const normalized = normalizeUsage(usage);
            const transportOk = statusCode != null && statusCode < 400;
            const error =
              bodyError ??
              parseError ??
              (!transportOk
                ? `upstream HTTP ${statusCode}`
                : null);
            recordCall({
              id: state.calls + 1,
              startedAt: startedAt.toISOString(),
              endedAt: endedAt.toISOString(),
              durationMs: endedAt.getTime() - startedAt.getTime(),
              method: req.method ?? "POST",
              path: req.url ?? "",
              model,
              stream: isStream,
              statusCode,
              ok: transportOk && !error,
              usage: normalized,
              error,
            });
          }

          // Strip hop-by-hop / encoding headers that no longer match the body
          // we already fully buffered.
          const outHeaders = { ...upRes.headers };
          delete outHeaders["content-encoding"];
          delete outHeaders["transfer-encoding"];
          outHeaders["content-length"] = String(respBuf.length);
          res.writeHead(statusCode ?? 200, outHeaders);
          res.end(respBuf);
        });
      },
    );

    upReq.on("error", (e) => {
      const endedAt = new Date();
      if (isChat) {
        recordCall({
          id: state.calls + 1,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          method: req.method ?? "POST",
          path: req.url ?? "",
          model,
          stream: isStream,
          statusCode: null,
          ok: false,
          usage: null,
          error: `transport: ${String(e?.message ?? e)}`,
        });
      }
      res.writeHead(502);
      res.end(JSON.stringify({ error: String(e) }));
    });
    upReq.end(bodyBuf);
  });
});

ensureOutDir();
save();
// Truncate JSONL for a fresh label run
fs.writeFileSync(OUT_JSONL, "");

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `token-proxy [${LABEL}] → ${UPSTREAM}, listening on http://127.0.0.1:${PORT}/v1`,
  );
  console.log(`  summary: ${OUT_JSON}`);
  console.log(`  per-call: ${OUT_JSONL}`);
});
