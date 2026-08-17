/**
 * Versioned documentation baseline.
 *
 * `livewiki/.baseline.json` is repository authority for the symbol version a
 * page documents. SQLite may project it for fast queries, but this module has
 * no database dependency so a clean clone can load and validate the same
 * evidence.
 */

import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as safeIo from "./safe-io.js";
import { extractAnchors, type Owner } from "./anchors.js";

export const BASELINE_REL_PATH = "livewiki/.baseline.json";
export const BASELINE_SCHEMA_VERSION = 1;

export const SUPPORTED_EXTRACTION_VERSIONS = new Set([
  "ts-v1",
  "tsx-v1",
  "js-v1",
  "py-v1",
  "go-v1",
  "rust-v1",
  "java-v1",
]);

export type BaselineProvenance = "accepted" | "inferred";

export interface BaselineEntry {
  wikiPath: string;
  symbolKey: string;
  hash: string;
  extraction: string;
  provenance: BaselineProvenance;
}

export interface DocumentationBaseline {
  schemaVersion: number;
  entries: BaselineEntry[];
}

export type BaselineIssueCode =
  | "invalid_json"
  | "invalid_root"
  | "unsupported_schema"
  | "invalid_entries"
  | "invalid_entry"
  | "invalid_wiki_path"
  | "invalid_symbol_key"
  | "invalid_hash"
  | "unsupported_extraction"
  | "invalid_provenance"
  | "duplicate_entry"
  | "noncanonical_serialization"
  // Not a defect of the baseline FILE: a wiki page the inventory could not
  // parse, surfaced here so `status` never presents it as absent obligations.
  | "malformed_frontmatter";

export interface BaselineIssue {
  code: BaselineIssueCode;
  detail: string;
  entryIndex?: number;
}

export type BaselineLoadResult =
  | { state: "unavailable"; issues: [] }
  | { state: "incompatible"; issues: BaselineIssue[]; baseline: DocumentationBaseline | null }
  | { state: "available"; issues: []; baseline: DocumentationBaseline };

export interface BaselineSymbol {
  key: string;
  name: string;
  content_hash: string;
}

export interface BaselineObligation {
  wikiPath: string;
  symbolKey: string;
  assignee: "agent" | "human";
}

/**
 * A wiki page whose frontmatter does not parse. No obligation can be read
 * from it, so it is reported instead of silently dropped out of the
 * debt/baseline system (`verify` reports the same page as
 * `malformed_frontmatter`).
 */
export interface MalformedDocumentationPage {
  wikiPath: string;
  detail: string;
}

export interface BaselineDocumentationInventory {
  obligations: BaselineObligation[];
  ownerByWikiPath: Map<string, Owner>;
  malformedPages: MalformedDocumentationPage[];
}

export type BaselineEntryState = "clean" | "changed" | "deleted" | "inferred";

export interface EvaluatedBaselineEntry extends BaselineEntry {
  state: BaselineEntryState;
  currentHash: string | null;
  assignee: "agent" | "human";
}

export interface BaselineMoveCandidate {
  wikiPath: string;
  oldKey: string;
  newKey: string;
  hash: string;
  assignee: "agent" | "human";
}

export interface BaselineHealth {
  entries: EvaluatedBaselineEntry[];
  moves: BaselineMoveCandidate[];
  unbaselined: BaselineObligation[];
  removedAnchors: BaselineEntry[];
  /** Pages the inventory could not read; reported, never counted as clean. */
  malformedPages: MalformedDocumentationPage[];
  counts: {
    clean: number;
    changed: number;
    moved: number;
    deleted: number;
    inferred: number;
    unbaselined: number;
    removedAnchors: number;
  };
}

const ROOT_KEYS = ["schemaVersion", "entries"] as const;
const ENTRY_KEYS = ["wikiPath", "symbolKey", "hash", "extraction", "provenance"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function emptyBaseline(): DocumentationBaseline {
  return { schemaVersion: BASELINE_SCHEMA_VERSION, entries: [] };
}

/** Stable extraction identity for a symbol key's source path. */
export function extractionVersionForSymbolKey(symbolKey: string): string | null {
  const split = splitSymbolKey(symbolKey);
  if (split === null) return null;
  switch (nodePath.posix.extname(split.sourcePath).toLowerCase()) {
    case ".ts":
      return "ts-v1";
    case ".tsx":
    case ".jsx":
      return "tsx-v1";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "js-v1";
    case ".py":
      return "py-v1";
    case ".go":
      return "go-v1";
    case ".rs":
      return "rust-v1";
    case ".java":
      return "java-v1";
    default:
      return null;
  }
}

export function sourcePathForSymbolKey(symbolKey: string): string | null {
  return splitSymbolKey(symbolKey)?.sourcePath ?? null;
}

export function baselineEntryIdentity(entry: Pick<BaselineEntry, "wikiPath" | "symbolKey">): string {
  return `${entry.wikiPath}\0${entry.symbolKey}`;
}

export function compareBaselineEntries(left: BaselineEntry, right: BaselineEntry): number {
  return compareCodePoints(left.wikiPath, right.wikiPath) ||
    compareCodePoints(left.symbolKey, right.symbolKey);
}

/** Serialize exactly as the public one-entry-per-line contract requires. */
export function serializeBaseline(baseline: DocumentationBaseline): string {
  const entries = [...baseline.entries].sort(compareBaselineEntries);
  const lines = ["{", `\"schemaVersion\":${baseline.schemaVersion},`, "\"entries\":["];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const canonical: BaselineEntry = {
      wikiPath: entry.wikiPath,
      symbolKey: entry.symbolKey,
      hash: entry.hash,
      extraction: entry.extraction,
      provenance: entry.provenance,
    };
    lines.push(`${JSON.stringify(canonical)}${index + 1 < entries.length ? "," : ""}`);
  }
  lines.push("]", "}");
  return `${lines.join("\n")}\n`;
}

export function parseBaseline(raw: string): BaselineLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return incompatible([{ code: "invalid_json", detail: "baseline is not valid JSON" }], null);
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, ROOT_KEYS)) {
    return incompatible(
      [{ code: "invalid_root", detail: "baseline root must contain only schemaVersion and entries" }],
      null,
    );
  }

  const schemaVersion = parsed.schemaVersion;
  const rawEntries = parsed.entries;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return incompatible(
      [{ code: "invalid_root", detail: "schemaVersion must be an integer" }],
      null,
    );
  }
  if (!Array.isArray(rawEntries)) {
    return incompatible(
      [{ code: "invalid_entries", detail: "entries must be an array" }],
      null,
    );
  }

  const issues: BaselineIssue[] = [];
  if (schemaVersion !== BASELINE_SCHEMA_VERSION) {
    issues.push({
      code: "unsupported_schema",
      detail: `unsupported baseline schemaVersion ${schemaVersion}`,
    });
  }

  const entries: BaselineEntry[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < rawEntries.length; index++) {
    const rawEntry = rawEntries[index];
    if (!isRecord(rawEntry) || !hasExactKeys(rawEntry, ENTRY_KEYS)) {
      issues.push({
        code: "invalid_entry",
        detail: "entry must contain exactly wikiPath, symbolKey, hash, extraction, and provenance",
        entryIndex: index,
      });
      continue;
    }

    const entry = rawEntry as unknown as BaselineEntry;
    let valid = true;
    const wikiPathError = validateWikiPath(entry.wikiPath);
    if (wikiPathError !== null) {
      issues.push({ code: "invalid_wiki_path", detail: wikiPathError, entryIndex: index });
      valid = false;
    }
    const symbolKeyError = validateSymbolKey(entry.symbolKey);
    if (symbolKeyError !== null) {
      issues.push({ code: "invalid_symbol_key", detail: symbolKeyError, entryIndex: index });
      valid = false;
    }
    if (typeof entry.hash !== "string" || !SHA256_HEX.test(entry.hash)) {
      issues.push({
        code: "invalid_hash",
        detail: "hash must be 64 lowercase hexadecimal characters",
        entryIndex: index,
      });
      valid = false;
    }
    if (typeof entry.extraction !== "string" ||
        !SUPPORTED_EXTRACTION_VERSIONS.has(entry.extraction)) {
      issues.push({
        code: "unsupported_extraction",
        detail: `unsupported extraction version ${JSON.stringify(entry.extraction)}`,
        entryIndex: index,
      });
      valid = false;
    }
    if (entry.provenance !== "accepted" && entry.provenance !== "inferred") {
      issues.push({
        code: "invalid_provenance",
        detail: "provenance must be accepted or inferred",
        entryIndex: index,
      });
      valid = false;
    }
    if (!valid) continue;

    const canonical: BaselineEntry = {
      wikiPath: entry.wikiPath,
      symbolKey: entry.symbolKey,
      hash: entry.hash,
      extraction: entry.extraction,
      provenance: entry.provenance,
    };
    const identity = baselineEntryIdentity(canonical);
    if (identities.has(identity)) {
      issues.push({
        code: "duplicate_entry",
        detail: `duplicate baseline entry for ${canonical.wikiPath} and ${canonical.symbolKey}`,
        entryIndex: index,
      });
      continue;
    }
    identities.add(identity);
    entries.push(canonical);
  }

  const baseline: DocumentationBaseline = { schemaVersion, entries };
  if (issues.length === 0 && raw !== serializeBaseline(baseline)) {
    issues.push({
      code: "noncanonical_serialization",
      detail: "baseline bytes do not match canonical serialization",
    });
  }
  return issues.length > 0 ? incompatible(issues, baseline) : available(baseline);
}

export async function readBaseline(repoRoot: string): Promise<BaselineLoadResult> {
  if (!await safeIo.exists(repoRoot, BASELINE_REL_PATH).catch(() => false)) {
    return { state: "unavailable", issues: [] };
  }
  try {
    return parseBaseline(await safeIo.readText(repoRoot, BASELINE_REL_PATH));
  } catch {
    return incompatible(
      [{ code: "invalid_json", detail: "baseline could not be read" }],
      null,
    );
  }
}

export async function writeBaseline(
  repoRoot: string,
  baseline: DocumentationBaseline,
): Promise<boolean> {
  const serialized = serializeBaseline(baseline);
  const validation = parseBaseline(serialized);
  if (validation.state !== "available") {
    throw new Error(validation.issues.map((issue) => issue.detail).join("; "));
  }
  const current = await safeIo.exists(repoRoot, BASELINE_REL_PATH).catch(() => false)
    ? await safeIo.readText(repoRoot, BASELINE_REL_PATH).catch(() => null)
    : null;
  if (current === serialized) return false;
  await safeIo.writeTextAtomic(repoRoot, BASELINE_REL_PATH, serialized, {
    expected: current,
    lockRelPath: ".livewiki/baseline.lock",
  });
  return true;
}

/** Replace a baseline only if its exact canonical bytes are still current. */
export async function writeBaselineCompareAndSwap(
  repoRoot: string,
  expected: DocumentationBaseline | null,
  next: DocumentationBaseline,
): Promise<boolean> {
  const expectedRaw = expected === null ? null : serializeBaseline(expected);
  const nextRaw = serializeBaseline(next);
  const validation = parseBaseline(nextRaw);
  if (validation.state !== "available") {
    throw new Error(validation.issues.map((issue) => issue.detail).join("; "));
  }
  if (expectedRaw === nextRaw) return false;
  await safeIo.writeTextAtomic(repoRoot, BASELINE_REL_PATH, nextRaw, {
    expected: expectedRaw,
    lockRelPath: ".livewiki/baseline.lock",
  });
  return true;
}

/**
 * Rebuild the current documentation obligations from Markdown, never from
 * `doc_pages`/`anchors`. Multiple occurrences collapse to one page+symbol
 * obligation and human ownership wins monotonically.
 */
export async function collectBaselineDocumentationInventory(
  repoRoot: string,
): Promise<BaselineDocumentationInventory> {
  const ownerByWikiPath = new Map<string, Owner>();
  const obligations = new Map<string, BaselineObligation>();
  const malformedPages: MalformedDocumentationPage[] = [];
  for (const wikiPath of await collectMarkdownPaths(repoRoot)) {
    const source = await safeIo.readText(repoRoot, wikiPath).catch(() => null);
    if (source === null) continue;
    let extracted;
    try {
      extracted = extractAnchors(source);
    } catch (error) {
      // Unparseable page: its obligations are unreadable, never zero. Record
      // it so the page leaves a trace instead of vanishing from the debt
      // system (`anchor-ledger.ts` reports the same failure mode).
      malformedPages.push({
        wikiPath,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    ownerByWikiPath.set(wikiPath, extracted.owner);
    for (const symbolKey of extracted.pageAnchors) {
      // Hand-edited pages may carry invalid keys; skipping is fail-closed
      // (verify reports the broken anchor separately) and keeps them away
      // from source-path disk reads.
      if (validateSymbolKey(symbolKey) !== null) continue;
      mergeObligation(obligations, {
        wikiPath,
        symbolKey,
        assignee: extracted.owner === "human" ? "human" : "agent",
      });
    }
    for (const section of extracted.sectionAnchors) {
      for (const symbolKey of section.symbolKeys) {
        if (validateSymbolKey(symbolKey) !== null) continue;
        mergeObligation(obligations, {
          wikiPath,
          symbolKey,
          assignee:
            section.inManualBlock || extracted.owner === "human" ? "human" : "agent",
        });
      }
    }
  }
  return {
    obligations: [...obligations.values()].sort((left, right) =>
      compareCodePoints(left.wikiPath, right.wikiPath) ||
      compareCodePoints(left.symbolKey, right.symbolKey)),
    ownerByWikiPath,
    malformedPages: [...malformedPages].sort((left, right) =>
      compareCodePoints(left.wikiPath, right.wikiPath)),
  };
}

/** Pure repository-health evaluation from versioned evidence and current facts. */
export function evaluateBaseline(
  baseline: DocumentationBaseline,
  symbols: readonly BaselineSymbol[],
  inventory: BaselineDocumentationInventory,
): BaselineHealth {
  const activeByKey = new Map(symbols.map((symbol) => [symbol.key, symbol]));
  const obligationByIdentity = new Map(
    inventory.obligations.map((obligation) => [baselineEntryIdentity(obligation), obligation]),
  );
  const baselineByIdentity = new Map(
    baseline.entries.map((entry) => [baselineEntryIdentity(entry), entry]),
  );
  const unbaselined = inventory.obligations.filter(
    (obligation) => !baselineByIdentity.has(baselineEntryIdentity(obligation)),
  );
  const removedAnchors = baseline.entries.filter(
    (entry) => !obligationByIdentity.has(baselineEntryIdentity(entry)),
  );

  const activeNameCount = new Map<string, number>();
  for (const symbol of symbols) {
    activeNameCount.set(symbol.name, (activeNameCount.get(symbol.name) ?? 0) + 1);
  }
  const acceptedMissing = baseline.entries.filter(
    (entry) => entry.provenance === "accepted" && !activeByKey.has(entry.symbolKey),
  );
  const possibleMoves = new Map<string, BaselineSymbol[]>();
  const claimsByNewKey = new Map<string, string[]>();
  for (const entry of acceptedMissing) {
    if (!obligationByIdentity.has(baselineEntryIdentity(entry))) continue;
    const oldName = logicalNameFromSymbolKey(entry.symbolKey);
    const candidates = symbols.filter((symbol) =>
      symbol.key !== entry.symbolKey &&
      symbol.content_hash === entry.hash &&
      extractionVersionForSymbolKey(symbol.key) === entry.extraction &&
      symbol.name === oldName &&
      activeNameCount.get(oldName) === 1,
    );
    possibleMoves.set(baselineEntryIdentity(entry), candidates);
    for (const candidate of candidates) {
      const claims = claimsByNewKey.get(candidate.key) ?? [];
      claims.push(baselineEntryIdentity(entry));
      claimsByNewKey.set(candidate.key, claims);
    }
  }

  const moves: BaselineMoveCandidate[] = [];
  const moveByOldIdentity = new Map<string, BaselineMoveCandidate>();
  for (const entry of acceptedMissing) {
    const identity = baselineEntryIdentity(entry);
    const candidates = possibleMoves.get(identity) ?? [];
    if (candidates.length !== 1) continue;
    const candidate = candidates[0]!;
    if ((claimsByNewKey.get(candidate.key) ?? []).length !== 1) continue;
    const obligation = obligationByIdentity.get(identity);
    if (!obligation) continue;
    const move: BaselineMoveCandidate = {
      wikiPath: entry.wikiPath,
      oldKey: entry.symbolKey,
      newKey: candidate.key,
      hash: entry.hash,
      assignee: obligation.assignee,
    };
    moves.push(move);
    moveByOldIdentity.set(identity, move);
  }

  const entries: EvaluatedBaselineEntry[] = baseline.entries.map((entry) => {
    const current = activeByKey.get(entry.symbolKey) ?? null;
    const obligation = obligationByIdentity.get(baselineEntryIdentity(entry));
    const assignee = obligation?.assignee ??
      (inventory.ownerByWikiPath.get(entry.wikiPath) === "human" ? "human" : "agent");
    let state: BaselineEntryState;
    if (entry.provenance === "inferred") state = "inferred";
    else if (current === null) state = "deleted";
    else state = current.content_hash === entry.hash ? "clean" : "changed";
    return { ...entry, state, currentHash: current?.content_hash ?? null, assignee };
  });

  const count = (state: BaselineEntryState): number =>
    entries.filter((entry) => entry.state === state).length;
  return {
    entries,
    moves: moves.sort((left, right) =>
      compareCodePoints(left.wikiPath, right.wikiPath) ||
      compareCodePoints(left.oldKey, right.oldKey)),
    unbaselined,
    removedAnchors,
    malformedPages: inventory.malformedPages,
    counts: {
      clean: count("clean"),
      changed: count("changed"),
      moved: moves.length,
      deleted: count("deleted") - moves.length,
      inferred: count("inferred"),
      unbaselined: unbaselined.length,
      removedAnchors: removedAnchors.length,
    },
  };
}

export function validateWikiPath(value: unknown): string | null {
  const base = validateDurablePath(value);
  if (base !== null) return `wikiPath ${base}`;
  const path = value as string;
  if (!path.startsWith("livewiki/") || !path.endsWith(".md")) {
    return "wikiPath must be a Markdown path inside livewiki/";
  }
  return null;
}

export function validateSymbolKey(value: unknown): string | null {
  if (typeof value !== "string") return "symbolKey must be a string";
  const split = splitSymbolKey(value);
  if (split === null) return "symbolKey must be source/path.ext#SymbolName";
  const pathError = validateDurablePath(split.sourcePath);
  if (pathError !== null) return `symbolKey source path ${pathError}`;
  if (/[\u0000-\u001f\u007f]/u.test(split.symbolName)) {
    return "symbolKey symbol name contains a control character";
  }
  return null;
}

function validateDurablePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return "must be a non-empty string";
  if (value !== value.normalize("NFC")) return "must use Unicode NFC";
  if (value.includes("\\")) return "must use forward slashes";
  if (value.startsWith("./")) return "must not start with ./";
  if (nodePath.posix.isAbsolute(value) || /^[A-Za-z]:\//u.test(value)) {
    return "must be repository-relative";
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "contains an empty, . or .. segment";
  }
  return null;
}

function splitSymbolKey(symbolKey: string): { sourcePath: string; symbolName: string } | null {
  const marker = symbolKey.lastIndexOf("#");
  if (marker <= 0 || marker === symbolKey.length - 1) return null;
  return { sourcePath: symbolKey.slice(0, marker), symbolName: symbolKey.slice(marker + 1) };
}

function logicalNameFromSymbolKey(symbolKey: string): string {
  const suffix = splitSymbolKey(symbolKey)?.symbolName ?? "";
  return suffix.slice(suffix.lastIndexOf(".") + 1);
}

function mergeObligation(
  obligations: Map<string, BaselineObligation>,
  next: BaselineObligation,
): void {
  const identity = baselineEntryIdentity(next);
  const current = obligations.get(identity);
  if (!current || (current.assignee === "agent" && next.assignee === "human")) {
    obligations.set(identity, next);
  }
}

async function collectMarkdownPaths(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  const root = nodePath.join(repoRoot, "livewiki");
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) stack.push(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(nodePath.relative(repoRoot, absolute).split(nodePath.sep).join("/"));
      }
    }
  }
  return out.sort(compareCodePoints);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0)!);
  const rightPoints = Array.from(right, (char) => char.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const delta = leftPoints[index]! - rightPoints[index]!;
    if (delta !== 0) return delta;
  }
  return leftPoints.length - rightPoints.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function available(baseline: DocumentationBaseline): BaselineLoadResult {
  return { state: "available", issues: [], baseline };
}

function incompatible(
  issues: BaselineIssue[],
  baseline: DocumentationBaseline | null,
): BaselineLoadResult {
  return { state: "incompatible", issues, baseline };
}
