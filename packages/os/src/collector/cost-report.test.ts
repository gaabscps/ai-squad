import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCostReport, readObservedCostRollup } from "./cost-report.js";

const dirs: string[] = [];
function specDirWith(content: string | null): string {
  const d = mkdtempSync(join(tmpdir(), "aios-costreport-"));
  dirs.push(d);
  if (content !== null) writeFileSync(join(d, "cost-report.json"), content);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FULL = JSON.stringify({
  planning_cost_usd: 6.5,
  orchestration_cost_usd: 1.0,
  implementation_cost_usd: 2.0,
  total_cost_usd: 9.5,
  subagent_count: 3,
  excluded_subagents: 66,
  recovered_subagents: 4,
  scoping_suspect: false,
  unpriced_models: [],
  complete: false,
  tokens: {
    by_type: { input: 100, output: 50, cache_read: 1000, cache_creation: 200 },
    total: 1350,
  },
});

describe("readCostReport — arquivo válido completo", () => {
  it("normaliza custo, fases, tokens e flags", () => {
    const r = readCostReport(specDirWith(FULL));
    expect(r).not.toBeNull();
    expect(r!.totalCostUsd).toBe(9.5);
    expect(r!.byPhase).toEqual({ planning: 6.5, orchestration: 1.0, implementation: 2.0 });
    expect(r!.tokens).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 });
    expect(r!.totalTokens).toBe(1350);
    expect(r!.partial).toBe(false);
    expect(r!.scopingSuspect).toBe(false);
    expect(r!.excludedSubagents).toBe(66);
    expect(r!.recoveredSubagents).toBe(4);
    expect(r!.complete).toBe(false);
  });
});

describe("readCostReport — casos de borda", () => {
  it("ausente ⇒ null", () => {
    expect(readCostReport(specDirWith(null))).toBeNull();
  });

  it("JSON inválido ⇒ null (não inventa número)", () => {
    expect(readCostReport(specDirWith("{ não é json"))).toBeNull();
  });

  it("sem total_cost_usd numérico ⇒ null", () => {
    expect(readCostReport(specDirWith(JSON.stringify({ complete: true })))).toBeNull();
  });

  it("válido mínimo (shape FEAT-010, sem bloco tokens) ⇒ tokens null", () => {
    const min = JSON.stringify({
      planning_cost_usd: 0,
      orchestration_cost_usd: 0,
      implementation_cost_usd: 0,
      total_cost_usd: 0,
      unpriced_models: [],
      complete: true,
    });
    const r = readCostReport(specDirWith(min))!;
    expect(r).not.toBeNull();
    expect(r.totalCostUsd).toBe(0);
    expect(r.tokens).toBeNull();
    expect(r.totalTokens).toBeNull();
    expect(r.complete).toBe(true);
    expect(r.scopingSuspect).toBe(false);
    expect(r.excludedSubagents).toBeNull();
  });

  it("scoping_suspect=true ⇒ implementation vira null", () => {
    const susp = JSON.stringify({
      planning_cost_usd: 5,
      orchestration_cost_usd: 1,
      implementation_cost_usd: 99,
      total_cost_usd: 105,
      scoping_suspect: true,
      unpriced_models: [],
    });
    const r = readCostReport(specDirWith(susp))!;
    expect(r.scopingSuspect).toBe(true);
    expect(r.byPhase.implementation).toBeNull();
    expect(r.byPhase.planning).toBe(5);
  });

  it("bloco tokens presente mas sem total ⇒ totalTokens null (não 0)", () => {
    const noTotal = JSON.stringify({
      total_cost_usd: 3,
      unpriced_models: [],
      tokens: { by_type: { input: 10, output: 5, cache_read: 0, cache_creation: 0 } },
    });
    const r = readCostReport(specDirWith(noTotal))!;
    expect(r.tokens).toEqual({ input: 10, output: 5, cacheRead: 0, cacheCreation: 0 });
    expect(r.totalTokens).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readObservedCostRollup — testes unitários
// ---------------------------------------------------------------------------

const OBS_REPORT_OK = JSON.stringify({
  spec_id: "OBS-018",
  mode: "observed",
  total_cost_usd: 1.23,
  complete: true,
  unpriced_models: [],
  generated_at: "2026-06-10T18:00:00Z",
  tokens: {
    total: 500000,
    by_type: { input: 100000, output: 50000, cache_read: 340000, cache_creation: 10000 },
  },
});

function obsSpecDirWith(report: string | null, costFiles?: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "aios-obs-rollup-"));
  dirs.push(d);
  if (report !== null) writeFileSync(join(d, "cost-report.json"), report);
  if (costFiles) {
    const costsDir = join(d, "costs");
    mkdirSync(costsDir);
    for (const [name, content] of Object.entries(costFiles)) {
      writeFileSync(join(costsDir, name), content);
    }
  }
  return d;
}

describe("readObservedCostRollup — complete ausente ⇒ totalCostUsd null", () => {
  it("complete ausente não é true ⇒ nunca USD confiável", () => {
    // O campo `complete` não está no JSON — ausente ≠ true
    const noComplete = JSON.stringify({
      total_cost_usd: 5.0,
      unpriced_models: [],
      generated_at: "2026-06-10T12:00:00Z",
      tokens: { total: 1000, by_type: { input: 500, output: 200, cache_read: 200, cache_creation: 100 } },
    });
    const r = readObservedCostRollup(obsSpecDirWith(noComplete));
    expect(r.totalCostUsd).toBeNull();
    expect(r.partial).toBe(true);
    expect(r.source).toBe("cost_report");
  });
});

describe("readObservedCostRollup — staleness", () => {
  it("cost-report.json mais velho que costs/*.json ⇒ source não é 'cost_report' (fallback)", () => {
    // isStale lê generated_at do CONTEÚDO do cost-report.json (não do mtime do arquivo).
    // OBS_REPORT_OK tem generated_at "2026-06-10T18:00:00Z"; costs/session-bbb.json
    // é gravado agora (mtime atual) → mais novo → isStale=true → fallback.
    const d = obsSpecDirWith(OBS_REPORT_OK, {
      "session-bbb.json": JSON.stringify({
        session_id: "bbb",
        scope: "session",
        total_cost_usd: 0.5,
        by_model: {},
        unpriced_models: [],
      }),
    });
    const r = readObservedCostRollup(d);
    expect(r.source).not.toBe("cost_report");
  });

  it("cost-report.json mais novo que costs/*.json ⇒ source === 'cost_report'", () => {
    const d = obsSpecDirWith(OBS_REPORT_OK, {
      "session-bbb.json": JSON.stringify({
        session_id: "bbb",
        scope: "session",
        total_cost_usd: 0.5,
        by_model: {},
        unpriced_models: [],
      }),
    });
    // Deixa o costs/session-bbb.json com mtime muito no passado → cost-report
    // com generated_at "2026-06-10T18:00:00Z" fica mais novo → isStale=false
    const costPath = join(d, "costs", "session-bbb.json");
    const oldDate = new Date("2020-01-01T00:00:00Z");
    utimesSync(costPath, oldDate, oldDate);
    const r = readObservedCostRollup(d);
    expect(r.source).toBe("cost_report");
    expect(r.totalCostUsd).toBe(1.23);
  });
});

describe("readObservedCostRollup — tolerância a JSON vazio {}", () => {
  it("{} sem generated_at → não falha; report sem bloco tokens é esparso demais — cai pra soma crua", () => {
    // {} tem generated_at ausente → isStale retorna false (não dá pra julgar)
    // mas {} não tem bloco tokens → Fix 2: esparso demais → readRawCostRollup
    const r = readObservedCostRollup(obsSpecDirWith("{}"));
    expect(["partial", "empty"]).toContain(r.source);
    expect(r.totalCostUsd).toBeNull();
  });
});

describe("readObservedCostRollup — generated_at inválido", () => {
  it("generated_at 'not-a-date' → não lança; isStale retorna false → report confiado (source 'cost_report')", () => {
    // isStale: timestamp inválido → NaN → retorna false → confia no report
    const withBadDate = JSON.stringify({
      total_cost_usd: 2.0,
      complete: true,
      unpriced_models: [],
      generated_at: "not-a-date",
      tokens: { total: 1000, by_type: { input: 500, output: 200, cache_read: 200, cache_creation: 100 } },
    });
    const r = readObservedCostRollup(obsSpecDirWith(withBadDate));
    expect(r.source).toBe("cost_report");
    expect(r.totalCostUsd).toBe(2.0);
  });
});

describe("readObservedCostRollup — stale + report.html presente NUNCA retorna source='report'", () => {
  it("dir observado stale com report.html → source 'partial' ou 'empty' (jamais 'report'/'unreliable')", () => {
    // Cenário real: producer gravou report.html e cost-report.json no mesmo Stop hook,
    // depois chegou um novo costs/session-*.json → cost-report.json stale.
    // O fallback deve usar readRawCostRollup (soma crua), nunca readCostRollup
    // que poderia tomar o branch report.html e retornar totais stale como canônicos.
    const d = mkdtempSync(join(tmpdir(), "aios-obs-stale-html-"));
    dirs.push(d);
    // cost-report.json com generated_at no passado
    writeFileSync(
      join(d, "cost-report.json"),
      JSON.stringify({
        total_cost_usd: 9.99,
        complete: true,
        unpriced_models: [],
        generated_at: "2020-01-01T00:00:00Z",
        tokens: { total: 999, by_type: { input: 500, output: 199, cache_read: 200, cache_creation: 100 } },
      }),
    );
    // report.html mínimo presente (existência é suficiente para disparar o branch errado se houvesse)
    writeFileSync(join(d, "report.html"), "<html><body>stub</body></html>");
    // costs/session-new.json gravado agora → mtime atual → isStale=true
    const costsDir = join(d, "costs");
    mkdirSync(costsDir);
    writeFileSync(
      join(costsDir, "session-new.json"),
      JSON.stringify({ total_cost_usd: 0.5, by_model: {}, unpriced_models: [] }),
    );
    const r = readObservedCostRollup(d);
    // Prova que o fallback bypassa o parser do report.html
    expect(r.source).not.toBe("report");
    expect(r.source).not.toBe("unreliable");
    expect(["partial", "empty"]).toContain(r.source);
  });
});
