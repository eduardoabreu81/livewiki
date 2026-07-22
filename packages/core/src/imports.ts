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
 *
 * Limitação: NÃO resolve imports dinâmicos (require() variável, import() com
 * expressão). Esses viram "unknown" no grafo. Aceitável pro MVP — LLM pode
 * inferir do contexto.
 */

import type { Tree } from "web-tree-sitter";
import { initParser, parseSource } from "./parser.js";

export type ImportKind = "ts-import" | "ts-export" | "py-import" | "py-from";

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