// Post-build: garante shebang executável no entry point. Necessário porque
// tsc não preserva permissões Unix ao transpilar. Em Windows o shebang não é
// necessário para npx/node, mas em macOS/Linux sim.
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const entry = nodePath.resolve(here, "..", "dist", "index.js");

await nodeFs.chmod(entry, 0o755);
console.log(`[cli] chmod 755 ${entry}`);