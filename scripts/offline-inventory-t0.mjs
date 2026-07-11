/**
 * T0 offline module inventory — **real** index/plan path (no synthetic walker).
 *
 * 1. Copies the current livewiki working tree into a disposable directory
 *    (source surface clean v3 would document).
 * 2. Writes a plan-only config (structural thresholds — no LLM provider).
 * 3. Runs `runInit({ plan: true })` — same walker, parser, indexer, AST
 *    symbols, loadConfig, unique→split→partition as batch.
 * 4. Audits partition, uniqueness, caps, unsplittable; writes modules.json.
 *
 * No LLM / no paid API. No clean v3 batch.
 *
 * Usage (from repo root, after `pnpm --filter @livewiki/core build`):
 *   node scripts/offline-inventory-t0.mjs
 */
import {
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function importDist(relFromRoot) {
  return import(pathToFileURL(join(root, relFromRoot)).href);
}

const { runInit } = await importDist("packages/core/dist/init.js");
const { openIndex } = await importDist("packages/core/dist/db.js");
const { applyDefaults, CONFIG_DEFAULTS } = await importDist(
  "packages/core/dist/config.js",
);
const {
  assertExactPathPartition,
  assertUniqueModuleIds,
  normalizeSplitLimits,
} = await importDist("packages/core/dist/modules.js");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".livewiki",
  "livewiki",
  "dist",
  "coverage",
  ".codegraph",
]);

function copyWorkingTree(srcRoot, destRoot) {
  mkdirSync(destRoot, { recursive: true });

  function walk(relPosix) {
    const abs = relPosix ? join(srcRoot, ...relPosix.split("/")) : srcRoot;
    for (const name of readdirSync(abs)) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const from = join(abs, name);
      const childRel = relPosix ? `${relPosix}/${name}` : name;
      let st;
      try {
        st = statSync(from);
      } catch {
        continue;
      }
      const destPath = join(destRoot, ...childRel.split("/"));
      if (st.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        walk(childRel);
      } else if (st.isFile()) {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(from, destPath);
      }
    }
  }

  walk("");
}

function tallyExtensions(paths) {
  const t = {};
  for (const p of paths) {
    const i = p.lastIndexOf(".");
    const ext = i >= 0 ? p.slice(i) : "(none)";
    t[ext] = (t[ext] ?? 0) + 1;
  }
  return t;
}

const disposable = mkdtempSync(join(tmpdir(), "livewiki-t0-inv-"));
const outDir = join(
  root,
  "docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0",
);
mkdirSync(outDir, { recursive: true });

console.error(`[offline-inventory] disposable copy → ${disposable}`);
copyWorkingTree(root, disposable);

mkdirSync(join(disposable, ".livewiki"), { recursive: true });
const planConfig = {
  language: "en",
  maxModuleFiles: CONFIG_DEFAULTS.maxModuleFiles,
  maxModuleSymbols: CONFIG_DEFAULTS.maxModuleSymbols,
  stage4MaxOutputTokens: CONFIG_DEFAULTS.stage4MaxOutputTokens,
  maxRepairAttempts: CONFIG_DEFAULTS.maxRepairAttempts,
};
writeFileSync(
  join(disposable, ".livewiki/config.json"),
  JSON.stringify(planConfig, null, 2) + "\n",
  "utf8",
);

try {
  const result = await runInit({
    repoRoot: disposable,
    plan: true,
    quiet: true,
  });
  if (!result.plan) {
    throw new Error("runInit plan:true returned no plan");
  }
  const plan = result.plan;
  const cfg = applyDefaults(
    JSON.parse(readFileSync(join(disposable, ".livewiki/config.json"), "utf8")),
  );
  const limits = normalizeSplitLimits(cfg.maxModuleFiles, cfg.maxModuleSymbols);

  const dbPath = join(disposable, ".livewiki/index.db");
  const db = openIndex(dbPath);
  let indexFiles = [];
  const symbolCountByPath = {};
  try {
    indexFiles = db
      .prepare(
        "SELECT path, lang, size FROM files WHERE status = 'active' ORDER BY path",
      )
      .all();
    const symRows = db
      .prepare("SELECT key FROM symbols WHERE status = 'active'")
      .all();
    for (const row of symRows) {
      const p = String(row.key).split("#")[0];
      symbolCountByPath[p] = (symbolCountByPath[p] ?? 0) + 1;
    }
  } finally {
    db.close();
  }

  // Authoritative planner inventory = paths that appear on active symbols
  // (same as batch/init buildPlan — InitPlanReport does not re-export filePaths).
  // files table may include walked files with zero extractable symbols; those
  // are reported but are NOT the partition base.
  const planPaths = [
    ...new Set(Object.keys(symbolCountByPath)),
  ].sort((a, b) => a.localeCompare(b));
  const filesTablePaths = indexFiles.map((f) => f.path).sort();
  const modules = plan.modules;
  const planPathSet = new Set(planPaths);
  const filesWithZeroSymbols = filesTablePaths.filter(
    (p) => (symbolCountByPath[p] ?? 0) === 0,
  );
  const filesNotInPlan = filesTablePaths.filter((p) => !planPathSet.has(p));

  let partitionOk = true;
  let partitionError = null;
  try {
    assertExactPathPartition(modules, planPaths);
  } catch (e) {
    partitionOk = false;
    partitionError = e.message;
  }
  let uniqueOk = true;
  let uniqueError = null;
  try {
    assertUniqueModuleIds(modules);
  } catch (e) {
    uniqueOk = false;
    uniqueError = e.message;
  }

  const ids = modules.map((m) => m.id);
  const summary = {
    note:
      "T0 offline inventory via real runInit({ plan: true }) on a disposable copy of the working tree (walker + parser + AST symbols + config + planner). Not a synthetic 1-symbol-per-file walk. No LLM. Partition is audited against plan.filePaths (symbol-bearing inventory), matching batch.",
    generatedAt: new Date().toISOString(),
    method: {
      entrypoint: "runInit({ plan: true, quiet: true })",
      disposableRootNote: "removed after run; recreate with this script",
      sourceRoot: "working-tree",
      configWritten: planConfig,
      reproduce:
        "pnpm --filter @livewiki/core build && node scripts/offline-inventory-t0.mjs",
      partitionBase:
        "plan.filePaths = distinct paths from active symbols (batch contract)",
    },
    caps: {
      maxModuleFiles: cfg.maxModuleFiles,
      maxModuleSymbols: cfg.maxModuleSymbols,
      normalized: limits,
    },
    inventory: {
      totalPlanFiles: plan.totalFiles,
      totalActiveSymbols: plan.totalSymbols,
      totalFilesTableActive: filesTablePaths.length,
      filesWithZeroSymbols: filesWithZeroSymbols.length,
      filesNotInPlanInventory: filesNotInPlan.length,
      extensionsPlan: tallyExtensions(planPaths),
      extensionsFilesTable: tallyExtensions(filesTablePaths),
      includesMjsInPlan: planPaths.some((p) => p.endsWith(".mjs")),
      includesMjsInFilesTable: filesTablePaths.some((p) => p.endsWith(".mjs")),
      includesCjsInFilesTable: filesTablePaths.some((p) => p.endsWith(".cjs")),
    },
    audits: {
      exactPartitionVsPlanFilePaths: partitionOk,
      partitionError,
      uniqueModuleIds: uniqueOk,
      uniqueError,
      moduleCount: modules.length,
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      legacySrcFilePattern: modules
        .filter((m) => /^src-[a-z0-9]+-ts$/.test(m.id))
        .map((m) => m.id),
      maxFilesInModule: Math.max(0, ...modules.map((m) => m.paths.length)),
      maxSymbolsInModule: Math.max(0, ...modules.map((m) => m.symbolCount)),
      unsplittableCount: modules.filter((m) => m.unsplittable).length,
      oneFileCount: modules.filter((m) => m.paths.length === 1).length,
      sumModuleFiles: modules.reduce((a, m) => a + m.paths.length, 0),
      sumModuleSymbols: modules.reduce((a, m) => a + m.symbolCount, 0),
      sumModuleSymbolsMatchesPlanTotal:
        modules.reduce((a, m) => a + m.symbolCount, 0) === plan.totalSymbols,
    },
    planFilePaths: planPaths,
    filesTableActive: indexFiles.map((f) => ({
      path: f.path,
      lang: f.lang,
      size: f.size,
      symbolCount: symbolCountByPath[f.path] ?? 0,
      inPlanInventory: planPathSet.has(f.path),
    })),
    filesNotInPlanInventory: filesNotInPlan,
    modules: modules
      .map((m) => ({
        id: m.id,
        files: m.paths.length,
        symbolCount: m.symbolCount,
        unsplittable: !!m.unsplittable,
        paths: m.paths,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    orderedIds: plan.ordered.map((m) => m.id),
    edgeCount: plan.edges.length,
  };

  writeFileSync(
    join(outDir, "modules.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  const notes = `# T0 offline module inventory (real index/plan)

**Generated:** ${summary.generatedAt}  
**Method:** disposable copy of the **working tree** + \`runInit({ plan: true })\`  
(same walker, parser, indexer, AST symbol extraction, \`loadConfig\`, and
unique → split → exact-partition → unique planner as batch).  
**Not** a synthetic file walk with 1 symbol/file.

**Partition base:** \`plan.filePaths\` = distinct paths from **active AST symbols**
(same as batch). The \`files\` table may list walked files with zero extractable
symbols; those are recorded under \`filesNotInPlanInventory\` and are outside
the module plan contract.

## Caps (resolved)

| Key | Value |
|-----|------:|
| maxModuleFiles | ${cfg.maxModuleFiles} |
| maxModuleSymbols | ${cfg.maxModuleSymbols} |
| normalized maxFiles | ${limits.maxFiles} |
| normalized maxSymbols | ${limits.maxSymbols} |

## Audits

| Check | Result |
|-------|--------|
| Exact partition vs **plan.filePaths** | **${partitionOk}** |
| Unique module IDs | **${uniqueOk}** |
| Plan files (symbol-bearing) | ${plan.totalFiles} |
| Files table (active) | ${filesTablePaths.length} |
| Zero-symbol files (not in plan) | ${filesNotInPlan.length} |
| Active symbols (AST) | ${plan.totalSymbols} |
| Modules | ${modules.length} |
| Max files / module | ${summary.audits.maxFilesInModule} |
| Max symbols / module | ${summary.audits.maxSymbolsInModule} |
| Sum module symbols | ${summary.audits.sumModuleSymbols} (matches plan total: ${summary.audits.sumModuleSymbolsMatchesPlanTotal}) |
| Unsplittable | ${summary.audits.unsplittableCount} |
| Legacy \`src-*-ts\` explosion | ${summary.audits.legacySrcFilePattern.length} |
| .mjs in plan | ${summary.inventory.includesMjsInPlan} |
| .mjs in files table | ${summary.inventory.includesMjsInFilesTable} |
| Plan extensions | ${JSON.stringify(summary.inventory.extensionsPlan)} |

## Modules (id × files × symbols)

${summary.modules.map((m) => `- \`${m.id}\` files=${m.files} symbols=${m.symbolCount}${m.unsplittable ? " **unsplittable**" : ""}`).join("\n")}

See \`modules.json\` for \`planFilePaths\`, per-file AST counts, and modules.

**Reproduce:** \`pnpm --filter @livewiki/core build && node scripts/offline-inventory-t0.mjs\`  
**Do not** treat as OpenWiki A/B winner. No paid batch / clean v3.
`;
  writeFileSync(join(outDir, "NOTES.md"), notes, "utf8");

  console.log(
    JSON.stringify(
      {
        outDir: relative(root, outDir).replace(/\\/g, "/"),
        totalPlanFiles: summary.inventory.totalPlanFiles,
        totalActiveSymbols: summary.inventory.totalActiveSymbols,
        totalFilesTableActive: summary.inventory.totalFilesTableActive,
        filesNotInPlanInventory: summary.inventory.filesNotInPlanInventory,
        moduleCount: summary.modules.length,
        audits: summary.audits,
        extensionsPlan: summary.inventory.extensionsPlan,
        modules: summary.modules.map(
          (m) =>
            `${m.id} files=${m.files} symbols=${m.symbolCount}${m.unsplittable ? " [U]" : ""}`,
        ),
      },
      null,
      2,
    ),
  );

  if (!partitionOk || !uniqueOk) {
    process.exitCode = 1;
  }
} finally {
  try {
    rmSync(disposable, { recursive: true, force: true });
  } catch {
    console.error(`[offline-inventory] warning: could not remove ${disposable}`);
  }
}
