/**
 * indexer — orchestrates: walk → read → hash → parse → extract → upsert.
 *
 * SPEC §"Phase 1 — Indexer":
 *   - extracts symbols (functions, classes, methods, exports)
 *   - computes hashes
 *   - persists to the SQLite schema
 *   - respects `.gitignore`
 *
 * Incremental: files with the same `content_hash` already in the DB are skipped
 * (read + hash only). New files are parsed. Files gone from disk are
 * marked with `status='deleted'` on their symbols.
 *
 * Performance:
 *   - SPEC target: 50k LOC < 30s first run, < 2s incremental
 *   - everything inside one SQLite transaction (atomic commit)
 *   - readFile serially (I/O bound; parallelizing does not help on SSD)
 *   - tree-sitter parse serially (CPU bound; parallelizing does not help on 1 core)
 *
 * Auto-init: if `.livewiki/` does not exist, it is created silently (SPEC §"index",
 * commit 300ad58). If `livewiki/` does not exist either, an info note is emitted
 * suggesting `livewiki init` (Phase 3) — exit 0.
 *
 * EOL-insensitive hashing + legacy silent migration (roadmap item 12):
 * file text is normalized with `normalizeEol` (CRLF → LF) ONCE right after
 * the read; the normalized string feeds the content_hash, tree-sitter, and
 * every symbol/rationale extraction, so symbol byte ranges and hashes are
 * all in the same coordinate system. A pure CRLF→LF flip on disk then
 * leaves every hash untouched — zero phantom debt.
 *
 * Databases written before this change store legacy RAW-BYTES hashes. On
 * the first index after the upgrade, such a file fails the normalized-hash
 * comparison; the indexer then hashes the current raw bytes and compares
 * against the stored hash. A match proves the on-disk bytes are unchanged
 * and only the hash ALGORITHM changed (raw → normalized), so the file is
 * silently migrated: the file row is re-hashed and symbols/calls/rationales
 * are re-parsed as usual, but (a) the file counts as UNCHANGED in the
 * result accounting, and (b) `anchors.symbol_hash_at_doc` for the file's
 * symbols is realigned to the new symbol content_hash inside the same
 * transaction, so the anchor-ledger's changed/moved diff never sees an
 * artificial old→new hash transition. Files whose raw bytes genuinely
 * changed never match the legacy hash and follow the normal debt path.
 *
 * Flipped-EOL legacy corpus (item 12 follow-up): the DB may have been
 * indexed under the OTHER EOL convention than the files currently on disk
 * (e.g. stored hashes are raw CRLF bytes, disk is now LF after a
 * cross-platform clone). The raw-bytes check above then fails even though
 * only line endings changed. Two directions, both covered:
 *   - legacy-LF DB + CRLF disk: `normalizeEol` of the current bytes IS the
 *     legacy raw hash, so the unchanged fast path absorbs it (legacy
 *     symbol hashes were computed on LF text == normalized text, so no
 *     realignment is needed);
 *   - legacy-CRLF DB + LF disk: when the current bytes contain zero
 *     `\r\n`, the indexer also hashes the CRLF-EXPANDED variant
 *     (`expandEolToCrlf`) and compares against the stored hash; a match
 *     proves the file is EOL-only-changed and triggers the same silent
 *     migration (legacy symbol hashes were raw CRLF slices ≠ normalized
 *     hashes, so the anchor realignment IS required here).
 * A mixed-EOL legacy file matches neither convention and takes the normal
 * updated path — acceptable residue: mixed endings are rare, and the
 * one-time `changed` debt it produces is truthful about the bytes being
 * different from anything the legacy DB could have stored.
 *
 * Per-symbol EOL realignment (item 12, follow-up 2): a file that takes
 * the NORMAL updated path inside a CRLF-era legacy DB (real edit + EOL
 * flip) re-hashes ALL its symbols from raw-CRLF slices to normalized
 * slices — including the symbols that did NOT change — which would emit
 * one phantom `changed` per unchanged symbol at the ledger diff. During
 * the legacy window (the run before `meta.eol_hashes_normalized` is first
 * written — after one complete run every file row is either re-hashed to
 * normalized or proved already-normalized by the unchanged fast path, so
 * no legacy hashes can remain and steady state pays zero extra hashing
 * cost), the write phase compares each old soft-deleted symbol hash
 * against sha256 of the NEW symbol's slice expanded back to CRLF
 * (`expandEolToCrlf`; the new slice is re-cut from the plan's normalized
 * text via the AST byte range — symbols store only hashes, never source).
 * A match proves the symbol's code is identical modulo EOL: its anchors
 * are realigned to the new normalized hash in the same transaction,
 * exactly like the per-file migration, and no debt is emitted. A real
 * edit fails the comparison and follows the normal `changed` path.
 * Residue: a file absent from the walk during the entire first
 * post-upgrade run keeps its legacy hashes marked deleted; if it later
 * reappears CHANGED, the window is already closed and its unchanged
 * symbols emit a one-time `changed` — accepted, since the anchor prose
 * was written against the pre-flip corpus anyway.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { walkRepo } from "./walker.js";
import { sha256, normalizeEol, expandEolToCrlf } from "./hashes.js";
import { initParser, parseSource, listSupportedGrammars, grammarForExtension, grammarState, type GrammarState } from "./parser.js";
import { extractSymbolsWithRanges, extractCalls, extractRationales, isLikelyGenerated, type SymbolRecord, type SymbolRange, type CallRecord, type RationaleRecord } from "./symbols.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { resolveCalls } from "./call-resolution.js";

export interface IndexOptions {
  /** Extra patterns to ignore (beyond .gitignore + defaults). */
  extraIgnores?: readonly string[];
  /** When true, suppresses info notes (JSON mode). */
  quiet?: boolean;
}

export interface IndexResult {
  filesScanned: number;
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  /** Re-parsed without content change because the grammar SET changed since
   *  the file was indexed (P1): it was indexed before its grammar landed and
   *  stayed prose-tier with zero symbols. Counted separately from unchanged
   *  so the upgrade is visible, not silent. */
  filesReprocessedGrammar: number;
  /** Rows that went from `status='deleted'` back to `'active'` because the
   *  file returned to the walk (restored, renamed back, un-ignored). Counted
   *  on its own axis: the file also lands in `filesUnchanged` or
   *  `filesUpdated` depending on whether its bytes moved. */
  filesReactivated: number;
  /** Skipped: NUL byte in the first 8 KiB (binary safety net — SPEC Phase 1). */
  filesSkippedBinary: number;
  /** Skipped: larger than 1 MiB (size cap — SPEC Phase 1). */
  filesSkippedTooLarge: number;
  symbolsAdded: number;
  symbolsDeleted: number;
  durationMs: number;
}

/** Files larger than this are skipped (SPEC Phase 1 size cap). */
export const MAX_FILE_BYTES = 1024 * 1024;
/** A NUL byte in this leading window marks the file as binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Runs the incremental index. Idempotent: running it twice with no repo
 * changes is cheap (just walk + 1 hash per file).
 */
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const startedAt = Date.now();
  const absRoot = nodePath.resolve(repoRoot);

  // 1. Ensure `.livewiki/` exists (no warning if `livewiki/` also exists).
  //    If not even `livewiki/` exists, emit an info note (not an error) — but
  //    only when NOT in quiet mode (Phase 5 hooks must not spam the terminal).
  await ensureLivewikiDir(absRoot, Boolean(opts.quiet));

  // 2. Resolve dbPath via safe-io (re-validates allowlist + symlinks).
  const dbPathRel = ".livewiki/index.db";
  const dbPath = await safeIo.resolveAndValidate(absRoot, dbPathRel);

  // 3. Walk
  const walked = await walkRepo(absRoot, {
    ...(opts.extraIgnores ? { extraIgnores: opts.extraIgnores } : {}),
  });

  // 4. Open the DB and orchestrate
  const db = openIndex(dbPath);
  try {
    return await orchestrateIndex(db, absRoot, walked, startedAt);
  } finally {
    db.close();
  }
}

async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void> {
  // Create `.livewiki/` (allowlist — safe-io). It is a derived cache.
  try {
    await safeIo.mkdir(absRoot, ".livewiki");
  } catch {
    // If it failed for a reason other than "already exists", re-throw.
    if (!(await nodeFs.stat(nodePath.join(absRoot, ".livewiki")).catch(() => null))) {
      throw new Error("failed to create .livewiki/");
    }
  }

  // Info note if the wiki also doesn't exist (Phase 3 will create it).
  // In quiet mode (hooks), suppress — the terminal stays clean.
  const livewikiExists = await nodeFs
    .stat(nodePath.join(absRoot, "livewiki"))
    .then(() => true)
    .catch(() => false);
  if (!livewikiExists && !quiet) {
    // eslint-disable-next-line no-console
    console.log(
      "[livewiki] note: wiki livewiki/ does not exist yet — indexed anyway. " +
        "Run `livewiki init` (Phase 3) to generate quickstart and full layout.",
    );
  }
}

async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult> {
  await initParser();

  // Load the current path → file row map for comparison
  const existingFiles = new Map<string, FileRow>();
  for (const row of db.prepare("SELECT * FROM files").all() as FileRow[]) {
    existingFiles.set(row.path, row);
  }

  // Grammar-set state (P1, external re-review 2026-08-03; widened
  // 2026-08-04): the unchanged fast path below compares content hashes
  // only, so a file whose grammar coverage changed AFTER it was indexed
  // silently keeps a stale result — the exact class of lie the tool exists
  // to prevent. Three change shapes, all detected from `meta.grammar_state`
  // (JSON written at the end of every run):
  //   - grammar ADDED: files indexed before it landed hold zero symbols
  //     under a prose label while status reports the tier as anchored;
  //   - grammar REMOVED/REMAPPED: `map[ext]` differs — symbols parsed with
  //     the wrong grammar stay stale (remap) or must be dropped (removal);
  //   - grammar VERSION BUMPED: the ext→grammar map is identical, only the
  //     vendored .wasm identity (`artifacts`) moves.
  // A database with no stored state is pre-feature: only the zero-symbol
  // directed re-parse is safe there (files with symbols stay as indexed;
  // precision starts with the NEXT change). Reprocessed files are re-parsed
  // but never counted as "updated" — content is unchanged, so no phantom
  // debt. On a version bump, symbols whose slice/hash genuinely moved take
  // the ledger's normal `changed` path (truthful debt; unlike the EOL
  // migration there is no deterministic transform that could prove an
  // identical body, so no realignment is attempted); identical-hash
  // symbols are silent.
  const currentGrammarState = grammarState();
  const storedGrammarStateRaw = (
    db.prepare("SELECT value FROM meta WHERE key = 'grammar_state'").get() as
      | { value: string }
      | undefined
  )?.value;
  let storedGrammarState: GrammarState | null = null;
  if (storedGrammarStateRaw !== undefined) {
    try {
      storedGrammarState = JSON.parse(storedGrammarStateRaw) as GrammarState;
    } catch {
      storedGrammarState = null; // corrupt state: treat as legacy
    }
  }
  const grammarStateChanged =
    storedGrammarState === null ||
    !grammarStateEqual(storedGrammarState, currentGrammarState);
  const filesWithActiveSymbols = new Set<number>();
  if (grammarStateChanged) {
    for (const row of db
      .prepare("SELECT DISTINCT file_id FROM symbols WHERE status = 'active'")
      .all() as Array<{ file_id: number }>) {
      filesWithActiveSymbols.add(row.file_id);
    }
  }

  // ── Phase A: async I/O (read + parse) OUTSIDE the transaction.
  // better-sqlite3 transactions are synchronous and cannot contain await.
  interface FilePlan {
    entry: { path: string; lang: string };
    content: string;
    size: number;
    mtime: number;
    hash: string;
    /** True when only the hash ALGORITHM changed (legacy raw-bytes →
     *  normalized); the on-disk bytes are provably identical. */
    eolMigration: boolean;
    /** True when the content is unchanged but the grammar set changed and
     *  the file had zero symbols (P1 directed re-parse). */
    grammarReprocess: boolean;
    /** True when this file's row was `status='deleted'` and the file is back
     *  in the walk. Orthogonal to the content buckets: the row transitions to
     *  active regardless of whether the bytes also changed. */
    reactivated: boolean;
    symbols: Array<SymbolRecord & SymbolRange>;
    calls: CallRecord[];
    rationales: RationaleRecord[];
  }
  const plans: FilePlan[] = [];

  let filesUnchanged = 0;
  let filesSkippedBinary = 0;
  let filesSkippedTooLarge = 0;
  for (const entry of walked) {
    const absPath = nodePath.join(repoRoot, entry.path);
    let stat;
    try {
      stat = await nodeFs.stat(absPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] skip ${entry.path}: ${(err as Error).message}`);
      continue;
    }
    // Size cap first: never read a huge file into memory.
    if (stat.size > MAX_FILE_BYTES) {
      filesSkippedTooLarge++;
      continue;
    }
    let rawContent: string;
    try {
      rawContent = await nodeFs.readFile(absPath, "utf8");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] skip ${entry.path}: ${(err as Error).message}`);
      continue;
    }
    // Binary safety net: a NUL byte in the leading window means this is not
    // text, whatever the extension says.
    if (rawContent.slice(0, BINARY_SNIFF_BYTES).includes("\0")) {
      filesSkippedBinary++;
      continue;
    }

    // Roadmap item 12: normalize EOL ONCE here; everything downstream
    // (hash, tree-sitter parse, symbol/rationale extraction) consumes this
    // same string, so a CRLF→LF flip is invisible to the index.
    const content = normalizeEol(rawContent);
    const hash = sha256(content);
    const prev = existingFiles.get(entry.path);
    // A row marked deleted whose file is back in the walk (restored, renamed
    // back, un-ignored) must return to 'active' even when the content never
    // changed. The unchanged fast path below only compares hashes, so it used
    // to `continue` over exactly this case and leave the row — and its
    // symbols — invisible to every consumer that filters status='active'.
    // Falling through to the normal parse path is deliberate: it re-inserts
    // only the symbols the file actually has today, instead of blanket-
    // reviving rows that a previous generation of the same file soft-deleted.
    const reactivated = prev !== undefined && prev.status !== "active";
    let grammarReprocess = false;
    if (prev && prev.content_hash === hash && !reactivated) {
      // Directed re-parse: content unchanged, but the grammar state changed
      // since this file was indexed (see above). Fall through to the normal
      // parse path instead of skipping.
      const ext = nodePath.extname(entry.path).toLowerCase();
      const grammar = grammarForExtension(ext);
      if (grammarStateChanged) {
        if (storedGrammarState === null) {
          // Legacy (pre-feature) database: only the zero-symbol case is
          // safe to touch; precision starts with the next state change.
          grammarReprocess =
            grammar !== undefined && !filesWithActiveSymbols.has(prev.id);
        } else {
          const previousGrammar = storedGrammarState.map[ext];
          const remapped = previousGrammar !== grammar; // add / remove / remap
          const bumped =
            grammar !== undefined &&
            storedGrammarState.artifacts[grammar] !== currentGrammarState.artifacts[grammar];
          const labelDrift = prev.lang !== entry.lang;
          grammarReprocess =
            (grammar !== undefined && !filesWithActiveSymbols.has(prev.id)) ||
            remapped ||
            bumped ||
            labelDrift;
        }
      }
      if (!grammarReprocess) {
        filesUnchanged++;
        continue;
      }
    }

    // Legacy silent migration: a stored hash that matches the RAW BYTES of
    // the current file (but not the normalized hash) can only come from a
    // pre-item-12 database — the bytes on disk are unchanged, only the hash
    // algorithm moved from raw to normalized. Migrated files are re-parsed
    // but count as unchanged and realign their anchors (write phase).
    // Only evaluated when the normalized hash did NOT match — the fast path
    // above absorbs matches, and a P1 grammar reprocess falls through WITH
    // a matching hash and must not be misread as an EOL migration (for
    // LF-only files sha256(rawContent) == content_hash, a false positive
    // that would swallow the reprocess accounting).
    let eolMigration = false;
    if (prev !== undefined && prev.content_hash !== hash) {
      eolMigration = prev.content_hash === sha256(rawContent);
      // Flipped-EOL legacy corpus: the DB was indexed under the OTHER EOL
      // convention (e.g. stored = raw CRLF bytes, disk now LF). The raw
      // check above then fails; hash the CRLF-expanded variant and compare.
      // Only attempted when the current bytes have zero `\r\n`, so the
      // expansion cannot double-expand anything (see expandEolToCrlf). The
      // reverse direction (legacy-LF DB, CRLF disk) needs no check: the
      // normalized hash above IS the legacy raw hash there.
      if (!eolMigration && !rawContent.includes("\r\n")) {
        eolMigration = prev.content_hash === sha256(expandEolToCrlf(rawContent));
      }
    }

    let symbols: Array<SymbolRecord & SymbolRange> = [];
    let calls: CallRecord[] = [];
    let rationales: RationaleRecord[] = [];
    const ext = nodePath.extname(entry.path);
    // Tier 2 (SPEC §"Coverage ladder"): without a grammar there is no parse
    // attempt at all — the file is indexed with zero symbols, no warning.
    // Parse FAILURES on grammar-mapped files keep the warning behavior.
    if (grammarForExtension(ext) !== undefined) {
      try {
        const tree = await parseSource(ext, content);
        symbols = extractSymbolsWithRanges(tree, entry.path, content);
        calls = extractCalls(tree, entry.path, content);
        // Step 2b: generated files (header sniff) yield zero rationale
        // rows — migration/protobuf revision comments are noise.
        if (!isLikelyGenerated(content)) {
          rationales = extractRationales(tree, entry.path, content);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[livewiki] parse failed in ${entry.path}: ${(err as Error).message}`);
      }
    }

    plans.push({
      entry,
      content,
      size: stat.size,
      mtime: stat.mtimeMs,
      hash,
      eolMigration,
      grammarReprocess,
      reactivated,
      symbols,
      calls,
      rationales,
    });
  }

  // ── Phase B: SYNCHRONOUS writes inside ONE transaction (atomicity + speed).
  const seenPaths = new Set(walked.map((w) => w.path));
  const result = {
    filesAdded: 0,
    filesUpdated: 0,
    filesUnchanged,
    filesDeleted: 0,
    filesReprocessedGrammar: 0,
    filesReactivated: 0,
    symbolsAdded: 0,
    symbolsDeleted: 0,
  };

  // Legacy window for the per-symbol EOL realignment (roadmap item 12,
  // follow-up 2): CRLF-era (non-normalized) symbol hashes can only be
  // present until ONE complete post-upgrade index run finishes — after it,
  // every file row was either re-hashed to normalized or took the
  // unchanged fast path (which requires stored == normalized). Scoping
  // the realignment to this window means steady-state normalized
  // operation pays ZERO extra hashing cost (no slice hashes, no extra
  // queries). The flag is written inside the transaction below.
  const legacyWindow =
    (db.prepare("SELECT value FROM meta WHERE key = 'eol_hashes_normalized'").get() as
      | { value: string }
      | undefined) === undefined;

  const writeAll = db.transaction(() => {
    const insertFile = db.prepare(
      "INSERT INTO files (path, lang, content_hash, size, mtime, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const updateFile = db.prepare(
      "UPDATE files SET lang = ?, content_hash = ?, size = ?, mtime = ?, indexed_at = ?, status = 'active' WHERE id = ?",
    );
    // NOTE: reactivation needs no statement of its own — `updateFile` above
    // already sets status='active', and a returning file goes through the
    // normal update path so its symbols are re-inserted as active.
    // SOFT-DELETE instead of hard delete (Fix A — Phase 2 review finding):
    // symbols that disappear from an UPDATED file need to keep their row with
    // the old content_hash, so the ledger can detect `moved` when that hash
    // shows up in another file.
    const markSymbolsActiveDeleted = db.prepare(
      "UPDATE symbols SET status = 'deleted' WHERE file_id = ? AND status = 'active'",
    );
    const insertSymbol = db.prepare(
      "INSERT INTO symbols (file_id, key, name, kind, signature, start_line, end_line, content_hash, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
    );
    const markSymbolDeleted = db.prepare(
      "UPDATE symbols SET status = 'deleted' WHERE file_id = ? AND status = 'active'",
    );
    const markFileDeleted = db.prepare(
      "UPDATE files SET status = 'deleted' WHERE id = ?",
    );
    // Calls have no move-tracking need (unlike symbols) — a changed or
    // removed file's call edges are simply recomputed wholesale.
    const deleteCallsForFile = db.prepare("DELETE FROM calls WHERE file_id = ?");
    const insertCall = db.prepare(
      "INSERT INTO calls (file_id, caller_key, callee_name, line, confidence) VALUES (?, ?, ?, ?, ?)",
    );
    // Rationales mirror calls exactly (Step 2b): recomputed wholesale per
    // file, no soft-delete — a rationale row has no identity worth
    // preserving across a re-parse.
    const deleteRationalesForFile = db.prepare("DELETE FROM rationales WHERE file_id = ?");
    const insertRationale = db.prepare(
      "INSERT INTO rationales (file_id, symbol_key, kind, text, start_line, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
    );
    // EOL silent migration (roadmap item 12): realign anchor hashes to the
    // re-parsed (normalized) symbol hashes inside this same transaction, so
    // the ledger's changed/moved diff never sees the raw→normalized
    // transition. Symbol keys are path-qualified, so each update touches
    // only anchors pointing at THIS file's symbols.
    const realignAnchorHash = db.prepare(
      "UPDATE anchors SET symbol_hash_at_doc = ? WHERE symbol_key = ?",
    );

    for (const plan of plans) {
      const prev = existingFiles.get(plan.entry.path);
      let fileId: number;
      // Per-symbol EOL realignment (roadmap item 12, follow-up 2): an
      // UPDATED file inside the legacy window may still hold CRLF-era
      // symbol hashes. Capture the old (just soft-deleted) key → hash map
      // so the insert loop can prove "same code, different EOL" per
      // symbol. Null outside the window / for migrations / for new files
      // — steady state never builds this map.
      let oldSymbolHashes: Map<string, string> | null = null;
      if (prev) {
        // Mark the old ones as deleted (keeping content_hash in the DB) before
        // inserting the new ones. The ledger reads the deleted ones to detect moved.
        markSymbolsActiveDeleted.run(prev.id);
        updateFile.run(
          plan.entry.lang,
          plan.hash,
          plan.size,
          plan.mtime,
          Date.now(),
          prev.id,
        );
        fileId = prev.id;
        // `updateFile` above already flipped status back to 'active' and the
        // symbol loop below re-inserts today's symbols as active, so the
        // reactivation is complete here. It is counted on its own axis: the
        // content bucket still reports whether the bytes moved.
        if (plan.reactivated) {
          result.filesReactivated++;
          if (plan.hash === prev.content_hash) result.filesUnchanged++;
          else result.filesUpdated++;
        }
        // EOL migration is not a content change: the file counts as
        // unchanged and its re-inserted symbols are not "added".
        else if (plan.eolMigration) {
          result.filesUnchanged++;
        } else if (plan.grammarReprocess) {
          // Directed re-parse: not a content change either — counted
          // separately so the grammar upgrade is visible, never as
          // "updated" (no phantom debt). Capture the just-soft-deleted
          // key → hash map so the symbol loop below can tell genuinely new
          // anchors from re-inserted ones.
          result.filesReprocessedGrammar++;
          oldSymbolHashes = new Map(
            (
              db
                .prepare(
                  "SELECT key, content_hash FROM symbols WHERE file_id = ? AND status = 'deleted'",
                )
                .all(prev.id) as Array<{ key: string; content_hash: string }>
            ).map((row) => [row.key, row.content_hash] as const),
          );
        } else {
          result.filesUpdated++;
          if (legacyWindow) {
            oldSymbolHashes = new Map(
              (
                db
                  .prepare(
                    "SELECT key, content_hash FROM symbols WHERE file_id = ? AND status = 'deleted'",
                  )
                  .all(prev.id) as Array<{ key: string; content_hash: string }>
              ).map((row) => [row.key, row.content_hash] as const),
            );
          }
        }
      } else {
        const res = insertFile.run(
          plan.entry.path,
          plan.entry.lang,
          plan.hash,
          plan.size,
          plan.mtime,
          Date.now(),
        );
        fileId = Number(res.lastInsertRowid);
        result.filesAdded++;
      }
      for (const sym of plan.symbols) {
        insertSymbol.run(
          fileId,
          sym.key,
          sym.name,
          sym.kind,
          sym.signature,
          sym.start_line,
          sym.end_line,
          sym.content_hash,
        );
        if (plan.eolMigration) {
          realignAnchorHash.run(sym.content_hash, sym.key);
        } else if (plan.grammarReprocess) {
          const oldHash = oldSymbolHashes?.get(sym.key);
          if (oldHash === undefined) {
            // Genuinely new anchor (grammar added or extraction widened).
            result.symbolsAdded++;
          }
          // Old key + identical hash: silent — no debt, no count. Old key +
          // different hash: a grammar bump moved the slice; the ledger's
          // normal `changed` path owns that debt — never realigned (there
          // is no deterministic transform that could prove body identity).
        } else {
          result.symbolsAdded++;
          // Per-symbol EOL realignment: if the old stored hash matches
          // sha256 of the NEW symbol's slice EXPANDED back to CRLF, the
          // symbol's code is identical modulo line endings (the new slice
          // comes from normalized text with zero `\r\n`, so the expansion
          // is unambiguous). Realign its anchors to the new normalized
          // hash instead of letting the ledger emit a phantom `changed`.
          // Symbols that really changed fail the comparison and follow
          // the normal debt path. Never stores source text — only hashes.
          const oldHash = oldSymbolHashes?.get(sym.key);
          if (oldHash !== undefined && oldHash !== sym.content_hash) {
            const slice = plan.content.slice(
              sym.source_start_byte,
              sym.source_end_byte,
            );
            if (sha256(expandEolToCrlf(slice)) === oldHash) {
              realignAnchorHash.run(sym.content_hash, sym.key);
            }
          }
        }
      }
      deleteCallsForFile.run(fileId);
      for (const call of plan.calls) {
        insertCall.run(fileId, call.caller_key, call.callee_name, call.line, call.confidence);
      }
      deleteRationalesForFile.run(fileId);
      for (const rationale of plan.rationales) {
        insertRationale.run(
          fileId,
          rationale.symbol_key,
          rationale.kind,
          rationale.text,
          rationale.start_line,
          rationale.content_hash,
        );
      }
    }

    // Files that existed in the DB but not in the walk → mark as deleted (file + symbols)
// WITHOUT deleting the file row. This preserves history for moved detection in
// Phase 2 (we need the deleted symbols with content_hash for matching).
    for (const [prevPath, prevRow] of existingFiles) {
      if (seenPaths.has(prevPath)) continue;
      // Already-deleted rows are left exactly as they are. Re-marking them
      // wrote the same value back, re-counted the same history on every run
      // (so `removed` never converged), and burned four statements per row
      // for nothing. Their history is preserved, never removed — only the
      // active → deleted transition is real work worth counting.
      if (prevRow.status !== "active") continue;
      // Count BEFORE the UPDATE (otherwise the WHERE filters out what just changed).
      const oldSyms = db
        .prepare("SELECT id FROM symbols WHERE file_id = ? AND status = 'active'")
        .all(prevRow.id) as { id: number }[];
      markSymbolDeleted.run(prevRow.id);
      result.symbolsDeleted += oldSyms.length;
      markFileDeleted.run(prevRow.id);
      deleteCallsForFile.run(prevRow.id);
      deleteRationalesForFile.run(prevRow.id);
      result.filesDeleted++;
    }

    // Runs inside the same transaction as the symbol/call writes above so a
    // reindex is atomic: readers never see calls with a stale/missing
    // resolution for symbols that were just added or removed.
    resolveCalls(db);

    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_indexed_at', ?)",
    ).run(String(Date.now()));

    // Closes the legacy window (see above): after this complete run no
    // CRLF-era hashes can remain in the DB.
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('eol_hashes_normalized', '1')",
    ).run();

    // Record the grammar state this run indexed under (see above). A future
    // run diffs it to direct re-parses (grammar added / removed / remapped /
    // version-bumped).
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('grammar_state', ?)",
    ).run(JSON.stringify(currentGrammarState));
  });

  writeAll();

  return {
    filesScanned: walked.length,
    filesAdded: result.filesAdded,
    filesUpdated: result.filesUpdated,
    filesDeleted: result.filesDeleted,
    filesUnchanged: result.filesUnchanged,
    filesReprocessedGrammar: result.filesReprocessedGrammar,
    filesReactivated: result.filesReactivated,
    filesSkippedBinary,
    filesSkippedTooLarge,
    symbolsAdded: result.symbolsAdded,
    symbolsDeleted: result.symbolsDeleted,
    durationMs: Date.now() - startedAt,
  };
}

/** Used in errors to give a support hint. */
export { listSupportedGrammars };

/** Structural equality for GrammarState (key order in stored JSON is not
 *  guaranteed to match a fresh build, so compare field by field). */
function grammarStateEqual(a: GrammarState, b: GrammarState): boolean {
  const mapA = Object.keys(a.map);
  const mapB = Object.keys(b.map);
  if (mapA.length !== mapB.length) return false;
  for (const key of mapA) {
    if (a.map[key] !== b.map[key]) return false;
  }
  const artA = Object.keys(a.artifacts);
  const artB = Object.keys(b.artifacts);
  if (artA.length !== artB.length) return false;
  for (const key of artA) {
    if (a.artifacts[key] !== b.artifacts[key]) return false;
  }
  return true;
}

export function formatHuman(result: IndexResult): string {
  const lines: string[] = [];
  lines.push(`livewiki index: OK in ${result.durationMs}ms`);
  lines.push(
    `  files: ${result.filesScanned} scanned  ` +
      `+${result.filesAdded} new  ~${result.filesUpdated} updated  ` +
      `=${result.filesUnchanged} unchanged  -${result.filesDeleted} removed`,
  );
  lines.push(
    `  symbols: +${result.symbolsAdded} extracted  -${result.symbolsDeleted} marked deleted`,
  );
  if (result.filesReprocessedGrammar > 0) {
    lines.push(
      `  grammar upgrade: ${result.filesReprocessedGrammar} unchanged file(s) re-parsed (new grammar coverage)`,
    );
  }
  if (result.filesReactivated > 0) {
    lines.push(
      `  reactivated: ${result.filesReactivated} previously removed file(s) back in the walk`,
    );
  }
  if (result.filesSkippedBinary > 0 || result.filesSkippedTooLarge > 0) {
    lines.push(
      `  skipped: ${result.filesSkippedBinary} binary (NUL byte)  ` +
        `${result.filesSkippedTooLarge} too large (>1 MiB)`,
    );
  }
  return lines.join("\n");
}