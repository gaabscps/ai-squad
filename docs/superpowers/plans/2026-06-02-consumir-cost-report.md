# Consumir cost-report.json como fonte de verdade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O aios passa a ler `<projeto>/.agent-session/<spec>/cost-report.json` como fonte de verdade de custo quando presente, caindo na soma crua dos `costs/*.json` (rotulada "preliminar") quando ausente.

**Architecture:** Um módulo parser novo (`cost-report.ts`) materializa o `cost-report.json` esparso num objeto tipado tolerante (todo campo opcional) ou `null`. O coordenador (`cost.ts`) é o juiz: se o parser devolve objeto → fonte `authoritative`; senão → soma crua (`preliminary`/`empty`). O tipo `CostRollup` é expandido de forma aditiva em um único lugar (`store/types.ts`) e propaga ao front, que importa o tipo direto do backend.

**Tech Stack:** Node + TypeScript, Vitest (runner), Vite + React + Testing Library (front). Fixtures de disco via `mkdtempSync(tmpdir())` + `writeFileSync`, limpas em `afterEach`.

**Spec de referência:** [docs/superpowers/specs/2026-06-02-consumir-cost-report-design.md](../specs/2026-06-02-consumir-cost-report-design.md)

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/store/types.ts` | Tipo `CostRollup` (único, consumido por backend + front) | Modificar (aditivo) |
| `src/collector/cost-report.ts` | Parser tolerante do `cost-report.json` → objeto tipado \| null | Criar |
| `src/collector/cost-report.test.ts` | Testes do parser (válido/mínimo/inválido/ausente/suspect) | Criar |
| `src/collector/cost.ts` | Coordenador: escolhe authoritative vs preliminary; helper `sumRawCosts` | Modificar |
| `src/collector/cost.test.ts` | Testes do coordenador (escolha de fonte + fallback de tokens) | Criar |
| `src/collector/watcher.ts` | +1 glob `cost-report.json` | Modificar |
| `src/collector/watcher.test.ts` | Asserção do glob novo | Modificar |
| `web/src/test-utils.tsx` | `makeCost` ganha defaults dos campos novos | Modificar |
| `web/src/components/DetailDrawer.tsx` | Breakdown por fase + badge "preliminar" | Modificar |
| `web/src/components/DetailDrawer.test.tsx` | Testes do breakdown + badges + "—" | Modificar |
| `web/src/components/KanbanCard.tsx` | Marcador "preliminar" | Modificar |
| `web/src/components/SpecTable.tsx` | Marcador "preliminar" | Modificar |
| `web/src/app.css` | Estilos do badge "preliminar" e da lista por fase | Modificar |

---

## Task 1: Expandir o tipo `CostRollup` (aditivo)

**Files:**
- Modify: `src/store/types.ts:38-50`

Este é o contrato. Fazer primeiro porque todo o resto referencia esses campos. Não há teste próprio — é tipo puro; o `tsc`/vitest dos próximos tasks o exercita.

- [ ] **Step 1: Adicionar os tipos novos e expandir a interface**

Substituir o bloco atual `// Custo: ...` + `export interface CostRollup {...}` (linhas 38-50) por:

```ts
// Custo: SEMPRE somado dos total_cost_usd já gravados; nunca recalculado.
// Quando existe cost-report.json (artefato canônico/escopado da pipeline), ele é a
// fonte de verdade (source="authoritative"); senão soma crua (source="preliminary").
export type CostSource = "empty" | "preliminary" | "authoritative";

export interface CostPhaseBreakdown {
  planning: number | null;
  orchestration: number | null;
  implementation: number | null; // null quando scopingSuspect=true (valor não confiável)
}

export interface CostRollup {
  totalCostUsd: number | null; // soma dos total_cost_usd; null se sem dados
  partial: boolean; // true se algum arquivo tinha unpriced_models não-vazio
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  totalTokens: number;
  reportPath: string | null; // caminho do report.html, se existir
  // --- novos (aditivos): preenchidos a partir do cost-report.json quando presente ---
  source: CostSource;
  scopingSuspect: boolean; // ausente no arquivo ⇒ false
  excludedSubagents: number | null;
  recoveredSubagents: number | null;
  byPhase: CostPhaseBreakdown | null; // só quando source="authoritative"
  complete: boolean | null; // campo `complete` do cost-report; null em preliminary/empty
}
```

- [ ] **Step 2: Verificar que o tipo compila (vai quebrar consumidores — esperado)**

Run: `npx tsc --noEmit`
Expected: erros APENAS em pontos que constroem `CostRollup` sem os campos novos — `src/collector/cost.ts` (`emptyRollup`/`readCostRollup`) e `web/src/test-utils.tsx` (`makeCost`). Esses são corrigidos nas Tasks 4 e 8. Nenhum outro erro.

- [ ] **Step 3: Commit**

```bash
git add src/store/types.ts
git commit -m "feat(cost): expande CostRollup com source/byPhase/scopingSuspect (aditivo)"
```

---

## Task 2: Parser `cost-report.ts` — caminho feliz (arquivo completo)

**Files:**
- Create: `src/collector/cost-report.ts`
- Test: `src/collector/cost-report.test.ts`

O parser lê o arquivo, valida o mínimo (`total_cost_usd` numérico) e normaliza campos esparsos. Retorna `null` quando ausente/inválido. Nesta task cobrimos o arquivo válido completo; Task 3 adiciona os casos de borda.

- [ ] **Step 1: Escrever o teste que falha (arquivo válido completo)**

Criar `src/collector/cost-report.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCostReport } from "./cost-report.js";

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/collector/cost-report.test.ts`
Expected: FAIL — `Cannot find module './cost-report.js'` (arquivo ainda não existe).

- [ ] **Step 3: Criar `src/collector/cost-report.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Objeto já normalizado a partir do cost-report.json (artefato canônico/escopado
 * da pipeline SDD). Campos opcionais do arquivo viram null/defaults aqui — o
 * arquivo real é esparso (alguns sem bloco `tokens`, sem `scoping_suspect`).
 * `tokens` é null quando o arquivo não traz bloco de tokens — o coordenador
 * (cost.ts) resolve esse caso caindo na soma crua dos costs/*.json.
 */
export interface CostReport {
  totalCostUsd: number;
  byPhase: { planning: number | null; orchestration: number | null; implementation: number | null };
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number } | null;
  totalTokens: number | null;
  partial: boolean;
  scopingSuspect: boolean;
  excludedSubagents: number | null;
  recoveredSubagents: number | null;
  complete: boolean | null;
}

interface RawCostReport {
  planning_cost_usd?: number;
  orchestration_cost_usd?: number;
  implementation_cost_usd?: number;
  total_cost_usd?: number;
  excluded_subagents?: number;
  recovered_subagents?: number;
  scoping_suspect?: boolean;
  unpriced_models?: string[];
  complete?: boolean;
  tokens?: {
    by_type?: { input?: number; output?: number; cache_read?: number; cache_creation?: number };
    total?: number;
  };
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Lê e normaliza o cost-report.json de uma Session. Retorna null quando o arquivo
 * está ausente, é JSON inválido, ou não tem total_cost_usd numérico — nesses casos
 * o coordenador cai na soma crua. NUNCA aplica pricing; só lê números já gravados.
 */
export function readCostReport(specDir: string): CostReport | null {
  const path = join(specDir, "cost-report.json");
  if (!existsSync(path)) return null;

  let raw: RawCostReport;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null; // arquivo corrompido: cai na soma crua, não inventa número
  }
  if (typeof raw.total_cost_usd !== "number") return null;

  const scopingSuspect = raw.scoping_suspect ?? false;

  const tk = raw.tokens?.by_type;
  const tokens = tk
    ? {
        input: tk.input ?? 0,
        output: tk.output ?? 0,
        cacheRead: tk.cache_read ?? 0,
        cacheCreation: tk.cache_creation ?? 0,
      }
    : null;

  return {
    totalCostUsd: raw.total_cost_usd,
    byPhase: {
      planning: num(raw.planning_cost_usd),
      orchestration: num(raw.orchestration_cost_usd),
      // implementation não confiável quando scoping_suspect: vira null (UI mostra "—")
      implementation: scopingSuspect ? null : num(raw.implementation_cost_usd),
    },
    tokens,
    totalTokens: tokens ? num(raw.tokens?.total) ?? 0 : null,
    partial: Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0,
    scopingSuspect,
    excludedSubagents: num(raw.excluded_subagents),
    recoveredSubagents: num(raw.recovered_subagents),
    complete: typeof raw.complete === "boolean" ? raw.complete : null,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/collector/cost-report.test.ts`
Expected: PASS (1 teste).

- [ ] **Step 5: Commit**

```bash
git add src/collector/cost-report.ts src/collector/cost-report.test.ts
git commit -m "feat(cost): parser cost-report.json (caminho feliz)"
```

---

## Task 3: Parser — casos de borda (mínimo / inválido / ausente / suspect)

**Files:**
- Modify: `src/collector/cost-report.test.ts`

Cobrir os shapes reais que vi no disco: FEAT-010 (sem bloco `tokens`), JSON inválido, arquivo ausente, e `scoping_suspect=true`.

- [ ] **Step 1: Adicionar os testes de borda**

Acrescentar dentro do arquivo de teste, após o `describe` existente:

```ts
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
});
```

- [ ] **Step 2: Rodar e ver passar (implementação da Task 2 já cobre)**

Run: `npx vitest run src/collector/cost-report.test.ts`
Expected: PASS (todos os testes, ~6). Se algum falhar, corrigir `cost-report.ts` — não o teste.

- [ ] **Step 3: Commit**

```bash
git add src/collector/cost-report.test.ts
git commit -m "test(cost): casos de borda do parser cost-report"
```

---

## Task 4: Coordenador `cost.ts` — extrair `sumRawCosts` e arbitrar fonte

**Files:**
- Modify: `src/collector/cost.ts` (arquivo inteiro)
- Test: `src/collector/cost.test.ts`

Refatorar a soma crua atual num helper reusável e fazer `readCostRollup` escolher entre authoritative (parser) e preliminary/empty (soma crua). Inclui o fallback de tokens da decisão D2.

- [ ] **Step 1: Escrever os testes do coordenador (falham)**

Criar `src/collector/cost.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCostRollup } from "./cost.js";

const dirs: string[] = [];
function specDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-cost-"));
  dirs.push(d);
  return d;
}
function writeReport(dir: string, obj: unknown) {
  writeFileSync(join(dir, "cost-report.json"), JSON.stringify(obj));
}
function writeRaw(dir: string, name: string, obj: unknown) {
  const costs = join(dir, "costs");
  mkdirSync(costs, { recursive: true });
  writeFileSync(join(costs, name), JSON.stringify(obj));
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readCostRollup — escolha de fonte", () => {
  it("sem nada ⇒ source 'empty'", () => {
    const r = readCostRollup(specDir());
    expect(r.source).toBe("empty");
    expect(r.totalCostUsd).toBeNull();
  });

  it("só costs/*.json ⇒ source 'preliminary' com soma crua", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 0.4,
      by_model: { m: { input_tokens: 10, output_tokens: 5 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("preliminary");
    expect(r.totalCostUsd).toBe(0.4);
    expect(r.totalTokens).toBe(15);
    expect(r.byPhase).toBeNull();
  });

  it("cost-report.json presente ⇒ source 'authoritative' e custo/fases do report", () => {
    const d = specDir();
    writeReport(d, {
      planning_cost_usd: 5,
      orchestration_cost_usd: 1,
      implementation_cost_usd: 2,
      total_cost_usd: 8,
      unpriced_models: [],
      tokens: { by_type: { input: 1, output: 2, cache_read: 3, cache_creation: 4 }, total: 10 },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalCostUsd).toBe(8);
    expect(r.byPhase).toEqual({ planning: 5, orchestration: 1, implementation: 2 });
    expect(r.totalTokens).toBe(10);
  });

  it("authoritative sem bloco tokens ⇒ tokens caem na soma crua (D2)", () => {
    const d = specDir();
    writeReport(d, { total_cost_usd: 8, unpriced_models: [], complete: true });
    writeRaw(d, "agent-1.json", { by_model: { m: { input_tokens: 7, output_tokens: 3 } } });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalCostUsd).toBe(8);
    expect(r.totalTokens).toBe(10); // veio do costs/*.json, não do report
  });

  it("authoritative com by_type mas SEM total ⇒ tokens caem na soma crua (I1)", () => {
    const d = specDir();
    writeReport(d, {
      total_cost_usd: 8,
      unpriced_models: [],
      tokens: { by_type: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } }, // sem `total`
    });
    writeRaw(d, "agent-1.json", { by_model: { m: { input_tokens: 7, output_tokens: 3 } } });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalTokens).toBe(10); // total ausente no report ⇒ soma crua, breakdown coerente
    expect(r.tokens).toEqual({ input: 7, output: 3, cacheRead: 0, cacheCreation: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/collector/cost.test.ts`
Expected: FAIL — `source` é `undefined` / `byPhase` inexistente (coordenador ainda não preenche os campos novos).

- [ ] **Step 3: Reescrever `src/collector/cost.ts`**

Substituir o arquivo inteiro por:

```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup } from "../store/types.js";
import { readCostReport } from "./cost-report.js";

interface RawModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface RawCostFile {
  total_cost_usd?: number;
  by_model?: Record<string, RawModelUsage>;
  unpriced_models?: string[];
}

interface RawSum {
  totalCostUsd: number | null;
  partial: boolean;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalTokens: number;
  hasData: boolean;
}

/**
 * Soma crua dos costs/*.json — o plano B quando não há cost-report.json (ou
 * quando ele não traz bloco de tokens). NUNCA aplica pricing; só soma números já
 * gravados. Read-only.
 */
function sumRawCosts(costsDir: string): RawSum {
  const empty: RawSum = {
    totalCostUsd: null,
    partial: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    totalTokens: 0,
    hasData: false,
  };
  if (!existsSync(costsDir)) return empty;
  const files = readdirSync(costsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return empty;

  let totalCostUsd: number | null = null;
  let partial = false;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const f of files) {
    let raw: RawCostFile;
    try {
      raw = JSON.parse(readFileSync(join(costsDir, f), "utf-8"));
    } catch {
      continue; // arquivo corrompido: ignora, não inventa número
    }
    if (typeof raw.total_cost_usd === "number") totalCostUsd = (totalCostUsd ?? 0) + raw.total_cost_usd;
    if (Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0) partial = true;
    for (const usage of Object.values(raw.by_model ?? {})) {
      tokens.input += usage.input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
      tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
  }

  const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { totalCostUsd, partial, tokens, totalTokens, hasData: true };
}

/**
 * Custo de uma Session. Se existe cost-report.json válido (artefato canônico/
 * escopado da pipeline), ele é a fonte de verdade (source="authoritative"); senão
 * cai na soma crua dos costs/*.json (source="preliminary") ou vazio. Read-only.
 */
export function readCostRollup(specDir: string): CostRollup {
  const reportPath = existsSync(join(specDir, "report.html"))
    ? join(specDir, "report.html")
    : null;

  const report = readCostReport(specDir);

  if (report) {
    // Usa tokens do report só quando há breakdown E total (caso canônico); se
    // qualquer um faltar, cai TODO na soma crua, pra breakdown e total virem da
    // mesma fonte (D2 + I1). report.tokens null = sem bloco; totalTokens null =
    // bloco presente mas sem `total`.
    const reportHasTokens = report.tokens !== null && report.totalTokens !== null;
    const raw = reportHasTokens ? null : sumRawCosts(join(specDir, "costs"));
    const tokens = reportHasTokens ? report.tokens! : raw!.tokens;
    const totalTokens = reportHasTokens ? report.totalTokens! : raw!.totalTokens;
    return {
      totalCostUsd: report.totalCostUsd,
      partial: report.partial,
      tokens,
      totalTokens,
      reportPath,
      source: "authoritative",
      scopingSuspect: report.scopingSuspect,
      excludedSubagents: report.excludedSubagents,
      recoveredSubagents: report.recoveredSubagents,
      byPhase: report.byPhase,
      complete: report.complete,
    };
  }

  const raw = sumRawCosts(join(specDir, "costs"));
  return {
    totalCostUsd: raw.totalCostUsd,
    partial: raw.partial,
    tokens: raw.tokens,
    totalTokens: raw.totalTokens,
    reportPath,
    source: raw.hasData ? "preliminary" : "empty",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
  };
}
```

- [ ] **Step 4: Rodar os testes do coordenador**

Run: `npx vitest run src/collector/cost.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Garantir que o tipo fecha em todo o backend**

Run: `npx tsc --noEmit`
Expected: nenhum erro em `src/` (o erro restante, se houver, é só em `web/src/test-utils.tsx` — corrigido na Task 8).

- [ ] **Step 6: Commit**

```bash
git add src/collector/cost.ts src/collector/cost.test.ts
git commit -m "feat(cost): coordenador arbitra cost-report (authoritative) vs soma crua"
```

---

## Task 5: Watcher — observar `cost-report.json`

**Files:**
- Modify: `src/collector/watcher.ts:38-43`
- Modify: `src/collector/watcher.test.ts`

- [ ] **Step 1: Adicionar a asserção do glob novo no teste**

Em `src/collector/watcher.test.ts`, após o `it(...)` existente ("inclui o glob outputs/*.json..."), adicionar dentro do mesmo `describe`:

```ts
  it("inclui o glob cost-report.json para cada root informado", async () => {
    const { watchProjects } = await import("./watcher.js");
    const handle = watchProjects(["/proj/a", "/proj/b"], vi.fn());
    await handle.close();

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const costReportPatterns = patterns.filter((p) =>
      p.replace(/\\/g, "/").includes("cost-report.json"),
    );
    expect(costReportPatterns.length).toBeGreaterThanOrEqual(2);

    for (const root of ["/proj/a", "/proj/b"]) {
      const normalizedRoot = root.replace(/\\/g, "/");
      const has = costReportPatterns.some((p) => {
        const norm = p.replace(/\\/g, "/");
        return norm.startsWith(normalizedRoot) && norm.includes(".agent-session");
      });
      expect(has).toBe(true);
    }
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/collector/watcher.test.ts`
Expected: FAIL — `costReportPatterns.length` é 0 (glob ainda não existe).

- [ ] **Step 3: Adicionar o glob em `watcher.ts`**

No array de `patterns` (linhas 38-43), adicionar a entrada após a linha de `outputs`:

```ts
  const patterns = roots.flatMap((r) => [
    join(r, "*", ".agent-session", "**", "session.yml"),
    join(r, "*", ".agent-session", "**", "costs", "*.json"),
    join(r, "*", ".agent-session", "**", "*manifest*.json"),
    join(r, "*", ".agent-session", "**", "outputs", "*.json"),
    join(r, "*", ".agent-session", "**", "cost-report.json"),
  ]);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/collector/watcher.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/collector/watcher.ts src/collector/watcher.test.ts
git commit -m "feat(cost): watcher observa cost-report.json"
```

---

## Task 6: `makeCost` no test-utils — defaults dos campos novos

**Files:**
- Modify: `web/src/test-utils.tsx:21-30` (função `makeCost`)

O front importa `CostRollup` do backend; `makeCost` precisa devolver os campos novos ou os testes web não compilam. Fazer antes de mexer nos componentes.

- [ ] **Step 1: Atualizar `makeCost`**

Substituir a função `makeCost` por:

```tsx
export function makeCost(over: Partial<CostRollup> = {}): CostRollup {
  return {
    totalCostUsd: 0.5,
    partial: false,
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 },
    totalTokens: 1350,
    reportPath: null,
    source: "preliminary",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
    ...over,
  };
}
```

- [ ] **Step 2: Verificar typecheck do front**

Run: `cd web && npx tsc --noEmit && cd ..`
Expected: nenhum erro relacionado a `CostRollup`/`makeCost`.

- [ ] **Step 3: Rodar a suíte web pra garantir que nada regrediu**

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx`
Expected: PASS (testes atuais seguem verdes; `source:"preliminary"` é default neutro).

- [ ] **Step 4: Commit**

```bash
git add web/src/test-utils.tsx
git commit -m "test(web): makeCost preenche campos novos de CostRollup"
```

---

## Task 7: DetailDrawer — breakdown por fase + badge "preliminar"

**Files:**
- Modify: `web/src/components/DetailDrawer.tsx:72-89`
- Modify: `web/src/components/DetailDrawer.test.tsx`

- [ ] **Step 1: Escrever os testes (falham)**

Em `web/src/components/DetailDrawer.test.tsx`, adicionar dentro do `describe("DetailDrawer", ...)`:

```ts
  it("authoritative: mostra breakdown por fase", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "authoritative",
        byPhase: { planning: 6.5, orchestration: 1, implementation: 2 },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("orchestration")).toBeInTheDocument();
    expect(screen.getByText("implementation")).toBeInTheDocument();
    expect(screen.getByText("US$ 6.50")).toBeInTheDocument();
  });

  it("scopingSuspect: implementation aparece como —", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "authoritative",
        scopingSuspect: true,
        byPhase: { planning: 6.5, orchestration: 1, implementation: null },
      }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const implRow = screen.getByText("implementation").closest("div")!;
    expect(implRow).toHaveTextContent("—");
  });

  it("preliminary: mostra badge 'preliminar' e nenhum breakdown por fase", () => {
    const spec = makeSpec({ cost: makeCost({ source: "preliminary", byPhase: null }) });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("preliminar")).toBeInTheDocument();
    expect(screen.queryByText("planning")).toBeNull();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx`
Expected: FAIL — não encontra "planning"/"preliminar" (UI ainda não renderiza).

- [ ] **Step 3: Atualizar o bloco de custo do DetailDrawer**

Substituir o bloco `<div className="drawer-cost">...</div>` (linhas 73-89) por (acrescenta o badge "preliminar" antes do link do report):

```tsx
        <div className="drawer-cost">
          <span className="drawer-cost-usd">{fmtUsd(spec.cost.totalCostUsd)}</span>
          <span className="mono drawer-cost-tok">
            {fmtTokens(spec.cost.totalTokens)} tokens
          </span>
          {spec.cost.partial && <span className="cost-partial">$ parcial</span>}
          {spec.cost.source === "preliminary" && (
            <span className="cost-preliminary" title="soma crua dos costs/*.json — cost-report.json ainda não publicado">
              preliminar
            </span>
          )}
          {spec.cost.reportPath && (
            <a
              className="drawer-cost-report"
              href={`/file?path=${encodeURIComponent(spec.cost.reportPath)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              report.html →
            </a>
          )}
        </div>
```

- [ ] **Step 4: Adicionar a lista por fase após o `<dl className="drawer-cost-breakdown ...">` de tokens**

Logo após o fechamento `</dl>` do breakdown de tokens (linha 107), inserir:

```tsx
        {spec.cost.source === "authoritative" && spec.cost.byPhase && (
          <dl className="drawer-cost-phases mono">
            <div>
              <dt>planning</dt>
              <dd>{fmtUsd(spec.cost.byPhase.planning)}</dd>
            </div>
            <div>
              <dt>orchestration</dt>
              <dd>{fmtUsd(spec.cost.byPhase.orchestration)}</dd>
            </div>
            <div>
              <dt>implementation</dt>
              <dd>{fmtUsd(spec.cost.byPhase.implementation)}</dd>
            </div>
          </dl>
        )}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx`
Expected: PASS (todos — antigos + 3 novos). `fmtUsd(null)` já produz "—" pro implementation suspeito.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DetailDrawer.tsx web/src/components/DetailDrawer.test.tsx
git commit -m "feat(web): drawer mostra custo por fase (authoritative) e badge preliminar"
```

---

## Task 8: KanbanCard + SpecTable — marcador "preliminar"

**Files:**
- Modify: `web/src/components/KanbanCard.tsx:39-42`
- Modify: `web/src/components/SpecTable.tsx:90-92`

Marcador discreto no agregado (sem breakdown — só o drawer tem). Sem teste novo dedicado: é um `&&` condicional de texto; a cobertura do `source` já vive no DetailDrawer. Validação por typecheck + render manual na Task 10.

- [ ] **Step 1: KanbanCard — adicionar o marcador**

Substituir o `<span className="kcard-cost">...</span>` (linhas 40-42) por:

```tsx
        <span className="kcard-cost">
          {fmtTokens(spec.cost.totalTokens)} tok · {fmtUsd(spec.cost.totalCostUsd)}
          {spec.cost.source === "preliminary" && <span className="cost-preliminary"> · prelim.</span>}
        </span>
```

- [ ] **Step 2: SpecTable — adicionar o marcador**

Substituir o conteúdo da `<td className="mono">` de custo (linhas 90-92) por:

```tsx
            <td className="mono">
              {fmtUsd(it.spec.cost.totalCostUsd)} · {fmtTokens(it.spec.cost.totalTokens)}
              {it.spec.cost.source === "preliminary" && (
                <span className="cost-preliminary"> · prelim.</span>
              )}
            </td>
```

- [ ] **Step 3: Verificar typecheck e suíte web**

Run: `cd web && npx tsc --noEmit && cd .. && npx vitest run web/`
Expected: PASS (nada regrediu).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/KanbanCard.tsx web/src/components/SpecTable.tsx
git commit -m "feat(web): marcador 'preliminar' no card e na tabela"
```

---

## Task 9: Estilos do badge e da lista por fase

**Files:**
- Modify: `web/src/app.css:157-162`

- [ ] **Step 1: Adicionar as regras CSS**

Após a linha `.drawer-cost-breakdown dd {...}` (linha 162), acrescentar:

```css
.cost-preliminary { color: var(--text-mute); font-weight: 600; font-size: 12px; }
.drawer-cost-phases { display: grid; grid-template-columns: 1fr; gap: 6px; margin: 10px 0 0; font-size: 12px; color: var(--text-dim); }
.drawer-cost-phases div { display: flex; }
.drawer-cost-phases dt { margin: 0; }
.drawer-cost-phases dd { margin: 0 0 0 auto; color: #374151; font-weight: 600; }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app.css
git commit -m "style(web): badge preliminar e lista de custo por fase"
```

---

## Task 10: Verificação ponta-a-ponta

**Files:** nenhum (validação).

- [ ] **Step 1: Suíte completa verde**

Run: `npx vitest run`
Expected: PASS — toda a suíte (backend + web), sem testes pulados.

- [ ] **Step 2: Typecheck dos dois lados**

Run: `npx tsc --noEmit && cd web && npx tsc --noEmit && cd ..`
Expected: zero erros.

- [ ] **Step 3: Conferir no app real (dados de disco já existem)**

Há `cost-report.json` reais em `~/Developer/ai-squad-os/.agent-session/FEAT-001` (com tokens) e em projetos como soundwave/jarvis (shape mínimo). Subir o app e abrir o drawer de uma spec com cost-report deve mostrar custo por fase; uma sem deve mostrar badge "preliminar".

Run: subir o cockpit (ver `package.json` script de dev/serve) e abrir o board.
Expected:
- Spec com `cost-report.json` completo (ex.: FEAT-001 aios) → drawer mostra planning/orchestration/implementation; sem badge "preliminar".
- Spec só com `costs/*.json` → agregado + "prelim." no card/tabela e badge "preliminar" no drawer.
- Nenhum erro no console.

- [ ] **Step 4: Commit final (se houver ajuste do passo 3)**

```bash
git add -A
git commit -m "test(cost): verificação ponta-a-ponta do consumo de cost-report"
```

---

## Self-review (cobertura do spec)

| Requisito do spec | Task |
|---|---|
| D1 — breakdown por fase no drawer | Task 7 |
| D2 — tokens do report c/ fallback à soma crua | Task 4 (teste "authoritative sem bloco tokens") |
| D3 — parser separado + coordenador | Tasks 2/3 (parser), 4 (coordenador) |
| D4 — headline mantém total; só implementation vira "—" | Task 7 (teste scopingSuspect) |
| Tipo aditivo em 1 lugar | Task 1 |
| Watcher +1 glob | Task 5 |
| Badges preliminar (drawer/card/tabela) | Tasks 7, 8 |
| Fixtures válido/mínimo/inválido/ausente/suspect | Tasks 2, 3 |
| Backward-compatible (sem arquivo = comportamento atual) | Task 4 (teste "empty"/"preliminary") |
| `makeCost` sincronizado | Task 6 |

Sem placeholders. Tipos consistentes entre tasks: `readCostReport`/`CostReport` (Task 2) usados na Task 4; `CostRollup` campos (Task 1) usados em 4/6/7/8.
