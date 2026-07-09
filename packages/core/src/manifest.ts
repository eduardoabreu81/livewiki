/**
 * manifest — escrita do `.livewiki/.manifest.json` (correção #3 da revisão).
 *
 * SPEC §"Layout gerado no repo-alvo" + SPEC §"Pipeline batch": `.manifest.json`
 * é versionado — é o que faz handoff cross-máquina. Inclui:
 *   - version: schema do manifest (atual 1)
 *   - lastDocumentedCommit: SHA do último commit documentado
 *   - snapshotHash: sha256 do conteúdo de livewiki/ EXCLUINDO o próprio manifest
 *     (OpenWiki convention — só regrava se mudou, anti-loop em CI)
 *   - updatedAt: ISO 8601
 *   - pendingBatch: { runId, stage, done, total } | null — habilita handoff
 *     cross-máquina de batch interrompido (outra máquina lê, vê o run
 *     pendente, retoma com `batch resume`).
 *
 * Grava via safe-io (livewiki/ está na allowlist). Só regrava se mudou —
 * mantém `git diff` limpo em CI.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { sha256 } from "./hashes.js";
import type { PendingBatchRef } from "./batch-state.js";

export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";

export interface LivewikiManifest {
  version: number;
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  updatedAt: string;
  pendingBatch: PendingBatchRef | null;
}

/**
 * Lê o manifest do disco (ou null se não existir / corrupto).
 * Tolerante a corrupção — retorna null em vez de throw (CI-friendly).
 */
export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null> {
  const exists = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false);
  if (!exists) return null;
  try {
    const raw = await safeIo.readText(repoRoot, MANIFEST_REL_PATH);
    const parsed = JSON.parse(raw) as LivewikiManifest;
    if (typeof parsed.version !== "number") return null;
    if (typeof parsed.snapshotHash !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Computa o snapshotHash do conteúdo de `livewiki/` EXCLUINDO o próprio
 * manifest. Hash determinístico (ordem de arquivo alfabética).
 *
 * Implementação: pra cada arquivo em `livewiki/` (recursivo), calcula
 * sha256 do conteúdo e concatena tudo num buffer, depois sha256 do buffer.
 * Determinístico porque a ordem de walk é alfabética (nodeFs.readdir
 * retorna ordem não-garantida — usamos sort pra garantir).
 */
export async function computeSnapshotHash(repoRoot: string): Promise<string> {
  const livewikiDir = nodePath.join(repoRoot, "livewiki");
  // Lista todos os arquivos recursivamente, excluindo o manifest.
  const files = await listFiles(livewikiDir);
  const filtered = files.filter((f) => !f.endsWith(MANIFEST_REL_PATH.split("/").pop()!));
  // Sort pra determinismo
  filtered.sort();

  const h = sha256; // alias
  // Combina: pra cada arquivo, "relpath\n<sha256(conteudo)>\n"
  const concat = await Promise.all(
    filtered.map(async (rel) => {
      const abs = nodePath.join(livewikiDir, rel);
      const content = await nodeFs.readFile(abs, "utf8");
      return `${rel}\n${h(content)}\n`;
    }),
  );
  return h(concat.join(""));
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = nodePath.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(abs);
      } else {
        const rel = nodePath.relative(dir, abs).split(nodePath.sep).join("/");
        out.push(rel);
      }
    }
  }
  return out;
}

/**
 * Escreve o manifest NO DISCO via safe-io. SÓ regrava se o conteúdo mudou
 * (compara snapshotHash + pendingBatch + updatedAt). Idempotente.
 *
 * Retorna true se escreveu, false se já estava igual (anti-loop CI).
 */
export async function writeManifestIfChanged(
  repoRoot: string,
  manifest: LivewikiManifest,
): Promise<boolean> {
  const current = await readManifest(repoRoot);
  if (current && manifestsEqual(current, manifest)) {
    return false;
  }
  const json = JSON.stringify(manifest, null, 2) + "\n";
  await safeIo.writeText(repoRoot, MANIFEST_REL_PATH, json);
  return true;
}

function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean {
  // updatedAt é timestamp, não conteúdo — ignorado na comparação.
  // Caso contrário, cada chamada geraria updatedAt novo e regravaria sempre,
  // quebrando o anti-loop de CI (git diff mostraria mudança todo commit).
  return (
    a.version === b.version &&
    a.snapshotHash === b.snapshotHash &&
    a.lastDocumentedCommit === b.lastDocumentedCommit &&
    pendingBatchEqual(a.pendingBatch, b.pendingBatch)
  );
}

function pendingBatchEqual(a: PendingBatchRef | null, b: PendingBatchRef | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.runId === b.runId && a.stage === b.stage && a.done === b.done && a.total === b.total;
}

/** Helper pra criar manifest novo a partir do estado atual. */
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
}): LivewikiManifest {
  return {
    version: MANIFEST_VERSION,
    lastDocumentedCommit: args.lastDocumentedCommit,
    snapshotHash: args.snapshotHash,
    updatedAt: new Date().toISOString(),
    pendingBatch: args.pendingBatch,
  };
}