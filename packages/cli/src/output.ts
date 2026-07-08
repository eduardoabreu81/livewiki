/**
 * Formatador de saída — toda saída do CLI passa por aqui.
 * SPEC §"Comandos CLI": "saída legível por humano E parseável (`--json` em
 * todo comando)".
 *
 * JSON: 1 linha, newline final, para ser seguro com `JSON.parse` linha-a-linha.
 * Human: texto multi-linha, plain.
 */

export interface EmitOptions {
  /** Quando true, força JSON mesmo se o caller não setar data. */
  json: boolean;
}

export function emitHuman(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

export function emitJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

/**
 * Helper único: se json, serializa `data`; senão, escreve `human`.
 * Use um ou outro — nunca os dois.
 */
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void {
  if (json) emitJson(data);
  else emitHuman(human);
}