/**
 * frontmatter — parser de YAML subset usado nos arquivos da wiki.
 *
 * Por que subset próprio e não `yaml` lib: nosso uso é limitado e o subset
 * é simples (chaves top-level, listas de strings, comentários). Manter parser
 * próprio evita dep extra e dá controle total do erro.
 *
 * Formato suportado:
 *
 *   ---
 *   title: Auth — login e sessão          # string
 *   owner: generated                     # string
 *   anchors:                             # lista de strings
 *     - src/auth/login.ts
 *     - src/auth/login.ts#validateToken
 *   updated: 2026-07-08                  # string (não interpretamos data)
 *   ---
 *   body markdown aqui...
 *
 * Limitações intencionais (não implementamos YAML completo):
 *   - Sem listas aninhadas, mapas aninhados, strings multi-linha (| >)
 *   - Sem booleans/null tipados (são strings: "true"/"false"/"null")
 *   - Sem âncoras/aliases `&foo` / `*foo`
 *   - Sem escape `\"` em strings
 *
 * Se a wiki precisar de features mais ricas no futuro, trocamos por `yaml` lib.
 * Por enquanto (Fase 2), os campos do SPEC §"Frontmatter das páginas de doc"
 * cabem no subset.
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
  /** Mapa de campos. Ausente se a página não tem frontmatter. */
  frontmatter: Frontmatter | null;
  /** Conteúdo após o `---` de fechamento (markdown body). */
  body: string;
  /** Byte offset onde o body começa no source original. */
  bodyOffset: number;
}

/**
 * Parseia frontmatter + body. Retorna `frontmatter: null` se a página não
 * começa com `---` (não é erro — páginas sem frontmatter são permitidas).
 */
export function parseFrontmatter(source: string): ParseResult {
  // Normaliza line endings pra simplificar parsing
  const normalized = source.replace(/\r\n/g, "\n");

  // Detecta abertura
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: null, body: source, bodyOffset: 0 };
  }

  // Procura fechamento
  const closeIdx = normalized.indexOf("\n---", 4);
  if (closeIdx === -1) {
    throw new FrontmatterParseError(
      "frontmatter aberto com --- mas sem fechamento --- antes do fim do arquivo",
      1,
    );
  }

  const yamlBlock = normalized.slice(4, closeIdx);
  const afterClose = closeIdx + 4; // pula "\n---"
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

    // Item de lista: "  - valor" (indent + dash + espaço)
    const listItemMatch = /^(\s*)-\s+(.*)$/.exec(line);
    if (listItemMatch) {
      const value = stripComment(listItemMatch[2] ?? "").trim();
      if (currentList === null) {
        throw new FrontmatterParseError(
          `item de lista sem chave anterior: ${line}`,
          lineNumber,
        );
      }
      currentList.push(value);
      continue;
    }

    // Chave: valor OU chave: (inicia lista)
    const kvMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kvMatch) {
      throw new FrontmatterParseError(`linha inválida: ${line}`, lineNumber);
    }
    const key = kvMatch[1] ?? "";
    const restRaw = stripComment(kvMatch[2] ?? "");

    if (restRaw === "") {
      // Início de lista (ou vazio intencional)
      currentListKey = key;
      currentList = [];
      out[key] = currentList;
    } else {
      // Valor string
      const value = restRaw.trim();
      out[key] = value;
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

/** Helper: lê anchors (sempre lista de strings). */
export function getAnchors(fm: Frontmatter | null): string[] {
  if (!fm) return [];
  const a = fm["anchors"];
  return Array.isArray(a) ? a : [];
}

/** Helper: lê owner (default: generated). */
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed" {
  if (!fm) return "generated";
  const o = fm["owner"];
  if (o === "human" || o === "mixed" || o === "generated") return o;
  return "generated";
}