import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readCostRollup } from "./cost.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../../test/fixtures/report");

const dirs: string[] = [];
function specDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-cost-"));
  dirs.push(d);
  return d;
}
function writeHtml(dir: string, content: string) {
  writeFileSync(join(dir, "report.html"), content);
}
function writeRaw(dir: string, name: string, obj: unknown) {
  const costs = join(dir, "costs");
  mkdirSync(costs, { recursive: true });
  writeFileSync(join(costs, name), JSON.stringify(obj));
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-005: estado vazio — sem report.html nem costs/*.json
// ---------------------------------------------------------------------------
describe("AC-005 — empty: sem report.html nem costs/", () => {
  it("source = 'empty', totalCostUsd = null", () => {
    const r = readCostRollup(specDir());
    expect(r.source).toBe("empty");
    expect(r.totalCostUsd).toBeNull();
    expect(r.byPhase).toBeNull();
    expect(r.reportPath).toBeNull();
  });

  it("totalTokens = 0 (nunca null) no estado vazio", () => {
    expect(readCostRollup(specDir()).totalTokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-003: estado partial — sem report.html, com costs/*.json
// ---------------------------------------------------------------------------
describe("AC-003 — partial: sem report.html, com costs/*.json", () => {
  it("source = 'partial' com totalCostUsd e totalTokens da soma crua", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 0.4,
      by_model: { m: { input_tokens: 10, output_tokens: 5 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("partial");
    expect(r.totalCostUsd).toBe(0.4);
    expect(r.totalTokens).toBe(15);
    expect(r.byPhase).toBeNull();
    expect(r.reportPath).toBeNull();
  });

  it("partial=true quando costs/*.json tem unpriced_models", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 0.4,
      unpriced_models: ["some-model"],
      by_model: {},
    });
    expect(readCostRollup(d).partial).toBe(true);
  });

  it("soma múltiplos arquivos de costs/", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 1.0,
      by_model: { m: { input_tokens: 100 } },
    });
    writeRaw(d, "agent-2.json", {
      total_cost_usd: 2.0,
      by_model: { m: { output_tokens: 200 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("partial");
    expect(r.totalCostUsd).toBe(3.0);
    expect(r.totalTokens).toBe(300);
  });

  it("costs/ com JSON corrompido: ignora o arquivo e continua", () => {
    const d = specDir();
    const costsDir = join(d, "costs");
    mkdirSync(costsDir, { recursive: true });
    writeFileSync(join(costsDir, "agent-bad.json"), "NOT JSON {{{");
    writeRaw(d, "agent-good.json", {
      total_cost_usd: 5.0,
      by_model: { m: { input_tokens: 50 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("partial");
    expect(r.totalCostUsd).toBe(5.0);
  });
});

// ---------------------------------------------------------------------------
// AC-001 / AC-002: estado report — report.html parseável tem prioridade máxima
// ---------------------------------------------------------------------------
describe("AC-001 / AC-002 — report: report.html parseável é a fonte canônica", () => {
  const VALID_REPORT_HTML = `<!DOCTYPE html><html><body>
<div class='kpi'><div class='lbl'>Cost · $179.23 · 229.5M tokens</div>
<div class='legend'>&#x1F535; planning $7.92 · &#x1F537; orchestration $142.06 · &#x1F7E2; implementation $29.25</div></div>
<table class='toktab'>
<tr><th></th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache creation</th><th>Total</th></tr>
<tr><th>Planning</th><td>1M <span class='tc'>($1.00)</span></td><td>2M <span class='tc'>($2.00)</span></td><td>3M <span class='tc'>($3.00)</span></td><td>1.5M <span class='tc'>($1.50)</span></td><td>7.5M <span class='tc'>($7.50)</span></td></tr>
<tr><th>Orchestration</th><td>50M <span class='tc'>($50.00)</span></td><td>80M <span class='tc'>($80.00)</span></td><td>40M <span class='tc'>($40.00)</span></td><td>14.2M <span class='tc'>($14.00)</span></td><td>184.2M <span class='tc'>($184.00)</span></td></tr>
<tr><th>Implementation</th><td>10M <span class='tc'>($10.00)</span></td><td>15M <span class='tc'>($15.00)</span></td><td>8M <span class='tc'>($8.00)</span></td><td>4.8M <span class='tc'>($4.80)</span></td><td>37.8M <span class='tc'>($37.80)</span></td></tr>
</table>
</body></html>`;

  it("source = 'report', totalCostUsd vem do report.html", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    const r = readCostRollup(d);
    expect(r.source).toBe("report");
    expect(r.totalCostUsd).toBe(179.23);
  });

  it("totalTokens vem do report.html (229.5M = 229_500_000)", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    expect(readCostRollup(d).totalTokens).toBe(229_500_000);
  });

  it("byPhase preenchido com dollars de cada fase", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    const r = readCostRollup(d);
    expect(r.byPhase).toEqual({ planning: 7.92, orchestration: 142.06, implementation: 29.25 });
  });

  it("reportPath aponta para report.html", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    expect(readCostRollup(d).reportPath).toBe(join(d, "report.html"));
  });

  it("AC-002: cost-report.json presente é ignorado quando report.html é parseável", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    writeFileSync(join(d, "cost-report.json"), JSON.stringify({
      total_cost_usd: 6.55,
      planning_cost_usd: 1,
      orchestration_cost_usd: 0,
      implementation_cost_usd: 5.55,
      complete: true,
    }));
    const r = readCostRollup(d);
    expect(r.source).toBe("report");
    expect(r.totalCostUsd).toBe(179.23);
  });

  it("AC-002: costs/*.json presente é ignorado para custo quando report.html é parseável", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    writeRaw(d, "agent-1.json", { total_cost_usd: 999.0, by_model: {} });
    const r = readCostRollup(d);
    expect(r.source).toBe("report");
    expect(r.totalCostUsd).toBe(179.23);
  });

  it("partial = false quando report.html é parseável (pipeline concluída)", () => {
    const d = specDir();
    writeHtml(d, VALID_REPORT_HTML);
    expect(readCostRollup(d).partial).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-004: estado unreliable — report.html existe mas não é parseável
// ---------------------------------------------------------------------------
describe("AC-004 — unreliable: report.html existe mas não parseou", () => {
  it("source = 'unreliable' quando report.html é HTML sem dados de custo", () => {
    const d = specDir();
    writeHtml(d, "<html><body><p>sem custo aqui</p></body></html>");
    expect(readCostRollup(d).source).toBe("unreliable");
  });

  it("reportPath ainda aponta para report.html no estado unreliable", () => {
    const d = specDir();
    writeHtml(d, "<html></html>");
    expect(readCostRollup(d).reportPath).toBe(join(d, "report.html"));
  });

  it("cai na soma crua de costs/ quando report.html não parseou", () => {
    const d = specDir();
    writeHtml(d, "<html><body>sem custo</body></html>");
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 12.5,
      by_model: { m: { input_tokens: 200, output_tokens: 100 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("unreliable");
    expect(r.totalCostUsd).toBe(12.5);
    expect(r.totalTokens).toBe(300);
  });

  it("unreliable sem costs/: totalCostUsd = null", () => {
    const d = specDir();
    writeHtml(d, "<html><body>sem custo</body></html>");
    const r = readCostRollup(d);
    expect(r.source).toBe("unreliable");
    expect(r.totalCostUsd).toBeNull();
  });

  it("byPhase = null no estado unreliable (nunca inventa número)", () => {
    const d = specDir();
    writeHtml(d, "<html><body>sem custo</body></html>");
    expect(readCostRollup(d).byPhase).toBeNull();
  });

  it("HTML truncado resulta em unreliable, não lança exceção (AC-006 / NFR-001)", () => {
    const d = specDir();
    const truncated = "<!DOCTYPE html><html><body><div class='kpi'><div class='lbl'>Cost · $179.23 ·";
    writeHtml(d, truncated);
    expect(() => readCostRollup(d)).not.toThrow();
    expect(readCostRollup(d).source).toBe("unreliable");
  });
});

// ---------------------------------------------------------------------------
// AC-001 / NFR-002: fixture real do FEAT-001 ($179.23 / 229.5M)
// ---------------------------------------------------------------------------
describe("NFR-002 — fixture real FEAT-001", () => {
  it("totalCostUsd = 179.23 da fixture feat001-report.html", () => {
    const html = readFileSync(join(FIXTURE_DIR, "feat001-report.html"), "utf-8");
    const d = specDir();
    writeHtml(d, html);
    const r = readCostRollup(d);
    expect(r.source).toBe("report");
    expect(r.totalCostUsd).toBe(179.23);
  });

  it("totalTokens = 229_500_000 da fixture feat001-report.html", () => {
    const html = readFileSync(join(FIXTURE_DIR, "feat001-report.html"), "utf-8");
    const d = specDir();
    writeHtml(d, html);
    expect(readCostRollup(d).totalTokens).toBe(229_500_000);
  });

  it("byPhase: planning=$7.92, orchestration=$142.06, implementation=$29.25", () => {
    const html = readFileSync(join(FIXTURE_DIR, "feat001-report.html"), "utf-8");
    const d = specDir();
    writeHtml(d, html);
    const r = readCostRollup(d);
    expect(r.byPhase).toEqual({ planning: 7.92, orchestration: 142.06, implementation: 29.25 });
  });
});
