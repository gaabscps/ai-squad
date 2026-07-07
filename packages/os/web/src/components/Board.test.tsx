import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider, useProjectsDispatch, type ProjectsAction } from "../state/projects";
import { makeProject, makeSpec, makeFeature } from "../test-utils";
import type { Project } from "../../../src/store/types";

function renderBoard(
  projects: Parameters<typeof makeProject>[0][] = [],
  onHide = vi.fn(),
  archiveAfterDays = 7,
) {
  const built = projects.map((p) => makeProject(p));
  return {
    onHide,
    ...render(
      <ProjectsProvider initial={built} initialArchiveAfterDays={archiveAfterDays}>
        <Board onHide={onHide} />
      </ProjectsProvider>,
    ),
  };
}

/**
 * Helper: renders Board with a dispatch-capturing child so tests can push WS snapshots.
 * Returns the rendered result plus a `pushSnapshot(projects)` function.
 */
function renderBoardWithDispatch(
  projects: Parameters<typeof makeProject>[0][] = [],
  onHide = vi.fn(),
) {
  const built = projects.map((p) => makeProject(p));
  let capturedDispatch: ((action: ProjectsAction) => void) | null = null;

  function DispatchCapture() {
    const dispatch = useProjectsDispatch();
    capturedDispatch = dispatch;
    return null;
  }

  const result = render(
    <ProjectsProvider initial={built}>
      <DispatchCapture />
      <Board onHide={onHide} />
    </ProjectsProvider>,
  );

  function pushSnapshot(updated: Project[]) {
    act(() => {
      capturedDispatch!({ type: "snapshot", projects: updated });
    });
  }

  return { ...result, onHide, pushSnapshot };
}

describe("Board", () => {
  it("mostra o card de feature no kanban; expandir revela a sessão-membro", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", status: "running", tasks: [{ id: "T-1", state: "running", loops: 0, dispatches: [] }] })], features: [makeFeature({ id: "ft-1", name: "Feature Um", sessionIds: ["FEAT-1"], status: "running" })] }]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByText("Feature Um")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Feature Um"));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
  });

  it("filtra por projeto", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })], features: [makeFeature({ id: "ft-1", name: "Feature A", sessionIds: ["FEAT-1"] })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })], features: [makeFeature({ id: "ft-2", name: "Feature B", sessionIds: ["FEAT-2"] })] },
    ]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("Feature A")).toBeInTheDocument();
    expect(screen.queryByText("Feature B")).toBeNull();
  });

  it("busca filtra por texto (casa via sessão-membro)", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [
      makeSpec({ id: "FEAT-1", title: "Exportar PDF" }),
      makeSpec({ id: "FEAT-2", title: "Login social" }),
    ], features: [
      makeFeature({ id: "ft-1", name: "Feature A", sessionIds: ["FEAT-1"] }),
      makeFeature({ id: "ft-2", name: "Feature B", sessionIds: ["FEAT-2"] }),
    ] }]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(screen.getByText("Feature A")).toBeInTheDocument();
    expect(screen.queryByText("Feature B")).toBeNull();
  });

  it("alterna pra tabela", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] }]);
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("tabela: coluna Feature mostra o nome da feature declarada e '—' pra sessão órfã", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [
      makeSpec({ id: "FEAT-1", title: "Exportar PDF" }),
      makeSpec({ id: "FEAT-2", title: "Login social" }),
    ], features: [
      makeFeature({ id: "ft-1", name: "Feature Declarada", sessionIds: ["FEAT-1"] }),
      makeFeature({ id: "ft-orfa-feat-2", name: "NOME-ORFAO-NAO-APARECE", orphan: true, sessionIds: ["FEAT-2"] }),
    ] }]);
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(screen.getByText("Feature Declarada")).toBeInTheDocument();
    expect(screen.queryByText("NOME-ORFAO-NAO-APARECE")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clicar numa sessão expandida abre o drawer; fechar o esconde", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "Checkout" })], features: [makeFeature({ id: "ft-1", name: "Feature Checkout", sessionIds: ["FEAT-1"] })] }]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByText("Feature Checkout"));
    await userEvent.click(screen.getByText("FEAT-1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ocultar manda o id estável e reseta o filtro do projeto oculto", async () => {
    const { onHide } = renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })], features: [makeFeature({ id: "ft-1", name: "Feature A", sessionIds: ["FEAT-1"] })] },
      { id: "proj-xyz", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })], features: [makeFeature({ id: "ft-2", name: "Feature B", sessionIds: ["FEAT-2"] })] },
    ]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByRole("button", { name: "proj-a" })); // filtra proj-a
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
    expect(screen.getByText("Feature B")).toBeInTheDocument(); // filtro resetou
  });

  it("desligar 'mostrar ocultos' reseta o filtro de um projeto oculto (não deixa o board vazio)", async () => {
    renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })], features: [makeFeature({ id: "ft-1", name: "Feature A", sessionIds: ["FEAT-1"] })] },
      { id: "proj-xyz", name: "proj-b", hidden: true, specs: [makeSpec({ id: "FEAT-2" })], features: [makeFeature({ id: "ft-2", name: "Feature B", sessionIds: ["FEAT-2"] })] },
    ]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // revela proj-b
    await userEvent.click(screen.getByRole("button", { name: "proj-b" })); // filtra o oculto
    expect(screen.queryByText("Feature A")).toBeNull(); // só proj-b
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // desliga de novo
    expect(screen.getByText("Feature A")).toBeInTheDocument(); // filtro resetou, board não ficou vazio
  });
});

describe("Board — dormência", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  // now = 2026-06-12T12:00:00Z; DORMANT_AFTER_DAYS = 3
  // runningDormente: lastActivityAt 10 dias atrás → dorme
  // runningAtivo:   lastActivityAt 1 dia atrás → não dorme
  const runningDormente = () =>
    makeSpec({ id: "FEAT-SLEEP", status: "running", lastActivityAt: "2026-06-02T12:00:00Z" });
  const runningAtivo = () =>
    makeSpec({ id: "FEAT-AWAKE", status: "running", lastActivityAt: "2026-06-11T12:00:00Z" });
  const featsSleepAwake = [
    makeFeature({ id: "ft-sleep", name: "Feature Sleep", sessionIds: ["FEAT-SLEEP"], status: "running" }),
    makeFeature({ id: "ft-awake", name: "Feature Awake", sessionIds: ["FEAT-AWAKE"], status: "running" }),
  ];

  it("kanban esconde a feature cuja única sessão-membro está dormente", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [runningDormente(), runningAtivo()], features: featsSleepAwake }]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.queryByText("Feature Sleep")).toBeNull();
    expect(screen.getByText("Feature Awake")).toBeInTheDocument();
  });

  it("aba Arquivadas mostra sessão dormente com chip 'dormindo'", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [runningDormente(), runningAtivo()], features: featsSleepAwake }]);
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText("FEAT-SLEEP")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-AWAKE")).toBeNull();
    expect(screen.getByText("dormindo")).toBeInTheDocument();
  });

  it("aba Arquivadas vazia mostra empty state atualizado", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [runningAtivo()], features: [featsSleepAwake[1]] }]);
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText(/nenhuma feature arquivada ou dormente/i)).toBeInTheDocument();
  });
});

describe("Board — arquivamento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  // "now" = 2026-06-10; limite = 7 dias
  // doneVelha: lastActivityAt = 2026-06-01 → 9 dias atrás → arquivada
  // doneNova:  lastActivityAt = 2026-06-09 → 1 dia atrás → NÃO arquivada
  const doneVelha = () =>
    makeSpec({ id: "FEAT-OLD", status: "done", lastActivityAt: "2026-06-01T00:00:00Z" });
  const doneNova = () =>
    makeSpec({ id: "FEAT-NEW", status: "done", lastActivityAt: "2026-06-09T00:00:00Z" });
  const featsOldNew = [
    makeFeature({ id: "ft-old", name: "Feature Old", sessionIds: ["FEAT-OLD"], status: "done" }),
    makeFeature({ id: "ft-new", name: "Feature New", sessionIds: ["FEAT-NEW"], status: "done" }),
  ];

  it("kanban esconde a feature cuja única sessão-membro está arquivada (done velha)", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()], features: featsOldNew }]);
    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.queryByText("Feature Old")).toBeNull();
    expect(screen.getByText("Feature New")).toBeInTheDocument(); // done nova ainda aparece
  });

  it("aba Arquivadas mostra só a done velha", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()], features: featsOldNew }]);
    // Usa fireEvent pra evitar hang de userEvent com fake timers
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText("FEAT-OLD")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-NEW")).toBeNull();
  });

  it("aba Arquivadas vazia mostra empty state", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneNova()], features: [featsOldNew[1]] }]);
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText(/nenhuma feature arquivada/i)).toBeInTheDocument();
  });
});

describe("Board — AC-014: foco do painel por id resiliente a snapshot WebSocket", () => {
  it("drawer permanece aberto quando chega snapshot com dados novos da mesma spec", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "Título original" });
    const feature = makeFeature({ id: "ft-x", name: "Feature X", sessionIds: ["FEAT-X"] });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec], features: [feature] },
    ]);

    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByText("Feature X"));
    await userEvent.click(screen.getByText("FEAT-X"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Título original aparece no drawer
    expect(dialog).toHaveTextContent("Título original");

    // Simula snapshot WS com título atualizado para a mesma spec
    const updatedSpec = makeSpec({ id: "FEAT-X", title: "Título atualizado" });
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [updatedSpec], features: [feature] })]);

    // Drawer permanece aberto (não fecha)
    const dialogAfter = screen.getByRole("dialog");
    expect(dialogAfter).toBeInTheDocument();
    // E mostra os dados novos (derivação por id funciona)
    expect(dialogAfter).toHaveTextContent("Título atualizado");
    expect(dialogAfter).not.toHaveTextContent("Título original");
  });

  it("drawer fecha quando a spec some do snapshot (sem a spec, sem seleção)", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "Spec temporária" });
    const feature = makeFeature({ id: "ft-x", name: "Feature X", sessionIds: ["FEAT-X"] });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec], features: [feature] },
    ]);

    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByText("Feature X"));
    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Snapshot sem a spec (removida externamente)
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [], features: [] })]);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drawer re-deriva dados ao vivo: múltiplos snapshots consecutivos mantêm o foco", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "v1" });
    const feature = makeFeature({ id: "ft-x", name: "Feature X", sessionIds: ["FEAT-X"] });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec], features: [feature] },
    ]);

    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByText("Feature X"));
    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [makeSpec({ id: "FEAT-X", title: "v2" })], features: [feature] })]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("v2");

    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [makeSpec({ id: "FEAT-X", title: "v3" })], features: [feature] })]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("v3");
  });

  it("snapshot com outra spec no projeto não fecha o drawer da spec aberta", async () => {
    const specX = makeSpec({ id: "FEAT-X", title: "Spec X" });
    const specY = makeSpec({ id: "FEAT-Y", title: "Spec Y" });
    const featureX = makeFeature({ id: "ft-x", name: "Feature X", sessionIds: ["FEAT-X"] });
    const featureY = makeFeature({ id: "ft-y", name: "Feature Y", sessionIds: ["FEAT-Y"] });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [specX, specY], features: [featureX, featureY] },
    ]);

    // Landing default agora é a Overview (S2/Task 6); entra no kanban explicitamente.
    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    await userEvent.click(screen.getByText("Feature X"));
    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Snapshot atualiza FEAT-Y mas mantém FEAT-X
    const updatedY = makeSpec({ id: "FEAT-Y", title: "Spec Y atualizada" });
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [specX, updatedY], features: [featureX, featureY] })]);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // O drawer ainda exibe FEAT-X (identificada via aria-label)
    expect(screen.getByRole("dialog", { name: /FEAT-X/i })).toBeInTheDocument();
  });
});
