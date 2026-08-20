/**
 * version — the single source of truth for the version @livewiki/mcp
 * reports about itself.
 *
 * Read from the package's own package.json rather than duplicated in a
 * literal: a hardcoded string is one release away from lying, and this one
 * did — the MCP handshake advertised `0.0.0` from 0.1.0 through 0.2.1 while
 * the package on npm said otherwise. The same defect was already fixed once
 * on the CLI side (`readVersion` in @livewiki/cli's cli.ts); this mirrors
 * that mechanism instead of inventing a second one.
 *
 * Synchronous on purpose — the file is static at build time and every caller
 * builds the server during startup, where one small read costs nothing.
 *
 * Path: src/version.ts → ../package.json. Built: dist/version.js → the same
 * relative path, because dist/ and src/ sit at the same depth inside the
 * package. That holds in the published tarball too, which ships package.json
 * next to dist/.
 */
import { readFileSync } from "node:fs";

/** Reported when package.json cannot be read or carries no version. */
export const UNKNOWN_VERSION = "0.0.0";

export function readPackageVersion(): string {
  const pkgUrl = new URL("../package.json", import.meta.url);
  try {
    const parsed = JSON.parse(readFileSync(pkgUrl, "utf8")) as {
      version?: string;
    };
    return parsed.version ?? UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
