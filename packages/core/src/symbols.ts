/**
 * symbols — extracts SymbolRecords from the tree-sitter AST.
 *
 * SPEC §"Phase 1 — Indexer": "symbol extraction (functions, classes, methods,
 * exports)".
 *
 * Coverage by language:
 *   TypeScript / TSX / JavaScript:
 *     - function_declaration         → kind: "function"
 *     - generator_function_declaration → kind: "function"
 *     - class_declaration            → kind: "class"
 *     - method_definition            → kind: "method" (parent = class)
 *     - arrow_function (named)       → kind: "function" (assigned to a const)
 *     - export_statement             → kind: "export" (covers re-exports)
 *   Python:
 *     - function_definition          → kind: "function"
 *     - class_definition             → kind: "class"
 *     - decorated_definition         → kind: decorator wraps fn/class
 *   Go (roadmap item 19 — pilot tier-1 extension):
 *     - function_declaration         → kind: "function" (same node type as TS)
 *     - method_declaration           → kind: "method" (parent = receiver type,
 *                                      pointer receivers stripped: `*T` → `T`)
 *     - type_declaration/struct_type    → kind: "class"
 *     - type_declaration/interface_type → kind: "interface"
 *     - call_expression              → callee identifier (extracted) or
 *                                      selector_expression field (inferred)
 *   Rust (roadmap item 20 — replicates the Go pilot pattern):
 *     - function_item                → kind: "function"; inside an impl_item
 *                                      body → kind: "method" keyed
 *                                      `Type.name` (both `impl T` and
 *                                      `impl Trait for T` qualify under T —
 *                                      those members are callable on T)
 *     - struct_item                  → kind: "class"
 *     - enum_item                    → kind: "class" (least invasive; variants
 *                                      are not citable symbols)
 *     - trait_item                   → kind: "interface" (member signatures
 *                                      are NOT extracted — same policy as Go
 *                                      interfaces)
 *     - call_expression              → callee identifier (extracted),
 *                                      generic_function (extracted), or
 *                                      field_expression / scoped_identifier
 *                                      right-most name (inferred)
 *   Java (roadmap item 21 — replicates the same pattern):
 *     - class_declaration            → kind: "class" (handled by the shared
 *                                      TS case — same node type name)
 *     - interface_declaration        → kind: "interface"
 *     - enum_declaration             → kind: "class" (mirrors the Rust enum
 *                                      decision: a named data type; constants
 *                                      are not citable symbols)
 *     - record_declaration           → kind: "class" (a record IS a final
 *                                      data class in Java)
 *     - method_declaration           → kind: "method" keyed `Type.name`
 *                                      (parent = the innermost enclosing
 *                                      type; Go's receiver field is absent,
 *                                      so the enclosing-type qualifier wins).
 *                                      Interface member signatures ARE
 *                                      extracted (`Interface.name`) — a delta
 *                                      from the Go/Rust "no member
 *                                      signatures" policy, kept because Java
 *                                      interfaces carry default/static
 *                                      bodies and the members are the
 *                                      callable surface.
 *     - constructor_declaration      → kind: "method" keyed `Type.Type`
 *                                      (the name field IS the class name)
 *     - method_invocation            → bare `name()` (no object field) =
 *                                      extracted; any receiver form
 *                                      (`x.m()`, `Type.m()`, `a.b.m()`) =
 *                                      inferred
 *     - object_creation_expression   → `new X()` = extracted (same policy
 *                                      as TS new_expression), right-most
 *                                      type_identifier of the type field
 *     - annotation_type_declaration  → NOT extracted v1 (rare; no kind
 *                                      assigned)
 *
 * Symbol key (SPEC §"Frontmatter"):
 *   - top-level: `relative/path.ext#Name`
 *   - method:    `relative/path.ext#Class.method`
 *   - Python decorator: `relative/path.py#decorated_fn`
 *
 * The extraction is "honest" — we only emit what the code actually declares.
 * Anonymous functions (nameless arrow, IIFE) are skipped: SPEC §"Key concepts"
 * talks about "code symbols" and a symbol key must be referenceable. Anonymous
 * ones are not.
 *
 * Classes declared INSIDE the body of a function/method (e.g. a mock
 * `class FakeThing:` local to a test) are also skipped — they are a local
 * implementation detail, not a citable module symbol. A local class's name
 * often repeats among sibling methods (one Fake* per tested variant);
 * extracting them would collide all onto the same `path#Name` key, silently
 * discarding all but the first (see dedup in `extractSymbols`) while the LLM,
 * seeing the raw source with genuinely repeated definitions, insists on citing
 * the shared key at several points — a confirmed root cause of a recurring
 * `duplicate_anchor` (2026-07-23).
 */

import type { Tree, Node } from "web-tree-sitter";
import { sha256, sha256Slice } from "./hashes.js";

export type SymbolKind = "function" | "class" | "method" | "export" | "interface";

export interface SymbolRecord {
  /** Full key (path#name or path#parent.name). UNIQUE per file+path. */
  key: string;
  /** Short name (last segment). */
  name: string;
  kind: SymbolKind;
  /** Representative slice — header or first line — for use in anchors. */
  signature: string | null;
  start_line: number;
  end_line: number;
  content_hash: string;
}

interface ExtractedSymbol extends SymbolRecord, SymbolRange {}

/**
 * Byte range of the symbol's AST node in the source string the parser saw.
 * Not persisted — the DB stores only hashes (rule: never store source
 * text). Used by the indexer's per-symbol EOL realignment (roadmap item
 * 12) to re-slice the normalized file text.
 */
export interface SymbolRange {
  source_start_byte: number;
  source_end_byte: number;
}

/**
 * Extracts all symbols from a tree. `relPath` is the path relative to repoRoot
 * with forward slashes (already coming from the walker).
 */
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[] {
  return extractSymbolsWithRanges(tree, relPath, source).map(toSymbolRecord);
}

/**
 * Same extraction/dedup as `extractSymbols`, but each record keeps the AST
 * node's byte range in `source`. The indexer uses the range to re-slice
 * the normalized file text for the per-symbol EOL realignment (roadmap
 * item 12); the range is never persisted.
 */
export function extractSymbolsWithRanges(
  tree: Tree,
  relPath: string,
  source: string,
): Array<SymbolRecord & SymbolRange> {
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
  const unique: Array<SymbolRecord & SymbolRange> = [];

  for (const { symbol } of ordered) {
    if (seenKeys.has(symbol.key)) continue;
    seenKeys.add(symbol.key);
    unique.push(symbol);
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
    node.type === "method_declaration" ||
    node.type === "constructor_declaration" ||
    node.type === "function_item" ||
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
      // TS uses "class_declaration"; Python uses "class_definition" (handled below).
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        // Descends into method_definition with parentClassName = name.
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
        }
        return; // already descended manually
      }
      break;
    }

    case "method_definition": {
      const name = node.childForFieldName("name")?.text;
      if (name && parentClassName) {
        out.push(makeRecord(node, source, relPath, `${parentClassName}.${name}`, "method"));
      } else if (name) {
        // method outside a class (rare but possible) — emits without qualification
        out.push(makeRecord(node, source, relPath, name, "method"));
      }
      break;
    }

    case "export_statement": {
      // `export class Foo` / `export function bar` — emits ONE entry
      // (kind=class or function, NOT export). Avoids duplicating with the inner
      // class/function. For `export const`, emits the identifier (kind=export).
      const decl = node.firstNamedChild;
      if (decl && (decl.type === "function_declaration" || decl.type === "generator_function_declaration")) {
        const name = decl.childForFieldName("name")?.text;
        if (name) {
          out.push(makeRecord(node, source, relPath, name, "function"));
        }
        return; // do NOT descend — the inner function would emit a duplicate
      } else if (decl?.type === "class_declaration") {
        if (insideFunctionBody) return;
        const name = decl.childForFieldName("name")?.text;
        if (name) {
          out.push(makeRecord(node, source, relPath, name, "class"));
          // Descends into methods (same as the class_declaration case without export)
          for (let i = 0; i < decl.namedChildCount; i++) {
            const child = decl.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
          }
          return; // already descended manually
        }
        return;
      } else if (decl?.type === "lexical_declaration" || decl?.type === "variable_statement") {
        // export const foo = ... — emits the identifier
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
      // Python. If inside a class_definition, qualifies as `Class.method`.
      // Otherwise it is top-level.
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
        // Descends into the class 'block' to find methods
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
      // Python — @decorator on function or class. Takes the inner child.
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && (child.type === "function_definition" || child.type === "class_definition")) {
          walkNode(child, source, relPath, parentClassName, out, insideFunctionBody);
        }
      }
      return;
    }

    case "method_declaration": {
      // Go — `func (r ReceiverType) Name(...)`. The receiver parameter_list
      // holds exactly one parameter_declaration whose type child names the
      // receiver type (`pointer_type` wraps `*T` — strip to `T`). The key
      // mirrors the TS `Class.method` convention: `path#Type.Name`.
      // Java — `Type name(...)` inside a type body has NO receiver field;
      // the innermost enclosing type (parentClassName) qualifies the key.
      const name = node.childForFieldName("name")?.text;
      const qualifier =
        goReceiverTypeName(node.childForFieldName("receiver")) ?? parentClassName;
      if (name && qualifier) {
        out.push(makeRecord(node, source, relPath, `${qualifier}.${name}`, "method"));
      } else if (name) {
        // No qualifier (receiver unreadable on a Go parse; a Java method
        // outside any type — shouldn't happen on valid Java) — emit
        // unqualified, same policy as TS method outside a class.
        out.push(makeRecord(node, source, relPath, name, "method"));
      }
      break;
    }

    case "constructor_declaration": {
      // Java — `ClassName(...)`. The name field IS the class name, so the
      // key is `Type.Type` under the innermost enclosing type.
      const name = node.childForFieldName("name")?.text;
      if (name) {
        const qualified = parentClassName ? `${parentClassName}.${name}` : name;
        out.push(makeRecord(node, source, relPath, qualified, "method"));
      }
      break;
    }

    case "interface_declaration": {
      // Java — kind "interface" (same decision as Go interfaces and Rust
      // traits). Member method declarations ARE extracted (delta from the
      // Go/Rust no-signatures policy — see the module docblock). Nested
      // types inside the interface body key under the interface name.
      // Java-ONLY: TypeScript names its interfaces `interface_declaration`
      // too, and TS interfaces were never extracted before item 21 —
      // changing that is out of scope here.
      if (!relPath.endsWith(".java")) break;
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "interface"));
        const body = node.childForFieldName("body");
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
          }
        }
        return; // already descended manually
      }
      break;
    }

    case "enum_declaration":
    case "record_declaration": {
      // Java — both map to "class" (mirrors the Rust enum decision: named
      // data types; class diagrams only match "class"). Enum constants and
      // record components are not citable symbols, but member methods (enum
      // body declarations / record body) key under the type name.
      // Java-ONLY: TypeScript also has `enum_declaration`, and TS enums
      // were never extracted before item 21 — out of scope here.
      if (!relPath.endsWith(".java")) break;
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) {
        out.push(makeRecord(node, source, relPath, name, "class"));
        const body = node.childForFieldName("body");
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i);
            if (child) walkNode(child, source, relPath, name, out, insideFunctionBody);
          }
        }
        return; // already descended manually
      }
      break;
    }

    case "type_declaration": {
      // Go — `type Name struct {...}` / `type Name interface {...}` / grouped
      // `type ( ... )`. Struct is the class analog (kind "class"); interface
      // gets kind "interface" (additive — class diagrams only match "class").
      // Local type declarations inside a function body are implementation
      // details, same skip policy as local classes.
      if (insideFunctionBody) return;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child?.type !== "type_spec" && child?.type !== "type_alias") continue;
        const name = child.childForFieldName("name")?.text;
        const typeNode = child.childForFieldName("type");
        if (!name || !typeNode) continue;
        const kind: SymbolKind | null =
          typeNode.type === "struct_type"
            ? "class"
            : typeNode.type === "interface_type"
              ? "interface"
              : null;
        if (kind === null) continue; // type aliases to non-struct/iface: not a citable construct
        // Record spans the whole type_declaration for a single spec; for a
        // grouped declaration the spec node keeps keys/lines honest.
        const recordNode = node.namedChildCount === 1 ? node : child;
        out.push(makeRecord(recordNode, source, relPath, name, kind));
      }
      break;
    }

    case "function_item": {
      // Rust — top-level `fn name(...)` is a function; inside an impl block
      // (parentClassName set by the impl_item case) it is an associated
      // function / method keyed `Type.name`, mirroring the Go receiver
      // convention. A nested `fn` inside a function body keeps the plain key
      // (same policy as nested TS function declarations).
      const name = node.childForFieldName("name")?.text;
      if (name) {
        const qualified = parentClassName ? `${parentClassName}.${name}` : name;
        const kind: SymbolKind = parentClassName ? "method" : "function";
        out.push(makeRecord(node, source, relPath, qualified, kind));
      }
      break;
    }

    case "impl_item": {
      // Rust — `impl T { ... }` and `impl Trait for T { ... }` both qualify
      // their members under T (the `type` field; the `trait` field only names
      // the implemented trait — those members are callable on T, so they
      // share the key space). Descends into the declaration_list with
      // parentClassName = T. impl blocks inside a function body are local
      // implementation details, same skip policy as local classes.
      if (insideFunctionBody) return;
      const typeName = rustImplTypeName(node.childForFieldName("type"));
      const body = node.childForFieldName("body");
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const child = body.namedChild(i);
          if (child) walkNode(child, source, relPath, typeName, out, insideFunctionBody);
        }
      }
      return; // already descended manually
    }

    case "struct_item":
    case "enum_item": {
      // Rust — struct is the class analog; enum gets "class" too (least
      // invasive — it is a named data type, and class diagrams only match
      // "class"). Fields/variants are not citable symbols, so no descent.
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) out.push(makeRecord(node, source, relPath, name, "class"));
      return;
    }

    case "trait_item": {
      // Rust — trait gets kind "interface" (same decision as Go interfaces).
      // Member signatures (function_signature_item) and default bodies are
      // NOT extracted — the trait itself is the citable symbol.
      if (insideFunctionBody) return;
      const name = node.childForFieldName("name")?.text;
      if (name) out.push(makeRecord(node, source, relPath, name, "interface"));
      return;
    }
  }

  // Default: descend into the children (except where we already handled them above).
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
  const startLine = node.startPosition.row + 1; // tree-sitter is 0-based
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
    source_end_byte: endByte,
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

/**
 * Go receiver type name for a `method_declaration`'s receiver parameter_list.
 * The receiver list holds exactly one parameter_declaration; its type is a
 * `type_identifier` (value receiver) or a `pointer_type` wrapping one
 * (pointer receiver — the `*` is stripped so `*T` and `T` share the key
 * prefix, matching the TS `Class.method` convention). Returns null when the
 * shape is unexpected (generic receiver with type parameters keeps the base
 * type identifier — `type_identifier` is still the first named child of the
 * type node family we handle).
 */
function goReceiverTypeName(receiver: Node | null): string | null {
  if (!receiver || receiver.type !== "parameter_list") return null;
  const decl = receiver.firstNamedChild;
  if (!decl || decl.type !== "parameter_declaration") return null;
  const typeNode = decl.childForFieldName("type") ?? decl.firstNamedChild;
  if (!typeNode) return null;
  if (typeNode.type === "type_identifier") return typeNode.text;
  if (typeNode.type === "pointer_type") {
    const inner = typeNode.firstNamedChild;
    if (inner?.type === "type_identifier") return inner.text;
    // generic instantiation inside the pointer, e.g. *List[T] — use its base
    const base = inner?.childForFieldName("type") ?? inner?.firstNamedChild;
    if (base?.type === "type_identifier") return base.text;
  }
  if (typeNode.type === "generic_type") {
    const base = typeNode.childForFieldName("type") ?? typeNode.firstNamedChild;
    if (base?.type === "type_identifier") return base.text;
  }
  return null;
}

/**
 * Rust impl-block receiver type name for qualifying member keys. The
 * impl_item `type` field is a `type_identifier` (`impl Server`), a
 * `generic_type` (`impl<T> Vec<T>` — the base type_identifier wins, so
 * `Vec<T>` and `Vec<U>` impl blocks share the `Vec.` key prefix), or a
 * `scoped_type_identifier` (`impl a::B` — the right-most name). Returns
 * null when the shape is unexpected (e.g. `impl Trait for dyn X`); members
 * then fall back to unqualified keys, same policy as TS methods outside a
 * class.
 */
function rustImplTypeName(typeNode: Node | null): string | null {
  if (!typeNode) return null;
  if (typeNode.type === "type_identifier") return typeNode.text;
  if (typeNode.type === "generic_type") {
    const base = typeNode.childForFieldName("type") ?? typeNode.firstNamedChild;
    if (base?.type === "type_identifier") return base.text;
  }
  if (typeNode.type === "scoped_type_identifier") {
    return typeNode.childForFieldName("name")?.text ?? null;
  }
  return null;
}

/**
 * Java `object_creation_expression` type → the created class name: the
 * right-most type_identifier (`new Server()` → Server; `new a.b.C()` → C;
 * `new ArrayList<String>()` → ArrayList — the generic_type's FIRST named
 * child is the base type, so type arguments are never descended into).
 * Returns null for shapes without a class name (anonymous bodies keep the
 * same type field, so they still resolve).
 */
function javaCreationTypeName(typeNode: Node | null): string | null {
  if (!typeNode) return null;
  if (typeNode.type === "type_identifier") return typeNode.text;
  if (typeNode.type === "scoped_type_identifier") {
    return javaCreationTypeName(typeNode.lastNamedChild);
  }
  if (typeNode.type === "generic_type") {
    return javaCreationTypeName(typeNode.firstNamedChild);
  }
  return null;
}

// === Phase 3: raw call-site extraction (symbol call graph) ===

/**
 * Confidence tag for a call edge (roadmap item 8, Graphify-style):
 *   - "extracted": the callee is a bare identifier or a `new X()` constructor
 *     call — the name the parser saw IS the symbol being invoked.
 *   - "inferred": the callee is the right-most identifier of a member/attribute
 *     access (`obj.method()`, `self.attr()`) — the receiver is unknown, so the
 *     name alone is a guess at which `method` symbol is meant.
 * The tag is final: resolution (call-resolution.ts) never changes it — a
 * bare-identifier callee that resolves repo-uniquely stays `extracted`.
 */
export type CallConfidence = "extracted" | "inferred";

export interface CallRecord {
  /** Same key format as SymbolRecord.key — the enclosing function/method. */
  caller_key: string;
  /** Right-most identifier of the callee expression (`foo` in `a.b.foo()`). */
  callee_name: string;
  /** 1-based line of the call site. */
  line: number;
  /** Extraction confidence — see CallConfidence. */
  confidence: CallConfidence;
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
 * skipped rather than guessed. Each emitted row carries a `confidence` tag
 * (see `CallConfidence`) so consumers can tell bare-name edges apart from
 * member-access name guesses. Resolving `callee_name` to a real symbol
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
    case "method_declaration": {
      // Go — qualifies as ReceiverType.method (pointer receivers stripped),
      // same key shape as the symbol extractor.
      // Java — no receiver field; the innermost enclosing type qualifies.
      const name = node.childForFieldName("name")?.text;
      const qualifier =
        goReceiverTypeName(node.childForFieldName("receiver")) ?? parentClassName;
      if (name) {
        nextCallerKey = qualifier
          ? `${relPath}#${qualifier}.${name}`
          : `${relPath}#${name}`;
      }
      break;
    }
    case "constructor_declaration": {
      // Java — caller key `Type.Type`, same key shape as the symbol extractor.
      const name = node.childForFieldName("name")?.text;
      if (name) {
        nextCallerKey = parentClassName
          ? `${relPath}#${parentClassName}.${name}`
          : `${relPath}#${name}`;
      }
      break;
    }
    case "method_invocation": {
      // Java — the callee is the `name` identifier; the `object` field is
      // present only for receiver forms. Bare `name()` is "extracted" (the
      // name IS the callee); `x.m()` / `Type.m()` / `a.b.m()` / `this.m()`
      // are "inferred" (the receiver is unknown here).
      const name = node.childForFieldName("name")?.text;
      if (name && callerKey) {
        out.push({
          caller_key: callerKey,
          callee_name: name,
          line: node.startPosition.row + 1,
          confidence: node.childForFieldName("object") ? "inferred" : "extracted",
        });
      }
      break;
    }
    case "object_creation_expression": {
      // Java — `new X(...)` is explicit about the symbol it targets, even
      // with a scoped or generic type (`new java.util.ArrayList<String>()`)
      // — always "extracted" (same policy as TS new_expression). The callee
      // name is the right-most type_identifier of the type field.
      const name = javaCreationTypeName(node.childForFieldName("type"));
      if (name && callerKey) {
        out.push({
          caller_key: callerKey,
          callee_name: name,
          line: node.startPosition.row + 1,
          confidence: "extracted",
        });
      }
      break;
    }
    case "function_item": {
      // Rust — qualifies as Type.method when nested under an impl block,
      // same key shape as the symbol extractor.
      const name = node.childForFieldName("name")?.text;
      if (name) {
        nextCallerKey = parentClassName
          ? `${relPath}#${parentClassName}.${name}`
          : `${relPath}#${name}`;
      }
      break;
    }
    case "impl_item": {
      // Rust — both `impl T` and `impl Trait for T` qualify members under T.
      const typeName = rustImplTypeName(node.childForFieldName("type"));
      if (typeName) nextParentClassName = typeName;
      break;
    }
    case "class_declaration":
    case "class":
    case "class_definition":
    case "interface_declaration":
    case "enum_declaration":
    case "record_declaration": {
      // The last three are Java types — members key under the type name.
      const name = node.childForFieldName("name")?.text;
      if (name) nextParentClassName = name;
      break;
    }
    case "call_expression":
    case "new_expression":
    case "call": {
      const calleeField = node.type === "new_expression" ? "constructor" : "function";
      const callee = extractCalleeName(node.childForFieldName(calleeField));
      if (callee && callerKey) {
        // A `new X()` constructor invocation is explicit about the symbol it
        // targets even when the callee is a member path — always "extracted".
        const confidence: CallConfidence =
          node.type === "new_expression" ? "extracted" : callee.confidence;
        out.push({
          caller_key: callerKey,
          callee_name: callee.name,
          line: node.startPosition.row + 1,
          confidence,
        });
      }
      break;
    }
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) walkForCalls(child, relPath, nextParentClassName, nextCallerKey, out);
  }
}

/**
 * Right-most confident identifier of a callee expression plus its extraction
 * confidence, or null if unclear. A bare identifier is "extracted" (the name
 * IS the callee); a member/attribute access is "inferred" (the receiver is
 * unknown, so the right-most identifier is only a name guess).
 */
function extractCalleeName(node: Node | null): { name: string; confidence: CallConfidence } | null {
  if (!node) return null;
  if (node.type === "identifier") return { name: node.text, confidence: "extracted" };
  if (node.type === "member_expression") {
    const name = node.childForFieldName("property")?.text;
    return name ? { name, confidence: "inferred" } : null;
  }
  if (node.type === "attribute") {
    // Python
    const name = node.childForFieldName("attribute")?.text;
    return name ? { name, confidence: "inferred" } : null;
  }
  if (node.type === "selector_expression") {
    // Go — `pkg.Func()` / `x.Method()`: the right-most field_identifier is
    // the callee name; the operand (package or receiver) is unknown here.
    const name = node.childForFieldName("field")?.text;
    return name ? { name, confidence: "inferred" } : null;
  }
  if (node.type === "field_expression") {
    // Rust — `x.m()`: the right-most field_identifier is the callee name;
    // the receiver value is unknown here.
    const name = node.childForFieldName("field")?.text;
    return name ? { name, confidence: "inferred" } : null;
  }
  if (node.type === "scoped_identifier") {
    // Rust — `path::f()` / `Type::assoc()`: the right-most `name` identifier
    // is the callee; the path segments are unknown here.
    const name = node.childForFieldName("name")?.text;
    return name ? { name, confidence: "inferred" } : null;
  }
  if (node.type === "generic_function") {
    // Rust — `foo::<T>()`: a bare generic call keeps the underlying
    // identifier's confidence (extracted for a bare name).
    return extractCalleeName(node.childForFieldName("function"));
  }
  return null;
}

function signatureFor(node: Node, source: string): string | null {
  // Takes the first non-empty line of the node — useful for Phase 2 anchors.
  const startByte = node.startIndex;
  const endByte = Math.min(node.endIndex, startByte + 200);
  const slice = source.slice(startByte, endByte);
  const firstLine = slice.split("\n", 1)[0]?.trim();
  if (!firstLine) return null;
  // Caps the length so it doesn't blow up the database
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}

// === Step 2b: rationale extraction (intent evidence from comments/docstrings) ===

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
 *     bodies; TS/JS/TSX block comments opening with `/**`; Rust doc comments
 *     (`///` outer, `//!` inner line comments, `/**` blocks); Java Javadoc
 *     (`/**` block comments — same detection as TS). Minimum 20
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
    if (
      candidate.pythonDocstring ||
      isTsDocstringComment(candidate.rawText) ||
      isRustDocComment(candidate.rawText)
    ) {
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
  // "comment" covers TS/JS/TSX/Go/Python; Rust and Java name them
  // line_comment / block_comment (Rust doc comments `///` and `//!` are
  // line_comment nodes; Java Javadoc is a block_comment).
  if (node.type === "comment" || node.type === "line_comment" || node.type === "block_comment") {
    const startLine = node.startPosition.row + 1;
    out.push({
      startLine,
      // Rust line_comment nodes INCLUDE the trailing newline, which shifts
      // endPosition to the next row — a line comment logically spans ONE
      // line, so clamp the end line or positional attribution breaks.
      endLine: node.type === "line_comment" ? startLine : node.endPosition.row + 1,
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
 * True for a Rust doc line comment: `///` outer (but NOT `////`, which is a
 * plain comment by convention) or `//!` inner. Rust `/**` blocks are already
 * covered by `isTsDocstringComment`.
 */
function isRustDocComment(rawText: string): boolean {
  if (rawText.startsWith("///")) return !rawText.startsWith("////");
  return rawText.startsWith("//!");
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
  } else if (text.startsWith("///") || text.startsWith("//!")) {
    // Rust doc line comments — strip the three-char marker.
    text = text.slice(3);
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
