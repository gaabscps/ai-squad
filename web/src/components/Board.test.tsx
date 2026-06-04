import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider, useProjectsDispatch, type ProjectsAction } from "../state/projects";
import { makeProject, makeSpec } from "../test-utils";
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
  it("mostra os cards das specs no kanban por padrão", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", status: "running", tasks: [{ id: "T-1", state: "running", loops: 0, dispatches: [] }] })] }]);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
  });

  it("filtra por projeto", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("busca filtra por texto", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [
      makeSpec({ id: "FEAT-1", title: "Exportar PDF" }),
      makeSpec({ id: "FEAT-2", title: "Login social" }),
    ] }]);
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("alterna pra tabela", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] }]);
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("clicar num card abre o drawer; fechar o esconde", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "Checkout" })] }]);
    await userEvent.click(screen.getByText("FEAT-1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ocultar manda o id estável e reseta o filtro do projeto oculto", async () => {
    const { onHide } = renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "proj-xyz", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" })); // filtra proj-a
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
    expect(screen.getByText("FEAT-2")).toBeInTheDocument(); // filtro resetou
  });

  it("desligar 'mostrar ocultos' reseta o filtro de um projeto oculto (não deixa o board vazio)", async () => {
    renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "proj-xyz", name: "proj-b", hidden: true, specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // revela proj-b
    await userEvent.click(screen.getByRole("button", { name: "proj-b" })); // filtra o oculto
    expect(screen.queryByText("FEAT-1")).toBeNull(); // só proj-b
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // desliga de novo
    expect(screen.getByText("FEAT-1")).toBeInTheDocument(); // filtro resetou, board não ficou vazio
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

  it("kanban esconde a done velha (arquivada)", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    expect(screen.queryByText("FEAT-OLD")).toBeNull();
    expect(screen.getByText("FEAT-NEW")).toBeInTheDocument(); // done nova ainda aparece
  });

  it("aba Arquivadas mostra só a done velha", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    // Usa fireEvent pra evitar hang de userEvent com fake timers
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText("FEAT-OLD")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-NEW")).toBeNull();
  });

  it("aba Arquivadas vazia mostra empty state", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneNova()] }]);
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText(/nenhuma feature arquivada/i)).toBeInTheDocument();
  });
});

describe("Board — AC-014: foco do painel por id resiliente a snapshot WebSocket", () => {
  it("drawer permanece aberto quando chega snapshot com dados novos da mesma spec", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "Título original" });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec] },
    ]);

    await userEvent.click(screen.getByText("FEAT-X"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Título original aparece no drawer
    expect(dialog).toHaveTextContent("Título original");

    // Simula snapshot WS com título atualizado para a mesma spec
    const updatedSpec = makeSpec({ id: "FEAT-X", title: "Título atualizado" });
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [updatedSpec] })]);

    // Drawer permanece aberto (não fecha)
    const dialogAfter = screen.getByRole("dialog");
    expect(dialogAfter).toBeInTheDocument();
    // E mostra os dados novos (derivação por id funciona)
    expect(dialogAfter).toHaveTextContent("Título atualizado");
    expect(dialogAfter).not.toHaveTextContent("Título original");
  });

  it("drawer fecha quando a spec some do snapshot (sem a spec, sem seleção)", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "Spec temporária" });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec] },
    ]);

    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Snapshot sem a spec (removida externamente)
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [] })]);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drawer re-deriva dados ao vivo: múltiplos snapshots consecutivos mantêm o foco", async () => {
    const spec = makeSpec({ id: "FEAT-X", title: "v1" });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [spec] },
    ]);

    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [makeSpec({ id: "FEAT-X", title: "v2" })] })]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("v2");

    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [makeSpec({ id: "FEAT-X", title: "v3" })] })]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("v3");
  });

  it("snapshot com outra spec no projeto não fecha o drawer da spec aberta", async () => {
    const specX = makeSpec({ id: "FEAT-X", title: "Spec X" });
    const specY = makeSpec({ id: "FEAT-Y", title: "Spec Y" });
    const { pushSnapshot } = renderBoardWithDispatch([
      { id: "proj-p", name: "proj-p", specs: [specX, specY] },
    ]);

    await userEvent.click(screen.getByText("FEAT-X"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Snapshot atualiza FEAT-Y mas mantém FEAT-X
    const updatedY = makeSpec({ id: "FEAT-Y", title: "Spec Y atualizada" });
    pushSnapshot([makeProject({ id: "proj-p", name: "proj-p", specs: [specX, updatedY] })]);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // O drawer ainda exibe FEAT-X (identificada via aria-label)
    expect(screen.getByRole("dialog", { name: /FEAT-X/i })).toBeInTheDocument();
  });
});
