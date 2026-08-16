/** Durable commit boundary for one validated, contract-bound documentation task. */

import * as safeIo from "./safe-io.js";
import {
  advanceContractBaseline,
  removeBaselinePages,
} from "./baseline-operations.js";
import { sha256 } from "./hashes.js";
import {
  readManifest,
  recordArtifactReceipt,
  removeArtifactReceiptsForPaths,
  type ArtifactReceiptOutput,
} from "./manifest.js";
import type { TaskArtifacts } from "./batch-state.js";

export type ContractTaskKind =
  | "file-page"
  | "folder-page"
  | "flow"
  | "topic"
  | "understanding";

export interface CommitDocumentationTaskOptions {
  repoRoot: string;
  taskId: string;
  kind: ContractTaskKind;
  page: string;
  symbolKeys: readonly string[];
  evidence: unknown;
  artifacts: TaskArtifacts;
}

export async function retireDocumentationArtifacts(
  repoRoot: string,
  removedPaths: readonly string[],
): Promise<void> {
  const pages = removedPaths.filter((path) => path.endsWith(".md"));
  await removeBaselinePages(repoRoot, pages);
  await removeArtifactReceiptsForPaths(repoRoot, removedPaths);
}

export interface CommitDocumentationTaskResult {
  baselineWritten: boolean;
  receiptWritten: boolean;
  evidenceHash: string;
}

export interface RecoverDocumentationReceiptOptions {
  repoRoot: string;
  taskId: string;
  kind: Exclude<ContractTaskKind, "file-page">;
  evidence: unknown;
  page: string;
  diagram?: string;
}

/** Reconstructs a completed checkpoint only from exact, versioned receipt proof. */
export async function recoverDocumentationReceipt(
  options: RecoverDocumentationReceiptOptions,
): Promise<TaskArtifacts | null> {
  const manifest = await readManifest(options.repoRoot);
  const receipt = manifest?.artifactReceipts.find((item) => item.taskId === options.taskId);
  if (receipt === undefined ||
      receipt.contract !== contractVersion(options.kind) ||
      receipt.evidenceHash !== sha256(canonicalJson(options.evidence))) {
    return null;
  }
  const expectedPaths = [options.page, ...(options.diagram ? [options.diagram] : [])]
    .sort(compareText);
  if (receipt.artifacts.length !== expectedPaths.length ||
      receipt.artifacts.some((artifact, index) => artifact.path !== expectedPaths[index])) {
    return null;
  }
  for (const artifact of receipt.artifacts) {
    const content = await safeIo.readText(options.repoRoot, artifact.path).catch(() => null);
    if (content === null || sha256(content) !== artifact.hash) return null;
  }
  const pageOutput = receipt.artifacts.find((artifact) => artifact.path === options.page);
  const diagramOutput = options.diagram === undefined
    ? undefined
    : receipt.artifacts.find((artifact) => artifact.path === options.diagram);
  if (pageOutput === undefined || (options.diagram !== undefined && diagramOutput === undefined)) {
    return null;
  }
  return {
    wikiPath: options.page,
    pageHash: pageOutput.hash,
    ...(diagramOutput === undefined
      ? {}
      : { diagramPath: diagramOutput.path, diagramHash: diagramOutput.hash }),
  };
}

export async function commitDocumentationTask(
  options: CommitDocumentationTaskOptions,
): Promise<CommitDocumentationTaskResult> {
  if (options.artifacts.wikiPath !== options.page || !options.artifacts.pageHash) {
    throw new Error(`task ${options.taskId} has no matching page artifact`);
  }
  const outputs = await validateArtifactHashes(options.repoRoot, options.artifacts);
  const baseline = await advanceContractBaseline(
    options.repoRoot,
    options.page,
    options.symbolKeys,
  );
  const evidenceHash = sha256(canonicalJson(options.evidence));
  let receiptWritten = false;
  if (options.kind !== "file-page") {
    receiptWritten = await recordArtifactReceipt(options.repoRoot, {
      taskId: options.taskId,
      evidenceHash,
      contract: contractVersion(options.kind),
      artifacts: outputs,
    });
  }
  return { baselineWritten: baseline.written, receiptWritten, evidenceHash };
}

async function validateArtifactHashes(
  repoRoot: string,
  artifacts: TaskArtifacts,
): Promise<ArtifactReceiptOutput[]> {
  if (!artifacts.wikiPath || !artifacts.pageHash) throw new Error("missing page artifact");
  const outputs: ArtifactReceiptOutput[] = [{
    path: artifacts.wikiPath,
    hash: artifacts.pageHash,
  }];
  if (Boolean(artifacts.diagramPath) !== Boolean(artifacts.diagramHash)) {
    throw new Error("diagram artifact path/hash must be present together");
  }
  if (artifacts.diagramPath && artifacts.diagramHash) {
    outputs.push({ path: artifacts.diagramPath, hash: artifacts.diagramHash });
  }
  for (const output of outputs) {
    const source = await safeIo.readText(repoRoot, output.path);
    if (sha256(source) !== output.hash) {
      throw new Error(`artifact changed before durable commit: ${output.path}`);
    }
  }
  return outputs.sort((left, right) => compareText(left.path, right.path));
}

function contractVersion(kind: Exclude<ContractTaskKind, "file-page">): string {
  switch (kind) {
    case "folder-page": return "folder-page-v1";
    case "flow": return "flow-v1";
    case "topic": return "topic-v1";
    case "understanding": return "understanding-v1";
  }
}

/** Stable JSON for receipt evidence; object insertion order is irrelevant. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(compareText).map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
