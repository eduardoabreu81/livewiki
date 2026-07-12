/**
 * Offline acceptance analysis for clean MiniMax runs (harness helper only).
 * Usage: node acceptance-analysis.mjs <artifactRoot> [proxyJsonBasename]
 *
 * Semantics aligned with stage-4 product validator:
 * - same key once in frontmatter and once in a single section marker = OK
 * - duplicate in frontmatter list OR same key in two section markers = real dup
 * - missing module page => fullSymbolCoverage = false
 * - plannedSymbols = index total from overview header (full plan), not first module line
 */
import fs from "node:fs";
import path from "node:path";

const art = process.argv[2];
const proxyBase =
  process.argv[3] || "token-proxy-livewiki-clean-v5.json";
if (!art) {
  console.error(
    "usage: node acceptance-analysis.mjs <artifactRoot> [proxyJsonBasename]",
  );
  process.exit(2);
}
const metrics = path.join(art, "metrics");
const wiki = path.join(art, "livewiki");

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function walk(d, a = []) {
  if (!fs.existsSync(d)) return a;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, a);
    else if (e.name.endsWith(".md")) a.push(p);
  }
  return a;
}

/**
 * Validator-aligned declaration scan for one page.
 * Returns declared set union keys + real duplicate errors.
 */
function scanPage(filePath) {
  const t = fs.readFileSync(filePath, "utf8");
  const fmKeys = [];
  const sectionKeys = []; // flat list in marker order with marker boundaries
  const realDups = [];

  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    const am = m[1].match(/^anchors:\s*\n((?:[ \t]+-\s+.+\n?)*)/m);
    if (am) {
      for (const line of am[1].split(/\n/)) {
        const k = line.match(/^\s*-\s+(\S+)/);
        if (k) fmKeys.push(k[1]);
      }
    }
  }

  const fmSeen = new Set();
  for (const k of fmKeys) {
    if (fmSeen.has(k)) {
      realDups.push({
        file: path.basename(filePath),
        k,
        kind: "frontmatter_duplicate",
      });
    } else {
      fmSeen.add(k);
    }
  }

  const sectionKeysSeen = new Set();
  for (const cm of t.matchAll(/<!--\s*lw:anchors\s+([^>]*?)\s*-->/g)) {
    const keys = cm[1].trim().split(/\s+/).filter(Boolean);
    const inMarker = new Set();
    for (const k of keys) {
      // A repeat within the SAME marker is only a same_marker_duplicate —
      // it must not also be reported as cross_section_duplicate just
      // because the first occurrence already registered the key in
      // sectionKeysSeen (fixes false-positive double reporting).
      if (inMarker.has(k)) {
        realDups.push({
          file: path.basename(filePath),
          k,
          kind: "same_marker_duplicate",
        });
      } else {
        inMarker.add(k);
        if (sectionKeysSeen.has(k)) {
          realDups.push({
            file: path.basename(filePath),
            k,
            kind: "cross_section_duplicate",
          });
        } else {
          sectionKeysSeen.add(k);
        }
      }
      sectionKeys.push(k);
    }
  }

  const declared = new Set([...fmSeen, ...sectionKeysSeen]);
  return { declared, realDups };
}

/**
 * Prefer full-repo total from overview header:
 *   "indexed and **366** symbols extracted"
 * Fallback: sum of per-module "**N** symbols" under planned module headings.
 */
function plannedSymbolsFromOverview(overviewText, plannedIds) {
  const header = overviewText.match(
    /indexed and \*\*(\d+)\*\* symbols/i,
  );
  if (header) return Number(header[1]);

  // Alternate header: "**366** symbols extracted"
  const extracted = overviewText.match(
    /\*\*(\d+)\*\* symbols extracted/i,
  );
  if (extracted) return Number(extracted[1]);

  // Sum per planned module sections when header missing.
  let sum = 0;
  let found = 0;
  for (const id of plannedIds) {
    const re = new RegExp(
      `<a id="${id}"></a>[\\s\\S]*?\\*\\*(\\d+)\\*\\* symbols`,
      "i",
    );
    const mm = overviewText.match(re);
    if (mm) {
      sum += Number(mm[1]);
      found++;
    }
  }
  return found > 0 ? sum : null;
}

const status = readJson(path.join(metrics, "batch-status.json"));
const verify = readJson(path.join(metrics, "verify.json"));
const proxy = readJson(path.join(metrics, proxyBase)) || {};
const planned = (status?.run?.summary?.modulesRefined || []).map(
  (m) => m.id,
);
const pages = fs.existsSync(wiki)
  ? fs
      .readdirSync(wiki)
      .filter(
        (f) =>
          f.endsWith(".md") &&
          f !== "quickstart.md" &&
          !f.startsWith("."),
      )
  : [];
const pageIds = pages.map((p) => p.replace(/\.md$/, ""));
const missing = planned.filter((id) => !pageIds.includes(id));
const explosion = pageIds.filter((id) => /src-.*-ts/.test(id));
const dups = pageIds.filter((id, i) => pageIds.indexOf(id) !== i);

const declared = new Set();
const realDups = [];
for (const f of walk(wiki)) {
  if (f.includes(`${path.sep}architecture${path.sep}`)) continue;
  if (path.basename(f) === "quickstart.md") continue;
  const scan = scanPage(f);
  for (const k of scan.declared) declared.add(k);
  realDups.push(...scan.realDups);
}

const runStatus = status?.run?.status;
const tasksFailed =
  status?.run?.summary?.tasksFailed ?? status?.failures?.length ?? null;
const tasksDone = status?.run?.summary?.tasksDone;
const s2 = status?.byStage?.["2"] || status?.run?.summary?.byStage?.["2"];
const s4 = status?.byStage?.["4"] || status?.run?.summary?.byStage?.["4"];

let plannedSymbols = null;
const overview = path.join(wiki, "architecture", "overview.md");
if (fs.existsSync(overview)) {
  plannedSymbols = plannedSymbolsFromOverview(
    fs.readFileSync(overview, "utf8"),
    planned,
  );
}

const covered = declared.size;
const hasMissingPages = missing.length > 0;

// Missing page always means incomplete symbol coverage for the plan.
// Coverage must be EXACT (declaredAnchorCount === plannedSymbols), not
// merely >=: an excess of declared anchors over the plan is itself a
// signal of drift (e.g. stale/duplicated keys) and must not pass silently.
let fullSymbolCoverage = null;
if (hasMissingPages) {
  fullSymbolCoverage = false;
} else if (plannedSymbols != null) {
  fullSymbolCoverage = covered === plannedSymbols;
}

const gates = {
  statusCompleted: runStatus === "completed",
  zeroFailed: tasksFailed === 0,
  allModulePages: planned.length > 0 && missing.length === 0,
  noExplosion: explosion.length === 0,
  noDupPageIds: dups.length === 0,
  verifyZero:
    verify?.ok === true &&
    Array.isArray(verify?.issues) &&
    verify.issues.length === 0,
  /** Real dups only (validator semantics) — FM+section same key is allowed. */
  noRealDuplicateAnchors: realDups.length === 0,
  fullSymbolCoverage,
};

const hard = [
  gates.statusCompleted,
  gates.zeroFailed,
  gates.allModulePages,
  gates.noExplosion,
  gates.noDupPageIds,
  gates.verifyZero,
  gates.noRealDuplicateAnchors,
];
if (gates.fullSymbolCoverage !== null) hard.push(gates.fullSymbolCoverage);
const overall = hard.every(Boolean);

const out = {
  runStatus,
  tasksDone,
  tasksFailed,
  stage2: s2,
  stage4: s4,
  plannedModules: planned,
  pageIds,
  missingPages: missing,
  explosionIds: explosion,
  duplicatePageIds: dups,
  declaredAnchorCount: covered,
  plannedSymbols,
  realDuplicateAnchors: realDups,
  verify,
  proxy: {
    calls: proxy.calls,
    prompt: proxy.promptTokens,
    completion: proxy.completionTokens,
    reasoning: proxy.reasoningTokens,
    errors: proxy.callsWithError,
  },
  gates,
  overallGate: overall ? "PASS" : "FAIL",
  failures: (status?.failures || []).map((f) => ({
    module: f.module,
    code: f.error?.code,
    msg: (f.error?.message || "").slice(0, 240),
  })),
};

fs.writeFileSync(
  path.join(metrics, "acceptance-analysis.json"),
  JSON.stringify(out, null, 2),
);
console.log(
  JSON.stringify(
    {
      overallGate: out.overallGate,
      runStatus,
      tasksFailed,
      missing: missing.length,
      proxyCalls: proxy.calls,
      declared: covered,
      plannedSymbols,
      realDups: realDups.length,
      gates,
    },
    null,
    2,
  ),
);
