import { describe, it, expect } from "vitest";
import { buildStory } from "./buildStory";
import { makeSpec, makeTask, makeCost, makeObservedSpec } from "../test-utils";

// AC-008: frase-resumo determinística com nº de tarefas, bloqueios, custo e fase dominante
// AC-011: source "empty" / sem fases → "em planejamento" (omissão graciosa)
// AC-012: source "partial" → rótulo "(parcial)"
// AC-013: source "unreliable" → sinaliza baixa confiança

describe("buildStory – AC-008: source report (frase completa)", () => {
  it("exibe nº de tarefas, custo exato e fase dominante", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ state: "done" }),
        makeTask({ id: "T-002", state: "done" }),
        makeTask({ id: "T-003", state: "pending" }),
      ],
      cost: makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: { planning: 7.92, orchestration: 142.06, implementation: 29.25 },
      }),
    });
    const result = buildStory(spec);
    expect(result).toContain("3 tarefas");
    expect(result).toContain("$179.23");
    expect(result).toContain("orchestration");
  });

  it("frase é determinística: mesma entrada gera exatamente a mesma saída", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 45.0,
        byPhase: { planning: 10.0, orchestration: 20.0, implementation: 15.0 },
      }),
    });
    expect(buildStory(spec)).toBe(buildStory(spec));
  });

  it("fase dominante é a de maior custo (orchestration ganha)", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 100.0,
        byPhase: { planning: 10.0, orchestration: 80.0, implementation: 10.0 },
      }),
    });
    expect(buildStory(spec)).toContain("orchestration");
  });

  it("em empate, planning ganha sobre orchestration e implementation", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 30.0,
        byPhase: { planning: 10.0, orchestration: 10.0, implementation: 10.0 },
      }),
    });
    expect(buildStory(spec)).toContain("planning");
  });

  it("em empate entre orchestration e implementation, orchestration ganha", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 20.0,
        byPhase: { planning: 0.0, orchestration: 10.0, implementation: 10.0 },
      }),
    });
    expect(buildStory(spec)).toContain("orchestration");
  });
});

describe("buildStory – AC-012: source partial (rótulo parcial)", () => {
  it("inclui rótulo '(parcial)' junto ao custo", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" }), makeTask({ id: "T-002", state: "running" })],
      cost: makeCost({
        source: "partial",
        totalCostUsd: 45.0,
        byPhase: null,
      }),
    });
    const result = buildStory(spec);
    expect(result).toContain("(parcial)");
    expect(result).toContain("$45.00");
  });

  it("NÃO contém rótulo parcial quando source é report", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        totalCostUsd: 10.0,
        byPhase: { planning: 5.0, orchestration: 3.0, implementation: 2.0 },
      }),
    });
    expect(buildStory(spec)).not.toContain("(parcial)");
  });
});

describe("buildStory – AC-013: source unreliable (baixa confiança)", () => {
  it("sinaliza baixa confiança em vez de apresentar número como exato", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({
        source: "unreliable",
        totalCostUsd: 6.55,
        byPhase: null,
      }),
    });
    const result = buildStory(spec);
    expect(result).toContain("baixa confiança");
  });

  it("NÃO exibe o número como exato quando unreliable", () => {
    const spec = makeSpec({
      cost: makeCost({ source: "unreliable", totalCostUsd: 6.55 }),
    });
    // deve conter sinalização, não o número cru sem aviso
    const result = buildStory(spec);
    expect(result).not.toMatch(/\$6\.55(?!\s*\()/); // se exibir o valor, deve ter contexto
    expect(result).toContain("baixa confiança");
  });
});

describe("buildStory – AC-011: source empty / sem fases (omissão graciosa)", () => {
  it("source empty → contém 'em planejamento' (AC-008 também exige status)", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
    });
    const result = buildStory(spec);
    expect(result).toContain("em planejamento");
    expect(result).toContain("em execução");
  });

  it("totalCostUsd null com source partial → não quebra, omite custo graciosamente", () => {
    const spec = makeSpec({
      tasks: [makeTask()],
      cost: makeCost({ source: "partial", totalCostUsd: null, byPhase: null }),
    });
    const result = buildStory(spec);
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("NaN");
  });

  it("source partial + totalCostUsd null → frase contém '(parcial)' mesmo sem valor monetário", () => {
    const spec = makeSpec({
      tasks: [makeTask()],
      cost: makeCost({ source: "partial", totalCostUsd: null, byPhase: null }),
    });
    const result = buildStory(spec);
    expect(result).toContain("(parcial)");
  });

  it("byPhase null com source report não quebra e omite a fase dominante graciosamente", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({ source: "report", totalCostUsd: 10.0, byPhase: null }),
    });
    const result = buildStory(spec);
    expect(result).toContain("$10.00");
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
  });
});

describe("buildStory – AC-008: status da feature na frase", () => {
  const baseCost = makeCost({
    source: "report",
    totalCostUsd: 50.0,
    byPhase: { planning: 10.0, orchestration: 30.0, implementation: 10.0 },
  });

  it("status 'running' → frase contém 'em execução'", () => {
    const spec = makeSpec({ tasks: [makeTask()], cost: baseCost, status: "running" });
    expect(buildStory(spec)).toContain("em execução");
  });

  it("status 'done' → frase contém 'concluída'", () => {
    const spec = makeSpec({ tasks: [makeTask()], cost: baseCost, status: "done" });
    expect(buildStory(spec)).toContain("concluída");
  });

  it("status 'blocked' → frase contém 'bloqueada'", () => {
    const spec = makeSpec({ tasks: [makeTask()], cost: baseCost, status: "blocked" });
    expect(buildStory(spec)).toContain("bloqueada");
  });

  it("status 'paused' → frase contém 'pausada'", () => {
    const spec = makeSpec({ tasks: [makeTask()], cost: baseCost, status: "paused" });
    expect(buildStory(spec)).toContain("pausada");
  });

  it("status 'escalated' → frase contém 'escalada'", () => {
    const spec = makeSpec({ tasks: [makeTask()], cost: baseCost, status: "escalated" });
    expect(buildStory(spec)).toContain("escalada");
  });

  it("status está presente mesmo quando source é 'empty'", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({ source: "empty", totalCostUsd: null, byPhase: null }),
      status: "running",
    });
    expect(buildStory(spec)).toContain("em execução");
  });
});

describe("buildStory – AC-008: tarefas bloqueadas e sem tarefas", () => {
  it("menciona bloqueios quando há tasks bloqueadas", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ state: "done" }),
        makeTask({ id: "T-002", state: "blocked" }),
        makeTask({ id: "T-003", state: "blocked" }),
      ],
      cost: makeCost({
        source: "report",
        totalCostUsd: 50.0,
        byPhase: { planning: 10.0, orchestration: 30.0, implementation: 10.0 },
      }),
    });
    const result = buildStory(spec);
    expect(result).toContain("bloqueada");
    expect(result).toMatch(/2\s*bloqueada/);
  });

  it("sem tasks bloqueadas → NÃO menciona bloqueios", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" }), makeTask({ id: "T-002", state: "running" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 20.0,
        byPhase: { planning: 5.0, orchestration: 10.0, implementation: 5.0 },
      }),
    });
    expect(buildStory(spec)).not.toContain("bloqueada");
  });

  it("sem tarefas e source report → não menciona contagem de tarefas desnecessariamente", () => {
    const spec = makeSpec({
      tasks: [],
      cost: makeCost({
        source: "report",
        totalCostUsd: 5.0,
        byPhase: { planning: 5.0, orchestration: 0.0, implementation: 0.0 },
      }),
    });
    const result = buildStory(spec);
    // pode exibir "0 tarefas" ou omitir; o que não pode é quebrar
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
  });

  it("uma task bloqueada → menciona '1 bloqueada'", () => {
    const spec = makeSpec({
      tasks: [makeTask({ state: "blocked" }), makeTask({ id: "T-002", state: "done" })],
      cost: makeCost({
        source: "report",
        totalCostUsd: 30.0,
        byPhase: { planning: 5.0, orchestration: 20.0, implementation: 5.0 },
      }),
    });
    const result = buildStory(spec);
    expect(result).toContain("bloqueada");
    expect(result).toMatch(/1\s*bloqueada/);
  });
});

describe("buildStory — modo observado", () => {
  it("spec observada com custo: frase contém status label e custo em USD", () => {
    const spec = makeObservedSpec({
      status: "done",
      cost: makeCost({ source: "cost_report", totalCostUsd: 3.5 }),
    });
    const result = buildStory(spec);
    expect(result).toContain("concluído");
    expect(result).toMatch(/3[.,]50/);
  });

  it("spec observada com custo null: frase contém status label e tokens", () => {
    const spec = makeObservedSpec({
      status: "running",
      cost: makeCost({ source: "cost_report", totalCostUsd: null, totalTokens: 5_200_000 }),
    });
    const result = buildStory(spec);
    // status label presente (qualquer forma natural de "running")
    expect(result.toLowerCase()).toMatch(/rodando|em andamento|em execu/);
    // tokens formatados aparecem (ex: "5.2M tokens")
    expect(result).toMatch(/5[.,]2M/);
  });

  it("spec observada NÃO contém 'tarefa', 'planejamento' nem 'fase'", () => {
    const spec = makeObservedSpec({
      status: "needs_attention",
      cost: makeCost({ source: "cost_report", totalCostUsd: 1.0 }),
    });
    const result = buildStory(spec);
    expect(result).not.toMatch(/tarefa/i);
    expect(result).not.toMatch(/planejamento/i);
    expect(result).not.toMatch(/fase/i);
  });

  it("spec observada preserva branch SDD quando spec.observed está ausente", () => {
    // spec SDD legado — observed ausente → buildStory usa o branch SDD intacto
    const spec = makeSpec({
      tasks: [makeTask({ state: "done" })],
      cost: makeCost({ source: "report", totalCostUsd: 10.0, byPhase: { planning: 10, orchestration: 0, implementation: 0 } }),
    });
    const result = buildStory(spec);
    expect(result).toContain("tarefa"); // SDD sempre menciona tarefas
  });

  it("observed partial com tokens > 0 → frase contém tokens + '(em coleta)'", () => {
    const spec = makeObservedSpec({
      status: "running",
      cost: makeCost({ source: "partial", totalCostUsd: null, totalTokens: 2_100_000 }),
    });
    const result = buildStory(spec);
    expect(result).toMatch(/2[.,]1M/);
    expect(result).toContain("em coleta");
    expect(result).not.toContain("sem custo ainda");
  });

  it("observed partial com totalTokens === 0 → frase contém 'sem custo ainda'", () => {
    const spec = makeObservedSpec({
      status: "running",
      cost: makeCost({ source: "partial", totalCostUsd: null, totalTokens: 0 }),
    });
    const result = buildStory(spec);
    expect(result).toContain("sem custo ainda");
  });
});
