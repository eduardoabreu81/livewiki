/**
 * file-page-plan — plan-then-write for oversized single-file pages (#29 D2).
 *
 * A file whose source exceeds `fileSplitSourceBytes` cannot be documented
 * from full source in one call. The pipeline (maintainer ruling 2026-08-08):
 *
 *   pass 0 — the model writes the page OPENING from the fair-truncated
 *            source (one mind designs the arc — no visible seams);
 *   pass 1 — the model designs the narrative ARC: ordered sections, each
 *            covering a set of closed-list keys (an exact partition);
 *   pass 2 — one call per section with the COMPLETE source slice of that
 *            section's symbol ranges; the model writes only prose — the
 *            orchestrator owns the heading and the lw:anchors marker;
 *   assembly — deterministic: frontmatter (title from the opening H1,
 *            anchors = the closed list), opening, sections in plan order.
 *
 * Chunking never reaches disk: the page is one coherent document. The
 * deterministic fallback plan (source-order chunks) keeps the pipeline
 * alive when the model's plan fails validation twice — generation-level
 * chunking is the machine's concern, exactly the #29 principle.
 *
 * This module is the PURE part: plan parsing/validation, fallback plan,
 * source slicing, assembly. No I/O, no LLM.
 */

/** One planned section: heading + the closed-list keys it covers. */
export interface FileSectionPlan {
  readonly heading: string;
  readonly keys: readonly string[];
}

export type FilePlanValidation =
  | { ok: true; sections: FileSectionPlan[] }
  | { ok: false; error: string };

/**
 * Parse and validate the model's plan. Accepted shape (strict): a fenced
 * ```json block containing {"sections": [{"heading": "...", "keys":
 * ["..."]}]}. The keys across sections must form an EXACT partition of the
 * closed list — every key exactly once, none from outside it.
 */
export function parseFilePlan(
  raw: string,
  closedKeyList: readonly string[],
): FilePlanValidation {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(raw);
  const jsonText = fence !== null ? fence[1]! : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.trim());
  } catch {
    return { ok: false, error: "plan is not valid JSON" };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { sections?: unknown }).sections)
  ) {
    return { ok: false, error: 'plan must be an object with a "sections" array' };
  }
  const sections: FileSectionPlan[] = [];
  const seen = new Set<string>();
  const closed = new Set(closedKeyList);
  for (const [i, s] of (parsed as { sections: unknown[] }).sections.entries()) {
    if (
      typeof s !== "object" ||
      s === null ||
      typeof (s as { heading?: unknown }).heading !== "string" ||
      (s as { heading: string }).heading.trim() === "" ||
      !Array.isArray((s as { keys?: unknown }).keys) ||
      (s as { keys: unknown[] }).keys.length === 0
    ) {
      return { ok: false, error: `section ${i + 1} needs a non-empty heading and a non-empty keys array` };
    }
    const keys: string[] = [];
    for (const k of (s as { keys: unknown[] }).keys) {
      if (typeof k !== "string" || !closed.has(k)) {
        return { ok: false, error: `section ${i + 1} cites key ${JSON.stringify(k)} which is not in the closed list` };
      }
      if (seen.has(k)) {
        return { ok: false, error: `key "${k}" appears in more than one section` };
      }
      seen.add(k);
      keys.push(k);
    }
    sections.push({ heading: (s as { heading: string }).heading.trim(), keys });
  }
  if (sections.length === 0) {
    return { ok: false, error: "plan has zero sections" };
  }
  const missing = closedKeyList.filter((k) => !seen.has(k));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `plan leaves ${missing.length} closed-list key(s) unassigned (e.g. ${missing.slice(0, 3).join(", ")}) — every key belongs to exactly one section`,
    };
  }
  return { ok: true, sections };
}

/**
 * Deterministic fallback plan: source-order chunks of at most
 * `maxKeysPerSection` consecutive closed-list keys. Section headings are
 * ordinal and honest ("Part N") — the heading is a generation artifact,
 * not a fabricated concept.
 */
export function deterministicFallbackPlan(
  closedKeyList: readonly string[],
  maxKeysPerSection = 15,
): FileSectionPlan[] {
  const sections: FileSectionPlan[] = [];
  for (let i = 0; i < closedKeyList.length; i += maxKeysPerSection) {
    const keys = closedKeyList.slice(i, i + maxKeysPerSection);
    sections.push({
      heading: `Part ${sections.length + 1} (symbols ${i + 1}–${i + keys.length})`,
      keys,
    });
  }
  return sections;
}

/** Symbol span for source slicing (subset of the index's SymbolRow). */
export interface SymbolSpan {
  readonly key: string;
  readonly start_line: number;
  readonly end_line: number;
}

/**
 * Extract the complete source slice covering a section's symbols: the
 * merged, contiguous line ranges of its spans, capped at `maxChars`
 * (truncation is flagged in the header so the section prompt can be
 * honest about partial evidence).
 */
export function extractSectionSource(
  sourceText: string,
  spans: readonly SymbolSpan[],
  maxChars: number,
): { text: string; truncated: boolean } {
  if (spans.length === 0) return { text: "", truncated: false };
  const lines = sourceText.split("\n");
  const ranges = spans
    .map((s) => ({
      start: Math.max(1, Math.min(s.start_line, s.end_line)),
      end: Math.max(1, Math.max(s.start_line, s.end_line)),
    }))
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  const chunks: string[] = [];
  let total = 0;
  let truncated = false;
  for (const r of merged) {
    const slice = lines.slice(r.start - 1, r.end).join("\n");
    if (total + slice.length > maxChars) {
      const remaining = Math.max(0, maxChars - total);
      if (remaining > 200) {
        chunks.push(slice.slice(0, remaining) + "\n// … (truncated by section source budget)");
      }
      truncated = true;
      break;
    }
    chunks.push(slice);
    total += slice.length;
  }
  return { text: chunks.join("\n// …\n"), truncated };
}

export interface AssembleFilePageOptions {
  /** Raw opening block from pass 0 (H1 + responsibility + opening H2s). */
  readonly opening: string;
  /** Section prose per planned section, in plan order. */
  readonly sectionProse: readonly string[];
  readonly plan: readonly FileSectionPlan[];
  readonly closedKeyList: readonly string[];
  readonly owner?: string;
}

/**
 * Assemble the complete file page deterministically. The frontmatter
 * anchors list is the closed list (the model never writes it); each
 * section's lw:anchors marker is the planned key set (the model never
 * writes markers); the title comes from the opening's H1.
 */
export function assembleFilePage(opts: AssembleFilePageOptions): string {
  const h1 = /^#\s+(.+?)\s*$/m.exec(opts.opening);
  const title = h1 !== null ? h1[1]! : "Untitled file";
  const lines: string[] = [
    "---",
    `title: ${title}`,
    `owner: ${opts.owner ?? "generated"}`,
  ];
  if (opts.closedKeyList.length > 0) {
    lines.push("anchors:");
    for (const key of opts.closedKeyList) lines.push(`  - ${key}`);
  }
  lines.push("---", "", opts.opening.trim(), "");
  for (const [i, section] of opts.plan.entries()) {
    const prose = opts.sectionProse[i] ?? "";
    lines.push(
      `## ${section.heading}`,
      `<!-- lw:anchors ${section.keys.join(" ")} -->`,
      "",
      prose.trim(),
      "",
    );
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
