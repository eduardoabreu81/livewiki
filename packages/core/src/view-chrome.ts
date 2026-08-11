/**
 * view-chrome — the viewer's UI strings, keyed by the configured wiki
 * language (#30 follow-up: `<html lang>` threaded the language but every
 * chrome string stayed hardcoded English).
 *
 * Scope: CHROME only — the site frame a reader touches on every page
 * (sidebar group labels, search box, theme toggle, version stamp, freshness
 * badges, diagram titles/captions, the mermaid fallback note). Page CONTENT
 * is already written in the wiki language by the generation pipeline; the
 * Activity dashboard's body strings stay English for now (recorded as open
 * in ROADMAP item 30).
 *
 * Adding a language is data-only: one more entry in `CHROME_TABLES`.
 * Resolution matches on the base subtag (`pt-BR` → `pt`); unknown languages
 * fall back to English byte-for-byte, which keeps every pre-#30 assertion
 * valid — `en` output is unchanged.
 */

/** Sidebar grouping identity. Keys stay English internally; only the
 *  rendered label is localized. */
export type SiteGroup =
  | "Quickstart"
  | "Concept topics"
  | "Flows"
  | "Implementation reference"
  | "Auxiliary areas"
  | "Diagrams"
  | "Indexes & overviews"
  | "Activity";

export const GROUP_ORDER: readonly SiteGroup[] = [
  "Quickstart",
  "Concept topics",
  "Flows",
  "Implementation reference",
  "Auxiliary areas",
  "Diagrams",
  "Indexes & overviews",
  "Activity",
];

export interface ViewerChrome {
  readonly groupLabels: Readonly<Record<SiteGroup, string>>;
  readonly searchPlaceholder: string;
  readonly searchAriaLabel: string;
  readonly searchNoResults: string;
  readonly themeToggleAriaLabel: string;
  /** Button label offering the switch TO dark mode (current theme is light). */
  readonly themeToDark: string;
  /** Button label offering the switch TO light mode (current theme is dark). */
  readonly themeToLight: string;
  readonly badgeNew: string;
  readonly badgeUpdated: string;
  readonly activityTitle: string;
  readonly stampText: (date: string) => string;
  readonly stampTooltip: (shortSha: string) => string;
  readonly structureDiagramTitle: string;
  readonly structureDiagramCaption: string;
  readonly modulesDiagramTitle: string;
  readonly modulesDiagramCaption: string;
  readonly classDiagramTitle: (humanizedFolder: string) => string;
  readonly classDiagramCaption: (folder: string) => string;
  readonly flowDiagramTitle: (humanizedSlug: string) => string;
  readonly flowDiagramCaption: string;
  readonly genericDiagramCaption: string;
  readonly diagramFallbackNote: string;
}

const EN: ViewerChrome = {
  groupLabels: {
    Quickstart: "Quickstart",
    "Concept topics": "Concept topics",
    Flows: "Flows",
    "Implementation reference": "Implementation reference",
    "Auxiliary areas": "Auxiliary areas",
    Diagrams: "Diagrams",
    "Indexes & overviews": "Indexes & overviews",
    Activity: "Activity",
  },
  searchPlaceholder: "Search…",
  searchAriaLabel: "Search the wiki",
  searchNoResults: "No pages match your search.",
  themeToggleAriaLabel: "Toggle light/dark mode",
  themeToDark: "Dark",
  themeToLight: "Light",
  badgeNew: "new",
  badgeUpdated: "updated",
  activityTitle: "Activity",
  stampText: (date) => `Documentation last changed on ${date}`,
  stampTooltip: (shortSha) => `commit ${shortSha}`,
  structureDiagramTitle: "Repository structure",
  structureDiagramCaption: "Map of the repository's folders and files.",
  modulesDiagramTitle: "Folder dependencies",
  modulesDiagramCaption: "Import graph between the repository's folders.",
  classDiagramTitle: (folder) => `${folder} — class diagram`,
  classDiagramCaption: (folder) => `Classes and types of the ${folder} folder.`,
  flowDiagramTitle: (slug) => `${slug} — flow diagram`,
  flowDiagramCaption:
    "One end-to-end flow through the codebase; the matching flow page tells the story.",
  genericDiagramCaption: "Diagram generated from the repository's structure.",
  diagramFallbackNote: "This diagram could not be rendered; showing its source.",
};

const PT: ViewerChrome = {
  groupLabels: {
    Quickstart: "Início rápido",
    "Concept topics": "Tópicos conceituais",
    Flows: "Fluxos",
    "Implementation reference": "Referência de implementação",
    "Auxiliary areas": "Áreas auxiliares",
    Diagrams: "Diagramas",
    "Indexes & overviews": "Índices e visões gerais",
    Activity: "Atividade",
  },
  searchPlaceholder: "Buscar…",
  searchAriaLabel: "Buscar na wiki",
  searchNoResults: "Nenhuma página corresponde à sua busca.",
  themeToggleAriaLabel: "Alternar entre modo claro e escuro",
  themeToDark: "Escuro",
  themeToLight: "Claro",
  badgeNew: "novo",
  badgeUpdated: "atualizado",
  activityTitle: "Atividade",
  stampText: (date) => `Documentação alterada pela última vez em ${date}`,
  stampTooltip: (shortSha) => `commit ${shortSha}`,
  structureDiagramTitle: "Estrutura do repositório",
  structureDiagramCaption: "Mapa das pastas e arquivos do repositório.",
  modulesDiagramTitle: "Dependências entre pastas",
  modulesDiagramCaption: "Grafo de imports entre as pastas do repositório.",
  classDiagramTitle: (folder) => `${folder} — diagrama de classes`,
  classDiagramCaption: (folder) => `Classes e tipos da pasta ${folder}.`,
  flowDiagramTitle: (slug) => `${slug} — diagrama de fluxo`,
  flowDiagramCaption:
    "Um fluxo de ponta a ponta pelo código; a página de fluxo correspondente conta a história.",
  genericDiagramCaption: "Diagrama gerado a partir da estrutura do repositório.",
  diagramFallbackNote: "Não foi possível renderizar este diagrama; exibindo o código-fonte.",
};

const CHROME_TABLES: Readonly<Record<string, ViewerChrome>> = { en: EN, pt: PT };

/**
 * Resolve the chrome string table for a BCP-47 wiki language. Matches on
 * the base subtag (`pt-BR` → `pt`); unknown languages fall back to English.
 */
export function resolveViewerChrome(language: string | undefined): ViewerChrome {
  const base = (language ?? "en").split("-")[0]?.toLowerCase() ?? "en";
  return CHROME_TABLES[base] ?? EN;
}
