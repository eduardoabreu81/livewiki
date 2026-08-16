/** Explicit lifecycle operations for the repository-portable baseline. */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { spawn } from "node:child_process";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { normalizeEol } from "./hashes.js";
import { run as runIndexer } from "./indexer.js";
import { parseSource } from "./parser.js";
import { extractSymbols, type SymbolRecord } from "./symbols.js";
import {
  BASELINE_SCHEMA_VERSION,
  baselineEntryIdentity,
  collectBaselineDocumentationInventory,
  compareBaselineEntries,
  extractionVersionForSymbolKey,
  readBaseline,
  sourcePathForSymbolKey,
  validateSymbolKey,
  validateWikiPath,
  writeBaselineCompareAndSwap,
  type BaselineEntry,
  type DocumentationBaseline,
} from "./baseline.js";

const MAX_CONCURRENT_WRITE_ATTEMPTS = 32;

export interface GitReader {
  lastCommitForPath(wikiPath: string): Promise<string | null>;
  readFileAt(commit: string, sourcePath: string): Promise<string | null>;
}

export type BootstrapGapReason =
  | "no_page_history"
  | "source_missing"
  | "unsupported_extraction"
  | "symbol_missing"
  | "parse_failed";

export interface BootstrapGap {
  wikiPath: string;
  symbolKey: string;
  reason: BootstrapGapReason;
}

export interface BootstrapBaselineResult {
  written: boolean;
  entries: number;
  inferred: number;
  unbaselined: BootstrapGap[];
  pageCommits: Array<{ wikiPath: string; commit: string | null }>;
}

export interface AcceptBaselineOptions {
  page: string;
  symbols?: readonly string[];
  all?: boolean;
}

export interface AcceptBaselineResult {
  written: boolean;
  page: string;
  accepted: string[];
}

export interface MigrateBaselineKeyOptions {
  page: string;
  from: string;
  to: string;
}

export interface MigrateBaselineKeyResult {
  written: boolean;
  page: string;
  from: string;
  to: string;
  hash: string;
}

export interface RemoveBaselineEntryOptions {
  page: string;
  symbol: string;
}

export interface RelocateBaselineEntryOptions {
  fromPage: string;
  toPage: string;
  symbol: string;
}

export interface AdvanceContractBaselineResult {
  written: boolean;
  page: string;
  accepted: string[];
}

/** True only when a page's complete current anchor set is accepted and hash-current. */
export async function hasCurrentContractBaseline(
  repoRoot: string,
  page: string,
  symbolKeys: readonly string[],
): Promise<boolean> {
  assertWikiPath(page);
  const allowed = new Set(symbolKeys);
  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  const pageKeys = [...new Set(
    inventory.obligations
      .filter((item) => item.wikiPath === page)
      .map((item) => item.symbolKey),
  )].sort(compareText);
  if (pageKeys.length === 0 || pageKeys.some((key) => !allowed.has(key))) return false;

  const loaded = await readBaseline(repoRoot);
  if (loaded.state !== "available") return false;
  const pageEntries = loaded.baseline.entries.filter((entry) => entry.wikiPath === page);
  if (pageEntries.length !== pageKeys.length) return false;
  const byKey = new Map(pageEntries.map((entry) => [entry.symbolKey, entry]));
  const current = await loadFreshSymbols(repoRoot, pageKeys).catch(() => null);
  if (current === null || current.size !== pageKeys.length) return false;
  return pageKeys.every((key) => {
    const entry = byKey.get(key);
    const symbol = current.get(key);
    return entry?.provenance === "accepted" &&
      entry.extraction === extractionVersionForSymbolKey(key) &&
      entry.hash === symbol?.content_hash;
  });
}

/** Build inferred evidence exactly once from the page's last Git commit. */
export async function bootstrapBaseline(
  repoRoot: string,
  options: { git?: GitReader } = {},
): Promise<BootstrapBaselineResult> {
  const loaded = await readBaseline(repoRoot);
  if (loaded.state !== "unavailable") {
    throw new Error("documentation baseline already exists; bootstrap never regenerates it");
  }

  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  const git = options.git ?? createGitReader(repoRoot);
  const obligationsByPage = groupByPage(inventory.obligations);
  const entries: BaselineEntry[] = [];
  const unbaselined: BootstrapGap[] = [];
  const pageCommits: BootstrapBaselineResult["pageCommits"] = [];

  for (const [wikiPath, obligations] of obligationsByPage) {
    const commit = await git.lastCommitForPath(wikiPath);
    pageCommits.push({ wikiPath, commit });
    if (commit === null) {
      for (const obligation of obligations) {
        unbaselined.push({ ...obligationIdentity(obligation), reason: "no_page_history" });
      }
      continue;
    }

    const symbolsBySource = new Map<string, Map<string, SymbolRecord> | BootstrapGapReason>();
    for (const obligation of obligations) {
      const extraction = extractionVersionForSymbolKey(obligation.symbolKey);
      const sourcePath = sourcePathForSymbolKey(obligation.symbolKey);
      if (extraction === null || sourcePath === null) {
        unbaselined.push({ ...obligationIdentity(obligation), reason: "unsupported_extraction" });
        continue;
      }
      if (!symbolsBySource.has(sourcePath)) {
        const historical = await extractHistoricalSymbols(git, commit, sourcePath);
        symbolsBySource.set(sourcePath, historical);
      }
      const sourceSymbols = symbolsBySource.get(sourcePath)!;
      if (typeof sourceSymbols === "string") {
        unbaselined.push({ ...obligationIdentity(obligation), reason: sourceSymbols });
        continue;
      }
      const symbol = sourceSymbols.get(obligation.symbolKey);
      if (!symbol) {
        unbaselined.push({ ...obligationIdentity(obligation), reason: "symbol_missing" });
        continue;
      }
      entries.push({
        wikiPath,
        symbolKey: obligation.symbolKey,
        hash: symbol.content_hash,
        extraction,
        provenance: "inferred",
      });
    }
  }

  const baseline: DocumentationBaseline = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    entries: entries.sort(compareBaselineEntries),
  };
  const written = await writeBaselineCompareAndSwap(repoRoot, null, baseline);
  return {
    written,
    entries: entries.length,
    inferred: entries.length,
    unbaselined,
    pageCommits,
  };
}

/** Explicitly accept the current code version for selected page anchors. */
export async function acceptBaseline(
  repoRoot: string,
  options: AcceptBaselineOptions,
): Promise<AcceptBaselineResult> {
  assertWikiPath(options.page);
  if (Boolean(options.all) === Boolean(options.symbols?.length)) {
    throw new Error("choose either explicit symbols or --all");
  }
  await runIndexer(repoRoot, { quiet: true });
  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  const pageKeys = new Set(
    inventory.obligations
      .filter((item) => item.wikiPath === options.page)
      .map((item) => item.symbolKey),
  );
  const selected = options.all
    ? [...pageKeys]
    : [...new Set(options.symbols ?? [])];
  if (selected.length === 0) throw new Error(`page has no anchored symbols: ${options.page}`);
  for (const key of selected) {
    assertSymbolKey(key);
    if (!pageKeys.has(key)) throw new Error(`page does not anchor symbol: ${key}`);
  }

  const current = await loadActiveSymbols(repoRoot, selected);
  await assertSymbolsStillCurrent(repoRoot, current);
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const nextEntries = new Map(
      baseline.entries.map((entry) => [baselineEntryIdentity(entry), entry]),
    );
    for (const key of selected) {
      const symbol = current.get(key);
      if (!symbol) throw new Error(`active symbol not found: ${key}`);
      const extraction = extractionVersionForSymbolKey(key);
      if (extraction === null) throw new Error(`unsupported extraction for symbol: ${key}`);
      const entry: BaselineEntry = {
        wikiPath: options.page,
        symbolKey: key,
        hash: symbol.content_hash,
        extraction,
        provenance: "accepted",
      };
      nextEntries.set(baselineEntryIdentity(entry), entry);
    }
    const next = { ...baseline, entries: [...nextEntries.values()].sort(compareBaselineEntries) };
    try {
      const written = await writeBaselineCompareAndSwap(repoRoot, baseline, next);
      return { written, page: options.page, accepted: selected.sort(compareText) };
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline acceptance retry limit exhausted");
}

/** Explicitly replace one durable page+symbol identity with another. */
export async function migrateBaselineKey(
  repoRoot: string,
  options: MigrateBaselineKeyOptions,
): Promise<MigrateBaselineKeyResult> {
  assertWikiPath(options.page);
  assertSymbolKey(options.from);
  assertSymbolKey(options.to);
  if (options.from === options.to) throw new Error("from and to symbol keys must differ");
  await runIndexer(repoRoot, { quiet: true });
  const oldIdentity = baselineEntryIdentity({ wikiPath: options.page, symbolKey: options.from });
  const newIdentity = baselineEntryIdentity({ wikiPath: options.page, symbolKey: options.to });

  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  const pageKeys = new Set(
    inventory.obligations
      .filter((item) => item.wikiPath === options.page)
      .map((item) => item.symbolKey),
  );
  if (pageKeys.has(options.from)) throw new Error("page still anchors the old symbol key");
  if (!pageKeys.has(options.to)) throw new Error("page does not anchor the new symbol key");

  const current = await loadActiveSymbols(repoRoot, [options.to]);
  await assertSymbolsStillCurrent(repoRoot, current);
  if (!current.get(options.to)) throw new Error(`active symbol not found: ${options.to}`);
  const extraction = extractionVersionForSymbolKey(options.to);
  if (extraction === null) throw new Error(`unsupported extraction for symbol: ${options.to}`);
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const oldEntry = baseline.entries.find(
      (entry) => baselineEntryIdentity(entry) === oldIdentity,
    );
    if (!oldEntry) throw new Error(`baseline entry not found: ${options.page} ${options.from}`);
    if (baseline.entries.some((entry) => baselineEntryIdentity(entry) === newIdentity)) {
      throw new Error(`target baseline entry already exists: ${options.page} ${options.to}`);
    }
    // The moved entry carries the old hash and provenance forward unchanged;
    // identical content stays clean, while drift after a rename honestly
    // surfaces as `changed` debt for explicit acceptance.
    const replacement: BaselineEntry = {
      ...oldEntry,
      symbolKey: options.to,
      extraction,
    };
    const next: DocumentationBaseline = {
      ...baseline,
      entries: baseline.entries
        .filter((entry) => baselineEntryIdentity(entry) !== oldIdentity)
        .concat(replacement)
        .sort(compareBaselineEntries),
    };
    try {
      const written = await writeBaselineCompareAndSwap(repoRoot, baseline, next);
      return {
        written,
        page: options.page,
        from: options.from,
        to: options.to,
        hash: oldEntry.hash,
      };
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline key migration retry limit exhausted");
}

/** Explicitly retire one obligation after its anchor has been removed. */
export async function removeBaselineEntry(
  repoRoot: string,
  options: RemoveBaselineEntryOptions,
): Promise<{ written: boolean; page: string; symbol: string }> {
  assertWikiPath(options.page);
  assertSymbolKey(options.symbol);
  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  if (inventory.obligations.some(
    (item) => item.wikiPath === options.page && item.symbolKey === options.symbol,
  )) {
    throw new Error("page still anchors the symbol; remove the anchor before retiring evidence");
  }
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const identity = baselineEntryIdentity({
      wikiPath: options.page,
      symbolKey: options.symbol,
    });
    if (!baseline.entries.some((entry) => baselineEntryIdentity(entry) === identity)) {
      throw new Error(`baseline entry not found: ${options.page} ${options.symbol}`);
    }
    const next = {
      ...baseline,
      entries: baseline.entries.filter((entry) => baselineEntryIdentity(entry) !== identity),
    };
    try {
      return {
        written: await writeBaselineCompareAndSwap(repoRoot, baseline, next),
        page: options.page,
        symbol: options.symbol,
      };
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline removal retry limit exhausted");
}

/** Explicitly move one clean obligation between wiki pages. */
export async function relocateBaselineEntry(
  repoRoot: string,
  options: RelocateBaselineEntryOptions,
): Promise<{ written: boolean; fromPage: string; toPage: string; symbol: string }> {
  assertWikiPath(options.fromPage);
  assertWikiPath(options.toPage);
  assertSymbolKey(options.symbol);
  if (options.fromPage === options.toPage) throw new Error("source and target pages must differ");
  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  if (inventory.obligations.some(
    (item) => item.wikiPath === options.fromPage && item.symbolKey === options.symbol,
  )) {
    throw new Error("source page still anchors the symbol");
  }
  if (!inventory.obligations.some(
    (item) => item.wikiPath === options.toPage && item.symbolKey === options.symbol,
  )) {
    throw new Error("target page does not anchor the symbol");
  }
  const current = await loadFreshSymbols(repoRoot, [options.symbol]);
  const symbol = current.get(options.symbol);
  if (symbol === undefined) throw new Error(`active symbol not found: ${options.symbol}`);

  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const fromIdentity = baselineEntryIdentity({
      wikiPath: options.fromPage,
      symbolKey: options.symbol,
    });
    const toIdentity = baselineEntryIdentity({
      wikiPath: options.toPage,
      symbolKey: options.symbol,
    });
    const entry = baseline.entries.find((item) => baselineEntryIdentity(item) === fromIdentity);
    if (entry === undefined) {
      throw new Error(`baseline entry not found: ${options.fromPage} ${options.symbol}`);
    }
    if (baseline.entries.some((item) => baselineEntryIdentity(item) === toIdentity)) {
      throw new Error(`target baseline entry already exists: ${options.toPage} ${options.symbol}`);
    }
    if (entry.provenance !== "accepted" || entry.hash !== symbol.content_hash ||
        entry.extraction !== extractionVersionForSymbolKey(options.symbol)) {
      throw new Error("baseline entry is not clean; accept the current documentation before moving it");
    }
    const replacement = { ...entry, wikiPath: options.toPage };
    const next = {
      ...baseline,
      entries: baseline.entries
        .filter((item) => baselineEntryIdentity(item) !== fromIdentity)
        .concat(replacement)
        .sort(compareBaselineEntries),
    };
    try {
      return {
        written: await writeBaselineCompareAndSwap(repoRoot, baseline, next),
        fromPage: options.fromPage,
        toPage: options.toPage,
        symbol: options.symbol,
      };
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline relocation retry limit exhausted");
}

/** Trusted task boundary: advance exactly the anchors covered by its contract. */
export async function advanceContractBaseline(
  repoRoot: string,
  page: string,
  symbolKeys: readonly string[],
): Promise<AdvanceContractBaselineResult> {
  assertWikiPath(page);
  const allowed = [...new Set(symbolKeys)].sort(compareText);
  for (const key of allowed) assertSymbolKey(key);

  const inventory = await collectBaselineDocumentationInventory(repoRoot);
  const pageKeys = new Set(
    inventory.obligations
      .filter((item) => item.wikiPath === page)
      .map((item) => item.symbolKey),
  );
  const allowedSet = new Set(allowed);
  for (const key of pageKeys) {
    if (!allowedSet.has(key)) throw new Error(`contract page anchors an unauthorized symbol: ${key}`);
  }
  const selected = allowed.filter((key) => pageKeys.has(key));
  if (selected.length === 0) return { written: false, page, accepted: [] };
  const current = await loadFreshSymbols(repoRoot, selected);

  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const nextEntries = new Map(
      baseline.entries
        .filter((entry) => entry.wikiPath !== page)
        .map((entry) => [baselineEntryIdentity(entry), entry]),
    );
    for (const key of selected) {
      const symbol = current.get(key);
      if (!symbol) throw new Error(`active symbol not found: ${key}`);
      const extraction = extractionVersionForSymbolKey(key);
      if (extraction === null) throw new Error(`unsupported extraction for symbol: ${key}`);
      const entry: BaselineEntry = {
        wikiPath: page,
        symbolKey: key,
        hash: symbol.content_hash,
        extraction,
        provenance: "accepted",
      };
      nextEntries.set(baselineEntryIdentity(entry), entry);
    }
    const next = { ...baseline, entries: [...nextEntries.values()].sort(compareBaselineEntries) };
    try {
      const written = await writeBaselineCompareAndSwap(repoRoot, baseline, next);
      return { written, page, accepted: selected };
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline advancement retry limit exhausted");
}

/** Remove authority for generated pages that a deterministic plan retired. */
export async function removeBaselinePages(
  repoRoot: string,
  wikiPaths: readonly string[],
): Promise<boolean> {
  const paths = new Set(wikiPaths);
  for (const path of paths) assertWikiPath(path);
  if (paths.size === 0) return false;
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const baseline = await requireAvailableBaseline(repoRoot);
    const next = {
      ...baseline,
      entries: baseline.entries.filter((entry) => !paths.has(entry.wikiPath)),
    };
    try {
      return await writeBaselineCompareAndSwap(repoRoot, baseline, next);
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  throw new Error("baseline page removal retry limit exhausted");
}

export function createGitReader(repoRoot: string): GitReader {
  return {
    async lastCommitForPath(wikiPath) {
      const output = await runGit(repoRoot, ["log", "-1", "--format=%H", "--", wikiPath]);
      return output?.trim() || null;
    },
    async readFileAt(commit, sourcePath) {
      return runGit(repoRoot, ["show", `${commit}:${sourcePath}`]);
    },
  };
}

async function extractHistoricalSymbols(
  git: GitReader,
  commit: string,
  sourcePath: string,
): Promise<Map<string, SymbolRecord> | BootstrapGapReason> {
  const source = await git.readFileAt(commit, sourcePath);
  if (source === null) return "source_missing";
  try {
    const normalized = normalizeEol(source);
    const tree = await parseSource(nodePath.posix.extname(sourcePath), normalized);
    return new Map(extractSymbols(tree, sourcePath, normalized).map((symbol) => [symbol.key, symbol]));
  } catch {
    return "parse_failed";
  }
}

async function requireAvailableBaseline(repoRoot: string): Promise<DocumentationBaseline> {
  const loaded = await readBaseline(repoRoot);
  if (loaded.state === "unavailable") throw new Error("documentation baseline is unavailable");
  if (loaded.state === "incompatible") {
    throw new Error(`documentation baseline is incompatible: ${loaded.issues.map((x) => x.detail).join("; ")}`);
  }
  return loaded.baseline;
}

async function loadActiveSymbols(
  repoRoot: string,
  keys: readonly string[],
): Promise<Map<string, SymbolRecord>> {
  const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const get = db.prepare(
      "SELECT key, name, kind, signature, start_line, end_line, content_hash " +
        "FROM symbols WHERE status = 'active' AND key = ?",
    );
    const out = new Map<string, SymbolRecord>();
    for (const key of keys) {
      const symbol = get.get(key) as SymbolRecord | undefined;
      if (symbol) out.set(key, symbol);
    }
    return out;
  } finally {
    db.close();
  }
}

async function assertSymbolsStillCurrent(
  repoRoot: string,
  expected: ReadonlyMap<string, SymbolRecord>,
): Promise<void> {
  const bySource = new Map<string, string[]>();
  for (const key of expected.keys()) {
    const sourcePath = sourcePathForSymbolKey(key);
    if (sourcePath === null) throw new Error(`invalid symbol key: ${key}`);
    const keys = bySource.get(sourcePath) ?? [];
    keys.push(key);
    bySource.set(sourcePath, keys);
  }
  for (const [sourcePath, keys] of bySource) {
    const absolute = nodePath.resolve(repoRoot, ...sourcePath.split("/"));
    const normalized = normalizeEol(await nodeFs.readFile(absolute, "utf8"));
    const tree = await parseSource(nodePath.posix.extname(sourcePath), normalized);
    const fresh = new Map(
      extractSymbols(tree, sourcePath, normalized).map((symbol) => [symbol.key, symbol]),
    );
    for (const key of keys) {
      if (fresh.get(key)?.content_hash !== expected.get(key)?.content_hash) {
        throw new Error(`symbol changed during baseline operation: ${key}`);
      }
    }
  }
}

async function loadFreshSymbols(
  repoRoot: string,
  keys: readonly string[],
): Promise<Map<string, SymbolRecord>> {
  const expected = new Map<string, SymbolRecord>();
  const bySource = new Map<string, string[]>();
  for (const key of keys) {
    const sourcePath = sourcePathForSymbolKey(key);
    if (sourcePath === null) throw new Error(`invalid symbol key: ${key}`);
    const values = bySource.get(sourcePath) ?? [];
    values.push(key);
    bySource.set(sourcePath, values);
  }
  for (const [sourcePath, sourceKeys] of bySource) {
    const absolute = nodePath.resolve(repoRoot, ...sourcePath.split("/"));
    const normalized = normalizeEol(await nodeFs.readFile(absolute, "utf8"));
    const tree = await parseSource(nodePath.posix.extname(sourcePath), normalized);
    const symbols = new Map(
      extractSymbols(tree, sourcePath, normalized).map((symbol) => [symbol.key, symbol]),
    );
    for (const key of sourceKeys) {
      const symbol = symbols.get(key);
      if (symbol) expected.set(key, symbol);
    }
  }
  return expected;
}

function groupByPage<T extends { wikiPath: string }>(items: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const values = grouped.get(item.wikiPath) ?? [];
    values.push(item);
    grouped.set(item.wikiPath, values);
  }
  return new Map([...grouped.entries()].sort(([left], [right]) => compareText(left, right)));
}

function obligationIdentity(item: { wikiPath: string; symbolKey: string }): {
  wikiPath: string;
  symbolKey: string;
} {
  return { wikiPath: item.wikiPath, symbolKey: item.symbolKey };
}

function assertWikiPath(path: string): void {
  const error = validateWikiPath(path);
  if (error !== null) throw new Error(error);
}

function assertSymbolKey(key: string): void {
  const error = validateSymbolKey(key);
  if (error !== null) throw new Error(error);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isConcurrentWrite(error: unknown): boolean {
  return error instanceof safeIo.CompareAndSwapConflictError ||
    error instanceof safeIo.WriteLockBusyError;
}

function yieldToConcurrentWriter(attempt: number): Promise<void> {
  // Small bounded backoff so a live concurrent holder is not instantly
  // exhausted by a tight retry loop.
  return new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 100)));
}

function runGit(repoRoot: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", repoRoot, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      resolve(code === 0 && !overflow ? Buffer.concat(chunks).toString("utf8") : null);
    });
  });
}
