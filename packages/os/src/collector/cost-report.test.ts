import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, statSync } from "node:fs";
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
    // Monta dir com cost-report.json completo + costs/session-bbb.json mais novo
    const d = obsSpecDirWith(OBS_REPORT_OK, {
      "session-bbb.json": JSON.stringify({
        session_id: "bbb",
        scope: "session",
        total_cost_usd: 0.5,
        by_model: {},
        unpriced_models: [],
      }),
    });
    // Deixa o cost-report.json com mtime bem no passado
    const reportPath = join(d, "cost-report.json");
    const oldDate = new Date("2020-01-01T00:00:00Z");
    utimesSync(reportPath, oldDate, oldDate);
    // costs/session-bbb.json tem mtime atual → cost-report.json é stale
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
    // Deixa o costs/session-bbb.json com mtime no passado; cost-report.json fica com mtime atual
    const costPath = join(d, "costs", "session-bbb.json");
    const oldDate = new Date("2020-01-01T00:00:00Z");
    utimesSync(costPath, oldDate, oldDate);
    const r = readObservedCostRollup(d);
    expect(r.source).toBe("cost_report");
    expect(r.totalCostUsd).toBe(1.23);
  });
});

describe("readObservedCostRollup — tolerância a JSON vazio {}", () => {
  it("{} sem generated_at → não falha; source 'cost_report', usd null, partial true", () => {
    // {} tem generated_at ausente → isStale retorna false (não dá pra julgar → confia no report)
    // mas complete ausente (não é true) → totalCostUsd null, partial true
    const r = readObservedCostRollup(obsSpecDirWith("{}"));
    expect(() => r).not.toThrow();
    expect(r.source).toBe("cost_report");
    expect(r.totalCostUsd).toBeNull();
    expect(r.partial).toBe(true);
  });
});
