/**
 * Testes de integração para src/collector/observed.ts — leitor de sessões observadas.
 *
 * TDD: testes escritos antes da implementação. Cada caso usa fixtures sintéticas
 * em packages/os/test/fixtures/obs-* que cobrem os cenários de ciclo de vida.
 *
 * Cobre:
 *   1. obs-aberto  — card normal em andamento
 *   2. obs-fechado — card done, lastActivityAt = closed_at
 *   3. obs-atencao — needs_attention + attentionKind
 *   4. obs-abandonado — status abandoned
 *   5. obs-drift — closed_at + status não-terminal → driftFlag
 *   6. obs-status-estranho — status fora do enum → driftFlag
 *   7. obs-ilegivel — YAML inválido em dir OBS-* → card degradado
 *   8. obs-legado-feat — session SDD sem mode: observed → null
 *   9. dir sem session.yml → null
 *  10. obs-aberto (sem closed_at) → lastActivityAt não-nulo (mtime de session.yml)
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSessionDir, withAt } from "./observed.js";

const here = dirname(fileURLToPath(import.meta.url));
// Caminho até packages/os/test/fixtures/ subindo de src/collector/ → src/ → packages/os/
const fixt = (name: string) => join(here, "..", "..", "test", "fixtures", name);

// ---------------------------------------------------------------------------
// 1. obs-aberto: card em andamento completo
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-aberto (OBS-010, in_progress)", () => {
  it("retorna Spec com id OBS-010", () => {
    const spec = readSessionDir(fixt("obs-aberto"));
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe("OBS-010");
  });

  it("title é o intent da sessão", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.title).toBe("Fixar emails na dashboard");
  });

  it("status é 'running' (in_progress → running)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.status).toBe("running");
  });

  it("observed.decisions tem 2 itens", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.decisions).toHaveLength(2);
  });

  it("primeira decision tem rejected === null (campo ausente → null)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.decisions[0].rejected).toBeNull();
  });

  it("observed.evidence tem 1 item", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.evidence).toHaveLength(1);
  });

  it("timeline é [] (decisions/evidence não viram TimelineEntry)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.timeline).toEqual([]);
  });

  it("tasks é []", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.tasks).toEqual([]);
  });

  it("observed.driftFlags é [] (sem inconsistências)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.driftFlags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. obs-fechado: card done com closed_at
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-fechado (OBS-011, done)", () => {
  it("status é 'done'", () => {
    const spec = readSessionDir(fixt("obs-fechado"))!;
    expect(spec.status).toBe("done");
  });

  it("lastActivityAt === closed_at da sessão", () => {
    const spec = readSessionDir(fixt("obs-fechado"))!;
    expect(spec.lastActivityAt).toBe("2026-06-10T18:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// 3. obs-atencao: needs_attention com attention.kind
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-atencao (OBS-012, needs_attention)", () => {
  it("status é 'needs_attention'", () => {
    const spec = readSessionDir(fixt("obs-atencao"))!;
    expect(spec.status).toBe("needs_attention");
  });

  it("observed.attentionKind === 'input'", () => {
    const spec = readSessionDir(fixt("obs-atencao"))!;
    expect(spec.observed!.attentionKind).toBe("input");
  });
});

// ---------------------------------------------------------------------------
// 4. obs-abandonado: status abandoned
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-abandonado (OBS-013, abandoned)", () => {
  it("status é 'abandoned'", () => {
    const spec = readSessionDir(fixt("obs-abandonado"))!;
    expect(spec.status).toBe("abandoned");
  });
});

// ---------------------------------------------------------------------------
// 5. obs-drift: closed_at presente com status não-terminal → driftFlag
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-drift (OBS-014, drift closed_with_open_status)", () => {
  it("status é 'done' (closed_at vence o in_progress)", () => {
    const spec = readSessionDir(fixt("obs-drift"))!;
    expect(spec.status).toBe("done");
  });

  it("driftFlags contém 'closed_with_open_status'", () => {
    const spec = readSessionDir(fixt("obs-drift"))!;
    expect(spec.observed!.driftFlags).toContain("closed_with_open_status");
  });
});

// ---------------------------------------------------------------------------
// 6. obs-status-estranho: status fora do enum → driftFlag
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-status-estranho (OBS-015, status desconhecido)", () => {
  it("status é 'running' (sem closed_at, status desconhecido → running)", () => {
    const spec = readSessionDir(fixt("obs-status-estranho"))!;
    expect(spec.status).toBe("running");
  });

  it("driftFlags contém 'unknown_status'", () => {
    const spec = readSessionDir(fixt("obs-status-estranho"))!;
    expect(spec.observed!.driftFlags).toContain("unknown_status");
  });
});

// ---------------------------------------------------------------------------
// 7. OBS-016: YAML inválido em dir OBS-* → card degradado
// ---------------------------------------------------------------------------

describe("readSessionDir — OBS-016 (YAML inválido)", () => {
  it("retorna Spec não-nulo (card nunca some do board)", () => {
    const spec = readSessionDir(fixt("OBS-016"));
    expect(spec).not.toBeNull();
  });

  it("status é 'unreadable'", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.status).toBe("unreadable");
  });

  it("id é o basename do dir 'OBS-016'", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.id).toBe("OBS-016");
  });

  it("driftFlags === ['unreadable_yaml']", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.observed!.driftFlags).toEqual(["unreadable_yaml"]);
  });

  it("observed.decisions é []", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.observed!.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. obs-legado-feat: session SDD (sem mode: observed) → null
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-legado-feat (FEAT-099, legado SDD)", () => {
  it("retorna null (filtrado do board observado)", () => {
    const spec = readSessionDir(fixt("obs-legado-feat"));
    expect(spec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. dir sem session.yml → null
// ---------------------------------------------------------------------------

describe("readSessionDir — dir sem session.yml", () => {
  it("retorna null quando session.yml não existe", () => {
    // spec-sem-custo existe como fixture e não tem session.yml
    const spec = readSessionDir(fixt("spec-sem-custo"));
    expect(spec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. obs-aberto (sem closed_at): lastActivityAt derivado do mtime de session.yml
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-aberto sem closed_at → lastActivityAt por mtime", () => {
  it("lastActivityAt é não-nulo (mtime de session.yml)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    // Sem closed_at, cai para max(mtime de session.yml e costs/*.json)
    expect(spec.lastActivityAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. OBS-019: YAML raiz é escalar (string solta) → card degradado (Fix 1)
// ---------------------------------------------------------------------------

describe("readSessionDir — OBS-019 (YAML raiz não-objeto)", () => {
  it("retorna Spec não-nulo (card nunca some do board)", () => {
    const spec = readSessionDir(fixt("OBS-019"));
    expect(spec).not.toBeNull();
  });

  it("status é 'unreadable'", () => {
    const spec = readSessionDir(fixt("OBS-019"))!;
    expect(spec.status).toBe("unreadable");
  });

  it("id é o basename do dir 'OBS-019'", () => {
    const spec = readSessionDir(fixt("OBS-019"))!;
    expect(spec.id).toBe("OBS-019");
  });

  it("driftFlags === ['unreadable_yaml']", () => {
    const spec = readSessionDir(fixt("OBS-019"))!;
    expect(spec.observed!.driftFlags).toEqual(["unreadable_yaml"]);
  });
});

// ---------------------------------------------------------------------------
// 12. obs-closed-vazio (OBS-020): closed_at: "" → tratado como ausente (Fix 2)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 13. obs-custo-ok (OBS-018): cost-report.json completo + completo → custo real
// ---------------------------------------------------------------------------

// obs-custo-ok não tem diretório costs/ por design: um costs/*.json commitado carregaria
// o mtime do checkout (sempre mais novo que o generated_at "2026-06-10T18:00:00Z" do
// cost-report.json), fabricando staleness permanente. Staleness é coberto pelos
// testes de temp-dir em cost-report.test.ts com mtimes controlados.
describe("readSessionDir — obs-custo-ok (OBS-018, cost-report.json completo)", () => {
  it("cost.totalCostUsd === 1.23 (lido do cost-report.json)", () => {
    const spec = readSessionDir(fixt("obs-custo-ok"))!;
    expect(spec.cost.totalCostUsd).toBe(1.23);
  });

  it("cost.source === 'cost_report'", () => {
    const spec = readSessionDir(fixt("obs-custo-ok"))!;
    expect(spec.cost.source).toBe("cost_report");
  });

  it("cost.byPhase === null (breakdown SDD seria falso para observado)", () => {
    const spec = readSessionDir(fixt("obs-custo-ok"))!;
    expect(spec.cost.byPhase).toBeNull();
  });

  it("cost.totalTokens === 500000", () => {
    const spec = readSessionDir(fixt("obs-custo-ok"))!;
    expect(spec.cost.totalTokens).toBe(500000);
  });

  it("cost.partial === false (complete true + unpriced_models vazio)", () => {
    const spec = readSessionDir(fixt("obs-custo-ok"))!;
    expect(spec.cost.partial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. obs-unpriced (OBS-017): unpriced_models não-vazio → null, nunca 0
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-unpriced (OBS-017, modelo sem preço)", () => {
  it("cost.totalCostUsd === null (NUNCA 0 quando há unpriced_models)", () => {
    const spec = readSessionDir(fixt("obs-unpriced"))!;
    expect(spec.cost.totalCostUsd).toBeNull();
  });

  it("cost.partial === true", () => {
    const spec = readSessionDir(fixt("obs-unpriced"))!;
    expect(spec.cost.partial).toBe(true);
  });

  it("cost.totalTokens > 0 (tokens preservados mesmo sem custo)", () => {
    const spec = readSessionDir(fixt("obs-unpriced"))!;
    expect(spec.cost.totalTokens).toBeGreaterThan(0);
  });

  it("cost.source === 'cost_report'", () => {
    const spec = readSessionDir(fixt("obs-unpriced"))!;
    expect(spec.cost.source).toBe("cost_report");
  });
});

// ---------------------------------------------------------------------------
// 15. obs-aberto (OBS-010): sem cost-report.json → source é partial ou empty
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-aberto (OBS-010) sem cost-report.json → fallback", () => {
  it("cost.source está em {'partial', 'empty'} (sem cost-report.json, cai na soma crua)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(["partial", "empty"]).toContain(spec.cost.source);
  });
});

describe("readSessionDir — obs-closed-vazio (OBS-020, closed_at vazio)", () => {
  it("status é 'running' (empty string = ausente, status in_progress mantido)", () => {
    const spec = readSessionDir(fixt("obs-closed-vazio"))!;
    expect(spec.status).toBe("running");
  });

  it("observed.closedAt é null (string vazia não vaza para closedAt)", () => {
    const spec = readSessionDir(fixt("obs-closed-vazio"))!;
    expect(spec.observed!.closedAt).toBeNull();
  });

  it("driftFlags é [] (closed_at vazio não gera drift)", () => {
    const spec = readSessionDir(fixt("obs-closed-vazio"))!;
    expect(spec.observed!.driftFlags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 16. obs-timeline (OBS-020): markers com edits/diff/blocks reais
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-timeline (markers)", () => {
  it("baseSha e outputLocale lidos do session.yml", () => {
    const spec = readSessionDir(fixt("obs-timeline"))!;
    expect(spec.observed!.baseSha).toBe("a1b2c3d");
    expect(spec.observed!.outputLocale).toBe("pt-BR");
  });
  it("markers começa com open e contém um edit", () => {
    const spec = readSessionDir(fixt("obs-timeline"))!;
    const kinds = spec.observed!.markers.map(m => m.kind);
    expect(kinds[0]).toBe("open");
    expect(kinds).toContain("edit");
  });
  it("edit marker carrega patch e counts do diff.json", () => {
    const spec = readSessionDir(fixt("obs-timeline"))!;
    const edit = spec.observed!.markers.find(m => m.kind === "edit")!;
    expect(edit.editFiles![0].path).toBe("src/app.ts");
    expect(edit.editFiles![0].added).toBe(3);
    expect(edit.editFiles![0].patch).toContain("@@");
  });
  it("block marker pareado do blocks.jsonl com duração", () => {
    const spec = readSessionDir(fixt("obs-timeline"))!;
    const block = spec.observed!.markers.find(m => m.kind === "block")!;
    expect(block).toBeDefined();
    expect(block.blockMs).toBe(900000); // 15 min
  });
  it("sessão sem artefatos de arquivo não quebra (sem edit/block; baseSha null)", () => {
    // obs-aberto não tem edits.jsonl/diff.json/blocks.jsonl nem base_sha.
    // Mesmo assim buildMarkers não joga erro — produz open + decisions/evidence da sessão.
    const spec = readSessionDir(fixt("obs-aberto"))!;
    const kinds = spec.observed!.markers.map(m => m.kind);
    expect(kinds).toContain("open");
    expect(kinds).not.toContain("edit");
    expect(kinds).not.toContain("block");
    expect(spec.observed!.baseSha).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 17. obs-trail (OBS-021): trail.jsonl → marker run na timeline
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-trail (OBS-021, trail.jsonl)", () => {
  it("expõe markers run a partir de trail.jsonl", () => {
    const spec = readSessionDir(fixt("obs-trail"))!;
    const run = spec.observed!.markers.find(m => m.kind === "run");
    expect(run?.note).toBe("npm test");
  });
});

// ---------------------------------------------------------------------------
// 18. report.md — parecer determinístico
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-com-report (report.md presente)", () => {
  it("expõe report.md em observed.report quando arquivo existe", () => {
    const spec = readSessionDir(fixt("obs-com-report"))!;
    expect(spec.observed!.report).toContain("O que foi feito");
  });

  it("report ausente → observed.report é null", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.report).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 19. withAt: alinhamento de `at` quando item inválido é descartado pelo meio
// ---------------------------------------------------------------------------

describe("withAt — alinhamento por índice com itens inválidos no meio", () => {
  it("withAt alinha at mesmo com item inválido no meio (índices divergentes)", () => {
    const raw = [
      { what: "A", at: "2026-06-13T14:05:00Z" },
      "garbage",
      { what: "B", at: "2026-06-13T14:25:00Z" },
    ];
    const normalized = [{ what: "A" }, { what: "B" }]; // como normalizeDecisions retornaria
    const out = withAt(raw, normalized as any);
    expect(out[0].at).toBe("2026-06-13T14:05:00Z");
    expect(out[1].at).toBe("2026-06-13T14:25:00Z"); // sem o fix, viria null
  });
});
