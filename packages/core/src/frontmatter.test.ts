import { describe, it, expect } from "vitest";
import { parseFrontmatter, getAnchors, getOwner, FrontmatterParseError } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("retorna frontmatter=null se não começar com ---", () => {
    const src = "# Apenas um título\n\nbody aqui.";
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe(src);
    expect(r.bodyOffset).toBe(0);
  });

  it("parseia frontmatter válido simples", () => {
    const src = `---
title: Hello
owner: human
---
body aqui`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toEqual({
      title: "Hello",
      owner: "human",
    });
    expect(r.body).toBe("body aqui");
  });

  it("parseia lista de strings (anchors)", () => {
    const src = `---
title: Auth
anchors:
  - src/auth/login.ts
  - src/auth/login.ts#validateToken
  - src/auth/session.ts#refresh
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["anchors"]).toEqual([
      "src/auth/login.ts",
      "src/auth/login.ts#validateToken",
      "src/auth/session.ts#refresh",
    ]);
  });

  // Regression: inline flow-style lists (`key: [a, b]`) — the form LLMs most
  // often emit. Previously parsed as one opaque string, which silently broke
  // anchor checks and flow `modules:` consumption.
  it("parses inline flow-style string lists", () => {
    const src = `---
title: Hooks to lib flow
modules: [hooks, services, lib]
anchors: [src/a.ts#x, src/b.ts#y]
empty: []
note: "[draft] title" trailing
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["modules"]).toEqual(["hooks", "services", "lib"]);
    expect(r.frontmatter?.["anchors"]).toEqual(["src/a.ts#x", "src/b.ts#y"]);
    expect(r.frontmatter?.["empty"]).toEqual([]);
    // Value that merely contains brackets is not a list.
    expect(r.frontmatter?.["note"]).toBe('"[draft] title" trailing');
  });

  it("inline flow-style list with trailing comment still parses", () => {
    const src = `---
modules: [hooks, lib] # participating modules
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["modules"]).toEqual(["hooks", "lib"]);
  });

  it("aceita comentários no final de linha", () => {
    const src = `---
title: Foo  # comentário
owner: generated
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["title"]).toBe("Foo");
    expect(r.frontmatter?.["owner"]).toBe("generated");
  });

  it("ignora linhas em branco e comentários", () => {
    const src = `---
# comentário solto

title: Foo

# outro comentário
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toEqual({ title: "Foo" });
  });

  it("suporta \\r\\n (Windows line endings)", () => {
    const src = "---\r\ntitle: Foo\r\nowner: generated\r\n---\r\nbody";
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["title"]).toBe("Foo");
    expect(r.body).toBe("body");
  });

  it("lança erro se frontmatter aberto não fecha", () => {
    const src = `---
title: Foo
body sem fechamento`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("lança erro em item de lista sem chave anterior", () => {
    const src = `---
- item solto
---`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("lança erro em linha malformada", () => {
    const src = `---
isso nao é chave:valor
---`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("suporta chave começando com underscore", () => {
    const src = `---
_private: x
__double: y
---`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["_private"]).toBe("x");
    expect(r.frontmatter?.["__double"]).toBe("y");
  });

  it("suporta chave com hífen", () => {
    const src = `---
my-key: x
---`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["my-key"]).toBe("x");
  });

  it("duas listas em sequência: chaves independentes", () => {
    const src = `---
first:
  - x
second:
  - y
---`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["first"]).toEqual(["x"]);
    expect(r.frontmatter?.["second"]).toEqual(["y"]);
  });

  it("bodyOffset aponta para depois do fechamento + newline", () => {
    const src = `---
title: Foo
---
body content`;
    const r = parseFrontmatter(src);
    expect(src.slice(r.bodyOffset)).toBe("body content");
  });
});

describe("getAnchors", () => {
  it("retorna lista de strings do frontmatter", () => {
    const fm = { anchors: ["a.ts", "b.ts"] };
    expect(getAnchors(fm)).toEqual(["a.ts", "b.ts"]);
  });

  it("retorna [] se frontmatter null", () => {
    expect(getAnchors(null)).toEqual([]);
  });

  it("retorna [] se anchors não é lista", () => {
    const fm = { anchors: "string-em-vez-de-lista" };
    expect(getAnchors(fm)).toEqual([]);
  });
});

describe("getOwner", () => {
  it("retorna o owner declarado", () => {
    expect(getOwner({ owner: "human" })).toBe("human");
    expect(getOwner({ owner: "mixed" })).toBe("mixed");
    expect(getOwner({ owner: "generated" })).toBe("generated");
  });

  it("default: generated quando ausente ou inválido", () => {
    expect(getOwner(null)).toBe("generated");
    expect(getOwner({})).toBe("generated");
    expect(getOwner({ owner: "weird" })).toBe("generated");
  });
});