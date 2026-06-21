import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObservedTimeline } from "./ObservedTimeline";
import type { ObservedMarker } from "../../../src/store/types";

/** Helper para construir um marker completo com defaults seguros. */
function makeMarker(over: Partial<ObservedMarker> = {}): ObservedMarker {
  return {
    kind: "open",
    at: "2026-06-01T10:00:00Z",
    exact: true,
    note: null,
    decision: null,
    evidence: null,
    editFiles: null,
    blockMs: null,
    ...over,
  };
}

describe("ObservedTimeline — render básico", () => {
  it("renderiza a timeline com data-testid=obs-timeline quando há markers", () => {
    const markers = [makeMarker({ kind: "open" })];
    render(<ObservedTimeline markers={markers} outputLocale={null} />);
    expect(screen.getByTestId("obs-timeline")).toBeInTheDocument();
  });

  it("exibe empty state quando markers é vazio", () => {
    render(<ObservedTimeline markers={[]} outputLocale={null} />);
    expect(screen.queryByTestId("obs-timeline")).toBeNull();
    expect(screen.getByText("no markers recorded")).toBeInTheDocument();
  });

  it("empty state em pt-BR exibe texto em português", () => {
    render(<ObservedTimeline markers={[]} outputLocale="pt-BR" />);
    expect(screen.getByText("sem marcos registrados")).toBeInTheDocument();
  });
});

describe("ObservedTimeline — labels por locale", () => {
  const editMarker = makeMarker({ kind: "edit", exact: false });
  const decisionMarker = makeMarker({
    kind: "decision",
    exact: false,
    decision: { what: "usar queue", why: "evita bloqueio", rejected: null, ref: null },
  });

  it("locale pt-BR: mostra 'Editou' e 'Decidiu'", () => {
    render(
      <ObservedTimeline
        markers={[editMarker, decisionMarker]}
        outputLocale="pt-BR"
      />
    );
    expect(screen.getByText(/Editou/)).toBeInTheDocument();
    expect(screen.getByText(/Decidiu/)).toBeInTheDocument();
  });

  it("locale null (default en): mostra 'Edited' e 'Decided'", () => {
    render(
      <ObservedTimeline
        markers={[editMarker, decisionMarker]}
        outputLocale={null}
      />
    );
    expect(screen.getByText(/Edited/)).toBeInTheDocument();
    expect(screen.getByText(/Decided/)).toBeInTheDocument();
  });

  it("locale 'en-US' (inglês explícito): mostra 'Edited' e 'Decided'", () => {
    render(
      <ObservedTimeline
        markers={[editMarker, decisionMarker]}
        outputLocale="en-US"
      />
    );
    expect(screen.getByText(/Edited/)).toBeInTheDocument();
    expect(screen.getByText(/Decided/)).toBeInTheDocument();
  });

  it("locale 'pt' (sem subtag): mostra 'Editou' e 'Decidiu'", () => {
    render(
      <ObservedTimeline
        markers={[editMarker, decisionMarker]}
        outputLocale="pt"
      />
    );
    expect(screen.getByText(/Editou/)).toBeInTheDocument();
    expect(screen.getByText(/Decidiu/)).toBeInTheDocument();
  });
});

describe("ObservedTimeline — marker kind=block", () => {
  it("blockMs=900000 (15 min) exibe '15 min'", () => {
    const marker = makeMarker({ kind: "block", blockMs: 900000 });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText(/15 min/)).toBeInTheDocument();
  });

  it("blockMs=null exibe label 'waiting' (en)", () => {
    const marker = makeMarker({ kind: "block", blockMs: null });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText(/waiting/)).toBeInTheDocument();
  });

  it("blockMs=null em pt-BR exibe label 'aguardando'", () => {
    const marker = makeMarker({ kind: "block", blockMs: null });
    render(<ObservedTimeline markers={[marker]} outputLocale="pt-BR" />);
    expect(screen.getByText(/aguardando/)).toBeInTheDocument();
  });

  it("blockMs=3600000 (1h exata) exibe '1h'", () => {
    const marker = makeMarker({ kind: "block", blockMs: 3600000 });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText(/1h/)).toBeInTheDocument();
  });

  it("blockMs=5400000 (1h30) exibe '1h 30min'", () => {
    const marker = makeMarker({ kind: "block", blockMs: 5400000 });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText(/1h 30min/)).toBeInTheDocument();
  });
});

describe("ObservedTimeline — editFiles: hunk sob demanda", () => {
  const patchText = "@@ -1,3 +1,4 @@\n context\n+added line\n context";

  const editMarker = makeMarker({
    kind: "edit",
    exact: true,
    editFiles: [
      {
        path: "src/foo.ts",
        added: 3,
        removed: 1,
        patch: patchText,
      },
    ],
  });

  // Helper: encontra o DiffView (.diff-view) dentro do container
  function getPatchEl(container: HTMLElement): HTMLElement | null {
    return container.querySelector(".diff-view");
  }

  it("patch não aparece antes de clicar no arquivo", () => {
    const { container } = render(
      <ObservedTimeline markers={[editMarker]} outputLocale={null} />
    );
    expect(getPatchEl(container)).toBeNull();
  });

  it("clique no arquivo revela o patch", async () => {
    const { container } = render(
      <ObservedTimeline markers={[editMarker]} outputLocale={null} />
    );
    const fileRow = screen.getByRole("button", { name: /src\/foo\.ts/ });
    await userEvent.click(fileRow);
    const pre = getPatchEl(container);
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain("added line");
  });

  it("segundo clique no mesmo arquivo fecha o patch", async () => {
    const { container } = render(
      <ObservedTimeline markers={[editMarker]} outputLocale={null} />
    );
    const fileRow = screen.getByRole("button", { name: /src\/foo\.ts/ });
    await userEvent.click(fileRow);
    expect(getPatchEl(container)).not.toBeNull();
    await userEvent.click(fileRow);
    expect(getPatchEl(container)).toBeNull();
  });

  it("exibe as estatísticas +N / −N mesmo sem clicar", () => {
    render(<ObservedTimeline markers={[editMarker]} outputLocale={null} />);
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
  });

  it("arquivo sem patch: clique não quebra (não há <pre> para mostrar)", async () => {
    const noPatchMarker = makeMarker({
      kind: "edit",
      exact: true,
      editFiles: [{ path: "src/bar.ts", added: 1, removed: 0, patch: null }],
    });
    render(<ObservedTimeline markers={[noPatchMarker]} outputLocale={null} />);
    const fileRow = screen.getByRole("button", { name: /src\/bar\.ts/ });
    await userEvent.click(fileRow);
    // sem patch → sem <pre> → não deve lançar erro e o patch não aparece
    expect(screen.queryByRole("code")).toBeNull();
  });
});

describe("ObservedTimeline — campos opcionais por kind", () => {
  it("marker decision com what, rejected e why renderiza os três campos", () => {
    const marker = makeMarker({
      kind: "decision",
      decision: {
        what: "usar TypeScript strict",
        why: "detecta erros cedo",
        rejected: "any types",
        ref: null,
      },
    });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText("usar TypeScript strict")).toBeInTheDocument();
    expect(screen.getByText("detecta erros cedo")).toBeInTheDocument();
    expect(screen.getByText(/any types/)).toBeInTheDocument();
  });

  it("marker verify com cmd e result renderiza ambos", () => {
    const marker = makeMarker({
      kind: "verify",
      evidence: { cmd: "npm test", result: "42 tests passed", kind: null },
    });
    render(<ObservedTimeline markers={[marker]} outputLocale={null} />);
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText(/42 tests passed/)).toBeInTheDocument();
  });

  it("marker exact=false exibe o marcador · (approx)", () => {
    const marker = makeMarker({ kind: "open", exact: false });
    const { container } = render(
      <ObservedTimeline markers={[marker]} outputLocale={null} />
    );
    const loose = container.querySelector(".tl-loose");
    expect(loose).not.toBeNull();
  });

  it("marker exact=true NÃO exibe o marcador ·", () => {
    const marker = makeMarker({ kind: "open", exact: true });
    const { container } = render(
      <ObservedTimeline markers={[marker]} outputLocale={null} />
    );
    expect(container.querySelector(".tl-loose")).toBeNull();
  });
});

describe("ObservedTimeline — marker kind=run", () => {
  it("renderiza o comando de um marker run com label traduzido", () => {
    render(
      <ObservedTimeline
        outputLocale="pt-BR"
        markers={[makeMarker({
          kind: "run", at: "2026-06-13T14:20:00Z", exact: true, note: "npm test",
          decision: null, evidence: null, editFiles: null, blockMs: null,
        })]}
      />,
    );
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("Executou")).toBeInTheDocument();
  });
});

describe("ObservedTimeline — decision.ref", () => {
  it("ref renderiza e clique chama onOpenRef com o valor correto", async () => {
    const onOpenRef = vi.fn();
    const marker = makeMarker({
      kind: "decision",
      decision: { what: "usar queue", why: "evita bloqueio", rejected: null, ref: "ADR-012" },
    });
    render(
      <ObservedTimeline markers={[marker]} outputLocale={null} onOpenRef={onOpenRef} />
    );
    expect(screen.getByText("ADR-012")).toBeInTheDocument();
    await userEvent.click(screen.getByText("ADR-012"));
    expect(onOpenRef).toHaveBeenCalledWith("ADR-012");
  });

  it("why=null: .tl-why não é renderizado, what ainda aparece", () => {
    const marker = makeMarker({
      kind: "decision",
      decision: { what: "usar cache", why: null, rejected: null, ref: null },
    });
    const { container } = render(
      <ObservedTimeline markers={[marker]} outputLocale={null} />
    );
    expect(container.querySelector(".tl-why")).toBeNull();
    expect(screen.getByText("usar cache")).toBeInTheDocument();
  });

  it("ref=null: .tl-ref não é renderizado", () => {
    const marker = makeMarker({
      kind: "decision",
      decision: { what: "usar queue", why: "evita bloqueio", rejected: null, ref: null },
    });
    const { container } = render(
      <ObservedTimeline markers={[marker]} outputLocale={null} />
    );
    expect(container.querySelector(".tl-ref")).toBeNull();
  });
});

describe("ObservedTimeline — timestamp", () => {
  it("mostra a hora do marker quando há at", () => {
    render(<ObservedTimeline outputLocale="pt-BR" markers={[
      { kind: "run", at: "2026-06-20T17:31:00Z", exact: true, note: "vitest", decision: null, evidence: null, editFiles: null, blockMs: null },
    ]} />);
    expect(screen.getByText(/14:31/)).toBeTruthy();
  });
});

describe("ObservedTimeline — vista de produto (work_type:product)", () => {
  const openMarker = makeMarker({ kind: "open" });
  const closeMarker = makeMarker({ kind: "close", at: "2026-06-01T11:00:00Z" });
  const blockMarker = makeMarker({ kind: "block", blockMs: 900000 });
  const runMarker = makeMarker({ kind: "run", note: "npm test", decision: null });
  const editMarker = makeMarker({ kind: "edit", editFiles: [{ path: "a.ts", added: 1, removed: 0, patch: null }] });
  const decisionMarker = makeMarker({
    kind: "decision",
    decision: { what: "Usar o transcript real", why: "evita fabricar conteúdo", rejected: "escrever resumo fixo", ref: null },
  });

  it("re-rotula para o vocabulário de produto em pt-BR (Aberta/Decisão/Fechada)", () => {
    render(<ObservedTimeline workType="product" outputLocale="pt-BR"
      markers={[openMarker, decisionMarker, closeMarker]} />);
    expect(screen.getByText(/Aberta/)).toBeInTheDocument();
    expect(screen.getByText(/Decisão/)).toBeInTheDocument();
    expect(screen.getByText(/Fechada/)).toBeInTheDocument();
    expect(screen.queryByText(/Decidiu/)).toBeNull();
  });

  it("re-rotula block como 'Pergunta levantada' em pt-BR", () => {
    render(<ObservedTimeline workType="product" outputLocale="pt-BR" markers={[blockMarker]} />);
    expect(screen.getByText(/Pergunta levantada/)).toBeInTheDocument();
    expect(screen.queryByText(/Bloqueou/)).toBeNull();
  });

  it("vocabulário de produto em inglês (Opened/Decision/Closed)", () => {
    render(<ObservedTimeline workType="product" outputLocale="en-US"
      markers={[openMarker, decisionMarker, closeMarker]} />);
    expect(screen.getByText(/Opened/)).toBeInTheDocument();
    expect(screen.getByText(/Decision/)).toBeInTheDocument();
    expect(screen.getByText(/Closed/)).toBeInTheDocument();
  });

  it("filtra marcos de execução: run/edit/verify não aparecem na vista de produto", () => {
    render(<ObservedTimeline workType="product" outputLocale="pt-BR"
      markers={[openMarker, runMarker, editMarker, decisionMarker]} />);
    expect(screen.queryByText("npm test")).toBeNull();
    expect(screen.queryByText(/Executou/)).toBeNull();
    expect(screen.queryByText(/Editou/)).toBeNull();
    // a decisão de produto permanece
    expect(screen.getByText(/Decisão/)).toBeInTheDocument();
    expect(screen.getByText("Usar o transcript real")).toBeInTheDocument();
  });

  it("progressive disclosure: why/rejected ficam ocultos até clicar em 'por quê?'", async () => {
    const user = userEvent.setup();
    render(<ObservedTimeline workType="product" outputLocale="pt-BR" markers={[decisionMarker]} />);
    // o 'what' (a decisão em si) aparece sempre
    expect(screen.getByText("Usar o transcript real")).toBeInTheDocument();
    // o porquê e a alternativa descartada começam ocultos
    expect(screen.queryByText("evita fabricar conteúdo")).toBeNull();
    expect(screen.queryByText(/escrever resumo fixo/)).toBeNull();
    // expande
    await user.click(screen.getByRole("button", { name: /por quê/i }));
    expect(screen.getByText("evita fabricar conteúdo")).toBeInTheDocument();
    expect(screen.getByText(/escrever resumo fixo/)).toBeInTheDocument();
  });

  it("vista dev (sem workType): mantém 'Decidiu' e exibe run — sem regressão", () => {
    render(<ObservedTimeline outputLocale="pt-BR" markers={[runMarker, decisionMarker]} />);
    expect(screen.getByText(/Decidiu/)).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    // na vista dev, why aparece direto (sem disclosure)
    expect(screen.getByText("evita fabricar conteúdo")).toBeInTheDocument();
  });
});
