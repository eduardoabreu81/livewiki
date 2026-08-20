/**
 * The MCP handshake version has exactly one source: this package's
 * package.json. It was a literal `"0.0.0"` in server.ts through 0.2.1, which
 * is a defect no test can catch by reading the same literal back — so these
 * assertions read package.json independently and compare.
 *
 * bin-e2e.test.ts proves the same property end to end on the INSTALLED
 * tarball. This file is the cheap guard that fails first when the mechanism
 * itself is replaced by a constant again.
 */

import { describe, it, expect } from "vitest";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion, UNKNOWN_VERSION } from "./version.js";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const pkgPath = nodePath.resolve(here, "..", "package.json");

describe("readPackageVersion", () => {
  it("returns the version declared in this package's package.json", () => {
    const declared = (
      JSON.parse(nodeFs.readFileSync(pkgPath, "utf8")) as { version: string }
    ).version;
    expect(readPackageVersion()).toBe(declared);
  });

  it("resolves a real semver, not the unknown-version fallback", () => {
    // A silent fallback is how the old defect would come back wearing a
    // different hat: package.json moving out of `../` would degrade to
    // "0.0.0" with nothing failing.
    const version = readPackageVersion();
    expect(version).not.toBe(UNKNOWN_VERSION);
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
  });

  it("resolves package.json relative to this module, so dist/ works too", () => {
    // src/version.ts and dist/version.js sit at the same depth, which is the
    // only reason `../package.json` is correct in both. Assert the shape the
    // published layout depends on rather than the path string.
    expect(nodeFs.existsSync(pkgPath)).toBe(true);
    expect(nodePath.basename(nodePath.dirname(pkgPath))).toBe("mcp");
  });
});
