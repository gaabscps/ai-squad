# Delivery-report no board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir, READ-ONLY, o delivery-report (parecer de entrega) de cada Session concluída no board do aiOS — veredicto em realce, 11 respostas com badge de confidence, tabela de ACs por classificação, link pro `.md`.

**Architecture:** Padrão "scan" (igual ao `cost`): um parser novo lê o `delivery-report.json` no momento do scan e anexa um objeto normalizado ao `Spec`, que já viaja no snapshot por WebSocket. O front lê `spec.deliveryReport` e renderiza um bloco no `DetailDrawer`. Normaliza `answers`⟺`questions`; enums canônicos em inglês com rótulos pt-BR só na apresentação.

**Tech Stack:** Node + TypeScript (backend), Vite + React (front), Vitest + @testing-library/react (testes).

> **Local do plano:** salvo em `docs/specs/` (convenção do projeto, junto do design), não no default `docs/superpowers/plans/` da skill.

---

## File Structure

**Backend**
- Create: `src/collector/delivery-report.ts` — parser `readDeliveryReport(specDir)`.
- Create: `src/collector/delivery-report.test.ts` — testa parser (answers, questions, ausência, malformado, enum desconhecido, colisão de ACs).
- Modify: `src/store/types.ts` — tipos `DeliveryReport` & cia + campo em `Spec`.
- Modify: `src/collector/session.ts` — fia `readDeliveryReport` em `parseSession`.
- Modify: `src/collector/session.test.ts` — testa que `parseSession` popula `deliveryReport`.

**Frontend**
- Create: `web/src/lib/deliveryLabels.ts` — mapas de rótulo/cor (pt-BR), chaveados pelo valor inglês.
- Create: `web/src/lib/deliveryLabels.test.ts` — testa mapas + fallback.
- Create: `web/src/components/DeliveryReportBlock.tsx` — o bloco visual.
- Create: `web/src/components/DeliveryReportBlock.test.tsx` — testa render.
- Modify: `web/src/test-utils.tsx` — factory `makeDeliveryReport`.
- Modify: `web/src/components/DetailDrawer.tsx` — encaixa a seção "Parecer de entrega".
- Modify: `web/src/app.css` — estilos do bloco (light).

---

## Task 1: Tipos do delivery-report

**Files:**
- Modify: `src/store/types.ts` (acrescenta ao fim, e um campo em `Spec`)

- [ ] **Step 1: Adicionar os tipos ao fim de `src/store/types.ts`**

```ts
// ── Delivery-report (parecer de entrega do ai-squad) ───────────────────────
// Enums canônicos em INGLÊS: a UI roteia cor/realce sobre estes valores.
// O parser NÃO faz whitelist — passa valores desconhecidos adiante (robustez a
// versões do chronicler), por isso os campos abaixo são `string`, não a union.
export type DeliveryConfidence = "recorded" | "inferred" | "not_recorded";
export type DeliveryVerdictValue =
  | "approved" | "approved_with_caveats" | "needs_changes" | "blocked" | "needs_human_review";
export type DeliveryAcClassification =
  | "met" | "partially_met" | "not_met" | "not_validated";

export interface DeliveryAnswer {
  key: string; // uma das 11 chaves canônicas
  answer: string; // prosa no output_locale
  confidence: string; // canônico = DeliveryConfidence; string crua se desconhecido
  evidenceRefs: string[];
}

export interface DeliveryVerdict {
  value: string; // canônico = DeliveryVerdictValue; string crua se desconhecido
  rationale: string;
  evidenceRefs: string[];
}

export interface DeliveryAcceptanceCriterion {
  id: string;
  description: string;
  classification: string; // canônico = DeliveryAcClassification; string crua se desconhecido
  evidenceRefs: string[];
}

export interface DeliveryReport {
  specId: string | null;
  outputLocale: string | null;
  generatedAt: string | null;
  verdict: DeliveryVerdict | null;
  answers: DeliveryAnswer[]; // ordenadas pelas 11 chaves canônicas
  acceptanceCriteria: DeliveryAcceptanceCriterion[];
  container: "answers" | "questions";
  mdPath: string | null;
  jsonPath: string;
}
```

- [ ] **Step 2: Adicionar o campo em `Spec`**

Em `src/store/types.ts`, dentro de `interface Spec`, logo após a linha `cost: CostRollup;`:

```ts
  cost: CostRollup;
  deliveryReport?: DeliveryReport | null; // null em sessões sem parecer (antigas/em curso)
```

- [ ] **Step 3: Commit**

```bash
git add src/store/types.ts
git commit -m "feat: tipos do delivery-report no store"
```

---

## Task 2: Parser `readDeliveryReport`

**Files:**
- Create: `src/collector/delivery-report.ts`
- Test: `src/collector/delivery-report.test.ts`

- [ ] **Step 1: Escrever o teste que falha — normalização `answers`**

Criar `src/collector/delivery-report.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeliveryReport } from "./delivery-report.js";

const dirs: string[] = [];
function specDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-delivery-"));
  dirs.push(d);
  return d;
}
function write(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Report mínimo, parametrizado pelo nome do container (answers|questions).
function report(container: "answers" | "questions") {
  return JSON.stringify({
    spec_id: "FEAT-X",
    output_locale: "pt-BR",
    generated_at: "2026-06-07T12:00:00Z",
    schema_version: 1,
    verdict: { value: "approved_with_caveats", rationale: "ok", evidence_refs: ["outputs/a.json"] },
    [container]: {
      what_was_done: { answer: "fez X", confidence: "recorded", evidence_refs: ["d#f"] },
      acceptance_criteria: { answer: "prosa sobre ACs", confidence: "inferred", evidence_refs: [] },
      final_verdict: { answer: "veredicto", confidence: "recorded", evidence_refs: [] },
    },
    acceptance_criteria: [
      { id: "AC-001", description: "faz isso", classification: "met", evidence_refs: ["o#1"] },
    ],
  });
}

describe("readDeliveryReport — normalização answers|questions", () => {
  it("lê o container 'answers'", () => {
    const d = specDir();
    write(d, "delivery-report.json", report("answers"));
    const r = readDeliveryReport(d);
    expect(r).not.toBeNull();
    expect(r!.container).toBe("answers");
    expect(r!.verdict?.value).toBe("approved_with_caveats");
    expect(r!.answers.map((a) => a.key)).toEqual(["what_was_done", "acceptance_criteria", "final_verdict"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/collector/delivery-report.test.ts`
Expected: FAIL — `Failed to resolve import "./delivery-report.js"` (módulo não existe).

- [ ] **Step 3: Implementar `src/collector/delivery-report.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  DeliveryReport,
  DeliveryAnswer,
  DeliveryVerdict,
  DeliveryAcceptanceCriterion,
} from "../store/types.js";

// As 11 chaves canônicas, em ordem de exibição. O parser itera ESTA lista
// (não as chaves cruas do JSON) pra garantir ordem estável e tolerar ausências.
const CANONICAL_KEYS = [
  "what_was_done",
  "how_it_was_done",
  "why_this_way",
  "deviations_from_plan",
  "acceptance_criteria",
  "evidence",
  "impacts",
  "out_of_scope",
  "risks_and_pending",
  "how_to_validate",
  "final_verdict",
] as const;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Lê <specDir>/delivery-report.json e devolve a forma normalizada, ou null se
 * não houver report (sessão antiga/em curso) ou o JSON for ilegível. Read-only.
 * Normaliza o container das 11 respostas: pode vir como `answers` (canônico) ou
 * `questions` (versões antigas do chronicler) — ambos o mesmo map de 11 chaves.
 */
export function readDeliveryReport(specDir: string): DeliveryReport | null {
  const jsonPath = join(specDir, "delivery-report.json");
  if (!existsSync(jsonPath)) return null;

  let raw: Record<string, any>;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, any>;
  } catch {
    return null; // malformado: trata como ausência, não derruba o scan
  }
  if (!raw || typeof raw !== "object") return null;

  const hasAnswers = raw.answers && typeof raw.answers === "object";
  const hasQuestions = raw.questions && typeof raw.questions === "object";
  const blocks: Record<string, any> =
    (hasAnswers ? raw.answers : hasQuestions ? raw.questions : {}) ?? {};
  const container: "answers" | "questions" = hasQuestions && !hasAnswers ? "questions" : "answers";

  const answers: DeliveryAnswer[] = [];
  for (const key of CANONICAL_KEYS) {
    const blk = blocks[key];
    if (!blk || typeof blk !== "object") continue;
    answers.push({
      key,
      answer: asString(blk.answer),
      confidence: asString(blk.confidence),
      evidenceRefs: asStringArray(blk.evidence_refs),
    });
  }

  let verdict: DeliveryVerdict | null = null;
  if (raw.verdict && typeof raw.verdict === "object") {
    verdict = {
      value: asString(raw.verdict.value),
      rationale: asString(raw.verdict.rationale),
      evidenceRefs: asStringArray(raw.verdict.evidence_refs),
    };
  }

  const acceptanceCriteria: DeliveryAcceptanceCriterion[] = Array.isArray(raw.acceptance_criteria)
    ? raw.acceptance_criteria
        .filter((ac: unknown) => ac && typeof ac === "object")
        .map((ac: any) => ({
          id: asString(ac.id),
          description: asString(ac.description),
          classification: asString(ac.classification),
          evidenceRefs: asStringArray(ac.evidence_refs),
        }))
    : [];

  const mdCandidate = join(specDir, "delivery-report.md");
  const mdPath = existsSync(mdCandidate) ? mdCandidate : null;

  return {
    specId: asString(raw.spec_id) || null,
    outputLocale: asString(raw.output_locale) || null,
    generatedAt: asString(raw.generated_at) || null,
    verdict,
    answers,
    acceptanceCriteria,
    container,
    mdPath,
    jsonPath,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/collector/delivery-report.test.ts`
Expected: PASS (1 teste).

- [ ] **Step 5: Adicionar os demais casos ao teste**

Acrescentar ao final de `src/collector/delivery-report.test.ts`:

```ts
describe("readDeliveryReport — robustez", () => {
  it("container 'questions' normaliza IGUAL a 'answers'", () => {
    const a = specDir();
    write(a, "delivery-report.json", report("answers"));
    const q = specDir();
    write(q, "delivery-report.json", report("questions"));
    const ra = readDeliveryReport(a)!;
    const rq = readDeliveryReport(q)!;
    // Os DADOS normalizam idêntico; só `container` (marcador da chave de origem)
    // e `jsonPath` (tmp dir de cada um) diferem de propósito — excluí-los da
    // comparação é o ponto do teste: answers e questions viram a mesma forma.
    const data = (r: typeof ra) => ({ ...r, jsonPath: "", container: "answers" as const });
    expect(data(rq)).toEqual(data(ra));
    expect(rq.container).toBe("questions");
    expect(ra.container).toBe("answers");
  });

  it("sem delivery-report.json → null", () => {
    expect(readDeliveryReport(specDir())).toBeNull();
  });

  it("JSON malformado → null", () => {
    const d = specDir();
    write(d, "delivery-report.json", "{ não é json");
    expect(readDeliveryReport(d)).toBeNull();
  });

  it("sem delivery-report.md → mdPath null; com .md → mdPath setado", () => {
    const semMd = specDir();
    write(semMd, "delivery-report.json", report("answers"));
    expect(readDeliveryReport(semMd)!.mdPath).toBeNull();

    const comMd = specDir();
    write(comMd, "delivery-report.json", report("answers"));
    write(comMd, "delivery-report.md", "# narrativa");
    expect(readDeliveryReport(comMd)!.mdPath).toContain("delivery-report.md");
  });

  it("enum desconhecido passa adiante intacto (sem whitelist)", () => {
    const d = specDir();
    write(d, "delivery-report.json", JSON.stringify({
      verdict: { value: "shipped_to_mars", rationale: "", evidence_refs: [] },
      answers: { what_was_done: { answer: "x", confidence: "guessed", evidence_refs: [] } },
      acceptance_criteria: [{ id: "AC-1", description: "d", classification: "kinda_met", evidence_refs: [] }],
    }));
    const r = readDeliveryReport(d)!;
    expect(r.verdict?.value).toBe("shipped_to_mars");
    expect(r.answers[0].confidence).toBe("guessed");
    expect(r.acceptanceCriteria[0].classification).toBe("kinda_met");
  });

  it("colisão acceptance_criteria: array top-level vira tabela; chave homônima vira resposta", () => {
    const d = specDir();
    write(d, "delivery-report.json", report("answers"));
    const r = readDeliveryReport(d)!;
    // a tabela (top-level)
    expect(r.acceptanceCriteria).toHaveLength(1);
    expect(r.acceptanceCriteria[0].id).toBe("AC-001");
    // a resposta homônima (dentro do container)
    expect(r.answers.find((a) => a.key === "acceptance_criteria")?.answer).toBe("prosa sobre ACs");
  });
});
```

- [ ] **Step 6: Rodar todos os testes do parser**

Run: `npx vitest run src/collector/delivery-report.test.ts`
Expected: PASS (todos).

- [ ] **Step 7: Commit**

```bash
git add src/collector/delivery-report.ts src/collector/delivery-report.test.ts
git commit -m "feat: parser readDeliveryReport com normalização answers|questions"
```

---

## Task 3: Fiar no `parseSession`

**Files:**
- Modify: `src/collector/session.ts`
- Test: `src/collector/session.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `src/collector/session.test.ts` um novo bloco (segue o padrão de `mkdtemp` + `writeFileSync` já usado no arquivo — use os helpers de criação de specDir já existentes nele; se o arquivo expõe um helper local de specDir, reuse-o, senão crie um `mkdtempSync` local como em `delivery-report.test.ts`):

```ts
import { readDeliveryReport } from "./delivery-report.js"; // (no topo, junto dos outros imports)

describe("parseSession — delivery-report", () => {
  it("popula spec.deliveryReport quando há delivery-report.json", () => {
    const d = mkdtempSync(join(tmpdir(), "aios-sess-dr-"));
    writeFileSync(join(d, "session.yml"), "task_id: FEAT-Z\ncurrent_phase: done\n");
    writeFileSync(join(d, "delivery-report.json"), JSON.stringify({
      verdict: { value: "approved", rationale: "ok", evidence_refs: [] },
      answers: { what_was_done: { answer: "x", confidence: "recorded", evidence_refs: [] } },
      acceptance_criteria: [],
    }));
    const spec = parseSession(d)!;
    expect(spec.deliveryReport).not.toBeNull();
    expect(spec.deliveryReport!.verdict?.value).toBe("approved");
    rmSync(d, { recursive: true, force: true });
  });

  it("deliveryReport = null quando não há delivery-report.json", () => {
    const d = mkdtempSync(join(tmpdir(), "aios-sess-dr-"));
    writeFileSync(join(d, "session.yml"), "task_id: FEAT-Z\n");
    const spec = parseSession(d)!;
    expect(spec.deliveryReport ?? null).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });
});
```

> Se `session.test.ts` ainda não importa `mkdtempSync`/`rmSync`/`tmpdir`/`join`, adicione-os aos imports `node:fs`/`node:os`/`node:path` já presentes no arquivo.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/collector/session.test.ts`
Expected: FAIL — `spec.deliveryReport` é `undefined` (ainda não fiado).

- [ ] **Step 3: Fiar `readDeliveryReport` em `parseSession`**

Em `src/collector/session.ts`, adicionar o import no topo (junto dos outros de `./`):

```ts
import { readDeliveryReport } from "./delivery-report.js";
```

E no objeto retornado por `parseSession`, logo após `cost: readCostRollup(specDir),`:

```ts
    cost: readCostRollup(specDir),
    deliveryReport: readDeliveryReport(specDir),
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/collector/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collector/session.ts src/collector/session.test.ts
git commit -m "feat: parseSession anexa deliveryReport ao Spec"
```

---

## Task 4: Mapas de rótulo (front)

**Files:**
- Create: `web/src/lib/deliveryLabels.ts`
- Test: `web/src/lib/deliveryLabels.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/lib/deliveryLabels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel } from "./deliveryLabels";

describe("deliveryLabels", () => {
  it("traduz as 11 chaves e o veredicto", () => {
    expect(answerTitle("what_was_done")).toBe("O que foi entregue");
    expect(answerTitle("final_verdict")).toBe("Veredicto final");
    expect(verdictLabel("approved_with_caveats")).toEqual({ label: "Aprovado com ressalvas", cls: "caveats" });
  });

  it("confidence e classification com cor", () => {
    expect(confidenceLabel("not_recorded")).toEqual({ label: "não registrado", cls: "not-recorded" });
    expect(classificationLabel("partially_met")).toEqual({ label: "parcialmente atendido", cls: "partial" });
  });

  it("fallback: enum/chave desconhecidos mostram o valor cru, cls 'unknown'", () => {
    expect(answerTitle("nova_chave")).toBe("nova_chave");
    expect(verdictLabel("shipped_to_mars")).toEqual({ label: "shipped_to_mars", cls: "unknown" });
    expect(confidenceLabel("")).toEqual({ label: "—", cls: "unknown" });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run web/src/lib/deliveryLabels.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `web/src/lib/deliveryLabels.ts`**

```ts
// Mapas de apresentação pro delivery-report. SEMPRE chaveados pelo valor inglês
// canônico (a UI nunca roteia sobre rótulo traduzido). Fallback mostra o valor
// cru com cls "unknown" — assim um enum novo do chronicler ainda aparece.

export interface LabelStyle {
  label: string;
  cls: string;
}

const ANSWER_TITLES: Record<string, string> = {
  what_was_done: "O que foi entregue",
  how_it_was_done: "Como foi feito",
  why_this_way: "Por que assim",
  deviations_from_plan: "Desvios do plano",
  acceptance_criteria: "Critérios de aceite",
  evidence: "Evidências",
  impacts: "Impactos",
  out_of_scope: "Fora de escopo",
  risks_and_pending: "Riscos e pendências",
  how_to_validate: "Como validar",
  final_verdict: "Veredicto final",
};

export function answerTitle(key: string): string {
  return ANSWER_TITLES[key] ?? key;
}

function lookup(map: Record<string, LabelStyle>, value: string): LabelStyle {
  return map[value] ?? { label: value || "—", cls: "unknown" };
}

const VERDICTS: Record<string, LabelStyle> = {
  approved: { label: "Aprovado", cls: "approved" },
  approved_with_caveats: { label: "Aprovado com ressalvas", cls: "caveats" },
  needs_changes: { label: "Precisa de mudanças", cls: "changes" },
  blocked: { label: "Bloqueado", cls: "blocked" },
  needs_human_review: { label: "Requer revisão humana", cls: "human" },
};
export function verdictLabel(value: string): LabelStyle {
  return lookup(VERDICTS, value);
}

const CONFIDENCES: Record<string, LabelStyle> = {
  recorded: { label: "registrado", cls: "recorded" },
  inferred: { label: "inferido", cls: "inferred" },
  not_recorded: { label: "não registrado", cls: "not-recorded" },
};
export function confidenceLabel(value: string): LabelStyle {
  return lookup(CONFIDENCES, value);
}

const CLASSIFICATIONS: Record<string, LabelStyle> = {
  met: { label: "atendido", cls: "met" },
  partially_met: { label: "parcialmente atendido", cls: "partial" },
  not_met: { label: "não atendido", cls: "not-met" },
  not_validated: { label: "não validado", cls: "not-validated" },
};
export function classificationLabel(value: string): LabelStyle {
  return lookup(CLASSIFICATIONS, value);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run web/src/lib/deliveryLabels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/deliveryLabels.ts web/src/lib/deliveryLabels.test.ts
git commit -m "feat: mapas de rótulo pt-BR do delivery-report"
```

---

## Task 5: Componente `DeliveryReportBlock`

**Files:**
- Modify: `web/src/test-utils.tsx` (factory `makeDeliveryReport`)
- Create: `web/src/components/DeliveryReportBlock.tsx`
- Test: `web/src/components/DeliveryReportBlock.test.tsx`

- [ ] **Step 1: Adicionar a factory em `web/src/test-utils.tsx`**

No topo, incluir `DeliveryReport` no import de tipos:

```ts
import type { Project, Spec, Task, CostRollup, Dispatch, DeliveryReport } from "../../src/store/types";
```

E adicionar a factory (ao lado de `makeCost`):

```ts
export function makeDeliveryReport(over: Partial<DeliveryReport> = {}): DeliveryReport {
  return {
    specId: "FEAT-011",
    outputLocale: "pt-BR",
    generatedAt: "2026-06-07T12:00:00Z",
    verdict: { value: "approved_with_caveats", rationale: "ok com ressalvas", evidenceRefs: ["o#1"] },
    answers: [
      { key: "what_was_done", answer: "fez X", confidence: "recorded", evidenceRefs: ["d#f"] },
      { key: "risks_and_pending", answer: "risco Y", confidence: "inferred", evidenceRefs: [] },
    ],
    acceptanceCriteria: [
      { id: "AC-001", description: "faz isso", classification: "met", evidenceRefs: [] },
      { id: "AC-002", description: "faz aquilo", classification: "partially_met", evidenceRefs: [] },
    ],
    container: "answers",
    mdPath: "/x/delivery-report.md",
    jsonPath: "/x/delivery-report.json",
    ...over,
  };
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `web/src/components/DeliveryReportBlock.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { makeDeliveryReport } from "../test-utils";

describe("DeliveryReportBlock", () => {
  it("sem report mostra placeholder", () => {
    render(<DeliveryReportBlock report={null} />);
    expect(screen.getByText("sem parecer de entrega ainda")).toBeInTheDocument();
  });

  it("mostra veredicto, respostas com confidence e tabela de ACs", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    expect(screen.getByText("Aprovado com ressalvas")).toBeInTheDocument();
    expect(screen.getByText("O que foi entregue")).toBeInTheDocument();
    expect(screen.getByText("registrado")).toBeInTheDocument();
    expect(screen.getByText("inferido")).toBeInTheDocument();
    expect(screen.getByText("AC-001")).toBeInTheDocument();
    expect(screen.getByText("parcialmente atendido")).toBeInTheDocument();
  });

  it("link pro .md quando mdPath existe; ausente quando null", () => {
    const { rerender } = render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    const link = screen.getByText("ver narrativa completa →").closest("a")!;
    expect(link.getAttribute("href")).toContain("/file?path=");

    rerender(<DeliveryReportBlock report={makeDeliveryReport({ mdPath: null })} />);
    expect(screen.queryByText("ver narrativa completa →")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 4: Implementar `web/src/components/DeliveryReportBlock.tsx`**

```tsx
import type { DeliveryReport } from "../../../src/store/types";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel } from "../lib/deliveryLabels";

export function DeliveryReportBlock({ report }: { report: DeliveryReport | null | undefined }) {
  if (!report) {
    return <p className="delivery-empty">sem parecer de entrega ainda</p>;
  }

  const v = report.verdict ? verdictLabel(report.verdict.value) : null;

  return (
    <section className="delivery" data-testid="delivery-report">
      {report.verdict && v && (
        <div className={`delivery-verdict verdict-${v.cls}`}>
          <span className="delivery-verdict-label">{v.label}</span>
          {report.verdict.rationale && (
            <p className="delivery-verdict-rationale">{report.verdict.rationale}</p>
          )}
        </div>
      )}

      <div className="delivery-answers">
        {report.answers.map((a) => {
          const c = confidenceLabel(a.confidence);
          return (
            <div key={a.key} className="delivery-answer">
              <h5 className="delivery-answer-title">
                {answerTitle(a.key)}
                <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
              </h5>
              <p className="delivery-answer-text">{a.answer}</p>
              {a.evidenceRefs.length > 0 && (
                <ul className="delivery-evidence">
                  {a.evidenceRefs.map((ref, i) => (
                    <li key={i} className="delivery-evidence-ref mono">{ref}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {report.acceptanceCriteria.length > 0 && (
        <table className="delivery-acs">
          <tbody>
            {report.acceptanceCriteria.map((ac) => {
              const cl = classificationLabel(ac.classification);
              return (
                <tr key={ac.id} className={`delivery-ac ac-${cl.cls}`}>
                  <td className="delivery-ac-id mono">{ac.id}</td>
                  <td className="delivery-ac-desc">{ac.description}</td>
                  <td className={`delivery-ac-class class-${cl.cls}`}>{cl.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {report.mdPath && (
        <a
          className="delivery-md-link"
          href={`/file?path=${encodeURIComponent(report.mdPath)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          ver narrativa completa →
        </a>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/test-utils.tsx web/src/components/DeliveryReportBlock.tsx web/src/components/DeliveryReportBlock.test.tsx
git commit -m "feat: componente DeliveryReportBlock"
```

---

## Task 6: Encaixar no `DetailDrawer` + estilos

**Files:**
- Modify: `web/src/components/DetailDrawer.tsx`
- Modify: `web/src/app.css`

> **Sobre teste:** não há `DetailDrawer.test.tsx` (o drawer compõe muitos filhos com hooks/WS, cujo mock seria pesado). O render do bloco já está coberto pelo teste unitário do Task 5; o encaixe é validado de ponta a ponta no preview do Step 4 (abrindo as DUAS Sessions reais — FEAT-011 e FEAT-012). Decisão consciente: cobertura de render via unit test + validação real via preview, sem um teste de integração caro do drawer.

- [ ] **Step 1: Importar o componente no `DetailDrawer.tsx`**

Junto dos outros imports de `./`:

```ts
import { DeliveryReportBlock } from "./DeliveryReportBlock";
```

- [ ] **Step 2: Inserir a seção após o `SpecSummaryBlock`**

Em `web/src/components/DetailDrawer.tsx`, localizar:

```tsx
        <SpecSummaryBlock
          projectId={projectId}
          specId={spec.id}
          specPath={spec.specPath ?? null}
        />

        <h4 className="drawer-section">Fases</h4>
```

e inserir a nova seção entre os dois:

```tsx
        <SpecSummaryBlock
          projectId={projectId}
          specId={spec.id}
          specPath={spec.specPath ?? null}
        />

        <h4 className="drawer-section">Parecer de entrega</h4>
        <DeliveryReportBlock report={spec.deliveryReport} />

        <h4 className="drawer-section">Fases</h4>
```

- [ ] **Step 3: Adicionar os estilos ao fim de `web/src/app.css`**

```css
/* ── Delivery-report (parecer de entrega) ───────────────────────────────── */
.delivery-empty {
  color: #6b7280;
  font-size: 0.85rem;
  font-style: italic;
  margin: 0.25rem 0 0.75rem;
}
.delivery {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.delivery-verdict {
  border-left: 4px solid #9ca3af;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  background: #f9fafb;
}
.delivery-verdict-label {
  font-weight: 700;
  font-size: 0.95rem;
}
.delivery-verdict-rationale {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: #374151;
  line-height: 1.45;
}
.verdict-approved      { border-color: #16a34a; background: #f0fdf4; }
.verdict-caveats       { border-color: #d97706; background: #fffbeb; }
.verdict-changes       { border-color: #ea580c; background: #fff7ed; }
.verdict-blocked       { border-color: #dc2626; background: #fef2f2; }
.verdict-human         { border-color: #2563eb; background: #eff6ff; }
.verdict-unknown       { border-color: #9ca3af; background: #f9fafb; }

.delivery-answers { display: flex; flex-direction: column; gap: 0.6rem; }
.delivery-answer-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.2rem;
  font-size: 0.85rem;
  font-weight: 600;
}
.delivery-answer-text {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #1f2937;
  white-space: pre-wrap;
}
.delivery-conf {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
}
.conf-recorded     { background: #dcfce7; color: #166534; }
.conf-inferred     { background: #fef9c3; color: #854d0e; }
.conf-not-recorded { background: #fee2e2; color: #991b1b; }
.conf-unknown      { background: #e5e7eb; color: #374151; }

.delivery-evidence {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.delivery-evidence-ref {
  font-size: 0.65rem;
  background: #f3f4f6;
  color: #4b5563;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
}

.delivery-acs { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.delivery-ac td { padding: 0.3rem 0.5rem; border-top: 1px solid #f0f0f0; vertical-align: top; }
.delivery-ac-id { white-space: nowrap; color: #6b7280; }
.delivery-ac-class { white-space: nowrap; font-weight: 600; }
.class-met           { color: #166534; }
.class-partial       { color: #854d0e; }
.class-not-met       { color: #991b1b; }
.class-not-validated { color: #6b7280; }
.class-unknown       { color: #374151; }

.delivery-md-link { font-size: 0.8rem; color: #2563eb; text-decoration: none; }
.delivery-md-link:hover { text-decoration: underline; }
```

- [ ] **Step 4: Validar no preview contra AMBAS as fixtures**

1. Subir o app (`preview_start`; o servidor é `npm run serve` + Vite, ou `npm run dev`). O board já observa `Admin_companies_payments`.
2. Abrir a gaveta da Session **FEAT-011** → conferir: banner "Aprovado com ressalvas" (âmbar), 11 respostas com badges de confidence, tabela de ACs (25 atendido / 6 parcial), link "ver narrativa completa →".
3. Abrir a gaveta da Session **FEAT-012** → **deve renderizar igual** apesar do container ser `questions`: mesmo banner, 11 respostas, ACs (13 atendido / 1 parcial).
4. Abrir uma Session sem parecer (em curso) → conferir o placeholder "sem parecer de entrega ainda".
5. `preview_console_logs` sem erros; `preview_screenshot` das duas gavetas.

Expected: FEAT-011 e FEAT-012 renderizam idêntico em estrutura; placeholder aparece nas sem report.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (toda a suíte, incluindo os testes novos).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/DetailDrawer.tsx web/src/app.css
git commit -m "feat: exibe Parecer de entrega no DetailDrawer"
```

---

## Verificação final (cobertura do spec)

- [ ] Normalização `answers`⟺`questions` → Task 2 (parser) + teste de igualdade; preview Task 6 com as duas fixtures reais.
- [ ] Tolerância à ausência (sessões antigas) → Task 2 (null) + Task 3 (deliveryReport null) + placeholder Task 5/6.
- [ ] Enums canônicos em inglês, sem rotear sobre tradução → Task 1 (tipos) + Task 4 (mapas chaveados por valor inglês + fallback).
- [ ] confidence/AC classification visíveis (inferred/not_recorded não escondidos) → Task 5 (badges) + Task 6 (cores).
- [ ] verdict como realce → Task 5/6 (banner colorido por valor).
- [ ] `.md` linkado, não parseado → Task 5 (link `/file`).
- [ ] READ-ONLY → só `readFileSync`/`existsSync` no parser; nenhuma escrita no repo observado.
