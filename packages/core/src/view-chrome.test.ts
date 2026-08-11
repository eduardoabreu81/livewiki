/**
 * view-chrome.test.ts — #30 follow-up (viewer chrome localization).
 *
 * Contracts:
 *   - resolution matches on the BCP-47 base subtag (`pt-BR` → `pt`);
 *   - unknown/undefined languages fall back to English byte-for-byte;
 *   - the English table pins the pre-#30 strings (existing view.test.ts
 *     assertions depend on them);
 *   - every table covers the full chrome surface (no missing key can
 *     silently render "undefined").
 */

import { describe, expect, it } from "vitest";
import {
  GROUP_ORDER,
  resolveViewerChrome,
  type ViewerChrome,
} from "./view-chrome.js";

describe("resolveViewerChrome", () => {
  it("resolves by base subtag and falls back to English", () => {
    expect(resolveViewerChrome(undefined).searchPlaceholder).toBe("Search…");
    expect(resolveViewerChrome("en").searchPlaceholder).toBe("Search…");
    expect(resolveViewerChrome("en-US").searchPlaceholder).toBe("Search…");
    expect(resolveViewerChrome("fr").searchPlaceholder).toBe("Search…");
    expect(resolveViewerChrome("pt").searchPlaceholder).toBe("Buscar…");
    expect(resolveViewerChrome("pt-BR").searchPlaceholder).toBe("Buscar…");
  });

  it("keeps the pre-#30 English strings byte-identical", () => {
    const en = resolveViewerChrome("en");
    expect(en.groupLabels["Quickstart"]).toBe("Quickstart");
    expect(en.groupLabels["Indexes & overviews"]).toBe("Indexes & overviews");
    expect(en.searchNoResults).toBe("No pages match your search.");
    expect(en.themeToggleAriaLabel).toBe("Toggle light/dark mode");
    expect(en.themeToDark).toBe("Dark");
    expect(en.themeToLight).toBe("Light");
    expect(en.badgeNew).toBe("new");
    expect(en.badgeUpdated).toBe("updated");
    expect(en.activityTitle).toBe("Activity");
    expect(en.stampText("2026-08-11")).toBe("Documentation last changed on 2026-08-11");
    expect(en.stampTooltip("abc1234")).toBe("commit abc1234");
    expect(en.structureDiagramTitle).toBe("Repository structure");
    expect(en.modulesDiagramTitle).toBe("Folder dependencies");
    expect(en.classDiagramTitle("App Utils")).toBe("App Utils — class diagram");
    expect(en.classDiagramCaption("app/utils")).toBe("Classes and types of the app/utils folder.");
    expect(en.flowDiagramTitle("Cli To Core")).toBe("Cli To Core — flow diagram");
    expect(en.genericDiagramCaption).toBe("Diagram generated from the repository's structure.");
    expect(en.diagramFallbackNote).toBe("This diagram could not be rendered; showing its source.");
  });

  it("every table covers every group label and returns non-empty interpolations", () => {
    for (const lang of ["en", "pt"]) {
      const chrome: ViewerChrome = resolveViewerChrome(lang);
      for (const group of GROUP_ORDER) {
        expect(chrome.groupLabels[group].length, `${lang} label for ${group}`).toBeGreaterThan(0);
      }
      expect(chrome.stampText("2026-08-11")).toContain("2026-08-11");
      expect(chrome.stampTooltip("abc1234")).toContain("abc1234");
      expect(chrome.classDiagramTitle("X")).toContain("X");
      expect(chrome.classDiagramCaption("x/y")).toContain("x/y");
      expect(chrome.flowDiagramTitle("Z")).toContain("Z");
    }
  });

  it("localizes the chrome to Portuguese", () => {
    const pt = resolveViewerChrome("pt");
    expect(pt.groupLabels["Implementation reference"]).toBe("Referência de implementação");
    expect(pt.searchNoResults).toBe("Nenhuma página corresponde à sua busca.");
    expect(pt.stampText("2026-08-11")).toBe("Documentação alterada pela última vez em 2026-08-11");
    expect(pt.structureDiagramTitle).toBe("Estrutura do repositório");
  });
});
