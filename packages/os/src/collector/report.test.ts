import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "./report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "../../test/fixtures/report");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("parseReport — entradas inválidas", () => {
  it("retorna null para string vazia", () => {
    expect(parseReport("")).toBeNull();
  });

  it("retorna null para HTML sem seção de custo", () => {
    expect(parseReport("<html><body><p>sem custo</p></body></html>")).toBeNull();
  });

  it("retorna null para HTML com KPI mas sem valores de fase", () => {
    const html = "<div class='kpi'><div class='lbl'>Cost · $10.00 · 5M tokens</div></div>";
    expect(parseReport(html)).toBeNull();
  });

  it("retorna null para HTML com valores de fase mas sem total", () => {
    const html = "<div class='legend'>planning $7.92 · 🔷 orchestration $142.06 · 🟢 implementation $29.25</div>";
    expect(parseReport(html)).toBeNull();
  });

  it("retorna null para HTML truncado (abrupto)", () => {
    const full = loadFixture("feat001-report.html");
    expect(parseReport(full.slice(0, 200))).toBeNull();
  });

  it("nunca lança exceção — entradas arbitrárias", () => {
    const inputs = [
      null as unknown as string,
      undefined as unknown as string,
      "<<<",
      "\x00\x01\x02",
      "$Cost · $abc · XYZtokens",
      "Cost · $179.23 · 229.5M tokens\nplanning $INVALID",
    ];
    for (const input of inputs) {
      expect(() => parseReport(input)).not.toThrow();
    }
  });

  it("retorna null para valores monetários não-numéricos", () => {
    const html = `
      <div class='lbl'>Cost · $abc.de · 229.5M tokens</div>
      <div class='legend'>planning $7.92 · 🔷 orchestration $142.06 · 🟢 implementation $29.25</div>
    `;
    expect(parseReport(html)).toBeNull();
  });
});

describe("parseReport — fixture FEAT-001 (valores reais)", () => {
  let html: string;

  it("carrega a fixture sem erro", () => {
    html = loadFixture("feat001-report.html");
    expect(html.length).toBeGreaterThan(100);
  });

  it("extrai totalDollars = 179.23", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.totalDollars).toBe(179.23);
  });

  it("extrai totalTokens = 229.5M (229_500_000)", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(229_500_000);
  });

  it("extrai planning: $7.92", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.planning?.dollars).toBe(7.92);
  });

  it("extrai orchestration: $142.06", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.orchestration?.dollars).toBe(142.06);
  });

  it("extrai implementation: $29.25", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.implementation?.dollars).toBe(29.25);
  });

  it("extrai tokens de planning (7.5M = 7_500_000)", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.planning?.tokens).toBe(7_500_000);
  });

  it("extrai tokens de orchestration (184.2M = 184_200_000)", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.orchestration?.tokens).toBe(184_200_000);
  });

  it("extrai tokens de implementation (37.8M = 37_800_000)", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.implementation?.tokens).toBe(37_800_000);
  });

  it("retorna objeto completo com todos os campos (não-null)", () => {
    const html = loadFixture("feat001-report.html");
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.byPhase.planning).not.toBeNull();
    expect(result!.byPhase.orchestration).not.toBeNull();
    expect(result!.byPhase.implementation).not.toBeNull();
  });
});

describe("parseReport — tolerância a falhas (AC-006 / NFR-001)", () => {
  it("não lança para qualquer leitura parcial da fixture", () => {
    const html = loadFixture("feat001-report.html");
    for (let cut = 0; cut < html.length; cut += 500) {
      expect(() => parseReport(html.slice(0, cut))).not.toThrow();
    }
  });

  it("extrai corretamente tokens em K com tabela completa", () => {
    const html = `<!DOCTYPE html><html><body>
<div class='kpi'><div class='lbl'>Cost · $1.00 · 500K tokens</div>
<div class='legend'>&#x1F535; planning $0.50 · &#x1F537; orchestration $0.30 · &#x1F7E2; implementation $0.20</div></div>
<table class='toktab'>
<tr><th></th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache creation</th><th>Total</th></tr>
<tr><th>Planning</th><td>10K <span class='tc'>($0.05)</span></td><td>20K <span class='tc'>($0.10)</span></td><td>50K <span class='tc'>($0.15)</span></td><td>10K <span class='tc'>($0.05)</span></td><td>90K <span class='tc'>($0.35)</span></td></tr>
<tr><th>Orchestration</th><td>5K <span class='tc'>($0.02)</span></td><td>15K <span class='tc'>($0.08)</span></td><td>100K <span class='tc'>($0.10)</span></td><td>5K <span class='tc'>($0.03)</span></td><td>125K <span class='tc'>($0.23)</span></td></tr>
<tr><th>Implementation</th><td>50K <span class='tc'>($0.15)</span></td><td>100K <span class='tc'>($0.10)</span></td><td>100K <span class='tc'>($0.05)</span></td><td>35K <span class='tc'>($0.02)</span></td><td>285K <span class='tc'>($0.32)</span></td></tr>
</table>
</body></html>`;
    const result = parseReport(html);
    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(500_000);
    expect(result!.totalDollars).toBe(1.00);
    expect(result!.byPhase.planning?.dollars).toBe(0.50);
    expect(result!.byPhase.planning?.tokens).toBe(90_000);
    expect(result!.byPhase.orchestration?.tokens).toBe(125_000);
    expect(result!.byPhase.implementation?.tokens).toBe(285_000);
  });

  it("retorna null quando legend ok mas tabela de tokens ausente (AC-004)", () => {
    const html = `
      <div class='kpi'><div class='lbl'>Cost · $1.00 · 500K tokens</div>
      <div class='legend'>&#x1F535; planning $0.50 · &#x1F537; orchestration $0.30 · &#x1F7E2; implementation $0.20</div></div>
    `;
    expect(parseReport(html)).toBeNull();
  });

  it("retorna null quando tabela existe mas linhas de fase estão ausentes (AC-004)", () => {
    const html = `
      <div class='kpi'><div class='lbl'>Cost · $1.00 · 500K tokens</div>
      <div class='legend'>&#x1F535; planning $0.50 · &#x1F537; orchestration $0.30 · &#x1F7E2; implementation $0.20</div></div>
      <table class='toktab'>
      <tr><th></th><th>Total</th></tr>
      <tr class='ttl'><th>Total</th><td>500K <span class='tc'>($1.00)</span></td></tr>
      </table>
    `;
    expect(parseReport(html)).toBeNull();
  });
});
