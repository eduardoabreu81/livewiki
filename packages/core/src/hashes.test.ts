import { describe, it, expect } from "vitest";
import { sha256, sha256Slice, normalizeEol, expandEolToCrlf } from "./hashes.js";

describe("hashes", () => {
  it("sha256 de string é hex 64 chars determinístico", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // valor conhecido
    expect(h1).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("sha256 difere para entradas diferentes", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("sha256 aceita Uint8Array", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(sha256(bytes)).toBe(sha256("hello"));
  });

  it("sha256Slice só considera o slice, não o source todo", () => {
    const source = "prefix-foo-suffix";
    const h1 = sha256Slice(source, 7, 10); // "foo"
    const h2 = sha256("foo");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(sha256(source));
  });

  it("sha256Slice com slice vazio retorna hash do vazio", () => {
    expect(sha256Slice("anything", 5, 5)).toBe(sha256(""));
  });
});

describe("normalizeEol (roadmap item 12)", () => {
  it("CRLF vira LF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("LF puro é inalterado", () => {
    expect(normalizeEol("a\nb\n")).toBe("a\nb\n");
  });

  it("CR solitário é preservado (não é EOL de git)", () => {
    expect(normalizeEol("a\rb")).toBe("a\rb");
  });

  it("hash é igual para a versão LF e CRLF do mesmo source", () => {
    const lf = "export function foo() {\n  return 1;\n}\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(sha256(normalizeEol(crlf))).toBe(sha256(lf));
    expect(sha256(crlf)).not.toBe(sha256(lf)); // raw bytes diferem
  });
});

describe("expandEolToCrlf (roadmap item 12 follow-up)", () => {
  it("expande LF para CRLF", () => {
    expect(expandEolToCrlf("a\nb\n")).toBe("a\r\nb\r\n");
  });

  it("round-trip com normalizeEol para conteúdo LF-only", () => {
    const lf = "a\nb\n";
    expect(normalizeEol(expandEolToCrlf(lf))).toBe(lf);
  });

  it("hash da variante expandida reproduz o hash legado raw-CRLF", () => {
    const lf = "export function f() {\n  return 1;\n}\n";
    expect(sha256(expandEolToCrlf(lf))).toBe(
      sha256(lf.replace(/\n/g, "\r\n")),
    );
  });
});