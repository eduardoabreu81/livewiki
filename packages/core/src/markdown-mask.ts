/**
 * markdown-mask — small, deterministic helpers to mask/inspect Markdown
 * code constructs (fenced code blocks, inline code spans).
 *
 * Shared by `verify.ts` (mask code before scanning for navigable links —
 * `[text](page.md)` inside a code span is a syntax example, not a real
 * link) and `artifact.ts` (mask code before checking for TODO/TBD filler
 * in prose, and detect whether the document was cut mid code-construct).
 *
 * Extracted from `verify.ts` so both validators share one implementation
 * instead of drifting.
 */

/** Combined mask: fenced blocks first, then inline code spans. */
export function maskCodeSpans(text: string): string {
  return maskInlineCode(maskFencedCodeBlocks(text));
}

/** Blanks the body (opening line, content, and closing line) of each fenced code block (``` or ~~~). */
export function maskFencedCodeBlocks(text: string): string {
  // CRLF-safe: a lone "\n" split leaves a trailing "\r" on each line, which
  // breaks the closing-fence `$` match on CRLF files and lets the fence
  // stay open — masking the rest of the page as a side effect.
  const lines = text.split(/\r?\n/);
  const fenceOpenRe = /^[ \t]{0,3}(`{3,}|~{3,})/;
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (!inFence) {
      const m = line.match(fenceOpenRe);
      if (m?.[1]) {
        inFence = true;
        fenceChar = m[1][0] as string;
        fenceLen = m[1].length;
        out.push("");
        continue;
      }
      out.push(line);
      continue;
    }
    const closeRe = new RegExp(`^[ \\t]{0,3}[${fenceChar}]{${fenceLen},}[ \\t]*$`);
    if (closeRe.test(line)) {
      inFence = false;
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Blanks inline code spans delimited by N backticks (N >= 1), following
 * the CommonMark rule: the closing delimiter must have the SAME number of
 * backticks as the opening one (allows `` `code with ` inside` `` etc).
 * A backtick run with no matching close is left as literal text (it
 * survives in the output — used by `hasUnclosedMarkdown` to detect
 * truncation mid code-span).
 */
export function maskInlineCode(text: string): string {
  let result = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] !== "`") {
      result += text[i];
      i++;
      continue;
    }
    let j = i;
    while (j < n && text[j] === "`") j++;
    const runLen = j - i;

    let k = j;
    let closeStart = -1;
    while (k < n) {
      if (text[k] === "`") {
        let k2 = k;
        while (k2 < n && text[k2] === "`") k2++;
        if (k2 - k === runLen) {
          closeStart = k;
          k = k2;
          break;
        }
        k = k2;
      } else {
        k++;
      }
    }

    if (closeStart === -1) {
      // No matching close — not a code span; keep it literal.
      result += text.slice(i, j);
      i = j;
    } else {
      const spanEnd = closeStart + runLen;
      result += " ".repeat(spanEnd - i);
      i = spanEnd;
    }
  }
  return result;
}

/**
 * True if a fenced code block was opened but never closed — the scan
 * ends still "inside" a fence.
 */
export function hasUnclosedFence(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const fenceOpenRe = /^[ \t]{0,3}(`{3,}|~{3,})/;
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of lines) {
    if (!inFence) {
      const m = line.match(fenceOpenRe);
      if (m?.[1]) {
        inFence = true;
        fenceChar = m[1][0] as string;
        fenceLen = m[1].length;
      }
      continue;
    }
    const closeRe = new RegExp(`^[ \\t]{0,3}[${fenceChar}]{${fenceLen},}[ \\t]*$`);
    if (closeRe.test(line)) inFence = false;
  }
  return inFence;
}

/**
 * True if the document has an unclosed fenced code block OR an inline
 * code span with no matching close — the objective, deterministic signal
 * that a document was cut mid Markdown construct (e.g. by a token-limit
 * truncation). Not a size/length heuristic: a well-formed document has
 * zero backticks surviving `maskInlineCode` (every one was consumed as
 * part of a matched pair) and zero fences left open.
 */
export function hasUnclosedMarkdown(text: string): boolean {
  if (hasUnclosedFence(text)) return true;
  return maskInlineCode(maskFencedCodeBlocks(text)).includes("`");
}
