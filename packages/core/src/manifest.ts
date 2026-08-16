/**
 * manifest — escrita do `.livewiki/.manifest.json` (correção #3 da revisão).
 *
 * SPEC §"Layout gerado no repo-alvo" + SPEC §"Pipeline batch": `.manifest.json`
 * é versionado — é o que faz handoff cross-máquina. Inclui:
 *   - version: manifest schema (current 2; v1 remains readable)
 *   - lastDocumentedCommit: SHA do último commit documentado
 *   - snapshotHash: sha256 of rendered livewiki content, excluding the
 *     manifest and versioned baseline audit state
 *     (OpenWiki convention — só regrava se mudou, anti-loop em CI)
 *   - updatedAt: ISO 8601
 *   - pendingBatch: compact progress presentation
 *   - artifactReceipts: deterministic proof for contract-bound tasks whose
 *     completion cannot be reconstructed from symbol baseline entries alone.
 *
 * Grava via safe-io (livewiki/ está na allowlist). Só regrava se mudou —
 * mantém `git diff` limpo em CI.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { sha256 } from "./hashes.js";
import type { PendingBatchRef } from "./batch-state.js";

export const MANIFEST_VERSION = 2;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
export const BASELINE_AUDIT_FILENAME = ".baseline.json";
const MAX_CONCURRENT_WRITE_ATTEMPTS = 32;

export interface ArtifactReceiptOutput {
  path: string;
  hash: string;
}

export interface ArtifactReceipt {
  taskId: string;
  evidenceHash: string;
  contract: string;
  artifacts: ArtifactReceiptOutput[];
}

export interface LivewikiManifest {
  version: number;
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  updatedAt: string;
  pendingBatch: PendingBatchRef | null;
  artifactReceipts: ArtifactReceipt[];
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
    return parseManifest(raw);
  } catch {
    return null;
  }
}

/**
 * Computes the rendered-wiki snapshot, excluding `.manifest.json` and
 * `.baseline.json`. The latter is audit state, not rendered documentation.
 *
 * Implementação: pra cada arquivo em `livewiki/` (recursivo), calcula
 * sha256 do conteúdo e concatena tudo num buffer, depois sha256 do buffer.
 * Determinístico porque a ordem de walk é alfabética (nodeFs.readdir
 * retorna ordem não-garantida — usamos sort pra garantir).
 */
export async function computeSnapshotHash(repoRoot: string): Promise<string> {
  const livewikiDir = nodePath.join(repoRoot, "livewiki");
  const files = await listFiles(livewikiDir);
  const filtered = files.filter(
    (file) => file !== MANIFEST_REL_PATH.split("/").pop()! &&
      file !== BASELINE_AUDIT_FILENAME &&
      !file.startsWith(`${MANIFEST_REL_PATH.split("/").pop()!}.tmp-`) &&
      !file.startsWith(`${BASELINE_AUDIT_FILENAME}.tmp-`),
  );
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
  const currentRaw = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false)
    ? await safeIo.readText(repoRoot, MANIFEST_REL_PATH).catch(() => null)
    : null;
  const current = currentRaw === null ? null : parseManifest(currentRaw);
  if (current && manifestsEqual(current, manifest)) {
    return false;
  }
  const json = serializeManifest(manifest);
  await safeIo.writeTextAtomic(repoRoot, MANIFEST_REL_PATH, json, {
    expected: currentRaw,
    lockRelPath: ".livewiki/manifest.lock",
  });
  return true;
}

/** Update operational manifest fields without dropping durable receipts. */
export async function writeManifestState(
  repoRoot: string,
  args: Omit<Parameters<typeof buildManifest>[0], "artifactReceipts">,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const currentRaw = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false)
      ? await safeIo.readText(repoRoot, MANIFEST_REL_PATH).catch(() => null)
      : null;
    const current = currentRaw === null ? null : parseManifest(currentRaw);
    const next = buildManifest({
      ...args,
      artifactReceipts: current?.artifactReceipts ?? [],
    });
    if (current && manifestsEqual(current, next)) return false;
    try {
      await safeIo.writeTextAtomic(repoRoot, MANIFEST_REL_PATH, serializeManifest(next), {
        expected: currentRaw,
        lockRelPath: ".livewiki/manifest.lock",
      });
      return true;
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  return false;
}

/** Merge one contract-bound artifact receipt without losing concurrent tasks. */
export async function recordArtifactReceipt(
  repoRoot: string,
  receipt: ArtifactReceipt,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const currentRaw = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false)
      ? await safeIo.readText(repoRoot, MANIFEST_REL_PATH).catch(() => null)
      : null;
    const current = currentRaw === null ? null : parseManifest(currentRaw);
    if (currentRaw !== null && current === null) {
      throw new Error("cannot record artifact receipt in an incompatible manifest");
    }
    const snapshotHash = await computeSnapshotHash(repoRoot);
    const next = buildManifest({
      lastDocumentedCommit: current?.lastDocumentedCommit ?? null,
      snapshotHash,
      pendingBatch: current?.pendingBatch ?? null,
      artifactReceipts: upsertArtifactReceipt(current?.artifactReceipts ?? [], receipt),
    });
    if (current && manifestsEqual(current, next)) return false;
    try {
      await safeIo.writeTextAtomic(repoRoot, MANIFEST_REL_PATH, serializeManifest(next), {
        expected: currentRaw,
        lockRelPath: ".livewiki/manifest.lock",
      });
      return true;
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  return false;
}

/** Remove receipts whose generated outputs were explicitly retired. */
export async function removeArtifactReceiptsForPaths(
  repoRoot: string,
  paths: readonly string[],
): Promise<boolean> {
  const removed = new Set(paths);
  if (removed.size === 0) return false;
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const currentRaw = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false)
      ? await safeIo.readText(repoRoot, MANIFEST_REL_PATH).catch(() => null)
      : null;
    if (currentRaw === null) return false;
    const current = parseManifest(currentRaw);
    if (current === null) throw new Error("cannot retire receipts from an incompatible manifest");
    const retained = current.artifactReceipts.filter((receipt) =>
      !receipt.artifacts.some((artifact) => removed.has(artifact.path)));
    if (retained.length === current.artifactReceipts.length) return false;
    const next = buildManifest({
      lastDocumentedCommit: current.lastDocumentedCommit,
      snapshotHash: await computeSnapshotHash(repoRoot),
      pendingBatch: current.pendingBatch,
      artifactReceipts: retained,
    });
    try {
      await safeIo.writeTextAtomic(repoRoot, MANIFEST_REL_PATH, serializeManifest(next), {
        expected: currentRaw,
        lockRelPath: ".livewiki/manifest.lock",
      });
      return true;
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  return false;
}

/** Refresh receipt hashes only for outputs rewritten by trusted deterministic navigation. */
export async function refreshArtifactReceiptHashes(
  repoRoot: string,
  changedPaths: readonly string[],
): Promise<boolean> {
  const changed = new Set(changedPaths);
  if (changed.size === 0) return false;
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const currentRaw = await safeIo.exists(repoRoot, MANIFEST_REL_PATH).catch(() => false)
      ? await safeIo.readText(repoRoot, MANIFEST_REL_PATH).catch(() => null)
      : null;
    if (currentRaw === null) return false;
    const current = parseManifest(currentRaw);
    if (current === null) throw new Error("cannot refresh receipts in an incompatible manifest");
    let refreshed = false;
    const receipts: ArtifactReceipt[] = [];
    for (const receipt of current.artifactReceipts) {
      if (!receipt.artifacts.some((artifact) => changed.has(artifact.path))) {
        receipts.push(receipt);
        continue;
      }
      const artifacts: ArtifactReceiptOutput[] = [];
      for (const artifact of receipt.artifacts) {
        const content = await safeIo.readText(repoRoot, artifact.path);
        artifacts.push({ path: artifact.path, hash: sha256(content) });
      }
      receipts.push({ ...receipt, artifacts });
      refreshed = true;
    }
    if (!refreshed) return false;
    const next = buildManifest({
      lastDocumentedCommit: current.lastDocumentedCommit,
      snapshotHash: await computeSnapshotHash(repoRoot),
      pendingBatch: current.pendingBatch,
      artifactReceipts: receipts,
    });
    if (manifestsEqual(current, next)) return false;
    try {
      await safeIo.writeTextAtomic(repoRoot, MANIFEST_REL_PATH, serializeManifest(next), {
        expected: currentRaw,
        lockRelPath: ".livewiki/manifest.lock",
      });
      return true;
    } catch (error) {
      if (!isConcurrentWrite(error) || attempt === MAX_CONCURRENT_WRITE_ATTEMPTS - 1) throw error;
      await yieldToConcurrentWriter(attempt);
    }
  }
  return false;
}

function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean {
  // updatedAt é timestamp, não conteúdo — ignorado na comparação.
  // Caso contrário, cada chamada geraria updatedAt novo e regravaria sempre,
  // quebrando o anti-loop de CI (git diff mostraria mudança todo commit).
  return (
    a.version === b.version &&
    a.snapshotHash === b.snapshotHash &&
    a.lastDocumentedCommit === b.lastDocumentedCommit &&
    pendingBatchEqual(a.pendingBatch, b.pendingBatch) &&
    artifactReceiptsEqual(a.artifactReceipts, b.artifactReceipts)
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
  artifactReceipts?: ArtifactReceipt[];
}): LivewikiManifest {
  const artifactReceipts = normalizeArtifactReceipts(args.artifactReceipts ?? []);
  if (artifactReceipts === null) throw new Error("invalid artifact receipts");
  return {
    version: MANIFEST_VERSION,
    lastDocumentedCommit: args.lastDocumentedCommit,
    snapshotHash: args.snapshotHash,
    updatedAt: new Date().toISOString(),
    pendingBatch: args.pendingBatch,
    artifactReceipts,
  };
}

export function upsertArtifactReceipt(
  receipts: readonly ArtifactReceipt[],
  receipt: ArtifactReceipt,
): ArtifactReceipt[] {
  const normalized = normalizeArtifactReceipts([...receipts, receipt], true);
  if (normalized === null) throw new Error("invalid artifact receipt");
  return normalized;
}

export function serializeManifest(manifest: LivewikiManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function artifactReceiptsEqual(
  left: readonly ArtifactReceipt[],
  right: readonly ArtifactReceipt[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeArtifactReceipts(
  value: unknown,
  replaceDuplicate = false,
): ArtifactReceipt[] | null {
  if (!Array.isArray(value)) return null;
  const byTask = new Map<string, ArtifactReceipt>();
  for (const candidate of value) {
    if (!isRecord(candidate) ||
        typeof candidate.taskId !== "string" || candidate.taskId.length === 0 ||
        typeof candidate.evidenceHash !== "string" || !isHash(candidate.evidenceHash) ||
        typeof candidate.contract !== "string" || candidate.contract.length === 0 ||
        !Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
      return null;
    }
    if (byTask.has(candidate.taskId) && !replaceDuplicate) return null;
    const outputs: ArtifactReceiptOutput[] = [];
    const paths = new Set<string>();
    for (const output of candidate.artifacts) {
      if (!isRecord(output) || typeof output.path !== "string" || output.path.length === 0 ||
          !output.path.startsWith("livewiki/") || output.path.includes("\\") ||
          typeof output.hash !== "string" || !isHash(output.hash) || paths.has(output.path)) {
        return null;
      }
      paths.add(output.path);
      outputs.push({ path: output.path, hash: output.hash });
    }
    outputs.sort((left, right) => compareStrings(left.path, right.path));
    byTask.set(candidate.taskId, {
      taskId: candidate.taskId,
      evidenceHash: candidate.evidenceHash,
      contract: candidate.contract,
      artifacts: outputs,
    });
  }
  return [...byTask.values()].sort((left, right) => compareStrings(left.taskId, right.taskId));
}

function parseManifest(raw: string): LivewikiManifest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LivewikiManifest>;
    if (parsed.version !== 1 && parsed.version !== MANIFEST_VERSION) return null;
    if (typeof parsed.snapshotHash !== "string") return null;
    const receipts = normalizeArtifactReceipts(parsed.artifactReceipts ?? []);
    if (receipts === null) return null;
    return {
      version: parsed.version,
      lastDocumentedCommit:
        typeof parsed.lastDocumentedCommit === "string" || parsed.lastDocumentedCommit === null
          ? parsed.lastDocumentedCommit
          : null,
      snapshotHash: parsed.snapshotHash,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      pendingBatch: parsed.pendingBatch ?? null,
      artifactReceipts: receipts,
    };
  } catch {
    return null;
  }
}

function isConcurrentWrite(error: unknown): boolean {
  return error instanceof safeIo.CompareAndSwapConflictError ||
    error instanceof safeIo.WriteLockBusyError;
}

function yieldToConcurrentWriter(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 100)));
}

function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
