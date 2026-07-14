/**
 * Thin wrapper for clean v5 path — delegates to shared tools helper
 * used for the next clean run. Does NOT rewrite frozen metrics/wiki.
 *
 * Usage: node _acceptance.mjs <artifactRoot>
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const art = process.argv[2];
if (!art) {
  console.error("usage: node _acceptance.mjs <artifactRoot>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(here, "..", "tools", "acceptance-analysis.mjs");
const r = spawnSync(
  process.execPath,
  [shared, art, "token-proxy-livewiki-clean-v5.json"],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
