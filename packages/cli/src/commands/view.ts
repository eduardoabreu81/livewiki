import type { Command } from "commander";
import { spawn } from "node:child_process";
import * as nodePath from "node:path";
import {
  buildSite,
  ViewError,
  type ViewTemplate,
} from "@livewiki/core/view";
import { resolveRepoRoot } from "../cli.js";
import { emitJson, emitHuman } from "../output.js";

interface ViewCliOptions {
  json?: boolean;
  repo?: string;
  template?: string;
  out?: string;
  /** commander `--no-open` → `open: false`; default true. */
  open?: boolean;
}

/**
 * `livewiki view` — Phase 7. Builds a self-contained static site from the
 * canonical `livewiki/` wiki (default output `.livewiki/site/`, `--out
 * <dir>` to publish elsewhere) and opens it in the browser unless
 * `--no-open`. The path is always printed.
 *
 * Exit codes: 0 = site built, 1 = failure (missing wiki, invalid
 * template/out dir). Uses `process.exitCode`, never `process.exit`
 * (FIX L rev2).
 */
export function registerView(program: Command): void {
  program
    .command("view")
    .description(
      "generate a self-contained static site (HTML+CSS+JS) with client-side search and Mermaid (Phase 7)",
    )
    .option("--template <name>", "visual template: 'agent' (dense, technical) or 'docs' (clean)", "agent")
    .option("--out <dir>", "output directory to publish (default: .livewiki/site/)")
    .option("--no-open", "build the site without opening the browser")
    .action(async (_options: ViewCliOptions, command: Command) => {
      const opts = command.optsWithGlobals<ViewCliOptions>();
      const json = Boolean(opts.json);
      const repoRoot = resolveRepoRoot(opts.repo);

      try {
        const result = await buildSite({
          repoRoot,
          ...(opts.out !== undefined ? { outDir: opts.out } : {}),
          template: (opts.template ?? "agent") as ViewTemplate,
        });
        const indexHtml = nodePath.join(result.outDir, "index.html");
        let opened = false;
        if (opts.open !== false) {
          opened = openBrowser(indexHtml);
        }
        process.exitCode = 0;
        if (json) {
          emitJson({ ok: true, view: { ...result, opened } });
        } else {
          const lines = [
            `livewiki view: ${result.pagesWritten} pages → ${result.outDir}`,
            opened ? "opened in the browser." : `open ${indexHtml} in a browser.`,
          ];
          emitHuman(lines.join("\n"));
        }
      } catch (err) {
        process.exitCode = 1;
        const code = err instanceof ViewError ? err.code : "view_failed";
        const detail = err instanceof Error ? err.message : String(err);
        if (json) {
          emitJson({ ok: false, error: { code, detail } });
        } else {
          emitHuman(`livewiki view: FAILED [${code}] ${detail}`);
        }
      }
    });
}

/**
 * Open a file/URL in the system browser, cross-platform, with
 * `shell: false`. Best-effort: a missing opener never fails the command
 * (the path has already been printed). Detached + unref'd so the CLI can
 * exit without waiting for the browser.
 */
function openBrowser(target: string): boolean {
  const args: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(args[0], args[1], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
