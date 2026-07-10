// Local pass-through proxy to MiniMax OpenAI-compatible API.
// Measures token usage at the wire — same instrument for both tools.
// Never needs the API key: it forwards the Authorization header untouched.
//
// Usage: node token-proxy.mjs [label]
//   point a tool's base URL at http://127.0.0.1:8900/v1
// Writes a running tally to token-proxy-<label>.json and logs each call.
import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";

const PORT = 8900;
const UPSTREAM = "https://api.minimax.io"; // /v1/... path forwarded as-is
const LABEL = process.argv[2] ?? "run";
const OUT = `C:/Users/Eduardo/AppData/Local/Temp/claude/token-proxy-${LABEL}.json`;

let calls = 0, promptTok = 0, completionTok = 0, totalTok = 0, noUsage = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify(
  { label: LABEL, calls, promptTokens: promptTok, completionTokens: completionTok, totalTokens: totalTok, callsWithoutUsage: noUsage, updatedAt: new Date().toISOString() }, null, 2));
save();

function extractUsageFromBody(buf, isStream) {
  // Non-stream: single JSON with .usage. Stream: last SSE data line with usage.
  const text = buf.toString("utf8");
  try {
    if (!isStream) {
      const j = JSON.parse(text);
      return j.usage ?? null;
    }
    // SSE: find the last "data: {...}" line that carries usage
    let usage = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^data:\s*(\{.*\})\s*$/);
      if (!m) continue;
      try { const j = JSON.parse(m[1]); if (j.usage) usage = j.usage; } catch {}
    }
    return usage;
  } catch { return null; }
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let bodyBuf = Buffer.concat(chunks);
    let isStream = false;
    // Force usage reporting on streamed chat completions.
    if (req.method === "POST" && /\/chat\/completions/.test(req.url) && bodyBuf.length) {
      try {
        const j = JSON.parse(bodyBuf.toString("utf8"));
        if (j.stream === true) {
          isStream = true;
          j.stream_options = { ...(j.stream_options || {}), include_usage: true };
          bodyBuf = Buffer.from(JSON.stringify(j));
        }
      } catch {}
    }
    const u = new URL(req.url, UPSTREAM);
    const headers = { ...req.headers, host: u.host };
    delete headers["content-length"];
    // Force uncompressed upstream response so we can read `usage` from the body.
    // (The client still gets whatever upstream sends; we just don't ask for gzip.)
    delete headers["accept-encoding"];
    const upReq = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: req.method, headers },
      (upRes) => {
        const respChunks = [];
        upRes.on("data", (c) => { respChunks.push(c); });
        upRes.on("end", () => {
          const respBuf = Buffer.concat(respChunks);
          if (req.method === "POST" && /\/chat\/completions/.test(req.url)) {
            calls++;
            const usage = extractUsageFromBody(respBuf, isStream);
            if (usage) {
              promptTok += usage.prompt_tokens ?? 0;
              completionTok += usage.completion_tokens ?? 0;
              totalTok += usage.total_tokens ?? ((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0));
              console.log(`[${LABEL}] call ${calls}: in=${usage.prompt_tokens} out=${usage.completion_tokens} | cum total=${totalTok}`);
            } else {
              noUsage++;
              console.log(`[${LABEL}] call ${calls}: NO USAGE in response (stream=${isStream})`);
            }
            save();
          }
          res.writeHead(upRes.statusCode ?? 200, upRes.headers);
          res.end(respBuf);
        });
      });
    upReq.on("error", (e) => { res.writeHead(502); res.end(JSON.stringify({ error: String(e) })); });
    upReq.end(bodyBuf);
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`token-proxy [${LABEL}] → ${UPSTREAM}, listening on http://127.0.0.1:${PORT}/v1 (tally: ${OUT})`));
