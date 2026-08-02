/**
 * safe-io — único módulo autorizado a escrever em disco.
 *
 * Regra inviolável #1 da SPEC: toda escrita passa por aqui. Validação contra a
 * allowlist (livewiki/ + .livewiki/ dentro do repoRoot). Caminhos fora disso =
 * erro. Sem exceções, nem em testes.
 *
 * Regra #2 (pointer em AGENTS.md/CLAUDE.md): opt-in via flag explícita. Esta
 * exceção NÃO mora aqui — fica em um módulo separado de Fase 5 (`pointer.ts`).
 * safe-io só conhece os dois diretórios "seguros".
 *
 * Defesa contra symlinks:
 *   Após validar que o path declarado está dentro da allowlist (rápido, falha
 *   cedo), caminhamos do alvo até o ancestral existente mais profundo, fazemos
 *   realpath dele, reconstituímos o path final, e REVALIDAMOS a allowlist. Isso
 *   fecha ataques do tipo:
 *     - `livewiki` é symlink para `/tmp/`        → realpath mostra /tmp, fora
 *     - `livewiki/sub` é symlink para `../src`   → realpath mostra src, fora
 *     - `livewiki/leaf` é symlink para `/etc/x`  → realpath mostra /etc, fora
 *
 *   Testado dos dois lados (ataque + caminho legítimo via symlink interno).
 */

import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";

/** Diretórios dentro do repoRoot onde escrita é permitida. */
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
export type AllowedDir = (typeof ALLOWED_DIRS)[number];

export interface SafeIoOptions {
  /**
   * Quando true, aceita escrita em AGENTS.md / CLAUDE.md na raiz do repo.
   * Implementado em Fase 5 (pointer). Mantido na interface para já forçar o
   * caminho explícito: default false, opt-in consciente.
   */
  allowPointer?: boolean;
  /**
   * When true, accepts writes to README.md at the repository root.
   * Opt-in for the `export readme` target only (rule #6: human content is
   * never rewritten by automation — readme-export enforces the marker-block
   * contract before any write reaches safe-io). Default false.
   */
  allowReadme?: boolean;
}

export class PathOutsideAllowlistError extends Error {
  public readonly repoRoot: string;
  public readonly attempted: string;
  public readonly allowlist: readonly string[];

  constructor(repoRoot: string, attempted: string, allowlist: readonly string[]) {
    super(
      `Refusing I/O outside allowlist: ${attempted} ` +
        `(repoRoot=${repoRoot}, allowlist=${allowlist.join(", ")})`,
    );
    this.name = "PathOutsideAllowlistError";
    this.repoRoot = repoRoot;
    this.attempted = attempted;
    this.allowlist = allowlist;
  }
}

export class InvalidRelativePathError extends Error {
  constructor(relPath: string, reason: string) {
    super(`Invalid relative path ${JSON.stringify(relPath)}: ${reason}`);
    this.name = "InvalidRelativePathError";
  }
}

function allowlistFor(opts: SafeIoOptions): readonly string[] {
  const extras: string[] = [];
  if (opts.allowPointer) extras.push("AGENTS.md", "CLAUDE.md");
  if (opts.allowReadme) extras.push("README.md");
  return [...ALLOWED_DIRS, ...extras];
}

/**
 * Caminho absoluto de um diretório permitido dentro do repoRoot.
 * Lança se repoRoot for inválido.
 */
function allowedAbs(repoRoot: string, dir: AllowedDir): string {
  const absRoot = nodePath.resolve(repoRoot);
  const absDir = nodePath.resolve(absRoot, dir);
  // Defesa em profundidade: o diretório permitido TEM que estar dentro de repoRoot.
  const rel = nodePath.relative(absRoot, absDir);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    // Não deveria acontecer — `dir` é literal controlada — mas falhamos fechado.
    throw new Error(`Internal: allowed dir ${dir} escapes repoRoot`);
  }
  return absDir;
}

/**
 * Decide se um path absoluto está dentro de algum diretório permitido.
 * Compara por prefixo + separador (não substring), para evitar que
 * `livewiki-evil` seja aceito como dentro de `livewiki/`.
 *
 * Pura: não toca em disco. Usada tanto na validação inicial (rápida) quanto
 * na revalidação após realpath.
 */
export function isInsideAllowlist(
  repoRoot: string,
  absPath: string,
  opts: SafeIoOptions = {},
): boolean {
  const target = nodePath.resolve(absPath);
  if (opts.allowPointer) {
    // AGENTS.md e CLAUDE.md na raiz do repoRoot. Validado por nome de arquivo,
    // não por diretório, porque a regra #2 fala "no AGENTS.md/CLAUDE.md",
    // não "num diretório".
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      const allowed = nodePath.resolve(repoRoot, filename);
      if (target === allowed) return true;
    }
  }
  if (opts.allowReadme) {
    // README.md at the repository root — validated by file name, like the
    // pointer files above, because the opt-in covers exactly one file.
    const allowed = nodePath.resolve(repoRoot, "README.md");
    if (target === allowed) return true;
  }
  return ALLOWED_DIRS.some((dir) => {
    const allowed = allowedAbs(repoRoot, dir);
    const rel = nodePath.relative(allowed, target);
    // Dentro se: relativo não começa com .., não é absoluto, e não é vazio
    // (vazio = target === allowed, que é o próprio diretório, ok).
    return !rel.startsWith("..") && !nodePath.isAbsolute(rel);
  });
}

/**
 * Valida o path declarado SEM considerar symlinks. Falha cedo em casos
 * óbvios (path absoluto, traversal, fora da allowlist no path declarado).
 */
function validateDeclared(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions,
): string {
  if (nodePath.isAbsolute(relPath)) {
    throw new InvalidRelativePathError(relPath, "must be relative to repoRoot");
  }
  const normalized = nodePath.normalize(relPath);
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new InvalidRelativePathError(relPath, "contains '..' segment");
  }
  const absRoot = nodePath.resolve(repoRoot);
  const absTarget = nodePath.resolve(absRoot, normalized);
  if (!isInsideAllowlist(absRoot, absTarget, opts)) {
    throw new PathOutsideAllowlistError(absRoot, absTarget, allowlistFor(opts));
  }
  return absTarget;
}

/**
 * Encontra o ancestral existente mais profundo começando de `from` e caminhando
 * em direção a `stopAt`. Retorna uma tupla [ancestral, sufixo]:
 *   - `ancestral`: o diretório (ou arquivo) mais profundo que existe
 *   - `sufixo`: a parte do path que NÃO existe ainda, a ser concatenada
 *
 * Se nada no caminho existe, retorna [stopAt, from-relativo-a-stopAt].
 *
 * Implementação síncrona porque `existsSync` é o que faz sentido no loop —
 * `realpath` é async mas só é chamado uma vez com o resultado.
 */
function findDeepestExisting(
  from: string,
  stopAt: string,
): readonly [ancestor: string, suffix: string] {
  let cursor = from;
  let suffix = "";
  while (cursor !== stopAt) {
    if (nodeFsSync.existsSync(cursor)) {
      return [cursor, suffix] as const;
    }
    const parent = nodePath.dirname(cursor);
    if (parent === cursor) {
      // Segurança: chegou na raiz do filesystem sem encontrar nem stopAt.
      // Devolve stopAt com tudo como sufixo.
      return [stopAt, nodePath.relative(stopAt, from)] as const;
    }
    suffix = suffix
      ? nodePath.join(nodePath.basename(cursor), suffix)
      : nodePath.basename(cursor);
    cursor = parent;
  }
  // cursor === stopAt. Se stopAt existe, retornamos ele com sufixo completo.
  return [stopAt, suffix] as const;
}

/**
 * Resolve o caminho, considerando symlinks, e revalida a allowlist.
 *
 * Algoritmo:
 *   1. Validar o path declarado (rápido, falha cedo)
 *   2. Achar o ancestral existente mais profundo
 *   3. Realpath desse ancestral
 *   4. Reconstruir o path final = realpath(ancestral) + sufixo
 *   5. Revalidar a allowlist no path final (defesa contra symlink attack)
 *
 * Retorna o caminho absoluto validado. Lança PathOutsideAllowlistError /
 * InvalidRelativePathError se qualquer validação falhar.
 *
 * Race condition: existe uma janela entre existsSync e realpath. Em prática,
 * symlinks são raramente criados/removidos em operação normal, e o caller
 * (writeText, etc.) já trata erros de I/O. Não é problema na Fase 0.
 */
export async function resolveAndValidate(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  // Canonicalize the root BEFORE any comparison: on macOS the temp dir is
  // /var/folders/... with /var → /private/var, so a realpath'd target never
  // prefix-matches a lexical root (and vice versa). The allowlist must apply
  // to the REAL location — that is the whole point of the symlink defense.
  // Fall back to the lexical resolve when the root doesn't exist yet (a
  // caller may create it below; comparisons then stay consistently lexical).
  const lexicalRoot = nodePath.resolve(repoRoot);
  let absRoot: string;
  try {
    absRoot = await nodeFs.realpath(lexicalRoot);
  } catch {
    absRoot = lexicalRoot;
  }
  const absDeclared = validateDeclared(absRoot, relPath, opts);

  const [ancestor, suffix] = findDeepestExisting(absDeclared, absRoot);

  // Realpath do ancestral existente. Se ancestor === absRoot e nada existe,
  // realpath do root é ele mesmo.
  let realAncestor: string;
  try {
    realAncestor = await nodeFs.realpath(ancestor);
  } catch {
    // ancestor não existe (race) ou outro erro — falhamos fechado
    throw new PathOutsideAllowlistError(
      absRoot,
      ancestor,
      allowlistFor(opts),
    );
  }

  // Reconstruir path final
  const finalAbs = suffix ? nodePath.join(realAncestor, suffix) : realAncestor;

  // Revalidar: se um symlink no ancestral redireciona para fora, isso cai aqui.
  if (!isInsideAllowlist(absRoot, finalAbs, opts)) {
    throw new PathOutsideAllowlistError(absRoot, finalAbs, allowlistFor(opts));
  }
  return finalAbs;
}

// ── Operações de I/O ────────────────────────────────────────────────────────
// Todas chamam resolveAndValidate antes de tocar em disco.

export async function writeText(
  repoRoot: string,
  relPath: string,
  content: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

export async function readText(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  return nodeFs.readFile(abs, "utf8");
}

export async function exists(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<boolean> {
  // exists() lê metadados — mesmo assim valida a allowlist (com symlink check).
  // Saber da existência de um arquivo fora de livewiki/ já é leak de informação.
  try {
    const abs = await resolveAndValidate(repoRoot, relPath, opts);
    await nodeFs.access(abs);
    return true;
  } catch (err) {
    if (err instanceof PathOutsideAllowlistError) throw err;
    return false;
  }
}

export async function mkdir(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.mkdir(abs, { recursive: true });
}

export async function remove(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.rm(abs, { recursive: true, force: true });
}