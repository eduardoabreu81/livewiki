import { describe, it, expect } from "vitest";
import { parseFrontmatter, getAnchors, getOwner, FrontmatterParseError } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns frontmatter=null if it does not start with ---", () => {
    const src = "# Just a title\n\nbody here.";
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe(src);
    expect(r.bodyOffset).toBe(0);
  });

  it("parses a simple valid frontmatter", () => {
    const src = `---
title: Hello
owner: human
---
body here`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toEqual({
      title: "Hello",
      owner: "human",
    });
    expect(r.body).toBe("body here");
  });

  it("parses a list of strings (anchors)", () => {
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

  it("accepts end-of-line comments", () => {
    const src = `---
title: Foo  # comment
owner: generated
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["title"]).toBe("Foo");
    expect(r.frontmatter?.["owner"]).toBe("generated");
  });

  it("ignores blank lines and comments", () => {
    const src = `---
# stray comment

title: Foo

# another comment
---
body`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter).toEqual({ title: "Foo" });
  });

  it("supports \\r\\n (Windows line endings)", () => {
    const src = "---\r\ntitle: Foo\r\nowner: generated\r\n---\r\nbody";
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["title"]).toBe("Foo");
    expect(r.body).toBe("body");
  });

  it("throws an error if an opened frontmatter is not closed", () => {
    const src = `---
title: Foo
body without closing`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("throws an error on a list item without a preceding key", () => {
    const src = `---
- stray item
---`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("throws an error on a malformed line", () => {
    const src = `---
this is not key:value
---`;
    expect(() => parseFrontmatter(src)).toThrow(FrontmatterParseError);
  });

  it("supports a key starting with an underscore", () => {
    const src = `---
_private: x
__double: y
---`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["_private"]).toBe("x");
    expect(r.frontmatter?.["__double"]).toBe("y");
  });

  it("supports a key with a hyphen", () => {
    const src = `---
my-key: x
---`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter?.["my-key"]).toBe("x");
  });

  it("two lists in sequence: independent keys", () => {
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

  it("bodyOffset points to just after the closing + newline", () => {
    const src = `---
title: Foo
---
body content`;
    const r = parseFrontmatter(src);
    expect(src.slice(r.bodyOffset)).toBe("body content");
  });
});

describe("getAnchors", () => {
  it("returns the list of strings from the frontmatter", () => {
    const fm = { anchors: ["a.ts", "b.ts"] };
    expect(getAnchors(fm)).toEqual(["a.ts", "b.ts"]);
  });

  it("returns [] if frontmatter is null", () => {
    expect(getAnchors(null)).toEqual([]);
  });

  it("returns [] if anchors is not a list", () => {
    const fm = { anchors: "string-instead-of-list" };
    expect(getAnchors(fm)).toEqual([]);
  });
});

describe("getOwner", () => {
  it("returns the declared owner", () => {
    expect(getOwner({ owner: "human" })).toBe("human");
    expect(getOwner({ owner: "mixed" })).toBe("mixed");
    expect(getOwner({ owner: "generated" })).toBe("generated");
  });

  it("default: generated when absent or invalid", () => {
    expect(getOwner(null)).toBe("generated");
    expect(getOwner({})).toBe("generated");
    expect(getOwner({ owner: "weird" })).toBe("generated");
  });
});