import { JSDOM } from "jsdom";

let validationQueue: Promise<void> = Promise.resolve();
const parserDom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
let mermaidInstance: (typeof import("mermaid"))["default"] | undefined;

/**
 * Validates Mermaid syntax with Mermaid's real parser and returns a concise
 * diagnostic, or `null` when the diagram is valid.
 *
 * Mermaid expects a browser-like `window` and `document` even when only its
 * parser is used. The temporary DOM is installed for the duration of one
 * parse and restored afterwards. Calls are serialized because those globals
 * are process-wide.
 */
export function validateMermaidSyntax(source: string): Promise<string | null> {
  const result = validationQueue.then(
    () => parseWithTemporaryDom(source),
    () => parseWithTemporaryDom(source),
  );
  validationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function parseWithTemporaryDom(source: string): Promise<string | null> {
  const globals = globalThis as Record<string, unknown>;
  const hadWindow = Object.prototype.hasOwnProperty.call(globals, "window");
  const hadDocument = Object.prototype.hasOwnProperty.call(globals, "document");
  const previousWindow = globals.window;
  const previousDocument = globals.document;
  globals.window = parserDom.window;
  globals.document = parserDom.window.document;

  try {
    if (mermaidInstance === undefined) {
      mermaidInstance = (await import("mermaid")).default;
      mermaidInstance.initialize({ startOnLoad: false });
    }
    await mermaidInstance.parse(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    restoreGlobal(globals, "window", hadWindow, previousWindow);
    restoreGlobal(globals, "document", hadDocument, previousDocument);
  }
}

function restoreGlobal(
  globals: Record<string, unknown>,
  key: string,
  existed: boolean,
  previous: unknown,
): void {
  if (existed) globals[key] = previous;
  else delete globals[key];
}
