/**
 * orientation — deterministic product-orientation evidence from the repo root.
 *
 * D1 of docs/plans/2026-07-26-orientation-and-intent-navigation.md: the
 * quickstart must state what the documented repository IS before it explains
 * the livewiki workflow. The evidence is free and human-written: the primary
 * README's first meaningful prose paragraph (never invented — `null` when
 * absent) plus deterministic entry-point surface hints from well-known root
 * files.
 *
 * Pure reads from the repo root; nothing is written and no LLM is involved.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

export interface RepoOrientation {
  /** First meaningful README prose paragraph, sentence-clipped to ~600 chars. */
  purpose: string | null;
  /** Ordered one-line entry-point hints derived from well-known root files. */
  surfaces: string[];
  /** Repo-relative path of the README the purpose was taken from, if any. */
  readmePath: string | null;
  /**
   * Product name from the README's first H1 (tags stripped, edge
   * decorations removed), when one exists — the deterministic answer to
   * "what is this product called", so synthesis never infers the name
   * from directory or wiki path names.
   */
  readmeTitle: string | null;
  /**
   * Heading text of the README section that documents the fastest local path
   * (quickstart / getting started / …), when one exists.
   */
  fastPathSection: string | null;
}

/** Bound for the purpose excerpt; longer paragraphs are sentence-clipped. */
export const PURPOSE_MAX_CHARS = 600;
/** Floor for a paragraph to count as "meaningful" prose. */
const PURPOSE_MIN_CHARS = 40;
/** READMEs are read through this cap only (they are near the top anyway). */
const README_MAX_BYTES = 256 * 1024;

const FAST_PATH_HEADING_RE =
  /quick ?start|getting started|installation|setup|run locally|local development|usage/i;

/**
 * Extracts deterministic product-orientation evidence from the repository
 * root. Never throws on missing/unreadable files — every absence degrades to
 * `null`/empty fields.
 */
export async function extractRepoOrientation(absRoot: string): Promise<RepoOrientation> {
  const root = nodePath.resolve(absRoot);
  const readmePath = await findPrimaryReadme(root);
  let purpose: string | null = null;
  let readmeTitle: string | null = null;
  let fastPathSection: string | null = null;
  if (readmePath !== null) {
    const source = await readBounded(nodePath.join(root, readmePath));
    if (source !== null) {
      purpose = extractPurpose(source);
      readmeTitle = extractReadmeTitle(source);
      fastPathSection = findFastPathSection(source);
    }
  }
  return {
    purpose,
    surfaces: await detectSurfaces(root),
    readmePath,
    readmeTitle,
    fastPathSection,
  };
}

/**
 * Primary README selection order: `README.md`, then `README.en.md`, then any
 * other `README*.{md,markdown}` at the root (sorted, case-insensitive).
 */
async function findPrimaryReadme(root: string): Promise<string | null> {
  const names = await readdirNames(root);
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const wanted of ["readme.md", "readme.en.md"]) {
    const hit = byLower.get(wanted);
    if (hit !== undefined) return hit;
  }
  const fallback = names
    .filter((name) => /^readme.*\.(md|markdown)$/i.test(name))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return fallback[0] ?? null;
}

async function readdirNames(root: string): Promise<string[]> {
  try {
    const entries = await nodeFs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readBounded(absFile: string): Promise<string | null> {
  try {
    const stat = await nodeFs.stat(absFile);
    if (stat.size > README_MAX_BYTES) {
      const handle = await nodeFs.open(absFile, "r");
      try {
        const buffer = Buffer.alloc(README_MAX_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, README_MAX_BYTES, 0);
        return buffer.toString("utf8", 0, bytesRead);
      } finally {
        await handle.close();
      }
    }
    return await nodeFs.readFile(absFile, "utf8");
  } catch {
    return null;
  }
}

/**
 * First meaningful prose paragraph of a README. HTML container blocks
 * (div/p/section/…) are TRAVERSED, not skipped: inline tags (`<b>`, `<i>`,
 * `<a>`, `<span>`, …) are stripped and their text content is kept, because
 * real READMEs (e.g. MoneyPrinterTurbo-Plus) place the product purpose
 * sentence inside a centered header div. Still skipped: fenced code,
 * multi-line tags, pure-tag lines, badge/image/link-only lines (language
 * switchers), markdown AND HTML headings (`# …` and `<h1>`–`<h6>` — a
 * heading is not purpose prose), thematic breaks, and list items. A
 * candidate paragraph ending with a colon is a list lead-in, not a purpose
 * statement, and scanning continues. The first paragraph with enough real
 * prose wins, clipped to PURPOSE_MAX_CHARS at a sentence boundary.
 */
export function extractPurpose(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let inTag = false;
  let paragraph: string[] = [];

  const flush = (): string | null => {
    if (paragraph.length === 0) return null;
    const candidate = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph = [];
    if (!isMeaningfulProse(candidate) || isListLeadIn(candidate)) return null;
    return clipSentence(candidate);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^(```|~~~)/.test(line)) {
      const done = flush();
      if (done !== null) return done;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (inTag) {
      if (line.includes(">")) inTag = false;
      continue;
    }
    // Multi-line HTML tag opener (e.g. an <img split across lines): skip
    // until the tag closes.
    if (line.startsWith("<") && !line.includes(">")) {
      const done = flush();
      if (done !== null) return done;
      inTag = true;
      continue;
    }

    if (line === "") {
      const done = flush();
      if (done !== null) return done;
      continue;
    }
    if (
      line.startsWith("#") ||
      HTML_HEADING_RE.test(line) ||
      /^(-{3,}|\*{3,}|_{3,})$/.test(line) ||
      isBadgeOrLinkOnlyLine(line) ||
      /^([-*+]|\d+[.)])\s/.test(line)
    ) {
      const done = flush();
      if (done !== null) return done;
      continue;
    }

    // Traverse containers: strip inline tags, keep the text content.
    const text = stripHtmlTags(line.replace(/^>\s?/, "")).replace(/\s+/g, " ").trim();
    if (text === "") {
      const done = flush();
      if (done !== null) return done;
      continue;
    }
    paragraph.push(text);
  }
  return flush();
}

/** `<h1>`–`<h6>` open tags (not `<header>`); headings are not purpose prose. */
const HTML_HEADING_RE = /<h[1-6](\s|>)/i;

/**
 * Product name from the README's first H1 (markdown `# ` or single-line
 * `<h1>`), tags stripped, links reduced to their text, and edge
 * decorations (emoji, badge punctuation) removed. Null when no usable H1
 * exists; capped at 80 chars. Skips fenced code so a `# comment` inside a
 * shell example is never mistaken for the title.
 */
export function extractReadmeTitle(markdown: string): string | null {
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const md = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    const html = md === null ? /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i.exec(line) : null;
    const raw = md?.[1] ?? html?.[1];
    if (raw === undefined) continue;
    const text = stripHtmlTags(raw)
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, "")
      .trim();
    if (text === "") continue;
    return text.slice(0, 80);
  }
  return null;
}

/** Removes every HTML tag, keeping only the text content. */
function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

/**
 * A paragraph that ends with a colon (after markdown stripping) introduces a
 * list — it is a lead-in, not a statement of what the product does.
 */
function isListLeadIn(text: string): boolean {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
  return plain.endsWith(":") || plain.endsWith("：");
}

/** Badge lines, images, and language switchers carry no prose: only links/tags/separators. */
function isBadgeOrLinkOnlyLine(line: string): boolean {
  const residual = line
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // linked badges: [![alt](img)](href)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, "") // plain images / links
    .replace(/<[^>]*>/g, "")
    .replace(/[\s|·•\-–—/\\,;]/g, "");
  return residual === "";
}

function isMeaningfulProse(text: string): boolean {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
  if (plain.length < PURPOSE_MIN_CHARS) return false;
  return /[a-zA-ZÀ-ÿ一-鿿぀-ヿ가-힯]/.test(plain);
}

/** Clips at the last sentence boundary inside the cap; word boundary + ellipsis as fallback. */
export function clipSentence(text: string, maxChars: number = PURPOSE_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars + 1);
  let clipEnd = -1;
  for (const match of window.matchAll(/[.!?。！？]+["'”’)]?(?=\s|$)/g)) {
    const end = match.index! + match[0].length;
    if (end <= maxChars) clipEnd = end;
  }
  if (clipEnd >= PURPOSE_MIN_CHARS) return text.slice(0, clipEnd).trimEnd();
  const hard = text.slice(0, maxChars);
  const lastSpace = hard.lastIndexOf(" ");
  return `${(lastSpace > PURPOSE_MIN_CHARS ? hard.slice(0, lastSpace) : hard).trimEnd()}…`;
}

/** Heading text of the README section documenting the fastest local path, if any. */
export function findFastPathSection(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match && FAST_PATH_HEADING_RE.test(match[1]!)) return match[1]!;
  }
  return null;
}

/**
 * Ordered entry-point hints from well-known root files (presence only):
 * main.py, manage.py, package.json bin|main, Dockerfile*, pyproject.toml,
 * go.mod, Cargo.toml.
 */
async function detectSurfaces(root: string): Promise<string[]> {
  const rootNames = await readdirNames(root);
  const names = new Set(rootNames.map((name) => name.toLowerCase()));
  const surfaces: string[] = [];

  if (names.has("main.py")) surfaces.push("Python entry point: `main.py`");
  if (names.has("manage.py")) surfaces.push("Django management entry point: `manage.py`");

  if (names.has("package.json")) {
    try {
      const raw = await nodeFs.readFile(nodePath.join(root, "package.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") {
        const bin = (parsed as Record<string, unknown>)["bin"];
        const main = (parsed as Record<string, unknown>)["main"];
        const hasBin =
          (typeof bin === "string" && bin.trim() !== "") ||
          (bin !== null && typeof bin === "object" && Object.keys(bin as object).length > 0);
        if (hasBin) {
          surfaces.push("Node.js CLI entry point declared in `package.json` (`bin`)");
        } else if (typeof main === "string" && main.trim() !== "") {
          surfaces.push("Node.js package entry point declared in `package.json` (`main`)");
        }
      }
    } catch {
      // An unreadable/malformed package.json yields no surface hint.
    }
  }

  const dockerfiles = rootNames
    .filter((name) => /^dockerfile($|[.-])/i.test(name))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (dockerfiles.length > 0) {
    surfaces.push(`Container build file: \`${dockerfiles[0]}\``);
  }

  if (names.has("pyproject.toml")) surfaces.push("Python project metadata: `pyproject.toml`");
  if (names.has("go.mod")) surfaces.push("Go module definition: `go.mod`");
  if (names.has("cargo.toml")) surfaces.push("Rust crate manifest: `Cargo.toml`");

  return surfaces;
}
