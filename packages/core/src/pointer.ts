/**
 * pointer — opt-in append de bloco "livewiki:start/end" em AGENTS.md / CLAUDE.md.
 *
 * SPEC §"Regras invioláveis" #2:
 *   "Pointer em AGENTS.md/CLAUDE.md: só com flag explícita
 *    (`--write-pointer`) ou confirmação interativa. Nunca automático.
 *    Modificação é append de bloco delimitado
 *    (`<!-- livewiki:start -->` ... `<!-- livewiki:end -->`), idempotente."
 *
 * Esta exceção NÃO vive em `safe-io.ts` — fica em módulo separado (este).
 * safe-io só conhece os dois diretórios "seguros" (livewiki/ + .livewiki/).
 * O pointer é a única exceção e está aqui, consciente, com allowPointer opt-in.
 *
 * Comportamento:
 *   - `insertPointer(repoRoot, opts)`: insere/substitui o bloco em AGENTS.md
 *     (default) ou CLAUDE.md (`opts.file`). Idempotente.
 *   - `removePointer(repoRoot, opts)`: remove o bloco se existir.
 *   - `findPointerBlock(content)`: parser puro do bloco (testável sem disco).
 *   - `buildPointerBlock()`: gera o conteúdo do bloco (1 parágrafo + 1 link).
 *
 * O conteúdo do bloco é deliberadamente CURTO — 1 parágrafo apontando pro
 * quickstart.md. Agentes/HUMANOS que lerem AGENTS.md veem o pointer e sabem
 * que existe uma wiki. Nenhum conteúdo da wiki é duplicado aqui.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";

/** Marcadores do bloco — devem ser estáveis (parsers externos podem depender). */
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";

/** Arquivos permitidos para o pointer (regra #2 fala "no AGENTS.md/CLAUDE.md"). */
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
export type PointerFile = (typeof POINTER_FILES)[number];

/** Decisão automática do arquivo alvo. */
export function pickPointerFile(
  hasAgentsMd: boolean,
  hasClaudeMd: boolean,
  requested?: PointerFile,
): PointerFile {
  if (requested) return requested;
  // Preferência: AGENTS.md se existir (mais comum), senão CLAUDE.md, senão cria AGENTS.md
  if (hasAgentsMd) return "AGENTS.md";
  if (hasClaudeMd) return "CLAUDE.md";
  return "AGENTS.md";
}

export interface PointerInsertOptions {
  /** Qual arquivo alvo. Default: pickPointerFile() */
  file?: PointerFile;
  /** Conteúdo customizado do bloco. Default: buildPointerBlock(). */
  block?: string;
}

export type PointerAction = "inserted" | "replaced" | "unchanged";

export interface PointerInsertResult {
  file: PointerFile;
  action: PointerAction;
  /** Bytes escritos (0 se 'unchanged'). */
  bytesWritten: number;
}

/** Conteúdo padrão do bloco. Curto e direto. */
export function buildPointerBlock(): string {
  // Idiomático: 1 parágrafo em PT-BR (idioma principal do projeto) + 1 link.
  // Mantém concisão — quem quiser mais contexto, clica no link.
  return [
    POINTER_START,
    "",
    "> Este repositório tem uma [livewiki](./livewiki/quickstart.md) — ",
    "> documentação viva, ancorada em símbolos do código e verificável. ",
    "> Comece pelo quickstart (baixo token) e use `livewiki status --json` ",
    "> para ver dívida de documentação aberta.",
    "",
    POINTER_END,
  ].join("\n");
}

/**
 * Encontra o bloco livewiki no conteúdo markdown. Retorna os índices (start, end)
 * incluindo os marcadores, ou null se não existir. Pura — não toca em disco.
 *
 * Busca é tolerante:
 *   - Ignora leading whitespace antes do start marker (defesa contra CRLF/BOM)
 *   - Aceita end marker mesmo que tenha espaços em volta
 *   - Retorna primeiro match (não múltiplos — insertPointer é idempotente e
 *     sempre substitui o primeiro/único bloco existente)
 */
export function findPointerBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null {
  const startRegex = /<!--\s*livewiki:start\s*-->/;
  const endRegex = /<!--\s*livewiki:end\s*-->/;
  const startMatch = startRegex.exec(content);
  if (!startMatch) return null;
  const endMatch = endRegex.exec(content);
  if (!endMatch) {
    // Bloco truncado (sem end marker) — trata como ausente. Evita corromper o doc.
    return null;
  }
  const startIdx = startMatch.index;
  const endIdx = endMatch.index + endMatch[0].length;
  const inner = content.slice(startIdx + startMatch[0].length, endMatch.index);
  return { startIdx, endIdx, inner };
}

/**
 * Substitui o bloco existente pelo novo, OU anexa se não existir.
 * Pura — opera só em string.
 */
export function applyPointerReplace(
  content: string,
  newBlock: string,
): { content: string; action: PointerAction } {
  const found = findPointerBlock(content);
  if (!found) {
    // Append no fim, com 1 linha em branco separadora (se conteúdo não-vazio)
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n\n" : "\n";
    const appended = content.length > 0
      ? content + sep + newBlock + "\n"
      : newBlock + "\n";
    return { content: appended, action: "inserted" };
  }
  const replaced =
    content.slice(0, found.startIdx) +
    newBlock +
    content.slice(found.endIdx);
  // Mesma string após normalização = unchanged (defesa contra no-op writes)
  if (replaced === content) return { content, action: "unchanged" };
  return { content: replaced, action: "replaced" };
}

/**
 * Remove o bloco do conteúdo se existir. Pura.
 */
export function applyPointerRemove(content: string): {
  content: string;
  removed: boolean;
} {
  const found = findPointerBlock(content);
  if (!found) return { content, removed: false };
  // Remove o bloco + whitespace adjacente (newline depois do end marker)
  let before = content.slice(0, found.startIdx);
  let after = content.slice(found.endIdx);
  // Trim trailing newline do 'before' se 'after' começa com blank
  if (before.endsWith("\n\n") && after.startsWith("\n")) {
    before = before.slice(0, -1);
  } else if (before.endsWith("\n") && after.startsWith("\n")) {
    // já tem separador suficiente, não duplica
    after = after.replace(/^\n+/, "");
  }
  const merged = before + after;
  return { content: merged, removed: merged !== content };
}

/**
 * Insere/substitui o pointer no arquivo alvo. Idempotente.
 *
 * Usa safe-io com allowPointer=true (única exceção à regra #1, documentada
 * aqui). Lança PathOutsideAllowlistError se opts.file não for AGENTS.md
 * ou CLAUDE.md (defesa contra path injection).
 */
export async function insertPointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult> {
  const absRoot = nodePath.resolve(repoRoot);

  // Decide arquivo alvo
  const agentsExists = await safeIo.exists(absRoot, "AGENTS.md").catch(() => false);
  const claudeExists = await safeIo.exists(absRoot, "CLAUDE.md").catch(() => false);
  const file = pickPointerFile(agentsExists, claudeExists, opts.file);

  // Validação dupla: só AGENTS.md ou CLAUDE.md, mesmo se safe-io aceitar
  // (defesa em profundidade — safe-io já valida, mas custa nada)
  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }

  // Lê conteúdo atual (se existir) — usa safe-io com allowPointer
  let current = "";
  if (await safeIo.exists(absRoot, file, { allowPointer: true })) {
    current = await safeIo.readText(absRoot, file, { allowPointer: true });
  }

  // Calcula novo conteúdo
  const block = opts.block ?? buildPointerBlock();
  const { content: newContent, action } = applyPointerReplace(current, block);

  // Só escreve se mudou (idempotência em disco — evita no-op git diff)
  if (action === "unchanged") {
    return { file, action, bytesWritten: 0 };
  }

  await safeIo.writeText(absRoot, file, newContent, { allowPointer: true });
  return { file, action, bytesWritten: newContent.length - current.length };
}

/**
 * Remove o pointer do arquivo alvo. No-op se bloco não existir.
 */
export async function removePointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult> {
  const absRoot = nodePath.resolve(repoRoot);

  const agentsExists = await safeIo.exists(absRoot, "AGENTS.md").catch(() => false);
  const claudeExists = await safeIo.exists(absRoot, "CLAUDE.md").catch(() => false);
  const file = pickPointerFile(agentsExists, claudeExists, opts.file);

  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }

  if (!(await safeIo.exists(absRoot, file, { allowPointer: true }))) {
    return { file, action: "unchanged", bytesWritten: 0 };
  }
  const current = await safeIo.readText(absRoot, file, { allowPointer: true });
  const { content: newContent, removed } = applyPointerRemove(current);
  if (!removed) return { file, action: "unchanged", bytesWritten: 0 };

  await safeIo.writeText(absRoot, file, newContent, { allowPointer: true });
  return { file, action: "replaced", bytesWritten: newContent.length - current.length };
}

/**
 * Lê o arquivo alvo e retorna o status do pointer (presente, ação recente, etc).
 * Útil pro CLI reportar ao usuário.
 */
export async function readPointerStatus(
  repoRoot: string,
  opts: { file?: PointerFile } = {},
): Promise<{
  file: PointerFile | null;
  present: boolean;
  inner?: string;
}> {
  const absRoot = nodePath.resolve(repoRoot);

  // Se file foi passado, verifica só esse; senão checa AMBOS (qualquer um com bloco = presente)
  if (opts.file) {
    const exists = await safeIo.exists(absRoot, opts.file, { allowPointer: true }).catch(() => false);
    if (!exists) return { file: opts.file, present: false };
    const content = await safeIo.readText(absRoot, opts.file, { allowPointer: true });
    const found = findPointerBlock(content);
    return found
      ? { file: opts.file, present: true, inner: found.inner.trim() }
      : { file: opts.file, present: false };
  }

  for (const f of POINTER_FILES) {
    const exists = await safeIo.exists(absRoot, f, { allowPointer: true }).catch(() => false);
    if (!exists) continue;
    const content = await safeIo.readText(absRoot, f, { allowPointer: true });
    const found = findPointerBlock(content);
    if (found) {
      return { file: f, present: true, inner: found.inner.trim() };
    }
  }
  return { file: null, present: false };
}

/**
 * Helper de baixo nível: cria AGENTS.md/CLAUDE.md vazio se não existir.
 * Exposto pra testes e pra casos onde o caller quer garantir que o arquivo
 * existe antes de chamar insertPointer (mas insertPointer já trata isso).
 */
export async function ensurePointerFile(
  repoRoot: string,
  file: PointerFile,
): Promise<void> {
  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }
  const absRoot = nodePath.resolve(repoRoot);
  const exists = await safeIo.exists(absRoot, file, { allowPointer: true }).catch(() => false);
  if (!exists) {
    await safeIo.writeText(absRoot, file, "", { allowPointer: true });
  }
}

// Re-export pra que node:fs seja usado só internamente
export const _internal = { nodeFs };