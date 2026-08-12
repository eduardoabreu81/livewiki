/**
 * clean-dist — removes a package's build outputs before `tsc` runs.
 *
 * Why: tsc is incremental and never deletes outputs of REMOVED sources.
 * A deleted `src/foo.ts` leaves an orphaned `dist/foo.js` that ships in
 * the published tarball (this exact bug shipped the dead
 * `dist/commands/stub.js` in @livewiki/cli 0.1.1). The stale
 * `.tsbuildinfo` must go too — otherwise tsc believes the outputs are
 * current and skips re-emitting into the wiped dist/.
 *
 * Usage (from a package root): `node ../../scripts/clean-dist.mjs`
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const cwd = process.cwd();
let removed = 0;

for (const entry of ["dist", "tsconfig.tsbuildinfo"]) {
  const p = nodePath.join(cwd, entry);
  if (nodeFs.existsSync(p)) {
    nodeFs.rmSync(p, { recursive: true, force: true });
    removed++;
  }
}

// tsbuildinfo may also live inside dist/ (already covered above) or carry
// a project-specific name — sweep any stragglers at the package root.
for (const f of nodeFs.readdirSync(cwd)) {
  if (f.endsWith(".tsbuildinfo")) {
    nodeFs.rmSync(nodePath.join(cwd, f), { force: true });
    removed++;
  }
}

console.log(`[clean-dist] ${nodePath.basename(cwd)}: removed ${removed} artifact(s)`);
