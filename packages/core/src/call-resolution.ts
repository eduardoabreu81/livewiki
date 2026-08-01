/**
 * call-resolution — fills `calls.resolved_callee_key` for rows the
 * indexer just inserted (or re-inserted) with it unset.
 *
 * Deliberately narrow, DB-only resolution (no filesystem/tsconfig import
 * resolution is threaded in here — that machinery lives in
 * `import-resolution.ts` and is async/fs-bound, while this runs
 * synchronously inside the indexer's write transaction):
 *
 *   1. Same-file match: exactly one active `function`/`export` symbol in
 *      the SAME file whose `name` equals the raw `callee_name`.
 *   2. Global-unique match (only tried when step 1 found nothing):
 *      exactly one active `function`/`export` symbol ANYWHERE in the repo
 *      with that name.
 *
 * Both steps require an UNAMBIGUOUS match (exactly one candidate) — zero
 * or multiple candidates leave `resolved_callee_key` NULL rather than
 * guess. Method calls (`obj.method()`) are out of scope for v1: this
 * scan's `callee_name` is the bare right-most identifier, and a method
 * symbol's `name` is qualified (`Class.method`), so it never matches a
 * bare name — that's intentional, not a bug, until a resolver that tracks
 * the call's receiver expression is worth building.
 *
 * Confidence policy (schema v7, roadmap item 8): the tag is decided at
 * EXTRACTION time (symbols.ts) and resolution never changes it. A bare-
 * identifier callee keeps 'extracted' through both steps — an explicitly
 * called name that is unique in the whole repo is strong cross-module
 * evidence (the flow tie-break relies on exactly this). Member/attribute
 * callees (`obj.method()`) arrive as 'inferred' from extraction and stay
 * so: the receiver is unknown, and that name guess is the noise the
 * consumers filter out.
 *
 * Scope note: this runs over the WHOLE `calls` table each index (only
 * touching `resolved_callee_key IS NULL` rows), so a symbol that starts
 * existing/becomes unique this run retroactively resolves any earlier,
 * previously-ambiguous edge — no reindex of the calling file needed. The
 * one gap: a row that was ALREADY resolved to a real key in a past run
 * is never re-examined, so if that target symbol later moves to a
 * different file (a new key) the edge goes stale until the CALLING
 * file itself is reindexed (which clears it back to NULL first). A
 * best-effort signal, not a correctness guarantee.
 */

import type Database from "better-sqlite3";

export interface ResolveCallsResult {
  /** Rows whose resolved_callee_key changed from NULL to a real key. */
  resolved: number;
}

/**
 * Priority-0 Phase 3 (flows.ts integration): the set of symbol keys with
 * at least one RESOLVED call whose caller lives in a DIFFERENT module —
 * i.e. a callee proven, by the indexed call graph, to be an actual
 * cross-module dependency (not just an import). Only 'extracted'-
 * confidence edges count (schema v7): a member-access name guess
 * (`obj.open()`) is not evidence of a cross-module dependency. Fed into
 * `detectFlowCandidates`'s `resolvedCrossModuleCallees` option, which only
 * uses it to break ties within the T2 (crossing) seed-key group; flows.ts
 * itself never touches the database, so this computation lives here.
 */
export function computeCrossModuleCallees(
  db: Database.Database,
  modules: ReadonlyArray<{ id: string; paths: readonly string[] }>,
): Set<string> {
  const fileToModule = new Map<string, string>();
  for (const module of modules) {
    for (const path of module.paths) fileToModule.set(path, module.id);
  }

  const rows = db
    .prepare(
      "SELECT caller_key, resolved_callee_key FROM calls WHERE resolved_callee_key IS NOT NULL AND confidence = 'extracted'",
    )
    .all() as Array<{ caller_key: string; resolved_callee_key: string }>;

  const result = new Set<string>();
  for (const row of rows) {
    const callerFile = row.caller_key.split("#")[0];
    const calleeFile = row.resolved_callee_key.split("#")[0];
    if (callerFile === undefined || calleeFile === undefined) continue;
    const callerModule = fileToModule.get(callerFile);
    const calleeModule = fileToModule.get(calleeFile);
    if (callerModule === undefined || calleeModule === undefined) continue;
    if (callerModule !== calleeModule) result.add(row.resolved_callee_key);
  }
  return result;
}

/**
 * Workstream B (deterministic topic-plan proposer): a cheap centrality
 * proxy over the existing `calls` table — the number of DISTINCT resolved
 * callers per callee key ("god node"-lite, no Leiden/community-detection
 * complexity). Only 'extracted'-confidence edges count (schema v7):
 * inferred callers (member-access name guesses) are excluded so
 * `obj.method()` noise cannot rank anchors. Consumed by
 * `selectTopicAnchors` (topics.ts) to rank
 * anchors within a bucket; a key absent from the returned map has zero
 * resolved callers (centrality 0), not an error.
 */
export function computeCallerCentrality(db: Database.Database): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT resolved_callee_key AS key, COUNT(DISTINCT caller_key) AS callers
       FROM calls WHERE resolved_callee_key IS NOT NULL AND confidence = 'extracted' GROUP BY resolved_callee_key`,
    )
    .all() as Array<{ key: string; callers: number }>;
  return new Map(rows.map((r) => [r.key, r.callers]));
}

export function resolveCalls(db: Database.Database): ResolveCallsResult {
  const sameFile = db
    .prepare(
      `UPDATE calls
       SET resolved_callee_key = (
         SELECT s.key FROM symbols s
         WHERE s.status = 'active' AND s.kind IN ('function', 'export')
           AND s.file_id = calls.file_id AND s.name = calls.callee_name
       )
       WHERE resolved_callee_key IS NULL
         AND (
           SELECT COUNT(*) FROM symbols s
           WHERE s.status = 'active' AND s.kind IN ('function', 'export')
             AND s.file_id = calls.file_id AND s.name = calls.callee_name
         ) = 1`,
    )
    .run();

  const globalUnique = db
    .prepare(
      `UPDATE calls
       SET resolved_callee_key = (
         SELECT s.key FROM symbols s
         WHERE s.status = 'active' AND s.kind IN ('function', 'export')
           AND s.name = calls.callee_name
       )
       WHERE resolved_callee_key IS NULL
         AND (
           SELECT COUNT(*) FROM symbols s
           WHERE s.status = 'active' AND s.kind IN ('function', 'export')
             AND s.name = calls.callee_name
         ) = 1`,
    )
    .run();

  return { resolved: sameFile.changes + globalUnique.changes };
}
