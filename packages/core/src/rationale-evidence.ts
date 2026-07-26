/**
 * Shared rationale-evidence rendering (Etapa 2b).
 *
 * Single source of truth for the bounded rationale block used by BOTH the
 * generator contexts (`buildModuleDocContext` / `buildTopicDocContext` in
 * batch.ts) and the topic planner estimate (topics.ts), so the planner's
 * per-candidate accounting can never drift from what the generator actually
 * assembles.
 */

/** One indexed rationale row (schema v6 `rationales` table joined to files). */
export interface RationaleEvidenceRow {
  path: string;
  symbol_key: string | null;
  kind: string;
  text: string;
  start_line: number;
}

/**
 * Renders rationale rows as bounded evidence lines
 * (`- [kind] path:line (key | file-level): text`), in the given order and
 * capped at `maxChars` total. Returns "" when maxChars <= 0 or no rows exist.
 */
export function renderRationaleEvidence(
  rows: ReadonlyArray<RationaleEvidenceRow>,
  maxChars: number,
): string {
  let out = "";
  for (const row of rows) {
    const target = row.symbol_key ?? "file-level";
    const line = `- [${row.kind}] ${row.path}:${row.start_line} (${target}): ${row.text}`;
    if (out.length + line.length + 1 > maxChars) break;
    out += (out === "" ? "" : "\n") + line;
  }
  return out;
}
