# Kanban de 5 colunas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir o balde "Em andamento" do kanban em três colunas (Em planejamento / Planejado / Em andamento), derivando o estágio real de cada spec a partir de campos que já existem (`squad`, `tasks[].state`).

**Architecture:** Toda a derivação vive em `web/src/lib/kanban.ts` (lógica pura, testável isolada). Os componentes `KanbanBoard`/`KanbanColumn` iteram genericamente sobre `COLUMN_DEFS` e **não mudam**. O CSS ganha grid de 5 colunas e dois "dots" de cor novos. Nada no collector nem nos tipos do store muda.

**Tech Stack:** TypeScript, React, Vite, Vitest. Tema light sem framework CSS (variáveis em `:root`).

**Spec:** [docs/superpowers/specs/2026-06-01-kanban-5-colunas-design.md](../specs/2026-06-01-kanban-5-colunas-design.md)

---

## Regra de classificação (referência — implementada na Task 1)

Cascata, primeira condição que casar vence:

| # | Condição | `ColumnKey` | Coluna |
|---|----------|-------------|--------|
| 1 | `blocked`/`escalated`/`paused` **ou** `auditException` | `attention` | Precisa de você |
| 2 | status `done` | `done` | Pronto |
| 3 | squad `discovery` | `running` | Em andamento |
| 4 | tem tasks **e** alguma `running`/`done` | `running` | Em andamento |
| 5 | tem tasks **e** todas `pending` | `planned` | Planejado |
| 6 | resto (sem tasks geradas) | `planning` | Em planejamento |

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `web/src/lib/kanban.ts` | Tipo `ColumnKey`, `COLUMN_DEFS`, `columnForSpec`, `bucketByColumn` | Modificar |
| `web/src/lib/kanban.test.ts` | Testes da lógica de coluna | Modificar (novos casos + atualizar os que assumem o comportamento antigo) |
| `web/src/app.css` | Grid do board + dots de cor | Modificar |

---

## Task 1: Lógica de classificação em 5 colunas

**Files:**
- Modify: `web/src/lib/kanban.ts`
- Test: `web/src/lib/kanban.test.ts`

Esta task muda o comportamento de `columnForSpec`, então **alguns testes existentes deixam de valer** (ex.: o default `makeSpec` tem `tasks: []`, e antes uma spec `running` sem tasks ia pra `running`; agora vai pra `planning`). Atualizamos esses testes junto com os novos.

- [ ] **Step 1: Escrever/atualizar os testes (devem falhar)**

Substitua os blocos `describe("columnForSpec", ...)`, `describe("COLUMN_DEFS", ...)` e `describe("bucketByColumn", ...)` em `web/src/lib/kanban.test.ts` por:

```ts
describe("columnForSpec", () => {
  // helper local: task num dado estado
  const task = (state: "pending" | "running" | "done" | "blocked") => ({
    id: "T-1", state, loops: 0, dispatches: [] as never[],
  });

  it("blocked/escalated/paused vão pra 'attention' (ganham de tudo)", () => {
    expect(columnForSpec(makeSpec({ status: "blocked" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "escalated" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "paused" }))).toBe("attention");
  });

  it("auditException leva pra 'attention' mesmo se running ou done", () => {
    const h = { pendingHuman: 0, escalationRate: 0, auditException: true };
    expect(columnForSpec(makeSpec({ status: "running", health: h }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "done", health: h }))).toBe("attention");
  });

  it("done vai pra 'done'", () => {
    expect(columnForSpec(makeSpec({ status: "done" }))).toBe("done");
  });

  it("discovery em andamento vai pra 'running' (sem conceito de planejado)", () => {
    expect(columnForSpec(makeSpec({ squad: "discovery", status: "running", tasks: [] }))).toBe("running");
  });

  it("tem task running/done -> 'running' (execução começou)", () => {
    expect(columnForSpec(makeSpec({ status: "running", tasks: [task("running")] }))).toBe("running");
    expect(columnForSpec(makeSpec({ status: "running", tasks: [task("done")] }))).toBe("running");
  });

  it("tem tasks e todas pending -> 'planned' (decomposto, ninguém começou)", () => {
    expect(columnForSpec(makeSpec({ status: "running", tasks: [task("pending"), task("pending")] }))).toBe("planned");
  });

  it("tasks parado em phase=tasks (todas pending) também é 'planned'", () => {
    expect(columnForSpec(makeSpec({ status: "running", phase: "tasks", tasks: [task("pending")] }))).toBe("planned");
  });

  it("sem tasks geradas -> 'planning' (ainda escrevendo spec/plano)", () => {
    expect(columnForSpec(makeSpec({ status: "running", phase: "specify", tasks: [] }))).toBe("planning");
    expect(columnForSpec(makeSpec({ status: "running", phase: "implementation", tasks: [] }))).toBe("planning");
  });
});

describe("COLUMN_DEFS", () => {
  it("tem as 5 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual([
      "attention", "planning", "planned", "running", "done",
    ]);
  });
});

describe("bucketByColumn", () => {
  const task = (state: "pending" | "running" | "done" | "blocked") => ({
    id: "T-1", state, loops: 0, dispatches: [] as never[],
  });
  it("agrupa cada item na sua coluna", () => {
    const flat = flattenSpecs(
      [makeProject({ specs: [
        makeSpec({ id: "A", status: "running", tasks: [task("running")] }),       // running
        makeSpec({ id: "B", status: "blocked", tasks: [task("blocked")] }),        // attention
        makeSpec({ id: "C", status: "done" }),                                     // done
        makeSpec({ id: "D", status: "running", tasks: [task("pending")] }),        // planned
        makeSpec({ id: "E", status: "running", phase: "specify", tasks: [] }),     // planning
      ] })],
      false,
    );
    const buckets = bucketByColumn(flat);
    expect(buckets.running.map((s) => s.spec.id)).toEqual(["A"]);
    expect(buckets.attention.map((s) => s.spec.id)).toEqual(["B"]);
    expect(buckets.done.map((s) => s.spec.id)).toEqual(["C"]);
    expect(buckets.planned.map((s) => s.spec.id)).toEqual(["D"]);
    expect(buckets.planning.map((s) => s.spec.id)).toEqual(["E"]);
  });
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd web && npx vitest run src/lib/kanban.test.ts`
Expected: FAIL — `columnForSpec` ainda não conhece `planning`/`planned`; `COLUMN_DEFS` tem 3 colunas.

- [ ] **Step 3: Atualizar `ColumnKey` e `COLUMN_DEFS` em `web/src/lib/kanban.ts`**

Substitua a linha do tipo e a const `COLUMN_DEFS` por:

```ts
export type ColumnKey = "attention" | "planning" | "planned" | "running" | "done";

export const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: "attention", label: "Precisa de você" },
  { key: "planning", label: "Em planejamento" },
  { key: "planned", label: "Planejado" },
  { key: "running", label: "Em andamento" },
  { key: "done", label: "Pronto" },
];
```

- [ ] **Step 4: Reescrever `columnForSpec` com a cascata**

Substitua a função `columnForSpec` inteira por:

```ts
/**
 * Mapeia a spec pra coluna numa cascata (primeira condição que casa vence).
 * Ordem importa: atenção (exige humano) ganha de tudo; discovery não tem
 * conceito de "planejado" (é investigação); planned vs running se decide pelo
 * estado das tasks, não pela fase. Tudo derivado de campos que JÁ existem.
 */
export function columnForSpec(spec: Spec): ColumnKey {
  const s = spec.status;
  if (s === "blocked" || s === "escalated" || s === "paused") return "attention";
  if (spec.health.auditException) return "attention";
  if (s === "done") return "done";
  if (spec.squad === "discovery") return "running";
  const hasTasks = spec.tasks.length > 0;
  if (hasTasks && spec.tasks.some((t) => t.state === "running" || t.state === "done")) return "running";
  if (hasTasks) return "planned";
  return "planning";
}
```

- [ ] **Step 5: Atualizar `bucketByColumn` pra inicializar os baldes novos**

Substitua a função `bucketByColumn` por:

```ts
/** Agrupa por coluna, preservando a ordem de entrada dentro de cada balde. */
export function bucketByColumn(items: SpecWithProject[]): Record<ColumnKey, SpecWithProject[]> {
  const buckets: Record<ColumnKey, SpecWithProject[]> = {
    attention: [], planning: [], planned: [], running: [], done: [],
  };
  for (const item of items) buckets[columnForSpec(item.spec)].push(item);
  return buckets;
}
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `cd web && npx vitest run src/lib/kanban.test.ts`
Expected: PASS (todos os describes verdes).

- [ ] **Step 7: Rodar a suíte inteira do front (pegar quebras colaterais)**

Run: `cd web && npx vitest run`
Expected: PASS. Se algum teste de componente (ex.: `KanbanBoard.test.tsx`, `Board.test.tsx`) assumia 3 colunas ou que uma spec sem tasks cai em "running", ajuste o fixture do teste pro novo comportamento (dar uma task no estado certo) — não mude a lógica de produção.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/kanban.ts web/src/lib/kanban.test.ts
git commit -m "feat(web): kanban de 5 colunas (em planejamento / planejado / em andamento)"
```

---

## Task 2: CSS — grid de 5 colunas e dots de cor

**Files:**
- Modify: `web/src/app.css`

Sem teste automatizado (mudança visual) — verificação via preview no fim.

- [ ] **Step 1: Adicionar os tokens de cor em `:root`**

Em `web/src/app.css`, dentro do bloco `:root { ... }` (logo após `--audit: #f59e0b;`, linha ~21), adicione:

```css
  --planning: #9ca3af; /* cinza: rascunho, ainda escrevendo */
  --planned: #f59e0b;  /* âmbar: decomposto, aguardando execução */
```

- [ ] **Step 2: Trocar o grid de 3 pra 5 colunas**

Substitua a linha (~79):

```css
.kboard { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
```

por:

```css
.kboard { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; align-items: start; }
```

- [ ] **Step 3: Adicionar os dots das colunas novas**

Logo após a regra `.kcol[data-col="attention"] .kcol-dot { ... }` (linha ~83), adicione:

```css
.kcol[data-col="planning"] .kcol-dot { background: var(--planning); }
.kcol[data-col="planned"] .kcol-dot { background: var(--planned); }
```

(As regras de `running` e `done` já existem e continuam valendo.)

- [ ] **Step 4: Verificar no preview**

Inicie o preview (porta 4732, ver `aios-preview`), abra o board e confirme:
- 5 colunas na ordem: Precisa de você | Em planejamento | Planejado | Em andamento | Pronto
- Cada coluna com seu dot de cor; specs distribuídas conforme a cascata
- No mobile (resize estreito) as colunas empilham em 1 (regra `@media` existente `.kboard { grid-template-columns: 1fr; }` já cobre — confirmar)

Tire um screenshot pra registro.

- [ ] **Step 5: Commit**

```bash
git add web/src/app.css
git commit -m "style(web): grid de 5 colunas e dots de planejamento/planejado"
```

---

## Self-Review (preenchido)

- **Spec coverage:** regra de 6 linhas → Task 1 (Steps 4); 5 colunas → Task 1 (Step 3) + Task 2 (Step 2); cores novas → Task 2 (Steps 1, 3); discovery em "Em andamento" → teste no Step 1 + linha 3 da cascata; tasks-parado → teste no Step 1. Tudo coberto.
- **Placeholder scan:** nenhum TBD/TODO; todo código está completo.
- **Type consistency:** `ColumnKey` com 5 membros usado consistentemente em `COLUMN_DEFS`, `columnForSpec`, `bucketByColumn`; nomes de chave (`planning`, `planned`) batem entre TS e CSS (`data-col`).
- **Comportamento quebrado tratado:** Step 1 e Step 7 da Task 1 cobrem a atualização dos testes que assumiam o comportamento antigo.
