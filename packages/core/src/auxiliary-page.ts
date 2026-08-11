/**
 * auxiliary-page — deterministic module page generation for non-product
 * modules (`fixture` | `tooling` | `docs`, per `classifyModuleRole`).
 *
 * Priority-0 fix (2026-07-20 improvement pass): auxiliary pages previously
 * went through the same LLM stage-4 loop as product modules, constrained by
 * the "compact auxiliary contract" prompt rules. That contract is fully
 * mechanical (fixed H2 set, one H3 + one marker + one short paragraph per
 * symbol) and carries no product-runtime semantics worth an LLM call, but the
 * model still drifted from the exact shape often enough to burn repair slots
 * and trip the stage-4 circuit breaker (`auxiliary_page_not_compact`, R11-A
 * E2E v21). This module assembles the same contract directly from the
 * indexed symbols — zero LLM calls, zero probabilistic failure — and the
 * result always satisfies `validateStage4Artifact`'s auxiliary checks.
 */

import type { Module } from "./modules.js";
import type { PathRole } from "./modules.js";

export type AuxiliaryRole = Exclude<PathRole, "product">;

export interface AuxiliarySymbolRow {
  key: string;
  name: string;
  kind: string;
  signature: string | null;
}

const ROLE_LABEL: Record<AuxiliaryRole, string> = {
  test: "automated tests",
  fixture: "test fixtures and supporting test data",
  tooling: "build tooling, scripts, or benchmarks",
  docs: "repository documentation",
};

const ROLE_BULLETS: Record<AuxiliaryRole, [string, string, string]> = {
  test: [
    "You are debugging a failing test and need to see what this suite covers.",
    "You are adding a test for a behavior that the product code already handles.",
    "You are checking whether a code path has test coverage before changing it.",
  ],
  fixture: [
    "You are debugging a failing test that depends on this fixture.",
    "You need to see every function and value this fixture provides to tests.",
    "You are adding a new test that should reuse this fixture instead of duplicating it.",
  ],
  tooling: [
    "You are modifying the build, lint, release, or benchmark scripts in this area.",
    "You need the exact functions these tooling scripts expose to other scripts.",
    "You are debugging a CI or local tooling failure that touches these scripts.",
  ],
  docs: [
    "You are updating the repository's own documentation source.",
    "You need the helpers used to generate or validate documentation.",
    "You are checking what this documentation area covers before editing it.",
  ],
};

const MAX_REFERENCE_PARAGRAPH_CHARS = 500;

/**
 * Builds the complete Markdown artifact for one auxiliary module page,
 * matching the same contract the LLM prompt used to describe (see
 * `buildStage4Prompt`'s `compactAuxiliaryRules` and
 * `validateStage4Artifact`'s auxiliary checks in `artifact.ts`).
 */
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string {
  const { module, role, symbols, closedKeyList } = opts;
  const title = module.displayTitle ?? humanizeModuleId(module.id);
  const roleLabel = ROLE_LABEL[role];

  const lines: string[] = ["---", `title: ${title}`, "owner: generated"];
  if (closedKeyList.length > 0) {
    lines.push("anchors:");
    for (const key of closedKeyList) lines.push(`  - ${key}`);
  }
  lines.push(
    "---",
    "",
    `# ${title}`,
    "",
    `This page documents the ${roleLabel} under \`${module.id}\` — reference material, not part of the shipped product's runtime code.`,
    "",
    "## When to use this page",
    "",
    ...ROLE_BULLETS[role].map((bullet) => `- ${bullet}`),
    "",
    "## How it fits",
    "",
    howItFitsParagraph(module, roleLabel),
    "",
    "## Reference",
    "",
  );

  for (const { symbol, heading } of disambiguateHeadings(symbols)) {
    lines.push(
      `### ${heading}`,
      `<!-- lw:anchors ${symbol.key} -->`,
      "",
      referenceParagraph(module, roleLabel, symbol),
      "",
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function howItFitsParagraph(module: Module, roleLabel: string): string {
  const fileWord = module.paths.length === 1 ? "file" : "files";
  return (
    `This area spans ${module.paths.length} ${fileWord} of ${roleLabel}. ` +
    `They are documented here for reference and are not linked from the main product pages.`
  );
}

function referenceParagraph(
  module: Module,
  roleLabel: string,
  symbol: AuxiliarySymbolRow,
): string {
  const path = symbol.key.split("#")[0] ?? module.paths[0] ?? module.id;
  const rawSignature = (symbol.signature ?? symbol.name).replace(/`/g, "'").trim();
  // Truncate the SIGNATURE (not the finished sentence) so the backtick pair
  // wrapping it always stays balanced — slicing the assembled sentence could
  // land inside a fence and leave `unclosed_markdown` behind.
  const fixedText =
    ` is a ${symbol.kind} defined in \`${path}\`, part of this area's ${roleLabel} ` +
    `— not part of the product's runtime behavior.`;
  const fixedTextChars = fixedText.length + 2;
  const signatureBudget = Math.max(1, MAX_REFERENCE_PARAGRAPH_CHARS - fixedTextChars);
  const signature =
    rawSignature.length > signatureBudget
      ? rawSignature.slice(0, signatureBudget - 1) + "…"
      : rawSignature;
  return (
    `\`${signature}\` is a ${symbol.kind} defined in \`${path}\`, part of this area's ${roleLabel} ` +
    `— not part of the product's runtime behavior.`
  );
}

/** Appends the file basename to disambiguate H3 headings sharing a symbol name. */
function disambiguateHeadings(
  symbols: AuxiliarySymbolRow[],
): Array<{ symbol: AuxiliarySymbolRow; heading: string }> {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    counts.set(symbol.name, (counts.get(symbol.name) ?? 0) + 1);
  }
  return symbols.map((symbol) => {
    const isDuplicate = (counts.get(symbol.name) ?? 0) > 1;
    if (!isDuplicate) return { symbol, heading: symbol.name };
    const path = symbol.key.split("#")[0] ?? "";
    const base = path.split("/").pop() ?? path;
    return { symbol, heading: `${symbol.name} (${base})` };
  });
}

/** Deterministic fallback title when no stage-2 `displayTitle` was accepted. */
function humanizeModuleId(id: string): string {
  const words = id.split(/[/\-_]+/).filter(Boolean);
  if (words.length === 0) return id;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
