/**
 * symbols — extrai SymbolRecords do tree-sitter AST.
 *
 * SPEC §"Fase 1 — Indexador": "extração de símbolos (funções, classes,
 * métodos, exports)".
 *
 * Cobertura por linguagem:
 *   TypeScript / TSX / JavaScript:
 *     - function_declaration         → kind: "function"
 *     - generator_function_declaration → kind: "function"
 *     - class_declaration            → kind: "class"
 *     - method_definition            → kind: "method" (parent = class)
 *     - arrow_function (com nome)    → kind: "function" (atribuída a const)
 *     - export_statement             → kind: "export" (cobre re-exports)
 *   Python:
 *     - function_definition          → kind: "function"
 *     - class_definition             → kind: "class"
 *     - decorated_definition         → kind: decorador envolve fn/classe
 *
 * Chave do símbolo (SPEC §"Frontmatter"):
 *   - top-level: `caminho/relativo.ext#Nome`
 *   - método:    `caminho/relativo.ext#Classe.metodo`
 *   - decorador Python: `caminho/relativo.py#decorated_fn`
 *
 * A extração é "honesta" — só emitimos o que o código realmente declara.
 * Funções anônimas (arrow sem nome, IIFE) são puladas: a SPEC §"Conceitos-
 * chave" fala em "símbolos do código" e chave de símbolo precisa ser
 * referenciável. Anônimas não são.
 */

import type { Tree, Node } from "web-tree-sitter";
import { sha256Slice } from "./hashes.js";

export type SymbolKind = "function" | "class" | "method" | "export";

export interface SymbolRecord {
  /** Chave completa (path#name ou path#parent.name). UNIQUE por arquivo+path. */
  key: string;
  /** Nome curto (último segmento). */
  name: string;
  kind: SymbolKind;
  /** Trecho representativo — header ou primeira linha — pra uso em âncoras. */
  signature: string | null;
  start_line: number;
  end_line: number;
  content_hash: string;
}

/**
 * Extrai todos os símbolos de uma árvore. `relPath` é o path relativo ao
 * repoRoot com forward slashes (já vindo do walker).
 */
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[] {
  const out: SymbolRecord[] = [];
  walkNode(tree.rootNode, source, relPath, null, out);
  return out;
}

function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: SymbolRecord[],
): void {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "function"));
      }
      break;
    }

    case "class_declaration":
    case "class": {
      // TS usa "class_declaration"; Python usa "class_definition" (tratado abaixo).
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        // Desce nos method_definition com parentClassName = name.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) walkNode(child, source, relPath, name, out);
        }
        return; // já descemos manualmente
      }
      break;
    }

    case "method_definition": {
      const name = node.childForFieldName("name")?.text;
      if (name && parentClassName) {
        out.push(makeRecord(node, source, relPath, `${parentClassName}.${name}`, "method"));
      } else if (name) {
        // método fora de classe (raro mas possível) — emite sem qualificação
        out.push(makeRecord(node, source, relPath, name, "method"));
      }
      break;
    }

    case "export_statement": {
      // `export class Foo` / `export function bar` — emite UMA entrada
      // (kind=class ou function, NÃO export). Evita duplicar com a class/function
      // interna. Para `export const`, emite o identificador (kind=export).
      const decl = node.firstNamedChild;
      if (decl && (decl.type === "function_declaration" || decl.type === "generator_function_declaration")) {
        const name = decl.childForFieldName("name")?.text;
        if (name) {
          out.push(makeRecord(node, source, relPath, name, "function"));
        }
        return; // NÃO descer — a function interna emitiria duplicado
      } else if (decl?.type === "class_declaration") {
        const name = decl.childForFieldName("name")?.text;
        if (name) {
          out.push(makeRecord(node, source, relPath, name, "class"));
          // Desce nos methods (igual ao caso class_declaration sem export)
          for (let i = 0; i < decl.namedChildCount; i++) {
            const child = decl.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out);
          }
          return; // já descemos manualmente
        }
        return;
      } else if (decl?.type === "lexical_declaration" || decl?.type === "variable_statement") {
        // export const foo = ... — emite o identificador
        for (let i = 0; i < decl.namedChildCount; i++) {
          const child = decl.namedChild(i);
          if (child?.type === "variable_declarator") {
            const id = child.childForFieldName("name");
            if (id) {
              out.push(makeRecord(node, source, relPath, id.text, "export"));
            }
          }
        }
      }
      break;
    }

    case "function_definition": {
      // Python. Se está dentro de class_definition, qualifica como
      // `Class.method`. Caso contrário é top-level.
      const name = node.childForFieldName("name")?.text;
      if (name) {
        const qualified = parentClassName ? `${parentClassName}.${name}` : name;
        const kind: SymbolKind = parentClassName ? "method" : "function";
        out.push(makeRecord(node, source, relPath, qualified, kind));
      }
      break;
    }

    case "class_definition": {
      // Python
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        // Desce nos 'block' da classe para encontrar métodos
        const block = node.childForFieldName("body");
        if (block) {
          for (let i = 0; i < block.namedChildCount; i++) {
            const child = block.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out);
          }
        }
        return;
      }
      break;
    }

    case "decorated_definition": {
      // Python — @decorator sobre function ou class. Pega o filho interno.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && (child.type === "function_definition" || child.type === "class_definition")) {
          walkNode(child, source, relPath, parentClassName, out);
        }
      }
      return;
    }
  }

  // Default: desce nos filhos (exceto quando já tratamos acima).
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkNode(child, source, relPath, parentClassName, out);
  }
}

function makeRecord(
  node: Node,
  source: string,
  relPath: string,
  name: string,
  kind: SymbolKind,
): SymbolRecord {
  const startLine = node.startPosition.row + 1; // tree-sitter é 0-based
  const endLine = node.endPosition.row + 1;
  const startByte = node.startIndex;
  const endByte = node.endIndex;
  const signature = signatureFor(node, source);
  return {
    key: `${relPath}#${name}`,
    name,
    kind,
    signature,
    start_line: startLine,
    end_line: endLine,
    content_hash: sha256Slice(source, startByte, endByte),
  };
}

function signatureFor(node: Node, source: string): string | null {
  // Pega a primeira linha não-vazia do nó — útil pra âncoras no Fase 2.
  const startByte = node.startIndex;
  const endByte = Math.min(node.endIndex, startByte + 200);
  const slice = source.slice(startByte, endByte);
  const firstLine = slice.split("\n", 1)[0]?.trim();
  if (!firstLine) return null;
  // Limita tamanho pra não estourar o banco
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}
