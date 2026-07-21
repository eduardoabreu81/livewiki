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

/**
 * Structured diagnostic for `unclosed_markdown` errors. The validator
 * used to emit only a generic message — R3 evidence (rerun-clean-v20)
 * showed the LLM keeping the same unclosed construct through every
 * repair attempt because the prompt had no way to point at the
 * specific opening delimiter. This struct carries:
 *
 *   - `kind`: which construct was left open (`fence` or `inline-code`),
 *     so the repair prompt can phrase the directive concretely. The
 *     closing rules differ between the two:
 *       - fence: close with the same delimiter character (backtick
 *         or tilde) and a run of AT LEAST `delimiterLength`.
 *       - inline-code: close with EXACTLY `delimiterLength` backticks
 *         — CommonMark requires exact-length match.
 *   - `lineNumber`: 1-based line of the opening delimiter (or the line
 *     holding the unmatched backtick run). Deterministically derivable
 *     from the body; the validator never has to guess.
 *   - `offending`: the line text, capped so a runaway long line cannot
 *     inflate the repair prompt. For a delimiter run LONGER than the
 *     cap, the excerpt can only show a visible representative portion
 *     — the exact length travels in `delimiterLength` instead.
 *   - `delimiterLength`: the exact length of the offending delimiter
 *     run (backtick/tilde run for a fence; unmatched backtick run
 *     for an inline-code span). The repair model MUST know the
 *     exact length to emit a correct closing run; the bounded
 *     excerpt is not sufficient when the run is longer than the cap.
 */
export interface UnclosedMarkdownDiagnostic {
  readonly kind: "fence" | "inline-code";
  /** 1-based line number of the offending opening delimiter. */
  readonly lineNumber: number;
  /** Excerpt of the offending line, capped at `excerptCap` chars. */
  readonly offending: string;
  /** Exact length of the offending delimiter run. */
  readonly delimiterLength: number;
}

const DEFAULT_UNCLOSED_EXCERPT_CAP = 200;

/**
 * Locate the structural reason `hasUnclosedMarkdown` returns true and
 * return a deterministic, actionable diagnostic the validator attaches
 * to the `unclosed_markdown` error. Returns null when the body is
 * well-formed (no unclosed fence, no unmatched inline backtick run).
 *
 * Strategy: first scan for an unclosed fence and remember the line of
 * the opening delimiter; if none, run the length-preserving code-span
 * mask and find the first surviving backtick — the first unmatched
 * inline-code run, which keeps its original character position.
 *
 * Uses the LENGTH-PRESERVING mask so the offset returned for the
 * inline-code case is byte-for-byte equal to the original body,
 * including on CRLF input.
 */
export function unclosedMarkdownDiagnostic(
  text: string,
  excerptCap: number = DEFAULT_UNCLOSED_EXCERPT_CAP,
): UnclosedMarkdownDiagnostic | null {
  const lines = text.split(/\r?\n/);
  const fenceState = createFenceState();
  let lineNumber = 0;
  let fenceOpenLine = -1;
  for (const line of lines) {
    lineNumber += 1;
    if (!fenceState.inFence) {
      const match = line.match(FENCE_OPEN_RE);
      if (match?.[1]) {
        fenceState.inFence = true;
        fenceState.fenceChar = match[1][0] as string;
        fenceState.fenceLen = match[1].length;
        fenceOpenLine = lineNumber;
      }
    } else {
      const closeRe = new RegExp(
        `^[ \\t]{0,3}[${fenceState.fenceChar}]{${fenceState.fenceLen},}[ \\t]*$`,
      );
      if (closeRe.test(line)) {
        fenceState.inFence = false;
        fenceOpenLine = -1;
      }
    }
  }
  if (fenceState.inFence && fenceOpenLine > 0) {
    const line = lines[fenceOpenLine - 1] ?? "";
    // For the fence case, the opening delimiter is the whole
    // meaningful prefix of the line (3+ backticks or tildes,
    // optionally preceded by indentation). Center the bounded
    // excerpt on the first delimiter character so a long opening
    // fence with trailing junk still has the fence as its midpoint.
    const delimMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    const delimOffset = delimMatch ? delimMatch[0].length - delimMatch[1]!.length : 0;
    const delimLen = delimMatch?.[1]?.length ?? 0;
    return {
      kind: "fence",
      lineNumber: fenceOpenLine,
      offending: boundedExcerpt(line, excerptCap, delimOffset, delimLen),
      delimiterLength: delimLen,
    };
  }

  // Inline-code case: the length-preserving mask keeps unmatched
  // backticks at their original positions, so the first backtick in
  // the masked output is the opening delimiter of the first unmatched
  // inline-code run. Translate the index back to a 1-based line
  // number AND a 0-based offset within that line, then center the
  // bounded excerpt on the unmatched run (not the start of the
  // line — for a 500+ character line whose unmatched backtick is
  // after column 200, slicing the first 200 chars would emit a
  // marker-free excerpt and leave the LLM with no actionable
  // pointer).
  const masked = maskCodeSpansPreservingLength(text);
  const idx = masked.indexOf("`");
  if (idx < 0) return null;
  let ln = 1;
  for (let i = 0; i < idx; i++) {
    if (text[i] === "\n") ln += 1;
  }
  let lineStart = idx;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart -= 1;
  let lineEnd = idx;
  while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd += 1;
  const line = text.slice(lineStart, lineEnd);
  // The unmatched backtick run starts at `idx` and continues until
  // the next non-backtick character (the run can be any length ≥ 1).
  let runLen = 1;
  while (idx + runLen < text.length && text[idx + runLen] === "`") {
    runLen += 1;
  }
  const delimOffsetInLine = idx - lineStart;
  return {
    kind: "inline-code",
    lineNumber: ln,
    offending: boundedExcerpt(line, excerptCap, delimOffsetInLine, runLen),
    delimiterLength: runLen,
  };
}

/**
 * Center a bounded excerpt of `line` on a delimiter of length
 * `delimLen` starting at column `delimOffset`, with the cap
 * inclusive of the optional left/right truncation markers. The
 * delimiter is preserved in the window. Short lines are returned
 * unchanged. When `delimOffset` and `delimLen` are both 0 (the
 * default) the window is positioned at the start of the line —
 * useful for fence diagnostics where the opening fence IS the line.
 */
function boundedExcerpt(
  line: string,
  cap: number,
  delimOffset: number = 0,
  delimLen: number = 0,
): string {
  if (line.length <= cap) return line;
  // Reserve room for at most two "… " markers (2 chars each).
  const innerCap = Math.max(1, cap - 4);
  const half = Math.floor(innerCap / 2);
  let start = delimOffset - half;
  let end = start + innerCap;
  if (start < 0) {
    end = Math.min(line.length, end - start);
    start = 0;
  }
  if (end > line.length) {
    start = Math.max(0, start - (end - line.length));
    end = line.length;
  }
  let excerpt = line.slice(start, end);
  if (start > 0) excerpt = "… " + excerpt;
  if (end < line.length) excerpt = excerpt + " …";
  // Defensive: if clamping or markers pushed us over `cap`, truncate.
  // The delimiter is in the window center, so it survives.
  if (excerpt.length > cap) excerpt = excerpt.slice(0, cap);
  // Final guard: the centered window must still contain the full
  // delimiter. If a malformed cap or off-by-one edge case dropped
  // the run, fall back to a guaranteed-safe slicing that includes
  // it. Real source virtually never hits this branch.
  if (delimLen > 0 && !excerpt.includes(line.slice(delimOffset, delimOffset + delimLen))) {
    const start2 = Math.max(0, Math.min(line.length - cap, delimOffset + delimLen - cap));
    excerpt = line.slice(start2, start2 + cap);
    if (start2 > 0) excerpt = "… " + excerpt.slice(2);
    if (start2 + cap < line.length) excerpt = excerpt.slice(0, excerpt.length - 2) + " …";
  }
  return excerpt;
}
