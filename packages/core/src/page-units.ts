/**
 * Real repository page units (#29) — the deterministic planner.
 *
 * Principle (maintainer ruling 2026-08-08): the page unit is the unit of
 * human curiosity — a FILE or a FOLDER, because those are the units a
 * reader can see in the repository. The old module chunks (`core-src-03`,
 * buckets of an 80-symbol cut) never reach disk: chunking is a generation
 * concern (budget, retry, `--only`), a page is a presentation concern.
 *
 * Product rule (same ruling): NO special machinery per file type. Every
 * indexed file is accounted for on exactly one real page — its own file
 * page when it bears symbols, a line on the folder page otherwise. Test
 * files never get pages: a 1:1 same-name pairing is a verifiable fact and
 * becomes a pointer on the product file's page; a test matched only by
 * name prefix is reported as "likely" (never asserted); a test matched by
 * nothing is registered as an ORPHAN on the folder page — the tool states
 * the anomaly instead of hiding it or force-fitting it.
 *
 * This module is PURE and deterministic: same input → same units, byte
 * identical. No I/O, no Date, no randomness.
 */

import { classifyPathRole, makeUniqueDeterministicIds, type PathRole, type PathRoleConfig } from "./modules.js";

/** Disposition of an indexed file inside its folder page. */
export type FileDisposition =
  /** Symbol-bearing non-test file: gets its own file page. */
  | "page"
  /** Non-test file without extracted symbols: one line on the folder page. */
  | "inert"
  /** Test file with a 1:1 same-name product counterpart on disk (a fact). */
  | "test-paired"
  /** Test file matched to a product file only by name prefix ("likely"). */
  | "test-likely"
  /** Test file matched by nothing: registered anomaly. */
  | "test-orphan";

export interface FileUnit {
  readonly kind: "file";
  /** Globally unique unit id: `<folderId>/<fileBase>` (used as task target). */
  readonly id: string;
  /** Wiki path of the page, e.g. `livewiki/core-src/batch.md`. */
  readonly pagePath: string;
  /** Repo-relative source path. */
  readonly filePath: string;
  /** Owning folder unit id. */
  readonly folderId: string;
  readonly symbolCount: number;
  readonly sizeBytes: number;
  /**
   * True when the file's source exceeds the split threshold: the page is
   * generated plan-then-write (D2), invisible on disk.
   */
  readonly oversizedSource: boolean;
  /** Same-name test file on disk (`batch.ts` ↔ `batch.test.ts`). Fact. */
  readonly pairedTestPath?: string;
  /** Prefix-only matches. Reported as "likely", never asserted. */
  readonly likelyTestPaths: readonly string[];
}

export interface FolderEntry {
  readonly filePath: string;
  readonly disposition: FileDisposition;
  /** Present only when disposition is "page". */
  readonly pagePath?: string;
  /**
   * Present only when disposition is "test-likely": the product file this
   * test plausibly covers (name-prefix match — report as "likely", never
   * assert).
   */
  readonly likelyProductPath?: string;
}

export interface FolderUnit {
  readonly kind: "folder";
  /** Globally unique folder id (module-style, e.g. `core-src`). */
  readonly id: string;
  /** Wiki path of the folder page, e.g. `livewiki/core-src/index.md`. */
  readonly pagePath: string;
  /** Repo-relative directory ("" for the repository root). */
  readonly dirPath: string;
  readonly entries: readonly FolderEntry[];
}

export type PageUnit = FileUnit | FolderUnit;

export interface PageUnitsPlan {
  readonly fileUnits: readonly FileUnit[];
  readonly folderUnits: readonly FolderUnit[];
}

export interface PlanPageUnitsOptions {
  readonly pathRoles?: PathRoleConfig;
  /**
   * Source-bytes threshold above which a file page is generated
   * plan-then-write (D2). Default {@link DEFAULT_FILE_SPLIT_SOURCE_BYTES}.
   * `0` disables (no file is ever oversized).
   */
  readonly fileSplitSourceBytes?: number;
}

/**
 * Default split threshold, aligned with the stage-4 context char budget:
 * a file whose source fits the budget is documented from full source in a
 * single call; above it, D2 plan-then-write applies.
 */
export const DEFAULT_FILE_SPLIT_SOURCE_BYTES = 60_000;

/**
 * Directory names already owned by livewiki under `livewiki/`. A folder id
 * colliding with one of these is suffixed `-files` so the wiki tree never
 * mixes page units with the reserved hubs.
 */
const RESERVED_WIKI_DIRS = new Set([
  "topics",
  "flows",
  "architecture",
  "diagrams",
  "auxiliary",
]);

/** Test infixes recognized for same-name pairing (`.test.`/`.spec.`). */
const TEST_INFIX_RE = /\.(test|spec)(\.[^.]+)$/;

/**
 * Strip the test infix: `batch.test.ts` → `batch.ts`. Returns null when the
 * path has no test infix.
 */
export function stripTestInfix(fileName: string): string | null {
  const m = TEST_INFIX_RE.exec(fileName);
  if (m === null) return null;
  return fileName.slice(0, m.index) + m[2]!;
}

/** Slug for a file page inside its folder: basename minus extension. */
function fileBaseName(filePath: string): string {
  const name = filePath.split("/").pop()!;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i < 0 ? "" : filePath.slice(0, i);
}

/**
 * Plan the real page units for a repository.
 *
 * `filePaths` is the active indexed inventory (the same set stage 1
 * produced); `symbolCountByPath` carries AST-derived symbol counts
 * (missing entry = 0); `sizeByPath` carries source sizes in bytes
 * (missing entry = 0, never oversized).
 *
 * Output invariants:
 * - every input path appears in EXACTLY ONE folder entry (exact partition);
 * - every symbol-bearing non-test file has exactly one file unit;
 * - ids and page paths are globally unique and deterministic.
 */
export function planPageUnits(
  input: {
    filePaths: readonly string[];
    symbolCountByPath: ReadonlyMap<string, number>;
    sizeByPath?: ReadonlyMap<string, number>;
  },
  opts: PlanPageUnitsOptions = {},
): PageUnitsPlan {
  const threshold =
    opts.fileSplitSourceBytes === undefined
      ? DEFAULT_FILE_SPLIT_SOURCE_BYTES
      : opts.fileSplitSourceBytes;

  const filePaths = [...input.filePaths].sort((a, b) => a.localeCompare(b));
  const symbolCountOf = (p: string) => input.symbolCountByPath.get(p) ?? 0;
  const sizeOf = (p: string) => input.sizeByPath?.get(p) ?? 0;

  // --- classification + dispositions -------------------------------------
  const roleByPath = new Map<string, PathRole>();
  for (const p of filePaths) {
    roleByPath.set(p, classifyPathRole(p, opts.pathRoles));
  }

  // Product (non-test) paths per directory, for pairing lookups.
  const productPaths = filePaths.filter((p) => roleByPath.get(p) !== "test");
  const productByPath = new Set(productPaths);
  const productBasesByDir = new Map<string, string[]>(); // dir → product basenames (no ext)
  for (const p of productPaths) {
    const dir = dirOf(p);
    const arr = productBasesByDir.get(dir) ?? [];
    arr.push(fileBaseName(p));
    productBasesByDir.set(dir, arr);
  }

  const dispositionByPath = new Map<string, FileDisposition>();
  const pairedTestByProduct = new Map<string, string>();
  const likelyTestsByProduct = new Map<string, string[]>();
  const likelyProductByTest = new Map<string, string>();

  for (const p of filePaths) {
    const role = roleByPath.get(p)!;
    if (role !== "test") {
      dispositionByPath.set(p, symbolCountOf(p) > 0 ? "page" : "inert");
      continue;
    }
    const dir = dirOf(p);
    const name = p.split("/").pop()!;
    const sameName = stripTestInfix(name);
    if (sameName !== null && productByPath.has(dir === "" ? sameName : `${dir}/${sameName}`)) {
      dispositionByPath.set(p, "test-paired");
      pairedTestByProduct.set(dir === "" ? sameName : `${dir}/${sameName}`, p);
      continue;
    }
    // Prefix match, same directory: `batch-repair.test.ts` → `batch.ts`.
    const testBase = sameName !== null ? fileBaseName(sameName) : fileBaseName(p);
    const candidates = (productBasesByDir.get(dir) ?? []).filter(
      (base) => base !== testBase && (base.startsWith(testBase) || testBase.startsWith(base)),
    );
    if (candidates.length > 0) {
      dispositionByPath.set(p, "test-likely");
      // Attach to the longest matching product base (most specific).
      const best = [...candidates].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]!;
      const bestPath = [...productByPath].find(
        (pp) => dirOf(pp) === dir && fileBaseName(pp) === best,
      );
      if (bestPath !== undefined) {
        likelyProductByTest.set(p, bestPath);
        const arr = likelyTestsByProduct.get(bestPath) ?? [];
        arr.push(p);
        likelyTestsByProduct.set(bestPath, arr);
      }
    } else {
      dispositionByPath.set(p, "test-orphan");
    }
  }

  // --- folder units (ids via the existing module-style uniqueness pass) ---
  const dirs = [...new Set(filePaths.map(dirOf))].sort((a, b) => a.localeCompare(b));
  const dirPseudoModules = dirs.map((dir) => {
    const segments = dir.split("/").filter(Boolean);
    return {
      id: segments.length === 0 ? "root" : segments[segments.length - 1]!,
      // makeUniqueDeterministicIds treats paths[0] as a FILE path (drops the
      // basename), so feed a synthetic file inside the directory.
      paths: [dir === "" ? "_" : `${dir}/_`],
      symbolCount: 0,
    };
  });
  const uniqueDirs = makeUniqueDeterministicIds(dirPseudoModules);
  const folderIdByDir = new Map<string, string>();
  const takenFolderIds = new Set<string>();
  for (let i = 0; i < dirs.length; i++) {
    let id = uniqueDirs[i]!.id;
    if (RESERVED_WIKI_DIRS.has(id)) id = `${id}-files`;
    // Dot-prefixed directories (`.claude`) would create dot-directories
    // under `livewiki/`, which the wiki walkers skip — the pages would be
    // invisible to verify. Sanitize deterministically.
    if (id.startsWith(".")) id = `dot-${id.replace(/^\.+/, "").replace(/\./g, "-")}`;
    while (takenFolderIds.has(id)) id = `${id}-x`;
    takenFolderIds.add(id);
    folderIdByDir.set(dirs[i]!, id);
  }

  // --- file units ----------------------------------------------------------
  // Page name collisions inside a folder (`a.ts` + `a.js`) suffix EVERY
  // colliding member with its extension: deterministic and symmetric. The
  // base `index` ALWAYS takes the suffix — its unsuffixed page path would
  // collide with the folder page itself (`livewiki/<folder>/index.md`).
  const fileUnits: FileUnit[] = [];
  const byFolder = new Map<string, string[]>();
  for (const p of productPaths) {
    if (dispositionByPath.get(p) !== "page") continue;
    const folderId = folderIdByDir.get(dirOf(p))!;
    const arr = byFolder.get(folderId) ?? [];
    arr.push(p);
    byFolder.set(folderId, arr);
  }
  for (const [folderId, paths] of byFolder) {
    const byBase = new Map<string, string[]>();
    for (const p of paths) {
      const base = fileBaseName(p);
      const arr = byBase.get(base) ?? [];
      arr.push(p);
      byBase.set(base, arr);
    }
    for (const [base, members] of byBase) {
      for (const p of members) {
        const ext = p.includes(".") ? p.split(".").pop()! : "";
        const pageBase =
          members.length > 1 || base === "index" ? `${base}-${ext}` : base;
        const size = sizeOf(p);
        fileUnits.push({
          kind: "file",
          id: `${folderId}/${pageBase}`,
          pagePath: `livewiki/${folderId}/${pageBase}.md`,
          filePath: p,
          folderId,
          symbolCount: symbolCountOf(p),
          sizeBytes: size,
          oversizedSource: threshold > 0 && size > threshold,
          ...(pairedTestByProduct.has(p)
            ? { pairedTestPath: pairedTestByProduct.get(p)! }
            : {}),
          likelyTestPaths: (likelyTestsByProduct.get(p) ?? []).sort((a, b) =>
            a.localeCompare(b),
          ),
        });
      }
    }
  }
  fileUnits.sort((a, b) => a.id.localeCompare(b.id));
  const pagePathByFile = new Map(fileUnits.map((u) => [u.filePath, u.pagePath]));

  // --- folder entries ------------------------------------------------------
  const folderUnits: FolderUnit[] = dirs.map((dir) => {
    const id = folderIdByDir.get(dir)!;
    const entries: FolderEntry[] = filePaths
      .filter((p) => dirOf(p) === dir)
      .map((p) => ({
        filePath: p,
        disposition: dispositionByPath.get(p)!,
        ...(pagePathByFile.has(p) ? { pagePath: pagePathByFile.get(p)! } : {}),
        ...(likelyProductByTest.has(p)
          ? { likelyProductPath: likelyProductByTest.get(p)! }
          : {}),
      }));
    return {
      kind: "folder",
      id,
      pagePath: `livewiki/${id}/index.md`,
      dirPath: dir,
      entries,
    };
  });

  return { fileUnits, folderUnits };
}

/**
 * Per-folder deterministic coverage signal (zero tokens): how many
 * symbol-bearing product files lack a 1:1 same-name test. Surfaced on the
 * folder page as one honest line.
 */
export function folderCoverageSignal(folder: FolderUnit): {
  pages: number;
  withoutSameNameTest: number;
} {
  let pages = 0;
  let paired = 0;
  for (const e of folder.entries) {
    if (e.disposition === "page") pages++;
    if (e.disposition === "test-paired") paired++;
  }
  return { pages, withoutSameNameTest: Math.max(0, pages - paired) };
}
