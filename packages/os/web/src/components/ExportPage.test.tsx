// web/src/components/ExportPage.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExportPage } from "./ExportPage";
import { ProjectsProvider } from "../state/projects";
import { makeProject, makeObservedSpec, makeObservedMeta } from "../test-utils";
import type { ProductClient, ProductServerMsg } from "../state/productClient";
import type { NarrativeClient, NarrativeServerMsg } from "../state/narrativeClient";

const emptyNarr: NarrativeClient = { subscribe: () => () => {}, fetch: () => {}, generate: () => {} };
function emptyProd(): ProductClient {
  return { subscribe: () => () => {}, fetch: () => {}, generate: () => {} };
}
function prodClientEmitting(msg: ProductServerMsg): ProductClient {
  return { subscribe: (_k, fn) => { setTimeout(() => fn(msg), 0); return () => {}; }, fetch: () => {}, generate: () => {} };
}
function narrClientEmitting(msg: NarrativeServerMsg): NarrativeClient {
  return { subscribe: (_k, fn) => { setTimeout(() => fn(msg), 0); return () => {}; }, fetch: () => {}, generate: () => {} };
}

const SUMMARY = {
  tldr: "Definiu o export full-page",
  decided: [{ what: "Markdown puro", why: "cola limpo", rejected: "wiki-markup" }],
  open: [],
  next: ["implementar o painel"],
  deliverable: "Função de export",
};

const NARRATIVE = {
  tldr: "Subiu o WS pro AppInner",
  why: "o WS precisa conectar em qualquer view",
  changes: [{ title: "Mover hook", prose: "do BoardLive pro AppInner", files: ["App.tsx"], primaryFile: "App.tsx" }],
  decisions: [{ what: "view condicional", why: "evita router", tradeoff: "bundle compartilhado" }],
  verifications: [{ cmd: "npm test", passed: true }],
  prReview: { groups: [{ label: "Wiring", files: ["App.tsx"], lookFirst: true }], risk: null },
};

function renderProduct() {
  const spec = makeObservedSpec({
    id: "OBS-1",
    title: "Export pro Jira",
    observed: makeObservedMeta({ workType: "product", outputLocale: "pt-BR", markers: [] }),
  });
  const proj = makeProject({ id: "p", name: "ai-squad", specs: [spec] });
  const prod = prodClientEmitting({ type: "product:cached", projectId: "p", specId: "OBS-1", summary: SUMMARY, stale: false });
  return render(
    <ProjectsProvider initial={[proj]}>
      <ExportPage projectId="p" specId="OBS-1" productClientArg={prod} narrativeClientArg={emptyNarr} />
    </ProjectsProvider>,
  );
}

function renderDev() {
  const spec = makeObservedSpec({
    id: "OBS-2",
    title: "Wiring do export",
    observed: makeObservedMeta({ outputLocale: "pt-BR", markers: [] }),
  });
  const proj = makeProject({ id: "p", name: "ai-squad", specs: [spec] });
  const narr = narrClientEmitting({ type: "narrative:cached", projectId: "p", specId: "OBS-2", narrative: NARRATIVE, stale: false });
  return render(
    <ProjectsProvider initial={[proj]}>
      <ExportPage projectId="p" specId="OBS-2" productClientArg={emptyProd()} narrativeClientArg={narr} />
    </ProjectsProvider>,
  );
}

describe("ExportPage", () => {
  it("renderiza cabeçalho, resumo de produto e o painel Jira com a descrição", async () => {
    renderProduct();
    expect(await screen.findByTestId("export-page")).toBeTruthy();
    expect(screen.getByText("OBS-1")).toBeTruthy();
    expect(screen.getByText("Export pro Jira")).toBeTruthy();
    // resumo de produto reusado: o tldr aparece no <p.narr-tldr> (ProductSummary) E no <p.jira-summary> (CopyJiraPanel)
    expect(await screen.findAllByText("Definiu o export full-page")).toBeTruthy();
    const panel = await screen.findByTestId("jira-panel");
    expect(panel.textContent).toContain("## Decisões");
    expect(panel.textContent).toContain("- [ ] implementar o painel");
  });

  it("renderiza a narrativa (modo dev) e o painel Jira com as seções dev", async () => {
    renderDev();
    expect(await screen.findByTestId("export-page")).toBeTruthy();
    expect(screen.getByText("OBS-2")).toBeTruthy();
    const panel = await screen.findByTestId("jira-panel");
    expect(panel.textContent).toContain("## Mudanças");
    expect(panel.textContent).toContain("## Decisões técnicas");
    expect(panel.textContent).toContain("## Verificações");
  });

  it("mostra 'carregando' enquanto o spec não chegou no snapshot", () => {
    render(
      <ProjectsProvider initial={[]}>
        <ExportPage projectId="p" specId="OBS-1" productClientArg={emptyProd()} narrativeClientArg={emptyNarr} />
      </ProjectsProvider>,
    );
    expect(screen.getByTestId("export-loading")).toBeTruthy();
  });
});
