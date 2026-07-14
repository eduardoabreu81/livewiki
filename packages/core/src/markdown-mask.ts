/**
 * markdown-mask — small, deterministic helpers to mask/inspect Markdown
 * code constructs (fenced code blocks, inline code spans).
 *
 * Shared by `verify.ts` (mask code before scanning for navigable links),
 * `artifact.ts` (marker validation, TODO/TBD filler, and truncation), and
 * `anchors.ts` (marker extraction for verify and the ledger). Markdown
 * code is display text rather than a structural link or marker surface.
 *
 * Extracted from `verify.ts` so all structural scans share one implementation
 * instead of drifting.
 */

/** Combined mask: fenced blocks first, then inline code spans. */
export function maskCodeSpans(text: string): string {
  return maskInlineCode(maskFencedCodeBlocks(text));
}

interface FenceState {
  inFence: boolean;
  fenceChar: string;
  fenceLen: number;
}

const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;

function createFenceState(): FenceState {
  return { inFence: false, fenceChar: "", fenceLen: 0 };
}

/**
 * Advances the shared fenced-block state machine for one line.
 * Returns true when the complete line belongs to a fenced block,
 * including its opening and closing fence lines.
 */
function consumeFenceLine(line: string, state: FenceState): boolean {
  if (!state.inFence) {
    const match = line.match(FENCE_OPEN_RE);
    if (!match?.[1]) return false;
    state.inFence = true;
    state.fenceChar = match[1][0] as string;
    state.fenceLen = match[1].length;
    return true;
  }

  const closeRe = new RegExp(
    `^[ \\t]{0,3}[${state.fenceChar}]{${state.fenceLen},}[ \\t]*$`,
  );
  if (closeRe.test(line)) state.inFence = false;
  return true;
}

/** Blanks the body (opening line, content, and closing line) of each fenced code block (``` or ~~~). */
export function maskFencedCodeBlocks(text: string): string {
  // CRLF-safe: a lone "\n" split leaves a trailing "\r" on each line, which
  // breaks the closing-fence `$` match on CRLF files and lets the fence
  // stay open — masking the rest of the page as a side effect.
  const lines = text.split(/\r?\n/);
  const state = createFenceState();
  const out: string[] = [];
  for (const line of lines) {
    out.push(consumeFenceLine(line, state) ? "" : line);
  }
  return out.join("\n");
}

/**
 * Masks fenced blocks and inline-code spans without changing the source
 * length or any line terminator. Characters inside code become spaces, so
 * every index in the masked view maps to the same index in the original text.
 */
export function maskCodeSpansPreservingLength(text: string): string {
  return maskInlineCode(maskFencedCodeBlocksPreservingLength(text));
}

function maskFencedCodeBlocksPreservingLength(text: string): string {
  const state = createFenceState();
  let result = "";
  let lineStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\n") continue;
    const hasCarriageReturn = i > lineStart && text[i - 1] === "\r";
    const lineEnd = hasCarriageReturn ? i - 1 : i;
    const line = text.slice(lineStart, lineEnd);
    result += consumeFenceLine(line, state) ? " ".repeat(line.length) : line;
    result += hasCarriageReturn ? "\r\n" : "\n";
    lineStart = i + 1;
  }

  const finalLine = text.slice(lineStart);
  result += consumeFenceLine(finalLine, state)
    ? " ".repeat(finalLine.length)
    : finalLine;
  return result;
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
  const state = createFenceState();
  for (const line of lines) {
    consumeFenceLine(line, state);
  }
  return state.inFence;
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
