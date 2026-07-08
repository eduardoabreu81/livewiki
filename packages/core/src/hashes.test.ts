import { describe, it, expect } from "vitest";
import { sha256, sha256Slice } from "./hashes.js";

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