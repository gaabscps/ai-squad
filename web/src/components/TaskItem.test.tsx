import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskItem } from "./TaskItem";
import { makeTask, makeDispatch } from "../test-utils";
import type { DispatchFinding, DispatchTestEvidence } from "../../../src/store/types";

vi.mock("../state/useTaskSummary", () => ({
  useTaskSummary: () => ({ state: "empty", text: "", generatedAt: null, error: null, generate: vi.fn(), regenerate: vi.fn() }),
}));

function makeFinding(over: Partial<DispatchFinding> = {}): DispatchFinding {
  return {
    severity: "warning",
    file: "src/foo.ts",
    line: 42,
    text: "descrição do finding",
    ...over,
  };
}

function makeTestEvidence(over: Partial<DispatchTestEvidence> = {}): DispatchTestEvidence {
  return {
    command: "npx vitest run",
    passed: true,
    detail: null,
    ...over,
  };
}

// ─── AC-015: linha colapsada por padrão ───────────────────────────────────────

describe("AC-015: linha colapsada por padrão", () => {
  it("exibe o id e o estado da tarefa sem expandir", () => {
    const task = makeTask({ id: "T-005", state: "done" });
    render(<TaskItem task={task} specId="FEAT-001" />);
    expect(screen.getByText("T-005")).toBeInTheDocument();
    expect(screen.getByText(/conclu/i)).toBeInTheDocument();
  });

  it("não exibe o indicador ↻ loops quando loops ≤ 1", () => {
    render(<TaskItem task={makeTask({ loops: 1 })} specId="FEAT-001" />);
    expect(screen.queryByText(/↻/)).toBeNull();
  });

  it("não exibe o indicador ↻ loops quando loops é 0", () => {
    render(<TaskItem task={makeTask({ loops: 0 })} specId="FEAT-001" />);
    expect(screen.queryByText(/↻/)).toBeNull();
  });

  it("exibe ↻ N loops quando loops > 1", () => {
    render(<TaskItem task={makeTask({ loops: 3 })} specId="FEAT-001" />);
    expect(screen.getByText(/↻.*3/)).toBeInTheDocument();
  });

  it("exibe o total de tokens quando há valores numéricos nos dispatches", () => {
    const task = makeTask({
      dispatches: [makeDispatch({ tokens: 1000 }), makeDispatch({ tokens: 500 })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    expect(screen.getByText(/2K.*tok|tok.*2K/)).toBeInTheDocument();
  });

  it("omite o total de tokens (best-effort) quando todos os dispatches têm tokens null", () => {
    const task = makeTask({ dispatches: [makeDispatch({ tokens: null })] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    expect(screen.queryByText(/tok/i)).toBeNull();
  });

  it("não mostra o conteúdo expandido antes do clique", () => {
    const task = makeTask({
      dispatches: [makeDispatch({ summary: "resumo secreto" })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    expect(screen.queryByText("resumo secreto")).toBeNull();
  });
});

// ─── AC-016/AC-018: toggle de expansão ───────────────────────────────────────

describe("AC-016 / AC-018: toggle de expansão", () => {
  it("clique na tarefa colapsada expande e mostra 'O que foi feito'", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ summary: "implementei X" })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("implementei X")).toBeInTheDocument();
  });

  it("segundo clique colapsa e oculta o conteúdo", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ summary: "implementei X" })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    const btn = screen.getByRole("button");
    await userEvent.click(btn);
    expect(screen.getByText("implementei X")).toBeInTheDocument();
    await userEvent.click(btn);
    expect(screen.queryByText("implementei X")).toBeNull();
  });

  it("expandido mostra 'Arquivos mudados' quando há arquivos", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ filesChanged: ["src/a.ts", "src/b.ts"] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("expandido mostra o rótulo 'Findings de review' quando há findings", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ findings: [makeFinding()] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Findings de review/i)).toBeInTheDocument();
  });

  it("expandido mostra 'Testes' quando há testEvidence", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ testEvidence: [makeTestEvidence({ command: "npx vitest run src/foo.test.ts" })] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/npx vitest run src\/foo.test.ts/)).toBeInTheDocument();
  });

  it("expandido mostra 'Histórico de loops' com dev/review/qa por loop", async () => {
    const task = makeTask({
      dispatches: [
        makeDispatch({ role: "dev", loop: 1 }),
        makeDispatch({ role: "reviewer", loop: 1 }),
      ],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Histórico de loops/i)).toBeInTheDocument();
    expect(screen.getByText(/dev/i)).toBeInTheDocument();
    expect(screen.getByText(/reviewer/i)).toBeInTheDocument();
  });
});

// ─── AC-017: todos os findings, sem amostrar ──────────────────────────────────

describe("AC-017: todos os findings renderizados", () => {
  it("mostra todos os findings sem amostrar (3 findings → 3 itens)", async () => {
    const findings: DispatchFinding[] = [
      makeFinding({ text: "finding um", severity: "error", file: "src/a.ts", line: 1 }),
      makeFinding({ text: "finding dois", severity: "warning", file: "src/b.ts", line: 10 }),
      makeFinding({ text: "finding três", severity: "info", file: "src/c.ts", line: 99 }),
    ];
    const task = makeTask({
      dispatches: [makeDispatch({ findings })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("finding um")).toBeInTheDocument();
    expect(screen.getByText("finding dois")).toBeInTheDocument();
    expect(screen.getByText("finding três")).toBeInTheDocument();
  });

  it("exibe severity, file:line e text de cada finding", async () => {
    const task = makeTask({
      dispatches: [
        makeDispatch({
          findings: [makeFinding({ severity: "error", file: "src/x.ts", line: 7, text: "bug aqui" })],
        }),
      ],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/error/i)).toBeInTheDocument();
    expect(screen.getByText(/src\/x\.ts:7/)).toBeInTheDocument();
    expect(screen.getByText("bug aqui")).toBeInTheDocument();
  });

  it("findings de múltiplos dispatches são todos exibidos", async () => {
    const task = makeTask({
      dispatches: [
        makeDispatch({ role: "reviewer", loop: 1, findings: [makeFinding({ text: "finding do loop 1" })] }),
        makeDispatch({ role: "reviewer", loop: 2, findings: [makeFinding({ text: "finding do loop 2" })] }),
      ],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("finding do loop 1")).toBeInTheDocument();
    expect(screen.getByText("finding do loop 2")).toBeInTheDocument();
  });

  it("finding com file null e line null não quebra o render", async () => {
    const task = makeTask({
      dispatches: [
        makeDispatch({ findings: [makeFinding({ file: null, line: null, text: "sem localização" })] }),
      ],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("sem localização")).toBeInTheDocument();
  });
});

// ─── AC-019: empty-state (sem dispatches) ────────────────────────────────────

describe("AC-019: empty-state — tarefa sem dispatches", () => {
  it("tarefa sem dispatches preserva a linha colapsada (id, estado)", () => {
    const task = makeTask({ id: "T-003", state: "pending", dispatches: [] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    expect(screen.getByText("T-003")).toBeInTheDocument();
    expect(screen.getByText(/pendente/i)).toBeInTheDocument();
  });

  it("tarefa sem dispatches pode expandir sem quebrar", async () => {
    const task = makeTask({ id: "T-001", dispatches: [] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    const header = screen.getByRole("button", { name: /T-001/ });
    await userEvent.click(header);
    // sem erro — componente continua montado
    expect(header).toBeInTheDocument();
  });

  it("expandida com dispatches vazios mostra aviso discreto", async () => {
    const task = makeTask({ dispatches: [] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/sem dispatches registrados/i)).toBeInTheDocument();
  });

  it("tarefa sem dispatches não some do DOM após clicar", async () => {
    const task = makeTask({ id: "T-004", dispatches: [] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("T-004")).toBeInTheDocument();
  });
});

// ─── AC-020: omitir blocos vazios ────────────────────────────────────────────

describe("AC-020: blocos vazios omitidos", () => {
  it("omite 'O que foi feito' quando todos os dispatches têm summary null", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ summary: null })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button", { name: /T-001/ }));
    const details = screen.getByText(/Detalhes t[ée]cnicos/i).closest("details")!;
    expect(within(details).queryByText(/O que foi feito/i)).toBeNull();
  });

  it("omite 'Arquivos mudados' quando filesChanged é vazio em todos os dispatches", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ filesChanged: [] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/Arquivos mudados/i)).toBeNull();
  });

  it("omite 'Findings de review' quando não há findings", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ findings: [] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/Findings de review/i)).toBeNull();
  });

  it("omite 'Testes' quando testEvidence é vazio em todos os dispatches", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ testEvidence: [] })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/Testes/i)).toBeNull();
  });

  it("exibe bloco presente quando um dispatch tem summary e outro não", async () => {
    const task = makeTask({
      dispatches: [
        makeDispatch({ summary: null }),
        makeDispatch({ summary: "feito na segunda passada" }),
      ],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button", { name: /T-001/ }));
    expect(screen.getByText("feito na segunda passada")).toBeInTheDocument();
    const details = screen.getByText(/Detalhes t[ée]cnicos/i).closest("details")!;
    expect(within(details).getByText(/O que foi feito/i)).toBeInTheDocument();
  });

  it("exibe 'Histórico de loops' mesmo quando um dispatch não tem summary", async () => {
    const task = makeTask({
      dispatches: [makeDispatch({ role: "dev", loop: 1, summary: null })],
    });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button"));
    // Histórico de loops sempre presente quando há dispatches
    expect(screen.getByText(/Histórico de loops/i)).toBeInTheDocument();
  });
});

// ─── Resumo IA + Detalhes técnicos ───────────────────────────────────────────

describe("Resumo IA + Detalhes técnicos", () => {
  it("expandido mostra o botão 'gerar resumo' e o grupo 'Detalhes técnicos'", async () => {
    const task = makeTask({ dispatches: [makeDispatch({ summary: "fez X" })] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button", { name: /T-001|tarefa/i }));
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeInTheDocument();
    expect(screen.getByText(/Detalhes t[ée]cnicos/i)).toBeInTheDocument();
  });

  it("desabilita 'gerar resumo' quando a task não tem dispatches", async () => {
    render(<TaskItem task={makeTask({ id: "T-001", dispatches: [] })} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button", { name: /T-001|tarefa/i }));
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeDisabled();
    expect(screen.getByText(/sem dados para resumir/i)).toBeInTheDocument();
  });
});
