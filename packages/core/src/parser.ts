/**
 * parser — wrapper over web-tree-sitter with a per-file Language cache.
 *
 * Loads `.wasm` from `packages/core/grammars/` (versioned in the repo). The
 * path is resolved relative to the module's package.json, so it works both in
 * dev (`src/`) and in build (`dist/`).
 *
 * Supported languages:
 *   - typescript (.ts)
 *   - tsx (.tsx, .jsx)
 *   - javascript (.js, .mjs, .cjs)
 *   - python (.py)
 *   - go (.go)
 *   - rust (.rs)
 *   - java (.java)
 *
 * `initParser()` is global, idempotent and must be called once at CLI
 * startup before the first `parseFile()`. More than one call is safe
 * (the Promise resolves immediately).
 */

import { Parser, Language, Tree } from "web-tree-sitter";
import { createRequire } from "node:module";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import { sha256 } from "./hashes.js";

let initPromise: Promise<void> | null = null;

/**
 * Initializes the tree-sitter WASM runtime. Idempotent.
 */
export async function initParser(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = Parser.init();
  return initPromise;
}

/** Locates the `grammars/` directory from this module's package.json.
 *
 * Robust strategy: try `./package.json` (dev: src/), then
 * `../package.json` (build: dist/). Throws if neither exists.
 *
 * We do not use `require.resolve("package.json")` because that looks in
 * node_modules, not in the package itself.
 */
function grammarsDir(): string {
  const req = createRequire(import.meta.url);
  for (const rel of ["./package.json", "../package.json"]) {
    try {
      const pkgPath = req.resolve(rel);
      return nodePath.join(nodePath.dirname(pkgPath), "grammars");
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "Could not locate package.json from " + import.meta.url,
  );
}

/** Language cache by name. Loading is expensive (WASM parsing). */
const languageCache = new Map<string, Language>();

async function loadLanguage(name: string): Promise<Language> {
  const cached = languageCache.get(name);
  if (cached) return cached;
  const wasmPath = nodePath.join(grammarsDir(), `tree-sitter-${name}.wasm`);
  if (!nodeFs.existsSync(wasmPath)) {
    throw new Error(
      `WASM grammar not found at ${wasmPath}. ` +
        `Grammar '${name}' not supported in this build of livewiki.`,
    );
  }
  const lang = await Language.load(wasmPath);
  languageCache.set(name, lang);
  return lang;
}

/** Extension → grammar name mapping (same .wasm file). */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
};

const GRAMMAR_TO_EXT = new Map<string, string>(
  Object.entries(EXT_TO_GRAMMAR).map(([ext, grammar]) => [grammar, ext]),
);

/** Language type given a file extension. */
export function grammarForExtension(ext: string): string | undefined {
  return EXT_TO_GRAMMAR[ext.toLowerCase()];
}

/**
 * Rich grammar-set state (P1 + follow-up, external re-review 2026-08-04).
 * The indexer stores this as JSON in `meta.grammar_state` and diffs it on
 * every run to direct re-parses:
 *   - `map` changes catch grammars being ADDED (zero-symbol files stuck in
 *     prose tier), REMOVED, or REMAPPED (an extension moving between
 *     grammars while its symbols stay stale);
 *   - `artifacts` catches grammar VERSION bumps — the ext→grammar map is
 *     untouched by a tree-sitter upgrade, so only the .wasm identity moves.
 */
export interface GrammarState {
  /** Extension (with dot) → grammar name, as configured. */
  map: Record<string, string>;
  /** Grammar name → sha256 of its vendored .wasm ("missing" when absent). */
  artifacts: Record<string, string>;
}

export function grammarState(): GrammarState {
  const dir = grammarsDir();
  const map: Record<string, string> = {};
  for (const [ext, grammar] of Object.entries(EXT_TO_GRAMMAR)) {
    map[ext] = grammar;
  }
  const artifacts: Record<string, string> = {};
  for (const grammar of new Set(Object.values(EXT_TO_GRAMMAR))) {
    const wasmPath = nodePath.join(dir, `tree-sitter-${grammar}.wasm`);
    artifacts[grammar] = nodeFs.existsSync(wasmPath)
      ? sha256(nodeFs.readFileSync(wasmPath))
      : "missing";
  }
  return { map, artifacts };
}

/** Parses source with the language appropriate for the extension. */
export async function parseSource(
  ext: string,
  source: string,
): Promise<Tree> {
  await initParser();
  const grammar = EXT_TO_GRAMMAR[ext.toLowerCase()];
  if (!grammar) {
    throw new Error(`No tree-sitter grammar for extension ${ext}`);
  }
  const lang = await loadLanguage(grammar);
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);
  if (!tree) {
    // tree-sitter returns null only in very exceptional cases (empty input?).
    // Does not happen with non-empty source; we treat it as an error so null is not propagated.
    throw new Error(`tree-sitter returned null tree for ${ext}`);
  }
  return tree;
}

/** Lists the supported languages (names of the available .wasm files). */
export function listSupportedGrammars(): string[] {
  const dir = grammarsDir();
  if (!nodeFs.existsSync(dir)) return [];
  return nodeFs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".wasm"))
    .map((f) => f.replace(/^tree-sitter-/, "").replace(/\.wasm$/, ""));
}

/** Used by tests to ensure languages are referenceable. */
export function _grammarToExtensionForTest(grammar: string): string | undefined {
  return GRAMMAR_TO_EXT.get(grammar);
}