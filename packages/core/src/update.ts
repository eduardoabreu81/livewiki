/**
 * update — modo incremental (coração do produto, Fase 5).
 *
 * SPEC §"Comandos CLI":
 *   livewiki update — modo incremental: dado o diff desde lastDocumentedCommit,
 *   lista a dívida e (a) emite o "pacote de trabalho" para o agente em sessão
 *   documentar, ou (b) com --llm chama a API configurada para pagar a dívida.
 *
 * SPEC §"Contabilidade de tokens (Fase 3)":
 *   Incremental: o `update` registra o tamanho (tokens estimados por tokenizer)
 *   do pacote de trabalho emitido ao agente e da doc escrita de volta.
 *   Métricas em tabela própria no `.livewiki/`, expostas via `status --json`.
 *
 * Esse número é a tese do produto ("800 tokens em vez de reler o repo"): o
 * pacote é focado — só dívida + snippets das âncoras afetadas + chaves
 * válidas — não o repo inteiro.
 *
 * Estrutura do pacote (WorkPackage):
 *   - manifest: dados do manifest (lastDocumentedCommit, pendingBatch)
 *   - debt: items abertos (changed/moved/deleted) com assignee
 *   - snippets: pra cada debt item, trecho do source atual em torno do symbol
 *     (janela de N linhas centrada em start_line do symbol — bounded)
 *   - validAnchors: chaves de symbols ativos que o agente pode ancorar
 *   - tokensEstimated: tamanho do pacote (chars / 4 — heurística comum;
 *     GPT tokenizer reporta ~4 chars/token pra inglês/code)
 *
 * Ações do agente após receber o pacote (SPEC §Skill "document-as-you-go"):
 *   1. Para cada debt item: atualiza o markdown correspondente (ou cria
 *      se não existir) — ancorando nos symbols válidos.
 *   2. Roda `livewiki verify` pra confirmar zero issues.
 *   3. (Opcional) `livewiki update --record-write <tokens>` pra contabilizar
 *      o tamanho da doc escrita de volta — alimenta a métrica de economia.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { run as runStatus, type DebtItem } from "./status.js";
import { readManifest } from "./manifest.js";
import { recordUpdateMetric, type UpdateMetric } from "./update-metrics.js";
// Backlog #2 (plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
// Item 2): the work package carries the additive `impact` block. The import
// edge change-impact.js → update.js (for the hoisted `snippetForSymbol`)
// forms a cycle with this one; it is safe because every cross-module use is a
// hoisted function declaration referenced only at call time.
import { computeChangeImpact, type ChangeImpact } from "./change-impact.js";

/** Estimativa padrão de tokens: ~4 chars/token (code/EN). */
export const CHARS_PER_TOKEN = 4;

/** Janela de linhas em torno do symbol no snippet (default ±20 linhas). */
export const SNIPPET_WINDOW = 20;

export interface WorkPackageOptions {
  /** Idioma dos messages humanos (default: "en"). Hoje não usado, mas reserva. */
  language?: "en" | "pt-BR";
  /** Override do tamanho da janela de snippet (em linhas). Default 20. */
  snippetWindow?: number;
  /** Limite de snippets (defesa — não incluir 1000 se a dívida for grande). */
  maxSnippets?: number;
}

export interface DebtSnippet {
  /** Symbol key (path/to/file.ts#name) — usado pelo agente pra escrever a âncora. */
  symbolKey: string;
  /** Conteúdo do source atual (janela em torno do symbol). */
  snippet: string;
  /** Path absoluto do arquivo no disco (relativo a repoRoot). */
  filePath: string;
  /** Linha inicial do symbol (1-indexed) — útil pra debug. */
  startLine: number;
  /** Linha final do symbol (1-indexed). */
  endLine: number;
}

export interface WorkPackage {
  /** Dados do manifest lido. Null se não existir (repo nunca inicializado). */
  manifest: {
    lastDocumentedCommit: string | null;
    pendingBatch: unknown;
  } | null;
  /** Items de dívida aberta — o agente paga cada um. */
  debt: DebtItem[];
  /** Snippets do source para cada debt item (janela em torno do symbol). */
  snippets: DebtSnippet[];
  /** Chaves de symbols ativos que o agente pode ancorar (subset das debt). */
  validAnchors: string[];
  /** Estimativa de tokens do pacote (chars / CHARS_PER_TOKEN). */
  tokensEstimated: number;
  /** Tamanho em bytes do pacote serializado. */
  bytes: number;
  /** Idioma dos messages humanos. */
  language: "en" | "pt-BR";
  /**
   * Additive bounded change-impact context (backlog #2, Item 2 of
   * docs/plans/2026-07-28-change-impact-and-index-freshness.md): working-tree
   * changed symbols, affected pages, direct importers and snippets — the
   * same payload `livewiki_impact` returns with an empty symbolKey.
   * Read-only; degrades to `notGitRepo: true` outside a git repository.
   */
  impact: ChangeImpact;
}

/**
 * Carrega o pacote de trabalho: manifest + dívida + snippets + âncoras
 * válidas + contabilidade. NÃO chama LLM — emite o pacote pra consumo
 * do agente em sessão (ou do `--llm` que está em outro lugar).
 *
 * Side effect: registra métrica de "pacote emitido" em update-metrics.json
 * (escrita idempotente — só regrava se algo mudou).
 */
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage> {
  const absRoot = nodePath.resolve(repoRoot);
  const language = opts.language ?? "en";

  // 1) Manifest
  const manifest = await readManifest(absRoot);
  const manifestView = manifest
    ? {
        lastDocumentedCommit: manifest.lastDocumentedCommit,
        pendingBatch: manifest.pendingBatch,
      }
    : null;

  // 2) Dívida aberta (via status — fonte única de verdade da Fase 2)
  const status = await runStatus(absRoot);
  const debt = status.debt.items;

  // 3) Snippets do source atual para cada debt item que tem symbol_key
  const window = opts.snippetWindow ?? SNIPPET_WINDOW;
  const maxSnippets = opts.maxSnippets ?? 50;
  const snippets: DebtSnippet[] = [];
  for (const item of debt.slice(0, maxSnippets)) {
    if (!item.symbol_key || !item.wiki_path) continue;
    const snippet = await snippetForSymbol(absRoot, item.symbol_key, window);
    if (snippet) snippets.push(snippet);
  }

  // 4) Chaves válidas: subset das symbol_keys que o agente pode ancorar.
  //    São exatamente os symbols ativos — limitado aos debt items pra
  //    reduzir ruído (o agente só precisa ancorar nesses).
  const validAnchors = Array.from(
    new Set(debt.map((d) => d.symbol_key).filter((k): k is string => k !== null)),
  ).sort();

  // 5) Change-impact context (backlog #2): bounded working-tree impact,
  //    read-only. Degrades to `notGitRepo: true` outside git — never throws.
  const impact = await computeChangeImpact(absRoot);

  // 6) Monta o pacote + estima tokens
  const pkg: WorkPackage = {
    manifest: manifestView,
    debt,
    snippets,
    validAnchors,
    tokensEstimated: 0, // preenchido abaixo
    bytes: 0,
    language,
    impact,
  };
  const json = JSON.stringify(pkg, null, 2);
  pkg.tokensEstimated = Math.ceil(json.length / CHARS_PER_TOKEN);
  pkg.bytes = json.length;

  // 7) Contabilidade (SPEC §Contabilidade): registra métrica incremental.
  //    Side effect em .livewiki/update_metrics.json (não bloqueia o retorno).
  await recordUpdateMetric(absRoot, {
    kind: "package_emitted",
    timestamp: Date.now(),
    tokensEstimated: pkg.tokensEstimated,
    bytes: pkg.bytes,
    debtCount: debt.length,
  });

  return pkg;
}

/**
 * Lê o source do arquivo da âncora e retorna a janela em torno do symbol.
 * Retorna null se o arquivo não existe ou o símbolo não tem start/end.
 *
 * Exported (hoisted) for the change-impact package (backlog #2) — reused,
 * never duplicated. Behavior unchanged.
 */
export async function snippetForSymbol(
  absRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null> {
  const [filePath, symName] = symbolKey.split("#");
  if (!filePath || !symName) return null;

  let source: string;
  try {
    source = await nodeFs.readFile(nodePath.join(absRoot, filePath), "utf8");
  } catch {
    return null; // arquivo sumiu
  }
  const lines = source.split("\n");

  // Pega linhas do símbolo — busca simples por nome. Para Fase 5 é OK;
  // Fase 6+ pode usar o índice (symbol.start_line/end_line) direto.
  let symStart = -1;
  let symEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // match simples: linha que define function/classe com o nome
    if (
      symStart === -1 &&
      (line.includes(`function ${symName}`) ||
        line.includes(`class ${symName}`) ||
        line.includes(`def ${symName}`) ||
        line.includes(`const ${symName}`) ||
        line.includes(`export function ${symName}`) ||
        line.includes(`export class ${symName}`) ||
        line.includes(`export const ${symName}`) ||
        line.includes(`export async function ${symName}`))
    ) {
      symStart = i;
      // Estimativa: symbols duram ~20 linhas. Bom o bastante pro snippet.
      symEnd = Math.min(lines.length, i + window);
    }
  }

  // Se não achou pelo nome, usa o índice de símbolos (mais confiável)
  if (symStart === -1) {
    const indexed = await lookupSymbol(absRoot, symbolKey);
    if (indexed) {
      symStart = indexed.startLine - 1; // 0-indexed
      symEnd = indexed.endLine;
    } else {
      // Sem jeito de localizar — usa a primeira linha do arquivo como
      // snippet mínimo. Melhor que nada pro agente ter contexto.
      symStart = 0;
      symEnd = Math.min(lines.length, window);
    }
  }

  const fromLine = Math.max(0, symStart - 3); // 3 linhas de contexto antes
  const toLine = Math.min(lines.length, symEnd + 3); // 3 depois
  const snippetLines: string[] = [];
  for (let i = fromLine; i < toLine; i++) {
    snippetLines.push(`${i + 1}: ${lines[i] ?? ""}`);
  }

  return {
    symbolKey,
    filePath,
    snippet: snippetLines.join("\n"),
    startLine: symStart + 1,
    endLine: symEnd,
  };
}

/** Look up no DB pra pegar start/end_line exatos (mais confiável). */
async function lookupSymbol(
  absRoot: string,
  symbolKey: string,
): Promise<{ startLine: number; endLine: number } | null> {
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const row = db
      .prepare("SELECT start_line, end_line FROM symbols WHERE key = ? AND status = 'active'")
      .get(symbolKey) as { start_line: number; end_line: number } | undefined;
    if (!row) return null;
    return { startLine: row.start_line, endLine: row.end_line };
  } finally {
    db.close();
  }
}

/**
 * Helper: registra o tamanho da doc escrita de volta pelo agente.
 * Chamado pelo skill/CLI depois do agente (ou humano) atualizar a wiki.
 *
 * Diferente de `recordUpdateMetric(kind='package_emitted')` — este é
 * `kind='write_received'` e rastreia o OUTPUT (economia: pacote grande
 * → doc pequena = boa economia; pacote grande → doc grande = má economia).
 */
export async function recordDocWrittenBack(
  repoRoot: string,
  payload: {
    wikiPath: string;
    bytes: number;
    tokensEstimated: number;
  },
): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  await recordUpdateMetric(absRoot, {
    kind: "write_received",
    timestamp: Date.now(),
    ...payload,
  });
}

// Re-exporta tipo de métrica pra conveniência do CLI
export type { UpdateMetric };