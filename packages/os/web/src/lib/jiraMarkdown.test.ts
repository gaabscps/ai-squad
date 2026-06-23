import { describe, it, expect } from "vitest";
import { productSummaryToJira, narrativeToJira } from "./jiraMarkdown";
import type { ProductSummary } from "../../../src/product/types";
import type { SessionNarrative } from "../../../src/narrative/types";

const META = { title: "Export pro Jira", specId: "OBS-011", labels: ["work-type:product", "lang:pt-BR"] };

const FULL: ProductSummary = {
  tldr: "Definiu o export full-page",
  decided: [
    { what: "Markdown puro", why: "cola limpo no Jira", rejected: "wiki-markup" },
    { what: "sem endpoint novo", why: null, rejected: null },
  ],
  open: ["testar colagem num Jira real"],
  next: ["implementar o painel", "ajustar o CSS de impressão"],
  deliverable: "Função de export do aiOS",
};

describe("productSummaryToJira", () => {
  it("monta seções de decisões, em aberto e critérios de aceite", () => {
    const md = productSummaryToJira(FULL, META);
    expect(md).toContain("**Entregável:** Função de export do aiOS");
    expect(md).toContain("## Decisões");
    expect(md).toContain("- **Markdown puro** — cola limpo no Jira _(descartado: wiki-markup)_");
    expect(md).toContain("- **sem endpoint novo**");
    expect(md).toContain("## Em aberto");
    expect(md).toContain("- testar colagem num Jira real");
    expect(md).toContain("## Critérios de aceite");
    expect(md).toContain("- [ ] implementar o painel");
    expect(md).toContain("_Labels sugeridas: work-type:product, lang:pt-BR_");
  });

  it("omite seções vazias e campos nulos sem quebrar", () => {
    const min: ProductSummary = { tldr: "x", decided: [], open: [], next: [], deliverable: "" };
    const md = productSummaryToJira(min, { title: "t", specId: "OBS-1", labels: [] });
    expect(md).not.toContain("## Decisões");
    expect(md).not.toContain("## Em aberto");
    expect(md).not.toContain("## Critérios de aceite");
    expect(md).not.toContain("**Entregável:**");
    expect(md).not.toContain("Labels sugeridas");
  });
});

describe("narrativeToJira", () => {
  const NARR: SessionNarrative = {
    tldr: "Subiu o useLiveProjects pro AppInner",
    why: "o WS precisa conectar em qualquer view",
    changes: [
      { title: "Mover hook de WS", prose: "do BoardLive pro AppInner", files: ["App.tsx"], primaryFile: "App.tsx" },
    ],
    decisions: [
      { what: "view condicional", why: "evita router", tradeoff: "bundle compartilhado" },
      { what: "sem endpoint", why: null, tradeoff: null },
    ],
    verifications: [
      { cmd: "npm test", passed: true },
      { cmd: "npm run build", passed: null },
    ],
    prReview: {
      groups: [{ label: "Wiring do App", files: ["App.tsx"], lookFirst: true }],
      risk: "regressão no toggleHide",
    },
  };

  it("monta contexto, mudanças, decisões técnicas, verificações e PR review", () => {
    const md = narrativeToJira(NARR, { title: "Export", specId: "OBS-011", labels: ["work-type:dev"] });
    expect(md).toContain("**Contexto:** o WS precisa conectar em qualquer view");
    expect(md).toContain("## Mudanças");
    expect(md).toContain("- **Mover hook de WS** — do BoardLive pro AppInner (`App.tsx`)");
    expect(md).toContain("## Decisões técnicas");
    expect(md).toContain("- **view condicional** — evita router _(trade-off: bundle compartilhado)_");
    expect(md).toContain("- **sem endpoint**");
    expect(md).toContain("## Verificações");
    expect(md).toContain("PASS  npm test");
    expect(md).toContain("—  npm run build");
    expect(md).toContain("## Ao revisar a PR");
    expect(md).toContain("- **Wiring do App** (olhe primeiro): App.tsx");
    expect(md).toContain("> Risco: regressão no toggleHide");
  });
});
