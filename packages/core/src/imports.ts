/**
 * imports — extrai imports de um arquivo via tree-sitter.
 *
 * SPEC §"Pipeline batch (etapa 2)": "agrupamento por diretório + grafo de
 * imports (heurística determinística; LLM pode refinar nomes/limites dos
 * módulos — 1 chamada)".
 *
 * Saída: Set<string> com as strings literais dos imports (path como aparece
 * no source). Resolução de path (./foo → src/auth/foo.ts) acontece depois,
 * em modules.ts, quando temos o mapa de arquivos.
 *
 * Cobertura:
 *   - TypeScript/JavaScript: import_statement, export_statement (re-exports)
 *   - Python: import_statement, import_from_statement
 *   - Go (roadmap item 19): import_declaration → import_spec(s), both the
 *     single form (`import "fmt"`) and the grouped form (`import ( ... )`);
 *     the path is the spec's `interpreted_string_literal`, aliases and blank
 *     imports (`_`) share the same path field.
 *   - Rust (roadmap item 20): use_declaration → the imported path
 *     (`use std::fmt`, braces `use a::{b, c}` record the shared prefix `a`,
 *     aliases `use a::b as c` record `a::b`, wildcards `use a::b::*` record
 *     `a::b`); `mod foo;` declarations (no body) record the module name as
 *     kind rust-mod. Inline `mod foo { ... }` (with body) is not an import.
 *
 * Limitação: NÃO resolve imports dinâmicos (require() variável, import() com
 * expressão). Esses viram "unknown" no grafo. Aceitável pro MVP — LLM pode
 * inferir do contexto.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { Tree, Node } from "web-tree-sitter";
import { initParser, parseSource } from "./parser.js";

export type ImportKind =
  | "ts-import"
  | "ts-export"
  | "py-import"
  | "py-from"
  | "go-import"
  | "rust-use"
  | "rust-mod";

export interface ExtractedImport {
  /** String literal do source (ex: "./auth", "express", "../utils") */
  source: string;
  kind: ImportKind;
  /** Para py-from: lista de nomes importados ("bar", "*") */
  names?: string[];
}

/**
 * Extrai imports de um source. Sem I/O — só parse. Útil em testes que já
 * têm o tree. Pra chamada completa (file path), use `collectImports`.
 */
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[] {
  const out: ExtractedImport[] = [];
  const cursor = tree.walk();

  function visit(): void {
    const node = cursor.currentNode;
    switch (node.type) {
      case "import_statement": {
        // TS: `import x from "y"` (tem source field com string)
        // Python: `import os` ou `import os.path` (tem dotted_name children)
        const src = node.childForFieldName("source")?.text;
        if (src) {
          // TS: strip surrounding quotes
          const cleaned = src.replace(/^['"]|['"]$/g, "");
          out.push({ source: cleaned, kind: "ts-import" });
        } else {
          // Python: `import foo` — coleta dotted_names
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child?.type === "dotted_name") {
              out.push({ source: child.text, kind: "py-import" });
            }
          }
        }
        break;
      }
      case "export_statement": {
        // export { foo } from "./bar"; OR export * from "./bar";
        const src = node.childForFieldName("source")?.text;
        if (src) {
          const cleaned = src.replace(/^['"]|['"]$/g, "");
          out.push({ source: cleaned, kind: "ts-export" });
        }
        break;
      }
      case "import_from_statement": {
        // Python: from .foo import bar  OR  from foo import bar
        const moduleNameNode = node.childForFieldName("module_name");
        const moduleName = moduleNameNode?.text;
        if (moduleName) {
          // Extract names from the children. For an absolute dotted "from"
          // target (e.g. "app.services"), `module_name` itself is a
          // `dotted_name` node — the SAME node type this loop matches for
          // imported names — so it must be excluded by position, or it
          // shows up twice: once as `source`, once as a bogus first entry
          // in `names` (relative "from .foo import bar" targets use a
          // different node shape and are unaffected).
          const names: string[] = [];
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (
              child &&
              child.startIndex === moduleNameNode?.startIndex &&
              child.endIndex === moduleNameNode?.endIndex
            ) {
              continue;
            }
            if (child?.type === "dotted_name" || child?.type === "aliased_import") {
              names.push(child.text);
            }
          }
          out.push({ source: moduleName, kind: "py-from", names });
        }
        break;
      }
      case "import_declaration": {
        // Go: import "fmt"  OR  import ( "fmt"\n alias "x/y"\n _ "z" )
        // Every import_spec (direct child or under import_spec_list) carries
        // its path as an interpreted/raw string literal.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child?.type === "import_spec") {
            pushGoImportSpec(child, out);
          } else if (child?.type === "import_spec_list") {
            for (let j = 0; j < child.namedChildCount; j++) {
              const spec = child.namedChild(j);
              if (spec?.type === "import_spec") pushGoImportSpec(spec, out);
            }
          }
        }
        break;
      }
      case "use_declaration": {
        // Rust: use std::fmt;  /  use a::{b, c};  /  use a::b as c;  /
        // use a::b::*; — every shape records the module PATH (never the
        // imported item names or the alias).
        pushRustUsePath(node.childForFieldName("argument"), out);
        break;
      }
      case "mod_item": {
        // Rust: `mod foo;` (no body) declares an external module file;
        // `mod foo { ... }` (body field) is inline and not an import.
        if (!node.childForFieldName("body")) {
          const name = node.childForFieldName("name")?.text;
          if (name) out.push({ source: name, kind: "rust-mod" });
        }
        break;
      }
    }

    if (cursor.gotoFirstChild()) {
      do {
        visit();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }

  visit();
  return out;
}

/**
 * Go import_spec → ExtractedImport. The path field is an
 * `interpreted_string_literal` ("...") or `raw_string_literal` (`...`);
 * both are stripped of their delimiters. Aliased (`x "a/b"`), dot
 * (`. "a/b"`), and blank (`_ "a/b"`) specs share the same path field.
 */
function pushGoImportSpec(spec: Node, out: ExtractedImport[]): void {
  const pathNode = spec.childForFieldName("path");
  if (!pathNode) return;
  const cleaned = pathNode.text.replace(/^["`]|["`]$/g, "");
  if (cleaned.length === 0) return;
  out.push({ source: cleaned, kind: "go-import" });
}

/**
 * Rust use_declaration argument → ExtractedImport (kind rust-use). The
 * recorded source is always the module path:
 *   - scoped_identifier / identifier (`use std::fmt`) → the full path text;
 *   - scoped_use_list (`use a::{b, c}`) → the shared `path` prefix `a`;
 *   - use_as_clause (`use a::b as c`) → the `path` field `a::b` (alias
 *     dropped — resolution targets the module, not the local name);
 *   - use_wildcard (`use a::b::*`) → the path with the `::*` suffix stripped.
 */
function pushRustUsePath(argument: Node | null, out: ExtractedImport[]): void {
  if (!argument) return;
  let path: string | null = null;
  switch (argument.type) {
    case "identifier":
    case "scoped_identifier":
      path = argument.text;
      break;
    case "scoped_use_list":
    case "use_as_clause":
      path = argument.childForFieldName("path")?.text ?? null;
      break;
    case "use_wildcard":
      path = argument.text.replace(/::\*$/, "");
      break;
    default:
      return; // use_list without a prefix and exotic shapes: not a path
  }
  if (path === null || path.length === 0) return;
  out.push({ source: path, kind: "rust-use" });
}

/**
 * High-level: extrai imports de um arquivo dado path relativo + conteúdo.
 * Inicializa o parser uma vez (cached).
 */
export async function collectImports(
  relPath: string,
  content: string,
): Promise<ExtractedImport[]> {
  await initParser();
  const ext = relPath.split(".").pop() ?? "";
  let tree: Tree;
  try {
    tree = await parseSource("." + ext, content);
  } catch {
    return []; // arquivo não-parseável: retorna vazio (graceful degradation)
  }
  const lang = ext === "py" ? "python" : "ts";
  return extractImportsFromTree(tree, lang);
}

/**
 * Reads each repo-relative file from disk and extracts its imports, returning
 * the per-file map. Hoisted from the former private `collectAllImports` in
 * batch.ts so the status risk analysis (Etapa 2c) recomputes the SAME
 * on-demand map — imports are never persisted (plan option A). Unreadable
 * or unparseable files are skipped.
 */
export async function collectImportsForFiles(
  absRoot: string,
  filePaths: readonly string[],
): Promise<Map<string, ExtractedImport[]>> {
  const out = new Map<string, ExtractedImport[]>();
  for (const p of filePaths) {
    try {
      const content = await nodeFs.readFile(nodePath.join(absRoot, p), "utf8");
      out.set(p, await collectImports(p, content));
    } catch {
      // skip unparseable
    }
  }
  return out;
}