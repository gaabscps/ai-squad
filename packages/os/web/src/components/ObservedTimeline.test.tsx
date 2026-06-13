import { describe, it, expect } from "vitest";
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

  // Helper: encontra o elemento <pre class="tl-patch"> dentro do container
  function getPatchEl(container: HTMLElement): HTMLElement | null {
    return container.querySelector("pre.tl-patch");
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
    expect(pre!.textContent).toBe(patchText);
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
