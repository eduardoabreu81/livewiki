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

import { unclosedMarkdownDiagnostic } from "./markdown-mask.js";

describe("unclosedMarkdownDiagnostic — bounded excerpt centers on the unmatched delimiter", () => {
  // Review blocker: boundedExcerpt() previously returned
  // `line.slice(0, cap)`. For a long line whose unmatched backtick
  // occurs after column 200, the 200-char prefix contained no
  // delimiter and the repair prompt had no actionable pointer.
  // The fix centers the excerpt on the delimiter (fence: the first
  // backtick/tilde of the opening fence; inline-code: the unmatched
  // backtick run) and includes left/right truncation markers.
  it("inline-code with unmatched backtick after column 500 still puts the delimiter in the excerpt", () => {
    const text = "A".repeat(500) + "`oops";
    const diag = unclosedMarkdownDiagnostic(text);
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("inline-code");
    expect(diag!.lineNumber).toBe(1);
    expect(diag!.offending).toBeDefined();
    expect(diag!.offending!.length).toBeLessThanOrEqual(200);
    // The unmatched backtick must be present (this is what failed
    // before the fix — the 200-char prefix was 500 A's and the
    // backtick was cut off).
    expect(diag!.offending).toContain("`");
    // Visible left/right truncation — both ends were clipped.
    expect(diag!.offending).toMatch(/…/);
  });

  it("fence diagnostic excerpt still contains the opening fence", () => {
    const text = "before\n```ts\nconst x = 1;\nrest of the line that could be very long and might exceed 200 chars if the validator went down that path, but fence openers are short by design so this is a sanity check not a length check";
    const diag = unclosedMarkdownDiagnostic(text);
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("fence");
    expect(diag!.lineNumber).toBe(2);
    expect(diag!.offending).toContain("```");
  });

  it("inline-code diagnostic carries exact delimiterLength for a 198-backtick run, with content on both sides", () => {
    // R4 follow-up: a 198-backtick run plus 500 chars of content on
    // each side was the exact reproduction. The diagnostic must carry
    // the exact length (198) in addition to the bounded excerpt; the
    // excerpt itself is allowed to show only a visible portion of the
    // run.
    const before = "A".repeat(500);
    const after = "Z".repeat(500);
    const run = "`".repeat(198);
    const text = `${before}${run}${after}`;
    const diag = unclosedMarkdownDiagnostic(text);
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("inline-code");
    expect(diag!.lineNumber).toBe(1);
    expect(diag!.delimiterLength).toBe(198);
    expect(diag!.offending!.length).toBeLessThanOrEqual(200);
    expect(diag!.offending!.includes("`")).toBe(true);
  });

  it("inline-code diagnostic carries exact delimiterLength for a >200-backtick run", () => {
    // Run strictly longer than the cap. The diagnostic still carries
    // the exact length; the excerpt shows a visible portion only.
    const before = "A".repeat(100);
    const after = "Z".repeat(100);
    const run = "`".repeat(260);
    const text = `${before}${run}${after}`;
    const diag = unclosedMarkdownDiagnostic(text);
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("inline-code");
    expect(diag!.lineNumber).toBe(1);
    expect(diag!.delimiterLength).toBe(260);
    expect(diag!.offending!.length).toBeLessThanOrEqual(200);
    expect(diag!.offending!.includes("`")).toBe(true);
  });

  it("fence diagnostic carries exact delimiterLength", () => {
    const text = "before\n`````ts\nconst x = 1;";
    const diag = unclosedMarkdownDiagnostic(text);
    expect(diag).toBeDefined();
    expect(diag!.kind).toBe("fence");
    expect(diag!.delimiterLength).toBe(5);
  });
});
