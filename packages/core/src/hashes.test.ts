import { describe, it, expect } from "vitest";
import { sha256, sha256Slice, normalizeEol, expandEolToCrlf } from "./hashes.js";

describe("hashes", () => {
  it("sha256 of a string is deterministic 64-char hex", () => {
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // known value
    expect(h1).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("sha256 differs for different inputs", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("sha256 accepts Uint8Array", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(sha256(bytes)).toBe(sha256("hello"));
  });

  it("sha256Slice only considers the slice, not the whole source", () => {
    const source = "prefix-foo-suffix";
    const h1 = sha256Slice(source, 7, 10); // "foo"
    const h2 = sha256("foo");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(sha256(source));
  });

  it("sha256Slice with an empty slice returns the hash of the empty string", () => {
    expect(sha256Slice("anything", 5, 5)).toBe(sha256(""));
  });
});

describe("normalizeEol (roadmap item 12)", () => {
  it("CRLF becomes LF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("pure LF is unchanged", () => {
    expect(normalizeEol("a\nb\n")).toBe("a\nb\n");
  });

  it("a lone CR is preserved (it is not a git EOL)", () => {
    expect(normalizeEol("a\rb")).toBe("a\rb");
  });

  it("hash is the same for the LF and CRLF versions of the same source", () => {
    const lf = "export function foo() {\n  return 1;\n}\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(sha256(normalizeEol(crlf))).toBe(sha256(lf));
    expect(sha256(crlf)).not.toBe(sha256(lf)); // raw bytes differ
  });
});

describe("expandEolToCrlf (roadmap item 12 follow-up)", () => {
  it("expands LF to CRLF", () => {
    expect(expandEolToCrlf("a\nb\n")).toBe("a\r\nb\r\n");
  });

  it("round-trip with normalizeEol for LF-only content", () => {
    const lf = "a\nb\n";
    expect(normalizeEol(expandEolToCrlf(lf))).toBe(lf);
  });

  it("hash of the expanded variant reproduces the legacy raw-CRLF hash", () => {
    const lf = "export function f() {\n  return 1;\n}\n";
    expect(sha256(expandEolToCrlf(lf))).toBe(
      sha256(lf.replace(/\n/g, "\r\n")),
    );
  });
});