/**
 * frontmatter — subset YAML parser used in the wiki files.
 *
 * Why our own subset and not the `yaml` lib: our usage is limited and the
 * subset is simple (top-level keys, string lists, comments). Keeping our own
 * parser avoids an extra dep and gives full control of the error.
 *
 * Supported format:
 *
 *   ---
 *   title: Auth — login and session      # string
 *   owner: generated                     # string
 *   anchors:                             # list of strings
 *     - src/auth/login.ts
 *     - src/auth/login.ts#validateToken
 *   modules: [hooks, services, lib]      # inline list (flow-style, 1 level)
 *   updated: 2026-07-08                  # string (we do not interpret dates)
 *   ---
 *   body markdown here...
 *
 * Intentional limitations (we do not implement full YAML):
 *   - No nested lists, nested maps, multi-line strings (| >)
 *   - Inline lists are of simple strings (no quotes, no internal comma)
 *   - No typed booleans/null (they are strings: "true"/"false"/"null")
 *   - No anchors/aliases `&foo` / `*foo`
 *   - No `\"` escape in strings
 *
 * If the wiki needs richer features in the future, we swap in the `yaml` lib.
 * For now (Phase 2), the SPEC §"Doc page frontmatter" fields fit in the
 * subset.
 */

export type FrontmatterValue = string | string[];

export type Frontmatter = Record<string, FrontmatterValue>;

export class FrontmatterParseError extends Error {
  public readonly line: number;
  constructor(message: string, line: number) {
    super(`Frontmatter parse error (line ${line}): ${message}`);
    this.name = "FrontmatterParseError";
    this.line = line;
  }
}

export interface ParseResult {
  /** Field map. Absent if the page has no frontmatter. */
  frontmatter: Frontmatter | null;
  /** Content after the closing `---` (markdown body). */
  body: string;
  /** Byte offset where the body starts in the original source. */
  bodyOffset: number;
}

/**
 * Parses frontmatter + body. Returns `frontmatter: null` if the page does not
 * start with `---` (not an error — pages without frontmatter are allowed).
 */
export function parseFrontmatter(source: string): ParseResult {
  // Normalize line endings to simplify parsing
  const normalized = source.replace(/\r\n/g, "\n");

  // Detect the opening
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: null, body: source, bodyOffset: 0 };
  }

  // Look for the closing
  const closeIdx = normalized.indexOf("\n---", 4);
  if (closeIdx === -1) {
    throw new FrontmatterParseError(
      "frontmatter opened with --- but missing closing --- before end of file",
      1,
    );
  }

  const yamlBlock = normalized.slice(4, closeIdx);
  const afterClose = closeIdx + 4; // skips "\n---"
  const body = normalized.slice(afterClose).replace(/^\n/, "");

  const frontmatter = parseYamlBlock(yamlBlock);
  return { frontmatter, body, bodyOffset: afterClose + (normalized[afterClose] === "\n" ? 1 : 0) };
}

function parseYamlBlock(yaml: string): Frontmatter {
  const lines = yaml.split("\n");
  const out: Frontmatter = {};
  let currentListKey: string | null = null;
  let currentList: string[] | null = null;
  let lineNumber = 1;

  for (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.replace(/\s+$/, ""); // strip trailing whitespace
    if (line === "" || line.startsWith("#")) continue;

    // List item: "  - value" (indent + dash + space)
    const listItemMatch = /^(\s*)-\s+(.*)$/.exec(line);
    if (listItemMatch) {
      const value = stripComment(listItemMatch[2] ?? "").trim();
      if (currentList === null) {
        throw new FrontmatterParseError(
          `list item without preceding key: ${line}`,
          lineNumber,
        );
      }
      currentList.push(value);
      continue;
    }

    // Key: value OR key: (starts a list)
    const kvMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kvMatch) {
      throw new FrontmatterParseError(`invalid line: ${line}`, lineNumber);
    }
    const key = kvMatch[1] ?? "";
    const restRaw = stripComment(kvMatch[2] ?? "");

    if (restRaw === "") {
      // Start of a list (or intentionally empty)
      currentListKey = key;
      currentList = [];
      out[key] = currentList;
    } else {
      const value = restRaw.trim();
      // Inline flow-style list (`key: [a, b, c]`): single-level, unquoted
      // strings — same subset philosophy, and the form LLMs most often emit.
      if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        out[key] =
          inner === ""
            ? []
            : inner
                .split(",")
                .map((item) => item.trim())
                .filter((item) => item !== "");
      } else {
        // String value
        out[key] = value;
      }
      currentListKey = null;
      currentList = null;
    }
  }

  return out;
}

function stripComment(s: string): string {
  // Comment "# ..." outside of a string. Simplification: we do not
  // support `#` inside a string. If that is ever needed, use
  // explicit quoting.
  // YAML allows `#` to start a comment at the beginning of a
  // value (`anchors: # foo`) or preceded by whitespace
  // (`key: value # foo`). The anchor rewrite scope depends on
  // this form being recognized.
  const idx = s.search(/(^|\s)#/);
  return idx === -1 ? s : s.slice(0, idx);
}

/** Helper: reads anchors (always a list of strings). */
export function getAnchors(fm: Frontmatter | null): string[] {
  if (!fm) return [];
  const a = fm["anchors"];
  return Array.isArray(a) ? a : [];
}

/** Helper: reads owner (default: generated). */
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed" {
  if (!fm) return "generated";
  const o = fm["owner"];
  if (o === "human" || o === "mixed" || o === "generated") return o;
  return "generated";
}