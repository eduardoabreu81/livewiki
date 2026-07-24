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
 *
 * Classes declaradas DENTRO do corpo de uma função/método (ex.: um mock
 * `class FakeThing:` local a um teste) também são puladas — são detalhe de
 * implementação local, não um símbolo de módulo citável. O nome de uma
 * classe local costuma se repetir entre métodos irmãos (um Fake* por
 * variante testada); extraí-las colidiria todas na mesma chave
 * `path#Nome`, descartando silenciosamente todas menos a primeira (ver
 * dedup em `extractSymbols`) enquanto a LLM, vendo o source bruto com
 * definições genuinamente repetidas, insiste em citar a chave compartilhada
 * em vários pontos — root cause confirmado de um `duplicate_anchor`
 * recorrente (2026-07-23).
 */

import type { Tree, Node } from "web-tree-sitter";
import { sha256, sha256Slice } from "./hashes.js";

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

interface ExtractedSymbol extends SymbolRecord {
  source_start_byte: number;
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
  const candidates: ExtractedSymbol[] = [];
  walkNode(tree.rootNode, source, relPath, null, candidates);

  const ordered = candidates
    .map((symbol, discoveryOrder) => ({ symbol, discoveryOrder }))
    .sort(
      (left, right) =>
        left.symbol.start_line - right.symbol.start_line ||
        left.symbol.source_start_byte - right.symbol.source_start_byte ||
        left.discoveryOrder - right.discoveryOrder,
    );
  const seenKeys = new Set<string>();
  const unique: SymbolRecord[] = [];

  for (const { symbol } of ordered) {
    if (seenKeys.has(symbol.key)) continue;
    seenKeys.add(symbol.key);
    unique.push(toSymbolRecord(symbol));
  }

  return unique;
}

function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: ExtractedSymbol[],
  insideFunctionBody = false,
): void {
  // Once we descend into a function/method body, any class definition found
  // among its descendants is a LOCAL implementation detail (e.g. a test
  // method's inline `class FakeCompletions:` mock), not a citable
  // module-level symbol. Skipping it matters because the same local class
  // name commonly repeats across sibling test methods (one Fake* mock per
  // provider branch); extracting all of them under the identical
  // `path#Name` key silently drops every occurrence but the first (see the
  // dedup in `extractSymbols`) while the LLM, reading the raw source, still
  // sees genuinely repeated definitions and keeps re-citing the shared key
  // at each one — a real duplicate_anchor failure confirmed via a paid E2E
  // run (2026-07-23) on MoneyPrinterTurbo-Plus's test/services/test_llm.py.
  const childInsideFunctionBody =
    node.type === "function_declaration" ||
    node.type === "generator_function_declaration" ||
    node.type === "method_definition" ||
    node.type === "function_definition"
      ? true
      : insideFunctionBody;

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
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        // Desce nos method_definition com parentClassName = name.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
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
        if (insideFunctionBody) return;
        const name = decl.childForFieldName("name")?.text;
        if (name) {
          out.push(makeRecord(node, source, relPath, name, "class"));
          // Desce nos methods (igual ao caso class_declaration sem export)
          for (let i = 0; i < decl.namedChildCount; i++) {
            const child = decl.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
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
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        // Desce nos 'block' da classe para encontrar métodos
        const block = node.childForFieldName("body");
        if (block) {
          for (let i = 0; i < block.namedChildCount; i++) {
            const child = block.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
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
          walkNode(child, source, relPath, parentClassName, out, insideFunctionBody);
        }
      }
      return;
    }
  }

  // Default: desce nos filhos (exceto quando já tratamos acima).
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkNode(child, source, relPath, parentClassName, out, childInsideFunctionBody);
  }
}

function makeRecord(
  node: Node,
  source: string,
  relPath: string,
  name: string,
  kind: SymbolKind,
): ExtractedSymbol {
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
    source_start_byte: startByte,
  };
}

function toSymbolRecord(symbol: ExtractedSymbol): SymbolRecord {
  return {
    key: symbol.key,
    name: symbol.name,
    kind: symbol.kind,
    signature: symbol.signature,
    start_line: symbol.start_line,
    end_line: symbol.end_line,
    content_hash: symbol.content_hash,
  };
}

// === Phase 3: raw call-site extraction (symbol call graph) ===

export interface CallRecord {
  /** Same key format as SymbolRecord.key — the enclosing function/method. */
  caller_key: string;
  /** Right-most identifier of the callee expression (`foo` in `a.b.foo()`). */
  callee_name: string;
  /** 1-based line of the call site. */
  line: number;
}

/**
 * Extracts raw call sites (`call_expression`/`new_expression` in TS/JS,
 * `call` in Python) found INSIDE a named function, method, or Python
 * function_definition. Calls at module top level (no enclosing named
 * symbol) are skipped — there is no caller key to attribute them to, and
 * top-level side-effect calls are rarely useful for a "who calls X" graph.
 *
 * This is intentionally the SAME "honest extraction" policy as
 * `extractSymbols`: only emit a `callee_name` this scan is confident about
 * (a plain identifier or a `.property`/`.attribute` access). Anything else
 * — computed member access (`obj[expr]()`), spread callees, IIFEs — is
 * skipped rather than guessed. Resolving `callee_name` to a real symbol
 * key is a SEPARATE pass (indexer.ts), since it needs cross-file import
 * data this module doesn't have.
 */
export function extractCalls(tree: Tree, relPath: string, source: string): CallRecord[] {
  const calls: CallRecord[] = [];
  walkForCalls(tree.rootNode, relPath, null, null, calls);
  return calls;
}

function walkForCalls(
  node: Node,
  relPath: string,
  parentClassName: string | null,
  callerKey: string | null,
  out: CallRecord[],
): void {
  let nextParentClassName = parentClassName;
  let nextCallerKey = callerKey;

  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration": {
      const name = node.childForFieldName("name")?.text;
      if (name) nextCallerKey = `${relPath}#${name}`;
      break;
    }
    case "method_definition": {
      const name = node.childForFieldName("name")?.text;
      if (name) {
        nextCallerKey = parentClassName
          ? `${relPath}#${parentClassName}.${name}`
          : `${relPath}#${name}`;
      }
      break;
    }
    case "function_definition": {
      // Python — qualifies as Class.method when nested under a class body.
      const name = node.childForFieldName("name")?.text;
      if (name) {
        nextCallerKey = parentClassName
          ? `${relPath}#${parentClassName}.${name}`
          : `${relPath}#${name}`;
      }
      break;
    }
    case "class_declaration":
    case "class":
    case "class_definition": {
      const name = node.childForFieldName("name")?.text;
      if (name) nextParentClassName = name;
      break;
    }
    case "call_expression":
    case "new_expression":
    case "call": {
      const calleeField = node.type === "new_expression" ? "constructor" : "function";
      const calleeName = extractCalleeName(node.childForFieldName(calleeField));
      if (calleeName && callerKey) {
        out.push({ caller_key: callerKey, callee_name: calleeName, line: node.startPosition.row + 1 });
      }
      break;
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkForCalls(child, relPath, nextParentClassName, nextCallerKey, out);
  }
}

/** Right-most confident identifier of a callee expression, or null if unclear. */
function extractCalleeName(node: Node | null): string | null {
  if (!node) return null;
  if (node.type === "identifier") return node.text;
  if (node.type === "member_expression") {
    return node.childForFieldName("property")?.text ?? null;
  }
  if (node.type === "attribute") {
    // Python
    return node.childForFieldName("attribute")?.text ?? null;
  }
  return null;
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

// === Etapa 2b: rationale extraction (intent evidence from comments/docstrings) ===

export type RationaleKind = "why" | "note" | "hack" | "todo" | "fixme" | "docstring";

export interface RationaleRecord {
  /** Full symbol key (path#name) the rationale attaches to, or null for file-level. */
  symbol_key: string | null;
  kind: RationaleKind;
  /** Normalized text (comment markers stripped, whitespace collapsed). */
  text: string;
  /** 1-based first line of the raw comment/docstring in the source file. */
  start_line: number;
  /** sha256 of the normalized text. */
  content_hash: string;
}

/** Tags that mark an intent-bearing comment (matched case-insensitively). */
const RATIONALE_TAG_RE = /^(why|note|hack|todo|fixme):/i;

/** Minimum normalized length for a docstring to be captured (shorter = noise). */
const MIN_DOCSTRING_CHARS = 20;

/** Generated-code header markers sniffed in the first lines of a file. */
const GENERATED_HEADER_MARKERS = [
  "do not edit",
  "@generated",
  "code generated",
  "auto-generated",
] as const;

/** How many leading lines the generated-file header sniff inspects. */
const GENERATED_HEADER_SNIFF_LINES = 8;

/**
 * Header sniff: a file whose first 8 lines carry a generated-code marker
 * (`DO NOT EDIT`, `@generated`, `Code generated`, `AUTO-GENERATED`,
 * `auto-generated`, case-insensitive) is auto-generated output. Rationale
 * extraction is skipped for the whole file — migration/protobuf revision
 * comments are noise, not intent evidence.
 */
export function isLikelyGenerated(content: string): boolean {
  const head = content.split("\n", GENERATED_HEADER_SNIFF_LINES);
  for (const line of head) {
    const lower = line.toLowerCase();
    for (const marker of GENERATED_HEADER_MARKERS) {
      if (lower.includes(marker)) return true;
    }
  }
  return false;
}

interface RawRationaleCandidate {
  /** 1-based inclusive line range of the raw comment/docstring node. */
  startLine: number;
  endLine: number;
  /** Raw node text (markers still present). */
  rawText: string;
  /** True only for Python first-statement strings (docstring branch). */
  pythonDocstring: boolean;
}

/**
 * Extracts intent-bearing comments and docstrings as symbol-adjacent
 * evidence. Two kinds only (SPEC §"Phase 1 — Indexer", rationale
 * extraction):
 *
 *   - Tagged comments: stripped text starts with WHY:/NOTE:/HACK:/TODO:/
 *     FIXME: (case-insensitive) — kind = lowercased tag.
 *   - Docstrings: Python first-statement strings of module/class/function
 *     bodies; TS/JS/TSX block comments opening with `/**`. Minimum 20
 *     normalized chars.
 *
 * Attribution is positional (comments are tree-sitter extras): a comment
 * whose line range falls inside a symbol's range attaches to the innermost
 * such symbol; a contiguous comment block ending immediately above the
 * declaration's first line (no blank lines) attaches to that symbol;
 * everything else is file-level (`symbol_key: null`).
 */
export function extractRationales(
  tree: Tree,
  relPath: string,
  source: string,
): RationaleRecord[] {
  const candidates: RawRationaleCandidate[] = [];
  collectRationaleCandidates(tree.rootNode, candidates);
  if (candidates.length === 0) return [];

  const symbols = extractSymbols(tree, relPath, source);
  const blocks = groupContiguousBlocks(candidates);
  const out: RationaleRecord[] = [];

  for (const candidate of candidates) {
    const normalized = normalizeRationaleText(candidate.rawText, candidate.pythonDocstring);
    if (normalized === "") continue;

    let kind: RationaleKind;
    if (candidate.pythonDocstring || isTsDocstringComment(candidate.rawText)) {
      if (normalized.length < MIN_DOCSTRING_CHARS) continue;
      kind = "docstring";
    } else {
      const tag = RATIONALE_TAG_RE.exec(normalized);
      if (!tag) continue;
      kind = tag[1]!.toLowerCase() as RationaleKind;
    }

    out.push({
      symbol_key: attributeRationale(candidate, blocks, symbols),
      kind,
      text: normalized,
      start_line: candidate.startLine,
      content_hash: sha256(normalized),
    });
  }

  return out;
}

/** Collects comment nodes and Python docstrings from the named-children stream. */
function collectRationaleCandidates(node: Node, out: RawRationaleCandidate[]): void {
  if (node.type === "comment") {
    out.push({
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      rawText: node.text,
      pythonDocstring: false,
    });
    return; // comments have no meaningful named children to descend into
  }

  // Python docstring branch: a string as the FIRST statement of a module,
  // class_definition, or function_definition body.
  if (node.type === "module" || node.type === "class_definition" || node.type === "function_definition") {
    const body = node.type === "module" ? node : node.childForFieldName("body");
    const first = body?.firstNamedChild;
    if (first && first.type === "expression_statement") {
      const stringNode = first.firstNamedChild;
      if (stringNode && stringNode.type === "string") {
        out.push({
          startLine: stringNode.startPosition.row + 1,
          endLine: stringNode.endPosition.row + 1,
          rawText: stringNode.text,
          pythonDocstring: true,
        });
      }
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectRationaleCandidates(child, out);
  }
}

/** True for a TS/JS/TSX block comment opening with `/**` (not plain `/*`). */
function isTsDocstringComment(rawText: string): boolean {
  return rawText.startsWith("/**");
}

/**
 * Normalizes comment/docstring text: strips comment markers and string
 * quotes, drops decorative leading `*` on block-comment lines, collapses
 * all whitespace to single spaces.
 */
function normalizeRationaleText(rawText: string, pythonDocstring: boolean): string {
  let text = rawText;
  if (pythonDocstring) {
    // Strip optional string prefix (r/b/f/u combos) and the quote pair.
    text = text.replace(/^[rubfRUBF]{0,3}("""|'''|"|')/, "");
    text = text.replace(/("""|'''|"|')$/, "");
  } else if (text.startsWith("//")) {
    text = text.slice(2);
  } else if (text.startsWith("#")) {
    text = text.slice(1);
  } else if (text.startsWith("/*")) {
    text = text.replace(/^\/\*\*?/, "").replace(/\*\/$/, "");
    text = text
      .split("\n")
      .map((line) => line.replace(/^\s*\*+ ?/, ""))
      .join("\n");
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Groups raw candidates into contiguous blocks: two comments belong to the
 * same block when the second starts on the line immediately after the first
 * ends (no blank line between). Candidates are already in document order
 * (the collector walks the tree in order).
 */
function groupContiguousBlocks(
  candidates: RawRationaleCandidate[],
): Map<RawRationaleCandidate, RawRationaleCandidate> {
  // Maps each candidate to the LAST candidate of its block (blocks are
  // maximal runs of adjacent candidates).
  const blockEnd = new Map<RawRationaleCandidate, RawRationaleCandidate>();
  let block: RawRationaleCandidate[] = [candidates[0]!];
  const flush = () => {
    const last = block[block.length - 1]!;
    for (const member of block) blockEnd.set(member, last);
  };
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const prev = block[block.length - 1]!;
    if (candidate.startLine === prev.endLine + 1) {
      block.push(candidate);
    } else {
      flush();
      block = [candidate];
    }
  }
  flush();
  return blockEnd;
}

/**
 * Positional attribution (pinned rule):
 *   1. Line range inside a symbol's range → innermost such symbol.
 *   2. Contiguous comment block whose last line is immediately above the
 *      declaration's first line (no blank lines) → that symbol.
 *   3. Otherwise file-level (null).
 */
function attributeRationale(
  candidate: RawRationaleCandidate,
  blockEnd: Map<RawRationaleCandidate, RawRationaleCandidate>,
  symbols: SymbolRecord[],
): string | null {
  // Rule 1: inside a symbol's line range. The innermost container wins
  // (largest start_line, then smallest end_line) so a method beats its class.
  let innermost: SymbolRecord | null = null;
  for (const symbol of symbols) {
    if (candidate.startLine >= symbol.start_line && candidate.endLine <= symbol.end_line) {
      if (
        innermost === null ||
        symbol.start_line > innermost.start_line ||
        (symbol.start_line === innermost.start_line && symbol.end_line < innermost.end_line)
      ) {
        innermost = symbol;
      }
    }
  }
  if (innermost !== null) return innermost.key;

  // Rule 2: the block this candidate belongs to ends immediately above the
  // declaration's first line. Note this also covers single-comment blocks.
  const lastOfBlock = blockEnd.get(candidate) ?? candidate;
  for (const symbol of symbols) {
    if (symbol.start_line === lastOfBlock.endLine + 1) return symbol.key;
  }

  return null;
}
