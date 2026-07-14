import { describe, expect, it } from "vitest";
import {
  maskCodeSpans,
  maskCodeSpansPreservingLength,
} from "./markdown-mask.js";

describe("maskCodeSpansPreservingLength", () => {
  it("keeps source length and real-content offsets stable", () => {
    const realMarker = "<!-- lw:anchors src/real.ts#run -->";
    const source = [
      "Before",
      "```markdown",
      "<!-- lw:anchors ... -->",
      "<!-- lw:anchors … -->",
      "```",
      realMarker,
      "After",
    ].join("\n");

    const masked = maskCodeSpansPreservingLength(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.indexOf(realMarker)).toBe(source.indexOf(realMarker));
    expect(masked).not.toContain("<!-- lw:anchors ... -->");
    expect(masked).not.toContain("<!-- lw:anchors … -->");
  });

  it("preserves CRLF terminators exactly", () => {
    const source = "head\r\n```ts\r\nconst x = 1;\r\n```\r\ntail";
    const masked = maskCodeSpansPreservingLength(source);

    expect(masked).toBe("head\r\n     \r\n            \r\n   \r\ntail");
    expect(masked).toHaveLength(source.length);
    expect([...masked.matchAll(/\r\n/g)].map((m) => m.index)).toEqual(
      [...source.matchAll(/\r\n/g)].map((m) => m.index),
    );
  });

  it("masks an unclosed fence through the end of the source", () => {
    const source = "before\n~~~ts\nsecret\nstill fenced";
    const masked = maskCodeSpansPreservingLength(source);

    expect(masked).toBe("before\n     \n      \n            ");
    expect(masked).toHaveLength(source.length);
  });

  it("masks single- and multi-backtick inline spans without shifting text", () => {
    const source = "left `code` middle ``x ` y`` right";
    const masked = maskCodeSpansPreservingLength(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.startsWith("left ")).toBe(true);
    expect(masked.endsWith(" right")).toBe(true);
    expect(masked).not.toContain("code");
    expect(masked).not.toContain("x ` y");
  });

  it("handles mixed fenced, inline, and real content", () => {
    const source = [
      "real-before `inline example`",
      "~~~html",
      "<!-- lw:anchors fake -->",
      "~~~",
      "real-after",
    ].join("\n");
    const masked = maskCodeSpansPreservingLength(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).toContain("real-before");
    expect(masked).toContain("real-after");
    expect(masked).not.toContain("inline example");
    expect(masked).not.toContain("lw:anchors");
  });

  it("leaves the existing collapsing mask behavior unchanged", () => {
    const source = "before\r\n```ts\r\nx\r\n```\r\nafter";
    expect(maskCodeSpans(source)).toBe("before\n\n\n\nafter");
  });
});
