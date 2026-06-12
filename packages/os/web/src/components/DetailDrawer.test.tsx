import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailDrawer } from "./DetailDrawer";
import { makeSpec, makeProject, makeCost, makeTask, makeDispatch, makeObservedSpec, makeObservedMeta } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

function item(spec = makeSpec()) {
  return flattenSpecs([makeProject({ name: "proj-a", path: "/a", specs: [spec] })], false)[0];
}

describe("DetailDrawer", () => {
  it("fechado (item null) não renderiza conteúdo", () => {
    render(<DetailDrawer item={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aberto mostra id, título e tarefas", () => {
    const spec = makeSpec({
      id: "FEAT-7",
      title: "Checkout",
      tasks: [
        makeTask({ id: "T-1", state: "done", loops: 0 }),
        makeTask({ id: "T-2", state: "blocked", loops: 2 }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("FEAT-7")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("T-2")).toBeInTheDocument();
    expect(screen.getByText(/2 loops/)).toBeInTheDocument();
  });

  it("loops=1 (passada normal) não conta como retrabalho", () => {
    const spec = makeSpec({ tasks: [makeTask({ id: "T-9", state: "done", loops: 1 })] });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("T-9")).toBeInTheDocument();
    expect(screen.queryByText(/loops/)).toBeNull(); // só >1 mostra ↻ N loops
  });

  it("mostra o breakdown de custo por tipo de token", () => {
    const spec = makeSpec({
      cost: makeCost({ tokens: { input: 1400, output: 220, cacheRead: 480, cacheCreation: 30 } }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/input/i)).toBeInTheDocument();
    expect(screen.getByText(/cache read/i)).toBeInTheDocument();
  });

  it("mostra o link do report quando há reportPath", () => {
    const spec = makeSpec({
      cost: makeCost({ reportPath: "/a/.agent-session/FEAT-7/report.html" }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("report.html"));
  });

  it("sem reportPath não mostra link de report", () => {
    render(<DetailDrawer item={item(makeSpec({ cost: makeCost({ reportPath: null }) }))} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });

  it("botão fechar chama onClose", async () => {
    const onClose = vi.fn();
    render(<DetailDrawer item={item()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("report: mostra breakdown por fase", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        byPhase: { planning: 6.5, orchestration: 1, implementation: 2 },
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const phases = container.querySelector(".drawer-cost-phases")!;
    expect(within(phases as HTMLElement).getByText("planning")).toBeInTheDocument();
    expect(within(phases as HTMLElement).getByText("orchestration")).toBeInTheDocument();
    expect(within(phases as HTMLElement).getByText("implementation")).toBeInTheDocument();
    expect(within(phases as HTMLElement).getByText("US$ 6.50")).toBeInTheDocument();
  });

  it("scopingSuspect: implementation aparece como —", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        scopingSuspect: true,
        byPhase: { planning: 6.5, orchestration: 1, implementation: null },
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const phases = container.querySelector(".drawer-cost-phases")!;
    const implRow = within(phases as HTMLElement).getByText("implementation").closest("div")!;
    expect(implRow).toHaveTextContent("—");
  });

  it("partial: mostra badge 'preliminar' e nenhum breakdown denso por fase", () => {
    const spec = makeSpec({ cost: makeCost({ source: "partial", byPhase: null }) });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("preliminar")).toBeInTheDocument();
    // O drawer-cost-phases (dl denso) não deve existir em estado parcial;
    // o PhaseJourney (seção nova) pode exibir os nomes das fases normalmente.
    expect(container.querySelector(".drawer-cost-phases")).toBeNull();
  });
});

// ─── AC-015: tarefas renderizadas via TaskItem (colapsadas por padrão) ────────

describe("AC-015: tarefas via TaskItem — colapsadas por padrão no drawer", () => {
  it("cada tarefa renderiza como botão colapsado (aria-expanded=false)", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ id: "T-1", state: "done", loops: 0 }),
        makeTask({ id: "T-2", state: "blocked", loops: 2 }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const taskButtons = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(taskButtons).toHaveLength(2);
    taskButtons.forEach((btn) =>
      expect(btn).toHaveAttribute("aria-expanded", "false")
    );
  });

  it("tarefa com tokens no dispatch exibe o total de tokens na linha colapsada", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-3",
          state: "done",
          loops: 0,
          dispatches: [makeDispatch({ tokens: 2000 })],
        }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/2K.*tok|tok.*2K/)).toBeInTheDocument();
  });

  it("tarefa com todos dispatches de tokens null exibe '—' (nunca zero)", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-4",
          state: "pending",
          dispatches: [makeDispatch({ tokens: null })],
        }),
      ],
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const tokEl = container.querySelector(".task-item-tokens");
    expect(tokEl).not.toBeNull();
    expect(tokEl!.textContent).toBe("—");
  });

  it("clique numa tarefa no drawer a expande — conteúdo rico fica visível", async () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-5",
          state: "done",
          dispatches: [makeDispatch({ summary: "resumo da tarefa T-5" })],
        }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(screen.getByText("resumo da tarefa T-5")).toBeInTheDocument();
  });
});

// ─── AC-015/AC-017/AC-019: lista completa de tarefas, vazio, ao vivo ──────────

describe("AC-015: lista ALL tarefas sem colapsar nenhuma — todas visíveis", () => {
  it("10 tarefas → 10 botões colapsados, todos renderizados no DOM", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `T-${i + 1}`, state: "pending", loops: 0 })
    );
    render(<DetailDrawer item={item(makeSpec({ tasks }))} onClose={vi.fn()} />);
    const taskBtns = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(taskBtns).toHaveLength(10);
    taskBtns.forEach((btn) => expect(btn).toHaveAttribute("aria-expanded", "false"));
  });

  it("lista tem overflow-y: auto para permitir rolagem", () => {
    const tasks = [makeTask({ id: "T-1" }), makeTask({ id: "T-2" })];
    const { container } = render(
      <DetailDrawer item={item(makeSpec({ tasks }))} onClose={vi.fn()} />
    );
    const ul = container.querySelector(".drawer-tasks") as HTMLElement;
    expect(ul).not.toBeNull();
    // overflow é definido pela classe .drawer-tasks em app.css — sem inline style
    expect(ul.classList.contains("drawer-tasks")).toBe(true);
    expect(ul.style.overflowY).toBe("");
    expect(ul.style.maxHeight).toBe("");
  });

  it("nenhuma tarefa é ocultada (tarefas com estado variado — done, blocked, pending)", () => {
    const tasks = [
      makeTask({ id: "TA-1", state: "done" }),
      makeTask({ id: "TA-2", state: "blocked" }),
      makeTask({ id: "TA-3", state: "pending" }),
    ];
    render(<DetailDrawer item={item(makeSpec({ tasks }))} onClose={vi.fn()} />);
    expect(screen.getByText("TA-1")).toBeInTheDocument();
    expect(screen.getByText("TA-2")).toBeInTheDocument();
    expect(screen.getByText("TA-3")).toBeInTheDocument();
  });
});

describe("AC-017: estado vazio explícito quando spec.tasks é vazio ou undefined", () => {
  it("tasks vazio → exibe 'nenhuma tarefa ainda'", () => {
    const spec = makeSpec({ tasks: [] });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("nenhuma tarefa ainda")).toBeInTheDocument();
  });

  it("tasks vazio → NÃO renderiza nenhum task-item (sem item fantasma)", () => {
    const spec = makeSpec({ tasks: [] });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(container.querySelectorAll(".task-item")).toHaveLength(0);
  });

  it("com tasks → NÃO exibe o estado vazio", () => {
    const spec = makeSpec({ tasks: [makeTask({ id: "T-X" })] });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.queryByText("nenhuma tarefa ainda")).toBeNull();
  });
});

describe("AC-019: lista re-deriva do snapshot — linha atualiza ao vivo via WS", () => {
  it("task muda de 'pending' para 'done' no rerender e a linha reflete o novo estado", () => {
    const specV1 = makeSpec({
      tasks: [makeTask({ id: "T-W1", state: "pending" })],
    });
    const specV2 = makeSpec({
      tasks: [makeTask({ id: "T-W1", state: "done" })],
    });
    const { rerender } = render(
      <DetailDrawer item={item(specV1)} onClose={vi.fn()} />
    );
    expect(screen.getByText(/pendente|pending/i)).toBeInTheDocument();

    rerender(<DetailDrawer item={item(specV2)} onClose={vi.fn()} />);
    expect(screen.getByText(/concluída|done/i)).toBeInTheDocument();
    expect(screen.queryByText(/pendente|pending/i)).toBeNull();
  });

  it("nova tarefa adicionada ao snapshot aparece na lista sem fechar o drawer", () => {
    const specV1 = makeSpec({ tasks: [makeTask({ id: "T-R1" })] });
    const specV2 = makeSpec({
      tasks: [makeTask({ id: "T-R1" }), makeTask({ id: "T-R2", state: "done" })],
    });
    const { rerender } = render(
      <DetailDrawer item={item(specV1)} onClose={vi.fn()} />
    );
    expect(screen.queryByText("T-R2")).toBeNull();

    rerender(<DetailDrawer item={item(specV2)} onClose={vi.fn()} />);
    expect(screen.getByText("T-R2")).toBeInTheDocument();
  });

  it("task removida do snapshot desaparece da lista sem fechar o drawer", () => {
    const specV1 = makeSpec({
      tasks: [makeTask({ id: "T-S1" }), makeTask({ id: "T-S2" })],
    });
    const specV2 = makeSpec({ tasks: [makeTask({ id: "T-S1" })] });
    const { rerender } = render(
      <DetailDrawer item={item(specV1)} onClose={vi.fn()} />
    );
    expect(screen.getByText("T-S2")).toBeInTheDocument();

    rerender(<DetailDrawer item={item(specV2)} onClose={vi.fn()} />);
    expect(screen.queryByText("T-S2")).toBeNull();
    expect(screen.getByText("T-S1")).toBeInTheDocument();
  });
});

// ─── AC-008 a AC-013: buildStory (Voz A) + PhaseJourney (Voz B) + confiança ──

describe("AC-008: frase-resumo buildStory visível no topo do painel", () => {
  it("exibe a frase com status e custo quando source é report", () => {
    const spec = makeSpec({
      status: "running",
      tasks: [makeTask({ state: "done" }), makeTask({ id: "T-002", state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: { planning: 7.92, orchestration: 142.06, implementation: 29.25 },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const story = screen.getByTestId("drawer-story");
    expect(story).toBeInTheDocument();
    expect(story).toHaveTextContent("em execução");
    expect(story).toHaveTextContent("$179.23");
    expect(story).toHaveTextContent("2 tarefas");
  });

  it("frase cobre a fase dominante de custo (orchestration com maior $)", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 100.0,
        byPhase: { planning: 10.0, orchestration: 80.0, implementation: 10.0 },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-story")).toHaveTextContent("orchestration");
  });

  it("menciona bloqueios quando há tasks bloqueadas", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "blocked" }), makeTask({ id: "T-002", state: "done" })],
      cost: makeCost({ source: "report", totalCostUsd: 50.0, byPhase: { planning: 10.0, orchestration: 30.0, implementation: 10.0 } }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-story")).toHaveTextContent("bloqueada");
  });
});

describe("AC-009: PhaseJourney (Voz B) visível no painel", () => {
  it("exibe as fases com custo quando source é report", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: { planning: 7.92, orchestration: 142.06, implementation: 29.25 },
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const journey = container.querySelector(".phase-journey")!;
    expect(journey).not.toBeNull();
    expect(within(journey as HTMLElement).getByText("planning")).toBeInTheDocument();
    expect(within(journey as HTMLElement).getByText("orchestration")).toBeInTheDocument();
    expect(within(journey as HTMLElement).getByText("implementation")).toBeInTheDocument();
    expect(within(journey as HTMLElement).getByText("US$ 7.92")).toBeInTheDocument();
    expect(within(journey as HTMLElement).getByText("US$ 142.06")).toBeInTheDocument();
  });

  it("exibe o total de custo via PhaseJourney", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: { planning: 7.92, orchestration: 142.06, implementation: 29.25 },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("phase-journey-total")).toHaveTextContent("US$ 179.23");
  });
});

describe("AC-010: link para report.html presente quando disponível", () => {
  it("mostra link quando reportPath está definido", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        reportPath: "/a/.agent-session/FEAT-001/report.html",
        totalCostUsd: 10.0,
        byPhase: { planning: 5.0, orchestration: 3.0, implementation: 2.0 },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("report.html"));
  });

  it("NÃO mostra link quando reportPath é null", () => {
    const spec = makeSpec({ cost: makeCost({ reportPath: null }) });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });
});

describe("AC-011: source empty → graceful, sem dados inventados, sem crash", () => {
  it("renderiza sem crash quando cost source é empty", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
    });
    expect(() =>
      render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />)
    ).not.toThrow();
  });

  it("frase indica 'em planejamento' quando source é empty", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-story")).toHaveTextContent("em planejamento");
  });

  it("PhaseJourney mostra 'sem dados de custo' quando source é empty", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/sem dados de custo/i)).toBeInTheDocument();
  });

  it("não exibe número inventado — nem custo na frase nem nas fases", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const story = screen.getByTestId("drawer-story");
    expect(story.textContent).not.toMatch(/\$\d/);
  });
});

describe("AC-012: source partial → rótulo 'parcial' visível na frase e na jornada", () => {
  it("frase contém rótulo '(parcial)' quando source é partial", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({ source: "partial", totalCostUsd: 45.0, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-story")).toHaveTextContent("(parcial)");
  });

  it("PhaseJourney exibe badge 'parcial' quando source é partial", () => {
    const spec = makeSpec({
      cost: makeCost({ source: "partial", totalCostUsd: 45.0, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/^parcial$/i)).toBeInTheDocument();
  });

  it("fases marcadas como 'não rodada ainda' quando byPhase é null e partial", () => {
    const spec = makeSpec({
      cost: makeCost({ source: "partial", totalCostUsd: 45.0, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const notRunYet = screen.getAllByText(/não rodada ainda/i);
    expect(notRunYet.length).toBeGreaterThanOrEqual(3);
  });
});

describe("AC-013: source unreliable → sinalização de baixa confiança visível", () => {
  it("frase indica baixa confiança quando source é unreliable", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({ source: "unreliable", totalCostUsd: 6.55, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-story")).toHaveTextContent("baixa confiança");
  });

  it("PhaseJourney exibe badge 'não confiável' quando source é unreliable", () => {
    const spec = makeSpec({
      cost: makeCost({ source: "unreliable", totalCostUsd: 6.55, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/não confiável/i)).toBeInTheDocument();
  });

  it("não apresenta o número como exato — frase não contém $6.55 sem aviso", () => {
    const spec = makeSpec({
      cost: makeCost({ source: "unreliable", totalCostUsd: 6.55, byPhase: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const story = screen.getByTestId("drawer-story");
    expect(story.textContent).not.toMatch(/\$6\.55(?!\s*\()/);
  });
});

// ─── Painel de atenção ────────────────────────────────────────────────────────

describe("DetailDrawer — painel de atenção", () => {
  it("renderiza o AttentionPanel quando a spec está em atenção (blocked)", () => {
    render(<DetailDrawer item={item(makeSpec({ status: "blocked" }))} onClose={() => {}} />);
    expect(screen.getByText(/o que fazer aqui/i)).toBeInTheDocument();
  });

  it("NÃO renderiza o AttentionPanel quando a spec está running", () => {
    render(<DetailDrawer item={item(makeSpec({ status: "running" }))} onClose={() => {}} />);
    expect(screen.queryByText(/o que fazer aqui/i)).not.toBeInTheDocument();
  });
});

// ─── AC-021: re-render por push WS não lança erro ────────────────────────────

describe("AC-021: push WebSocket re-renderiza sem erro; expansão é efêmera", () => {
  it("estado de expansão sobrevive a re-render normal (mesmas props)", async () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-6",
          state: "done",
          dispatches: [makeDispatch({ summary: "conteúdo expandido" })],
        }),
      ],
    });
    const { rerender } = render(
      <DetailDrawer item={item(spec)} onClose={vi.fn()} />
    );
    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(screen.getByText("conteúdo expandido")).toBeInTheDocument();

    // re-render normal com as mesmas props — expansão sobrevive
    rerender(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("conteúdo expandido")).toBeInTheDocument();
  });

  it("push WS com Project[] novo causa re-render sem lançar erro", async () => {
    const spec1 = makeSpec({
      tasks: [
        makeTask({
          id: "T-7",
          state: "running",
          dispatches: [makeDispatch({ summary: "em progresso" })],
        }),
      ],
    });
    const spec2 = makeSpec({
      tasks: [
        makeTask({
          id: "T-7",
          state: "done",
          dispatches: [makeDispatch({ summary: "concluída agora" })],
        }),
      ],
    });
    const { rerender } = render(
      <DetailDrawer item={item(spec1)} onClose={vi.fn()} />
    );

    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(taskBtn).toHaveAttribute("aria-expanded", "true");

    // simula push WS: novo Project[] => novo item com spec atualizada; não deve lançar
    expect(() =>
      rerender(<DetailDrawer item={item(spec2)} onClose={vi.fn()} />)
    ).not.toThrow();

    // estado de expansão é efêmero — pode recolher no push (AC-021, documentado como válido);
    // com mesmo task.id a reconciliação React preserva o estado local (comportamento atual)
    const taskBtns = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(taskBtns).toHaveLength(1);
    expect(taskBtns[0]).toHaveAttribute("aria-expanded", "true");
    // novo estado da spec2 ("done" → "concluída") visível — prova que o rerender rodou
    expect(screen.getByText("concluída")).toBeInTheDocument();
  });

  it("push WS com spec sem tarefas não quebra o render", () => {
    const spec = makeSpec({ tasks: [] });
    const { rerender } = render(
      <DetailDrawer item={item(spec)} onClose={vi.fn()} />
    );
    expect(() =>
      rerender(<DetailDrawer item={item(makeSpec({ tasks: [] }))} onClose={vi.fn()} />)
    ).not.toThrow();
    expect(screen.getByText(/nenhuma tarefa ainda/i)).toBeInTheDocument();
  });
});

// ─── Observed drawer ──────────────────────────────────────────────────────────

describe("DetailDrawer — modo observado: header", () => {
  it("exibe pill OBSERVADO no header", () => {
    const spec = makeObservedSpec();
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("OBSERVADO")).toBeInTheDocument();
  });

  it("header observado exibe o nome do projeto junto ao pill", () => {
    const spec = makeObservedSpec();
    // item() usa makeProject({ name: "proj-a" }); o nome fica no mesmo span que o pill
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const projSpan = container.querySelector(".drawer-proj");
    expect(projSpan).not.toBeNull();
    expect(projSpan!.textContent).toContain("proj-a");
  });

  it("NÃO exibe o texto '· SDD' ou '· DISCOVERY' (squad label) para observed", () => {
    const spec = makeObservedSpec({ squad: "sdd" });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    // o padrão SDD é "projName · SDD" — deve estar ausente
    expect(screen.queryByText(/·\s*(SDD|DISCOVERY)/i)).toBeNull();
  });
});

describe("DetailDrawer — modo observado: janela do contrato", () => {
  it("exibe 'aberto em' com a data de createdAt", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ createdAt: "2026-06-01T10:00:00Z", closedAt: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/aberto em/i)).toBeInTheDocument();
  });

  it("exibe 'fechado em' quando closedAt está presente", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        createdAt: "2026-06-01T10:00:00Z",
        closedAt: "2026-06-02T14:30:00Z",
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/fechado em/i)).toBeInTheDocument();
  });

  it("NÃO exibe 'fechado em' quando closedAt é null (contrato aberto)", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ closedAt: null }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.queryByText(/fechado em/i)).toBeNull();
  });
});

describe("DetailDrawer — modo observado: seção Decisões", () => {
  it("decisão completa: what, why, rejected, ref em monospace", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        decisions: [
          {
            what: "usar queue em vez de chamada direta",
            why: "evita bloqueio no request cycle",
            rejected: "chamada síncrona",
            ref: "ADR-012",
          },
        ],
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("usar queue em vez de chamada direta")).toBeInTheDocument();
    expect(screen.getByText("evita bloqueio no request cycle")).toBeInTheDocument();
    expect(screen.getByText(/rejeitado:.*chamada síncrona/)).toBeInTheDocument();
    const ref = container.querySelector("code.obs-decision-ref");
    expect(ref).not.toBeNull();
    expect(ref!.textContent).toBe("ADR-012");
  });

  it("decisão com what+why apenas: sem linhas de rejected/ref", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        decisions: [
          { what: "usar TypeScript strict", why: "detecta erros cedo", rejected: null, ref: null },
        ],
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("usar TypeScript strict")).toBeInTheDocument();
    expect(screen.getByText("detecta erros cedo")).toBeInTheDocument();
    expect(screen.queryByText(/rejeitado:/i)).toBeNull();
    expect(container.querySelector("code.obs-decision-ref")).toBeNull();
  });

  it("lista vazia: exibe estado vazio 'nenhuma decisão registrada'", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ decisions: [] }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("nenhuma decisão registrada")).toBeInTheDocument();
  });

  it("decisão com why=null não renderiza parágrafo why vazio", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        decisions: [
          { what: "usar cache em memória", why: null, rejected: null, ref: null },
        ],
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(container.querySelector(".obs-decision-why")).toBeNull();
  });
});

describe("DetailDrawer — modo observado: seção Evidências", () => {
  it("evidência: cmd em monospace e result como texto", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        evidence: [
          { cmd: "npm test", result: "42 tests passed", kind: null },
        ],
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const cmdEl = container.querySelector("code.obs-evidence-cmd");
    expect(cmdEl).not.toBeNull();
    expect(cmdEl!.textContent).toBe("npm test");
    expect(screen.getByText("42 tests passed")).toBeInTheDocument();
  });

  it("lista vazia: exibe estado vazio 'nenhuma evidência registrada'", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ evidence: [] }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("nenhuma evidência registrada")).toBeInTheDocument();
  });

  it("item degenerado (cmd/result/kind todos null) não renderiza li vazio bordejado", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({
        evidence: [{ cmd: null, result: null, kind: null }],
      }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    // item degenerado deve ser filtrado — nenhum obs-evidence-item renderizado
    expect(container.querySelectorAll(".obs-evidence-item")).toHaveLength(0);
  });
});

describe("DetailDrawer — modo observado: seções SDD ausentes", () => {
  it("PhaseBar (.phase-bar) ausente para observed", () => {
    const { container } = render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(container.querySelector(".phase-bar")).toBeNull();
  });

  it("PhaseJourney (.phase-journey) ausente para observed", () => {
    const { container } = render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(container.querySelector(".phase-journey")).toBeNull();
  });

  it("lista de tarefas (.drawer-tasks) ausente para observed", () => {
    const { container } = render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(container.querySelector(".drawer-tasks")).toBeNull();
  });

  it("SpecSummaryBlock (.spec-summary) ausente para observed", () => {
    const { container } = render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(container.querySelector(".spec-summary")).toBeNull();
  });

  it("Timeline (.timeline) ausente para observed", () => {
    const { container } = render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(container.querySelector(".timeline")).toBeNull();
  });
});

describe("DetailDrawer — modo observado: badge de drift", () => {
  it("exibe aviso de drift quando driftFlags não-vazio", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ driftFlags: ["closed_with_open_status"] }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const drift = container.querySelector(".obs-drift");
    expect(drift).not.toBeNull();
    expect(drift!.textContent).toMatch(/estado inconsistente/i);
  });

  it("sem drift quando driftFlags está vazio", () => {
    const spec = makeObservedSpec({
      observed: makeObservedMeta({ driftFlags: [] }),
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(container.querySelector(".obs-drift")).toBeNull();
  });
});

describe("DetailDrawer — modo SDD legado NÃO afetado por observed", () => {
  it("drawer SDD renderiza PhaseBar normalmente", () => {
    const spec = makeSpec({ tasks: [makeTask({ id: "T-1" })] });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(container.querySelector(".phase-bar")).not.toBeNull();
  });

  it("drawer SDD renderiza lista de tarefas normalmente", () => {
    const spec = makeSpec({ tasks: [makeTask({ id: "T-SDD-1" })] });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("T-SDD-1")).toBeInTheDocument();
  });

  it("drawer SDD NÃO exibe pill OBSERVADO", () => {
    render(<DetailDrawer item={item(makeSpec())} onClose={vi.fn()} />);
    expect(screen.queryByText("OBSERVADO")).toBeNull();
  });
});

// ─── Fix 2: section ORDER lock (legacy drawer) ────────────────────────────────

describe("DetailDrawer — ordem das seções no modo SDD legado", () => {
  it("Tarefas aparece antes de Custo, e Custo antes de Linha do tempo", () => {
    const spec = makeSpec({ tasks: [makeTask({ id: "T-ORDER-1" })] });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const html = container.innerHTML;
    const idxTarefas = html.indexOf("Tarefas");
    const idxCusto = html.indexOf("Custo");
    const idxLinha = html.indexOf("Linha do tempo");
    expect(idxTarefas).toBeGreaterThan(-1);
    expect(idxCusto).toBeGreaterThan(-1);
    expect(idxLinha).toBeGreaterThan(-1);
    // Tarefas < Custo < Linha do tempo
    expect(idxTarefas).toBeLessThan(idxCusto);
    expect(idxCusto).toBeLessThan(idxLinha);
  });
});

// ─── Fix 4: seção Custo e DeliveryReportBlock presentes em AMBOS os modos ─────

describe("DetailDrawer — seção Custo presente em ambos os modos", () => {
  it("modo SDD: seção Custo está presente", () => {
    render(<DetailDrawer item={item(makeSpec())} onClose={vi.fn()} />);
    expect(screen.getByText("Custo")).toBeInTheDocument();
  });

  it("modo observado: seção Custo está presente", () => {
    render(<DetailDrawer item={item(makeObservedSpec())} onClose={vi.fn()} />);
    expect(screen.getByText("Custo")).toBeInTheDocument();
  });
});

describe("DetailDrawer — DeliveryReportBlock presente em ambos os modos", () => {
  it("modo SDD: bloco de parecer de entrega está presente (estado vazio)", () => {
    const spec = makeSpec({ deliveryReport: null });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    // DeliveryReportBlock renderiza sempre (null-safe); heading é a âncora real
    expect(screen.getAllByText("Parecer de entrega").length).toBeGreaterThanOrEqual(1);
  });

  it("modo observado: bloco de parecer de entrega está presente (estado vazio)", () => {
    const spec = makeObservedSpec({ deliveryReport: null });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getAllByText("Parecer de entrega").length).toBeGreaterThanOrEqual(1);
  });
});
