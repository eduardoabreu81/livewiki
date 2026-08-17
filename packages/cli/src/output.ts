/**
 * Output formatter — all CLI output passes through here.
 * SPEC §"CLI commands": "human-readable AND parseable output (`--json` on
 * every command)".
 *
 * JSON: 1 line, trailing newline, to be safe with line-by-line `JSON.parse`.
 * Human: multi-line plain text.
 */

export interface EmitOptions {
  /** When true, forces JSON even if the caller does not set data. */
  json: boolean;
}

export function emitHuman(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

export function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

/**
 * Single helper: if json, serialize `data`; otherwise, write `human`.
 * Use one or the other — never both.
 */
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void {
  if (json) emitJson(data);
  else emitHuman(human);
}