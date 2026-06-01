# Redesign de UX — Fase 1 (visual) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o board plano atual por um cockpit em kanban (3 colunas por ação) + tabela alternável + painel de detalhe lateral, na direção visual clara, usando os dados que já existem (`session.yml` + `costs/`).

**Architecture:** O backend e o estado (WS empurra `Project[]` inteiro a cada mudança) ficam intocados. Toda a mudança é no front (`web/src/`). Lógica pura de derivação (qual coluna, motivo de atenção, achatar specs, busca) vive em `web/src/lib/kanban.ts`, testável isolada. Os componentes de apresentação (`TopBar`, `ProjectFilter`, `KanbanBoard`/`Column`/`Card`, `SpecTable`, `DetailDrawer`) consomem essa lógica. O `Board` vira orquestrador do estado de UI (view, filtro, busca, seleção). A estética é um conjunto de tokens CSS claros em `app.css`.

**Tech Stack:** Vite + React 18 + TypeScript; Vitest + Testing Library (RTL) + `@testing-library/user-event`; CSS puro (variáveis + grid/flex, sem framework). Comandos: `npm test` (vitest run), `npm run dev` (back+front juntos).

**Referência de design:** `docs/specs/2026-06-01-aios-ux-redesign-design.md`.

**Convenções existentes a seguir:**
- Tipos do domínio: `src/store/types.ts` (`Spec`, `Project`, `CostRollup`, `Task`). O front importa via caminho relativo `../../../src/store/types`.
- Helpers de teste: `web/src/test-utils.tsx` (`makeSpec`, `makeProject`, `makeCost`).
- Status já vem derivado do backend (`deriveStatus`): `running | paused | blocked | done | escalated`.
- Comentários em português, densidade igual à do código atual (cada arquivo tem um docblock no topo explicando o porquê).

---

## Task 1: `fmtRelativeTime` — tempo relativo legível

**Files:**
- Modify: `web/src/format.ts`
- Test: `web/src/format.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `web/src/format.test.ts` (manter os imports/testes existentes; garantir que `fmtRelativeTime` está no import de `./format`):

```ts
import { fmtTokens, fmtUsd, fmtRelativeTime } from "./format";

describe("fmtRelativeTime", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  it("mostra segundos como 'agora'", () => {
    expect(fmtRelativeTime("2026-06-01T11:59:30Z", now)).toBe("agora");
  });
  it("mostra minutos", () => {
    expect(fmtRelativeTime("2026-06-01T11:54:00Z", now)).toBe("há 6 min");
  });
  it("mostra horas", () => {
    expect(fmtRelativeTime("2026-06-01T09:00:00Z", now)).toBe("há 3 h");
  });
  it("mostra dias", () => {
    expect(fmtRelativeTime("2026-05-30T12:00:00Z", now)).toBe("há 2 dias");
  });
  it("1 dia no singular", () => {
    expect(fmtRelativeTime("2026-05-31T12:00:00Z", now)).toBe("há 1 dia");
  });
  it("null vira travessão", () => {
    expect(fmtRelativeTime(null, now)).toBe("—");
  });
  it("data inválida vira travessão", () => {
    expect(fmtRelativeTime("nao-e-data", now)).toBe("—");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test -- format`
Expected: FAIL — `fmtRelativeTime is not a function` (ou erro de export).

- [ ] **Step 3: Implementar o mínimo**

Adicionar ao fim de `web/src/format.ts`:

```ts
/**
 * Formata um instante ISO como tempo relativo ao agora: "agora", "há 6 min",
 * "há 3 h", "há 2 dias". null ou data inválida viram "—". `now` é injetável pra
 * teste (default = relógio real). Só leitura de um valor que já existe; nada de
 * recalcular estado.
 */
export function fmtRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return "agora";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- format`
Expected: PASS (todos, incluindo os antigos de `fmtTokens`/`fmtUsd`).

- [ ] **Step 5: Commit**

```bash
git add web/src/format.ts web/src/format.test.ts
git commit -m "feat(web): fmtRelativeTime para tempo relativo no card"
```

---

## Task 2: `kanban.ts` — coluna e motivo de atenção (lógica pura)

**Files:**
- Create: `web/src/lib/kanban.ts`
- Test: `web/src/lib/kanban.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/lib/kanban.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { columnForSpec, attentionReason, COLUMN_DEFS } from "./kanban";
import { makeSpec } from "../test-utils";

describe("columnForSpec", () => {
  it("running vai pra 'running'", () => {
    expect(columnForSpec(makeSpec({ status: "running" }))).toBe("running");
  });
  it("done vai pra 'done'", () => {
    expect(columnForSpec(makeSpec({ status: "done" }))).toBe("done");
  });
  it("blocked/escalated/paused vão pra 'attention'", () => {
    expect(columnForSpec(makeSpec({ status: "blocked" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "escalated" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "paused" }))).toBe("attention");
  });
  it("auditException leva pra 'attention' mesmo se running ou done", () => {
    const h = { pendingHuman: 0, escalationRate: 0, auditException: true };
    expect(columnForSpec(makeSpec({ status: "running", health: h }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "done", health: h }))).toBe("attention");
  });
});

describe("attentionReason", () => {
  it("blocked aponta a task bloqueada quando existe", () => {
    const spec = makeSpec({
      status: "blocked",
      tasks: [{ id: "T-005", state: "blocked", loops: 1 }],
    });
    expect(attentionReason(spec)).toEqual({ kind: "blocked", label: "T-005 bloqueada" });
  });
  it("blocked sem task identificada usa label genérico", () => {
    expect(attentionReason(makeSpec({ status: "blocked", tasks: [] }))).toEqual({
      kind: "blocked",
      label: "bloqueado",
    });
  });
  it("escalated", () => {
    expect(attentionReason(makeSpec({ status: "escalated" }))).toEqual({
      kind: "escalated",
      label: "decisão humana",
    });
  });
  it("paused", () => {
    expect(attentionReason(makeSpec({ status: "paused" }))).toEqual({
      kind: "paused",
      label: "pausado",
    });
  });
  it("audit quando exceção e status normal", () => {
    expect(
      attentionReason(makeSpec({ status: "running", health: { pendingHuman: 0, escalationRate: 0, auditException: true } })),
    ).toEqual({ kind: "audit", label: "exceção de auditoria" });
  });
  it("sem motivo de atenção retorna null", () => {
    expect(attentionReason(makeSpec({ status: "running" }))).toBeNull();
  });
});

describe("COLUMN_DEFS", () => {
  it("tem as 3 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual(["attention", "running", "done"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test -- kanban`
Expected: FAIL — módulo `./kanban` não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/lib/kanban.ts`:

```ts
import type { Spec } from "../../../src/store/types";

/**
 * Lógica pura do kanban: a que coluna uma spec pertence e, quando exige atenção,
 * qual o motivo. Tudo derivado de campos que JÁ existem na Spec (status, health,
 * tasks) — nada recalculado nem inventado. Separado dos componentes pra ser
 * testável isolado.
 */
export type ColumnKey = "attention" | "running" | "done";

export const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: "attention", label: "Precisa de você" },
  { key: "running", label: "Em andamento" },
  { key: "done", label: "Pronto" },
];

/**
 * Mapeia o status derivado + flag de auditoria pra coluna. Ordem importa:
 * blocked/escalated/paused e auditException → attention (exigem olho humano)
 * ANTES de done, pra um item em auditoria não se esconder em "Pronto".
 */
export function columnForSpec(spec: Spec): ColumnKey {
  const s = spec.status;
  if (s === "blocked" || s === "escalated" || s === "paused") return "attention";
  if (spec.health.auditException) return "attention";
  if (s === "done") return "done";
  return "running";
}

export interface AttentionReason {
  kind: "blocked" | "escalated" | "paused" | "audit";
  label: string;
}

/** Motivo de a spec estar em "Precisa de você"; null se não estiver. */
export function attentionReason(spec: Spec): AttentionReason | null {
  if (spec.status === "blocked") {
    const blocked = spec.tasks.find((t) => t.state === "blocked");
    return { kind: "blocked", label: blocked ? `${blocked.id} bloqueada` : "bloqueado" };
  }
  if (spec.status === "escalated") return { kind: "escalated", label: "decisão humana" };
  if (spec.status === "paused") return { kind: "paused", label: "pausado" };
  if (spec.health.auditException) return { kind: "audit", label: "exceção de auditoria" };
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- kanban`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/kanban.ts web/src/lib/kanban.test.ts
git commit -m "feat(web): logica de coluna e motivo de atencao do kanban"
```

---

## Task 3: `kanban.ts` — achatar specs, agrupar por coluna, busca

**Files:**
- Modify: `web/src/lib/kanban.ts`
- Test: `web/src/lib/kanban.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar os blocos abaixo a `web/src/lib/kanban.test.ts`. **Substituir** a linha de import de `./kanban` e a de `../test-utils` pelas duas primeiras linhas mostradas (evita import duplicado de `makeSpec`):

```ts
import {
  columnForSpec, attentionReason, COLUMN_DEFS,
  flattenSpecs, bucketByColumn, matchesQuery,
} from "./kanban";
import { makeSpec, makeProject } from "../test-utils";

describe("flattenSpecs", () => {
  it("achata todas as specs com metadados do projeto", () => {
    const projects = [
      makeProject({ id: "p1", name: "proj-a", path: "/a", specs: [makeSpec({ id: "FEAT-1" })] }),
      makeProject({ id: "p2", name: "proj-b", path: "/b", specs: [makeSpec({ id: "FEAT-2" })] }),
    ];
    const flat = flattenSpecs(projects, false);
    expect(flat.map((s) => s.spec.id)).toEqual(["FEAT-1", "FEAT-2"]);
    expect(flat[0]).toMatchObject({ projectId: "p1", projectName: "proj-a", projectPath: "/a" });
  });
  it("esconde projetos hidden quando showHidden=false", () => {
    const projects = [
      makeProject({ id: "p1", hidden: true, specs: [makeSpec({ id: "FEAT-1" })] }),
      makeProject({ id: "p2", specs: [makeSpec({ id: "FEAT-2" })] }),
    ];
    expect(flattenSpecs(projects, false).map((s) => s.spec.id)).toEqual(["FEAT-2"]);
    expect(flattenSpecs(projects, true).map((s) => s.spec.id)).toEqual(["FEAT-1", "FEAT-2"]);
  });
});

describe("bucketByColumn", () => {
  it("agrupa cada item na sua coluna", () => {
    const flat = flattenSpecs(
      [makeProject({ specs: [
        makeSpec({ id: "A", status: "running" }),
        makeSpec({ id: "B", status: "blocked", tasks: [{ id: "T-1", state: "blocked", loops: 0 }] }),
        makeSpec({ id: "C", status: "done" }),
        makeSpec({ id: "D", status: "running" }),
      ] })],
      false,
    );
    const buckets = bucketByColumn(flat);
    expect(buckets.running.map((s) => s.spec.id)).toEqual(["A", "D"]);
    expect(buckets.attention.map((s) => s.spec.id)).toEqual(["B"]);
    expect(buckets.done.map((s) => s.spec.id)).toEqual(["C"]);
  });
});

describe("matchesQuery", () => {
  const item = flattenSpecs(
    [makeProject({ name: "site-vendas", specs: [makeSpec({ id: "FEAT-042", title: "Exportar PDF" })] })],
    false,
  )[0];
  it("vazio casa com tudo", () => expect(matchesQuery(item, "")).toBe(true));
  it("casa por id (case-insensitive)", () => expect(matchesQuery(item, "feat-042")).toBe(true));
  it("casa por título", () => expect(matchesQuery(item, "exportar")).toBe(true));
  it("casa por nome do projeto", () => expect(matchesQuery(item, "vendas")).toBe(true));
  it("não casa quando nada bate", () => expect(matchesQuery(item, "zzz")).toBe(false));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- kanban`
Expected: FAIL — `flattenSpecs`/`bucketByColumn`/`matchesQuery` não existem.

- [ ] **Step 3: Implementar o mínimo**

Acrescentar a `web/src/lib/kanban.ts`:

```ts
import type { Project } from "../../../src/store/types";

/** Uma spec carregada com os metadados do projeto que o drawer/tabela precisam. */
export interface SpecWithProject {
  spec: Spec;
  projectId: string;
  projectName: string;
  projectPath: string;
}

/**
 * Achata Project[] → SpecWithProject[] (o kanban cruza projetos; o agrupamento por
 * projeto vira só a tag/cor). Esconde specs de projetos hidden a menos que
 * showHidden. Preserva a ordem (projeto, depois spec).
 */
export function flattenSpecs(projects: Project[], showHidden: boolean): SpecWithProject[] {
  const out: SpecWithProject[] = [];
  for (const p of projects) {
    if (p.hidden && !showHidden) continue;
    for (const spec of p.specs) {
      out.push({ spec, projectId: p.id, projectName: p.name, projectPath: p.path });
    }
  }
  return out;
}

/** Agrupa por coluna, preservando a ordem de entrada dentro de cada balde. */
export function bucketByColumn(items: SpecWithProject[]): Record<ColumnKey, SpecWithProject[]> {
  const buckets: Record<ColumnKey, SpecWithProject[]> = { attention: [], running: [], done: [] };
  for (const item of items) buckets[columnForSpec(item.spec)].push(item);
  return buckets;
}

/** Busca simples: casa o termo (case-insensitive) em id, título ou nome do projeto. */
export function matchesQuery(item: SpecWithProject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = `${item.spec.id} ${item.spec.title} ${item.projectName}`.toLowerCase();
  return hay.includes(q);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- kanban`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/kanban.ts web/src/lib/kanban.test.ts
git commit -m "feat(web): achatar specs, agrupar por coluna e busca"
```

---

## Task 4: `KanbanCard` — card compacto adaptável

**Files:**
- Create: `web/src/components/KanbanCard.tsx`
- Test: `web/src/components/KanbanCard.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/KanbanCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "./KanbanCard";
import { makeSpec, makeProject } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

function item(spec = makeSpec()) {
  return flattenSpecs([makeProject({ name: "proj-a", specs: [spec] })], false)[0];
}

describe("KanbanCard", () => {
  it("mostra id, título e projeto", () => {
    render(<KanbanCard item={item(makeSpec({ id: "FEAT-9", title: "Tema" }))} onSelect={vi.fn()} />);
    expect(screen.getByText("FEAT-9")).toBeInTheDocument();
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("proj-a")).toBeInTheDocument();
  });

  it("em atenção mostra o motivo", () => {
    const spec = makeSpec({ status: "blocked", tasks: [{ id: "T-5", state: "blocked", loops: 0 }] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/T-5 bloqueada/)).toBeInTheDocument();
  });

  it("em andamento mostra a fase atual", () => {
    const spec = makeSpec({ status: "running", phase: "tasks", plannedPhases: ["specify", "plan", "tasks", "implementation"] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/tasks/)).toBeInTheDocument();
  });

  it("clicar chama onSelect com o item", async () => {
    const onSelect = vi.fn();
    const it0 = item(makeSpec({ id: "FEAT-9" }));
    render(<KanbanCard item={it0} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("FEAT-9"));
    expect(onSelect).toHaveBeenCalledWith(it0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- KanbanCard`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/KanbanCard.tsx`:

```tsx
import type { SpecWithProject } from "../lib/kanban";
import { columnForSpec, attentionReason } from "../lib/kanban";
import { fmtTokens, fmtUsd, fmtRelativeTime } from "../format";

/**
 * Card compacto do kanban. O conteúdo adapta-se à coluna: em "atenção" mostra o
 * MOTIVO (bloqueio/escalada/auditoria); em "andamento" mostra a fase atual. O
 * rodapé sempre traz custo + última atividade. A borda esquerda (cor por status)
 * e a tag de squad são CSS (data-status / data-squad). Só leitura; clicar abre o
 * drawer via onSelect.
 */
export function KanbanCard({
  item,
  onSelect,
}: {
  item: SpecWithProject;
  onSelect: (item: SpecWithProject) => void;
}) {
  const { spec, projectName } = item;
  const col = columnForSpec(spec);
  const reason = attentionReason(spec);
  return (
    <article
      className="kcard"
      data-status={spec.status}
      data-squad={spec.squad}
      onClick={() => onSelect(item)}
    >
      <div className="kcard-row1">
        <span className="kcard-id">{spec.id}</span>
        <span className="kcard-proj">{projectName}</span>
      </div>
      <h3 className="kcard-title">{spec.title}</h3>

      {col === "attention" && reason && (
        <div className={`kcard-why why-${reason.kind}`}>{reason.label}</div>
      )}

      {col === "running" && spec.phase && (
        <div className="kcard-phase">{spec.phase}</div>
      )}

      <div className="kcard-meta">
        <span className="kcard-cost">
          {fmtTokens(spec.cost.totalTokens)} tok · {fmtUsd(spec.cost.totalCostUsd)}
        </span>
        <time className="kcard-time">{fmtRelativeTime(spec.lastActivityAt)}</time>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- KanbanCard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KanbanCard.tsx web/src/components/KanbanCard.test.tsx
git commit -m "feat(web): KanbanCard compacto adaptavel por coluna"
```

---

## Task 5: `KanbanColumn` — cabeçalho, contagem e vazio

**Files:**
- Create: `web/src/components/KanbanColumn.tsx`
- Test: `web/src/components/KanbanColumn.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/KanbanColumn.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanColumn } from "./KanbanColumn";
import { makeSpec, makeProject } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [makeProject({ specs: [makeSpec({ id: "A" }), makeSpec({ id: "B" })] })],
  false,
);

describe("KanbanColumn", () => {
  it("mostra rótulo e contagem", () => {
    render(<KanbanColumn columnKey="running" label="Em andamento" items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
  it("renderiza um card por item", () => {
    render(<KanbanColumn columnKey="running" label="Em andamento" items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
  it("vazia mostra placeholder", () => {
    render(<KanbanColumn columnKey="done" label="Pronto" items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/nada aqui/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- KanbanColumn`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/KanbanColumn.tsx`:

```tsx
import type { ColumnKey, SpecWithProject } from "../lib/kanban";
import { KanbanCard } from "./KanbanCard";

/**
 * Uma coluna do kanban: cabeçalho com ponto de cor (data-col no CSS), rótulo e
 * contagem; depois os cards. Vazia mostra um placeholder discreto pra deixar
 * claro que está vazia de propósito (não quebrada).
 */
export function KanbanColumn({
  columnKey,
  label,
  items,
  onSelect,
}: {
  columnKey: ColumnKey;
  label: string;
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  return (
    <section className="kcol" data-col={columnKey}>
      <header className="kcol-head">
        <span className="kcol-dot" />
        <span className="kcol-label">{label}</span>
        <span className="kcol-count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="kcol-empty">nada aqui</p>
      ) : (
        items.map((it) => (
          <KanbanCard key={`${it.projectId}/${it.spec.id}`} item={it} onSelect={onSelect} />
        ))
      )}
    </section>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- KanbanColumn`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KanbanColumn.tsx web/src/components/KanbanColumn.test.tsx
git commit -m "feat(web): KanbanColumn com contagem e estado vazio"
```

---

## Task 6: `KanbanBoard` — as 3 colunas

**Files:**
- Create: `web/src/components/KanbanBoard.tsx`
- Test: `web/src/components/KanbanBoard.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/KanbanBoard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanBoard } from "./KanbanBoard";
import { makeSpec, makeProject } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [makeProject({ specs: [
    makeSpec({ id: "R", status: "running" }),
    makeSpec({ id: "B", status: "blocked", tasks: [{ id: "T-1", state: "blocked", loops: 0 }] }),
    makeSpec({ id: "D", status: "done" }),
  ] })],
  false,
);

describe("KanbanBoard", () => {
  it("mostra as 3 colunas com seus títulos", () => {
    render(<KanbanBoard items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("Precisa de você")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
  });
  it("coloca cada spec na coluna certa", () => {
    render(<KanbanBoard items={items} onSelect={vi.fn()} />);
    // os 3 ids aparecem (um por coluna)
    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- KanbanBoard`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/KanbanBoard.tsx`:

```tsx
import type { SpecWithProject } from "../lib/kanban";
import { COLUMN_DEFS, bucketByColumn } from "../lib/kanban";
import { KanbanColumn } from "./KanbanColumn";

/**
 * O kanban: agrupa os itens (já filtrados pelo Board) por coluna e renderiza as 3
 * colunas na ordem de COLUMN_DEFS. Não conhece filtro/busca — recebe a lista
 * pronta. onSelect sobe pro Board abrir o drawer.
 */
export function KanbanBoard({
  items,
  onSelect,
}: {
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  const buckets = bucketByColumn(items);
  return (
    <div className="kboard">
      {COLUMN_DEFS.map((c) => (
        <KanbanColumn
          key={c.key}
          columnKey={c.key}
          label={c.label}
          items={buckets[c.key]}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- KanbanBoard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KanbanBoard.tsx web/src/components/KanbanBoard.test.tsx
git commit -m "feat(web): KanbanBoard agrupando as 3 colunas"
```

---

## Task 7: `SpecTable` — 2ª visão ordenável

**Files:**
- Create: `web/src/components/SpecTable.tsx`
- Test: `web/src/components/SpecTable.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/SpecTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpecTable } from "./SpecTable";
import { makeSpec, makeProject, makeCost } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [makeProject({ name: "proj-a", specs: [
    makeSpec({ id: "FEAT-1", title: "Alpha", cost: makeCost({ totalCostUsd: 2 }) }),
    makeSpec({ id: "FEAT-2", title: "Beta", cost: makeCost({ totalCostUsd: 9 }) }),
  ] })],
  false,
);

describe("SpecTable", () => {
  it("renderiza uma linha por spec com id e título", () => {
    render(<SpecTable items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });
  it("clicar numa linha chama onSelect", async () => {
    const onSelect = vi.fn();
    render(<SpecTable items={items} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
  it("ordena por custo ao clicar no cabeçalho de custo", async () => {
    render(<SpecTable items={items} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /custo/i }));
    const rows = screen.getAllByRole("row").slice(1); // pula o header
    // ascendente: 2 antes de 9 → FEAT-1 primeiro
    expect(within(rows[0]).getByText("FEAT-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /custo/i }));
    const rows2 = screen.getAllByRole("row").slice(1);
    // descendente: FEAT-2 primeiro
    expect(within(rows2[0]).getByText("FEAT-2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- SpecTable`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/SpecTable.tsx`:

```tsx
import { useState } from "react";
import type { SpecWithProject } from "../lib/kanban";
import { fmtTokens, fmtUsd, fmtRelativeTime } from "../format";

/**
 * 2ª visão (toggle "Tabela"): uma linha por spec, ordenável, pra COMPARAR custo/
 * progresso — o gesto que o kanban não serve bem. Ordenação é estado local; o
 * clique numa linha abre o mesmo drawer via onSelect. Custo em $ é sempre o
 * agregado da spec (não há $ por tarefa — ver design §6).
 */
type SortKey = "project" | "id" | "status" | "phase" | "cost" | "activity";

function valueFor(item: SpecWithProject, key: SortKey): string | number {
  const s = item.spec;
  switch (key) {
    case "project": return item.projectName;
    case "id": return s.id;
    case "status": return s.status;
    case "phase": return s.phase;
    case "cost": return s.cost.totalCostUsd ?? -1; // sem dado vai pro fim no asc
    case "activity": return s.lastActivityAt ?? "";
  }
}

export function SpecTable({
  items,
  onSelect,
}: {
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("activity");
  const [asc, setAsc] = useState(false);

  const sorted = [...items].sort((a, b) => {
    const va = valueFor(a, sortKey);
    const vb = valueFor(b, sortKey);
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return asc ? cmp : -cmp;
  });

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(true); }
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: "project", label: "projeto" },
    { key: "id", label: "id" },
    { key: "status", label: "status" },
    { key: "phase", label: "fase" },
    { key: "cost", label: "custo" },
    { key: "activity", label: "atividade" },
  ];

  return (
    <table className="spec-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key}>
              <button type="button" onClick={() => toggle(c.key)}>
                {c.label}
                {sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
              </button>
            </th>
          ))}
          <th>título</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((it) => (
          <tr key={`${it.projectId}/${it.spec.id}`} onClick={() => onSelect(it)} data-status={it.spec.status}>
            <td>{it.projectName}</td>
            <td className="mono">{it.spec.id}</td>
            <td><span className={`status status-${it.spec.status}`}>{it.spec.status}</span></td>
            <td>{it.spec.phase}</td>
            <td className="mono">{fmtUsd(it.spec.cost.totalCostUsd)} · {fmtTokens(it.spec.cost.totalTokens)}</td>
            <td>{fmtRelativeTime(it.spec.lastActivityAt)}</td>
            <td>{it.spec.title}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- SpecTable`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SpecTable.tsx web/src/components/SpecTable.test.tsx
git commit -m "feat(web): SpecTable ordenavel como 2a visao"
```

---

## Task 8: `DetailDrawer` — painel lateral de investigação

**Files:**
- Create: `web/src/components/DetailDrawer.tsx`
- Test: `web/src/components/DetailDrawer.test.tsx`

**Nota:** reusa `PhaseBar`, `Timeline` e `StatusBadge` existentes. As tarefas aqui são uma lista plana (id/estado/loops) — a versão colapsável rica é a Fase 2.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/DetailDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailDrawer } from "./DetailDrawer";
import { makeSpec, makeProject, makeCost } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

function item(spec = makeSpec()) {
  return flattenSpecs([makeProject({ name: "proj-a", path: "/a", specs: [spec] })], false)[0];
}

describe("DetailDrawer", () => {
  it("fechado (item null) não renderiza conteúdo", () => {
    render(<DetailDrawer item={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("aberto mostra id, título e tarefas", () => {
    const spec = makeSpec({
      id: "FEAT-7", title: "Checkout",
      tasks: [{ id: "T-1", state: "done", loops: 0 }, { id: "T-2", state: "blocked", loops: 2 }],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("FEAT-7")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("T-2")).toBeInTheDocument();
    expect(screen.getByText(/2 loops/)).toBeInTheDocument(); // retrabalho visível
  });
  it("mostra o breakdown de custo por tipo de token", () => {
    const spec = makeSpec({ cost: makeCost({ tokens: { input: 1400, output: 220, cacheRead: 480, cacheCreation: 30 } }) });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/input/i)).toBeInTheDocument();
    expect(screen.getByText(/cache read/i)).toBeInTheDocument();
  });
  it("mostra o link do report quando há reportPath", () => {
    const spec = makeSpec({ cost: makeCost({ reportPath: "/a/.agent-session/FEAT-7/report.html" }) });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("report.html"));
  });
  it("sem reportPath não mostra link de report", () => {
    render(<DetailDrawer item={item(makeSpec({ cost: makeCost({ reportPath: null }) }))} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });
  it("botão fechar chama onClose", async () => {
    const onClose = vi.fn();
    render(<DetailDrawer item={item()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- DetailDrawer`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/DetailDrawer.tsx`:

```tsx
import type { SpecWithProject } from "../lib/kanban";
import { attentionReason } from "../lib/kanban";
import { fmtTokens, fmtUsd } from "../format";
import { PhaseBar } from "./PhaseBar";
import { StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";

/**
 * Painel lateral que abre ao clicar num card/linha — onde mora a "investigação".
 * Reúne motivo (quando em atenção), fases, tarefas (lista plana; a versão rica
 * colapsável é a Fase 2), custo destrinchado por tipo de token, e a timeline +
 * links dos .md (reusa <Timeline>). item null = fechado. Tudo leitura.
 */
const STATE_LABEL: Record<string, string> = {
  pending: "pendente", running: "rodando", done: "concluída", blocked: "bloqueada",
};

export function DetailDrawer({
  item,
  onClose,
}: {
  item: SpecWithProject | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const { spec, projectName, projectPath } = item;
  const reason = attentionReason(spec);
  const t = spec.cost.tokens;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`detalhe ${spec.id}`} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <span className="drawer-id">{spec.id}</span>
          <span className="drawer-proj">{projectName} · {spec.squad.toUpperCase()}</span>
          <StatusBadge spec={spec} />
          <button type="button" className="drawer-close" aria-label="fechar" onClick={onClose}>✕</button>
        </header>
        <h2 className="drawer-title">{spec.title}</h2>

        {reason && <div className={`drawer-why why-${reason.kind}`}>{reason.label}</div>}

        <h4 className="drawer-section">Fases</h4>
        <PhaseBar spec={spec} />

        <h4 className="drawer-section">Tarefas</h4>
        <ul className="drawer-tasks">
          {spec.tasks.length === 0 && <li className="drawer-tasks-empty">sem tarefas registradas</li>}
          {spec.tasks.map((task) => (
            <li key={task.id} data-state={task.state}>
              <span className="mono">{task.id}</span>
              <span className="task-state">{STATE_LABEL[task.state] ?? task.state}</span>
              {task.loops > 1 && <span className="task-loops">↻ {task.loops} loops</span>}
            </li>
          ))}
        </ul>

        <h4 className="drawer-section">Custo</h4>
        <div className="drawer-cost">
          <span className="drawer-cost-usd">{fmtUsd(spec.cost.totalCostUsd)}</span>
          <span className="mono drawer-cost-tok">{fmtTokens(spec.cost.totalTokens)} tokens</span>
          {spec.cost.partial && <span className="cost-partial">$ parcial</span>}
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
        <dl className="drawer-cost-breakdown mono">
          <div><dt>input</dt><dd>{fmtTokens(t.input)}</dd></div>
          <div><dt>output</dt><dd>{fmtTokens(t.output)}</dd></div>
          <div><dt>cache read</dt><dd>{fmtTokens(t.cacheRead)}</dd></div>
          <div><dt>cache creation</dt><dd>{fmtTokens(t.cacheCreation)}</dd></div>
        </dl>

        <h4 className="drawer-section">Linha do tempo</h4>
        <Timeline spec={spec} projectPath={projectPath} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- DetailDrawer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DetailDrawer.tsx web/src/components/DetailDrawer.test.tsx
git commit -m "feat(web): DetailDrawer lateral de investigacao (reusa PhaseBar/Timeline)"
```

---

## Task 9: `TopBar` — marca, conexão, busca, toggle de visão

**Files:**
- Create: `web/src/components/TopBar.tsx`
- Test: `web/src/components/TopBar.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/TopBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";

function setup(over = {}) {
  const props = {
    connected: true, query: "", onQuery: vi.fn(),
    view: "kanban" as const, onView: vi.fn(), ...over,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("mostra 'ao vivo' quando conectado e 'reconectando' quando não", () => {
    setup({ connected: true });
    expect(screen.getByText(/ao vivo/i)).toBeInTheDocument();
  });
  it("digitar na busca chama onQuery", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(props.onQuery).toHaveBeenCalled();
  });
  it("clicar em Tabela chama onView com 'table'", async () => {
    const props = setup({ view: "kanban" });
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(props.onView).toHaveBeenCalledWith("table");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- TopBar`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/TopBar.tsx`:

```tsx
/**
 * Barra superior: marca + pílula de conexão (ao vivo / reconectando, vindo do WS)
 * + busca (controlada pelo Board) + toggle Kanban|Tabela. Não tem estado próprio;
 * tudo sobe via callbacks pro Board, que é o dono do estado de UI.
 */
export type ViewMode = "kanban" | "table";

export function TopBar({
  connected,
  query,
  onQuery,
  view,
  onView,
}: {
  connected: boolean;
  query: string;
  onQuery: (q: string) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand"><span className="brand-mark" />ai-squad-os</div>
      <span className={`conn conn-${connected ? "up" : "down"}`}>
        {connected ? "ao vivo" : "reconectando…"}
      </span>
      <input
        className="search"
        type="search"
        placeholder="buscar spec, projeto…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="seg" role="group" aria-label="visão">
        <button type="button" className={view === "kanban" ? "on" : ""} onClick={() => onView("kanban")}>
          Kanban
        </button>
        <button type="button" className={view === "table" ? "on" : ""} onClick={() => onView("table")}>
          Tabela
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- TopBar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TopBar.tsx web/src/components/TopBar.test.tsx
git commit -m "feat(web): TopBar com conexao, busca e toggle de visao"
```

---

## Task 10: `ProjectFilter` — chips + ocultar/mostrar

**Files:**
- Create: `web/src/components/ProjectFilter.tsx`
- Test: `web/src/components/ProjectFilter.test.tsx`

**Nota:** preserva o comportamento atual de hide/unhide (manda o `id` estável pro callback) e o toggle "mostrar ocultos". Cada chip de projeto tem um botão ocultar; projetos hidden só aparecem (com botão "mostrar") quando "mostrar ocultos" está ligado.

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/ProjectFilter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectFilter } from "./ProjectFilter";
import { makeProject } from "../test-utils";

function setup(over = {}) {
  const props = {
    projects: [makeProject({ id: "p1", name: "proj-a" }), makeProject({ id: "p2", name: "proj-b", hidden: true })],
    filter: null as string | null, onFilter: vi.fn(),
    showHidden: false, onShowHidden: vi.fn(), onHide: vi.fn(), ...over,
  };
  render(<ProjectFilter {...props} />);
  return props;
}

describe("ProjectFilter", () => {
  it("mostra 'todos' + os projetos visíveis (esconde hidden por padrão)", () => {
    setup();
    expect(screen.getByRole("button", { name: "todos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "proj-a" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "proj-b" })).toBeNull();
  });
  it("clicar num projeto chama onFilter com o id", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(props.onFilter).toHaveBeenCalledWith("p1");
  });
  it("ocultar manda o id estável", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(props.onHide).toHaveBeenCalledWith("p1", true);
  });
  it("com 'mostrar ocultos' ligado, hidden aparece com ação de mostrar", async () => {
    const props = setup({ showHidden: true });
    expect(screen.getByRole("button", { name: "proj-b" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /mostrar proj-b/i }));
    expect(props.onHide).toHaveBeenCalledWith("p2", false);
  });
  it("o checkbox 'mostrar ocultos' chama onShowHidden", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i));
    expect(props.onShowHidden).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- ProjectFilter`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o mínimo**

Criar `web/src/components/ProjectFilter.tsx`:

```tsx
import type { Project } from "../../../src/store/types";

/**
 * Filtro por projeto em chips + ocultar/mostrar (substitui o cabeçalho do antigo
 * ProjectGroup, já que o kanban não agrupa por projeto). Projetos hidden só
 * aparecem quando "mostrar ocultos" está ligado, aí com ação de "mostrar". O id
 * usado em onFilter/onHide é o estável (project.id); o name é só exibição.
 */
export function ProjectFilter({
  projects,
  filter,
  onFilter,
  showHidden,
  onShowHidden,
  onHide,
}: {
  projects: Project[];
  filter: string | null;
  onFilter: (id: string | null) => void;
  showHidden: boolean;
  onShowHidden: (v: boolean) => void;
  onHide: (id: string, hidden: boolean) => void;
}) {
  const visible = projects.filter((p) => showHidden || !p.hidden);
  return (
    <div className="pfilter">
      <button className={filter === null ? "chip on" : "chip"} onClick={() => onFilter(null)}>
        todos
      </button>
      {visible.map((p) => (
        <span key={p.id} className="chip-wrap" data-hidden={p.hidden || undefined}>
          <button className={filter === p.id ? "chip on" : "chip"} onClick={() => onFilter(p.id)}>
            {p.name}
          </button>
          <button
            className="chip-hide"
            aria-label={`${p.hidden ? "mostrar" : "ocultar"} ${p.name}`}
            title={p.hidden ? "mostrar" : "ocultar"}
            onClick={() => onHide(p.id, !p.hidden)}
          >
            {p.hidden ? "👁" : "✕"}
          </button>
        </span>
      ))}
      <label className="show-hidden">
        <input type="checkbox" checked={showHidden} onChange={(e) => onShowHidden(e.target.checked)} />
        mostrar ocultos
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- ProjectFilter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProjectFilter.tsx web/src/components/ProjectFilter.test.tsx
git commit -m "feat(web): ProjectFilter com chips e ocultar/mostrar"
```

---

## Task 11: `Board` — orquestrador (kanban/tabela + drawer + filtro + busca)

**Files:**
- Modify (rewrite): `web/src/components/Board.tsx`
- Modify (rewrite): `web/src/components/Board.test.tsx`

- [ ] **Step 1: Reescrever o teste**

Substituir TODO o conteúdo de `web/src/components/Board.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider } from "../state/projects";
import { makeProject, makeSpec } from "../test-utils";

function renderBoard(projects: Parameters<typeof makeProject>[0][] = [], onHide = vi.fn()) {
  const built = projects.map((p) => makeProject(p));
  return {
    onHide,
    ...render(
      <ProjectsProvider initial={built}>
        <Board onHide={onHide} />
      </ProjectsProvider>,
    ),
  };
}

describe("Board", () => {
  it("mostra os cards das specs no kanban por padrão", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", status: "running" })] }]);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
  });

  it("filtra por projeto", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("busca filtra por texto", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [
      makeSpec({ id: "FEAT-1", title: "Exportar PDF" }),
      makeSpec({ id: "FEAT-2", title: "Login social" }),
    ] }]);
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("alterna pra tabela", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] }]);
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("clicar num card abre o drawer; fechar o esconde", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "Checkout" })] }]);
    await userEvent.click(screen.getByText("FEAT-1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ocultar manda o id estável e reseta o filtro do projeto oculto", async () => {
    const { onHide } = renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "proj-xyz", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" })); // filtra proj-a
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
    expect(screen.getByText("FEAT-2")).toBeInTheDocument(); // filtro resetou
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- Board`
Expected: FAIL — `Board` ainda é a versão antiga (sem TopBar/kanban/drawer).

- [ ] **Step 3: Reescrever o `Board`**

Substituir TODO o conteúdo de `web/src/components/Board.tsx`:

```tsx
import { useState } from "react";
import { useProjects } from "../state/projects";
import { flattenSpecs, matchesQuery, type SpecWithProject } from "../lib/kanban";
import { TopBar, type ViewMode } from "./TopBar";
import { ProjectFilter } from "./ProjectFilter";
import { KanbanBoard } from "./KanbanBoard";
import { SpecTable } from "./SpecTable";
import { DetailDrawer } from "./DetailDrawer";

/**
 * Orquestrador da UI. O estado vindo do WS (projects + connected) é só leitura;
 * todo o resto é estado de UI local: visão (kanban/tabela), filtro de projeto,
 * busca, "mostrar ocultos" e a spec selecionada (drawer). Achata as specs uma vez
 * e aplica filtro+busca antes de passar pro kanban/tabela. A seleção guarda
 * (projectId, specId) e re-localiza o item a cada render — se a spec sumir num
 * novo snapshot, o drawer fecha sozinho.
 */
export function Board({ onHide }: { onHide: (id: string, hidden: boolean) => void }) {
  const { projects, connected } = useProjects();
  const [view, setView] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<{ projectId: string; specId: string } | null>(null);

  const all = flattenSpecs(projects, showHidden);
  const visible = all
    .filter((sp) => filter === null || sp.projectId === filter)
    .filter((sp) => matchesQuery(sp, query));

  const selectedItem: SpecWithProject | null =
    selected
      ? all.find((sp) => sp.projectId === selected.projectId && sp.spec.id === selected.specId) ?? null
      : null;

  const handleHide = (id: string, hidden: boolean) => {
    if (hidden && filter === id) setFilter(null);
    onHide(id, hidden);
  };

  const onSelect = (item: SpecWithProject) =>
    setSelected({ projectId: item.projectId, specId: item.spec.id });

  return (
    <div className="app-shell">
      <TopBar connected={connected} query={query} onQuery={setQuery} view={view} onView={setView} />
      <ProjectFilter
        projects={projects}
        filter={filter}
        onFilter={setFilter}
        showHidden={showHidden}
        onShowHidden={setShowHidden}
        onHide={handleHide}
      />
      <main className="board-body">
        {view === "kanban" ? (
          <KanbanBoard items={visible} onSelect={onSelect} />
        ) : (
          <SpecTable items={visible} onSelect={onSelect} />
        )}
      </main>
      <DetailDrawer item={selectedItem} onClose={() => setSelected(null)} />
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- Board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Board.tsx web/src/components/Board.test.tsx
git commit -m "feat(web): Board orquestra kanban/tabela + drawer + filtro + busca"
```

---

## Task 12: Remover componentes obsoletos (`ProjectGroup`, `SpecCard`, `CostTag`)

**Files:**
- Delete: `web/src/components/ProjectGroup.tsx`, `web/src/components/ProjectGroup.test.tsx` (se existir)
- Delete: `web/src/components/SpecCard.tsx`, `web/src/components/SpecCard.test.tsx`
- Delete: `web/src/components/CostTag.tsx`, `web/src/components/CostTag.test.tsx`

**Razão:** o kanban (cards) + o drawer substituem por completo `ProjectGroup`/`SpecCard`. O `CostTag` só era usado pelo `SpecCard`; o card do kanban formata custo inline e o drawer monta o breakdown + link de report próprios, então o `CostTag` também fica órfão. `PhaseBar`, `StatusBadge` e `Timeline` continuam reusados (drawer/tabela) — NÃO são removidos.

- [ ] **Step 1: Confirmar que ninguém mais importa os três**

Run: `grep -rn "SpecCard\|ProjectGroup\|CostTag" web/src --include=*.tsx --include=*.ts | grep -v ".test."`
Expected: nenhuma linha (fora arquivos de teste dos próprios). Se aparecer algum import remanescente, corrigir antes de deletar.

- [ ] **Step 2: Deletar os arquivos**

```bash
git rm web/src/components/ProjectGroup.tsx web/src/components/SpecCard.tsx web/src/components/CostTag.tsx
git rm -f web/src/components/ProjectGroup.test.tsx web/src/components/SpecCard.test.tsx web/src/components/CostTag.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — nada quebrou (os obsoletos não eram mais referenciados).

- [ ] **Step 4: Commit**

```bash
git add -A web/src/components
git commit -m "refactor(web): remove ProjectGroup/SpecCard substituidos por kanban+drawer"
```

---

## Task 13: `app.css` — tokens light + estilos dos novos componentes

**Files:**
- Modify (rewrite): `web/src/app.css`

**Nota:** CSS não é coberto por teste unitário; a verificação é visual via `npm run dev`. As classes abaixo casam exatamente com as emitidas pelos componentes das Tasks 4–11. Tokens conforme design §4.

- [ ] **Step 1: Reescrever `web/src/app.css`**

Substituir TODO o conteúdo por:

```css
/* ai-squad-os — tema CLARO do cockpit (redesign Fase 1).
   Tokens light + layout do kanban / tabela / drawer. Sem framework: variáveis
   CSS + grid/flex. As classes casam com as emitidas pelos componentes. */

:root {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-soft: #fafbfc;
  --border: #e7e9ee;
  --border-soft: #f0f1f4;
  --text: #111827;
  --text-dim: #6b7280;
  --text-mute: #9ca3af;
  --accent: #2563eb;

  --running: #2563eb;
  --paused: #f59e0b;
  --blocked: #ef4444;
  --done: #22c55e;
  --escalated: #a855f7;
  --audit: #f59e0b;

  --sdd: #2563eb;
  --discovery: #0d9488;

  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  --shadow-lift: 0 4px 12px rgba(16, 24, 40, 0.08);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.mono { font-family: var(--mono); }

.app-shell { max-width: 1280px; margin: 0 auto; }

/* ---- TopBar ---- */
.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.brand { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 7px; }
.brand-mark { width: 16px; height: 16px; border-radius: 5px; background: linear-gradient(135deg, #2563eb, #60a5fa); }
.conn { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
.conn-up { color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; }
.conn-down { color: #b45309; background: #fffbeb; border: 1px solid #fde68a; }
.search {
  flex: 1; max-width: 280px; font-size: 13px; color: var(--text);
  background: #f3f4f6; border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px;
}
.seg { display: flex; margin-left: auto; background: #f3f4f6; border: 1px solid var(--border); border-radius: 8px; padding: 2px; }
.seg button { border: 0; background: transparent; font-size: 12px; font-weight: 600; color: var(--text-dim); padding: 5px 14px; border-radius: 6px; cursor: pointer; }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }

/* ---- ProjectFilter ---- */
.pfilter { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 10px 16px; background: var(--surface-soft); border-bottom: 1px solid var(--border); }
.chip { font-size: 11px; color: var(--text-dim); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
.chip:hover { color: var(--text); }
.chip.on { background: var(--text); color: var(--surface); border-color: var(--text); font-weight: 600; }
.chip-wrap { display: inline-flex; align-items: center; gap: 2px; }
.chip-wrap[data-hidden] .chip { opacity: 0.55; }
.chip-hide { border: 0; background: transparent; color: var(--text-mute); font-size: 10px; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
.chip-hide:hover { color: var(--text); background: #f3f4f6; }
.show-hidden { margin-left: auto; font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 5px; cursor: pointer; }

/* ---- Kanban ---- */
.board-body { padding: 14px 16px; }
.kboard { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; align-items: start; }
.kcol { background: var(--surface-soft); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; }
.kcol-head { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #374151; margin-bottom: 10px; }
.kcol-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--text-mute); }
.kcol[data-col="attention"] .kcol-dot { background: var(--blocked); }
.kcol[data-col="running"] .kcol-dot { background: var(--running); }
.kcol[data-col="done"] .kcol-dot { background: var(--done); }
.kcol-count { margin-left: auto; color: var(--text-mute); }
.kcol-empty { font-size: 12px; color: var(--text-mute); padding: 8px 4px; margin: 0; }

.kcard { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--text-mute); border-radius: var(--radius); padding: 11px; margin-bottom: 9px; box-shadow: var(--shadow); cursor: pointer; transition: box-shadow 0.12s, transform 0.12s; }
.kcard:hover { box-shadow: var(--shadow-lift); transform: translateY(-1px); }
.kcard[data-status="running"] { border-left-color: var(--running); }
.kcard[data-status="blocked"] { border-left-color: var(--blocked); }
.kcard[data-status="escalated"] { border-left-color: var(--escalated); }
.kcard[data-status="paused"] { border-left-color: var(--paused); }
.kcard[data-status="done"] { border-left-color: var(--done); }
.kcard-row1 { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.kcard-id { font-family: var(--mono); font-size: 10px; color: var(--text-mute); }
.kcard-proj { font-size: 9px; color: var(--sdd); background: #eff4ff; padding: 1px 7px; border-radius: 999px; margin-left: auto; }
.kcard[data-squad="discovery"] .kcard-proj { color: var(--discovery); background: #effcfa; }
.kcard-title { margin: 0 0 8px; font-size: 13px; font-weight: 600; line-height: 1.35; }
.kcard-why { font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 6px; margin-bottom: 8px; }
.why-blocked { color: #b91c1c; background: #fef2f2; }
.why-escalated { color: #7e22ce; background: #faf5ff; }
.why-paused, .why-audit { color: #b45309; background: #fffbeb; }
.kcard-phase { font-size: 10px; color: var(--text-dim); margin-bottom: 8px; }
.kcard-meta { display: flex; align-items: center; font-family: var(--mono); font-size: 10px; color: var(--text-mute); }
.kcard-time { margin-left: auto; }

/* ---- Tabela ---- */
.spec-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.spec-table th { text-align: left; background: var(--surface-soft); border-bottom: 1px solid var(--border); }
.spec-table th button { border: 0; background: transparent; font: inherit; font-weight: 700; color: var(--text-dim); cursor: pointer; padding: 9px 12px; width: 100%; text-align: left; }
.spec-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); }
.spec-table tbody tr { cursor: pointer; }
.spec-table tbody tr:hover { background: var(--surface-soft); }

/* ---- Status badge (reuso) ---- */
.status-badge { display: flex; gap: 6px; align-items: center; }
.status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.03em; }
.status-running { color: var(--running); background: color-mix(in srgb, var(--running) 14%, transparent); }
.status-paused { color: var(--paused); background: color-mix(in srgb, var(--paused) 16%, transparent); }
.status-blocked { color: var(--blocked); background: color-mix(in srgb, var(--blocked) 14%, transparent); }
.status-done { color: var(--done); background: color-mix(in srgb, var(--done) 16%, transparent); }
.status-escalated { color: var(--escalated); background: color-mix(in srgb, var(--escalated) 14%, transparent); }
.flag-audit { font-size: 11px; font-weight: 600; color: var(--audit); background: color-mix(in srgb, var(--audit) 16%, transparent); padding: 2px 8px; border-radius: 999px; }

/* ---- PhaseBar (reuso) ---- */
.phase-bar { list-style: none; display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 4px; padding: 0; }
.phase { font-size: 11px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--border); }
.phase-done { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.phase-current { color: var(--accent); border-color: #bfdbfe; background: #eff4ff; font-weight: 700; }
.phase-future { color: var(--text-mute); }

/* ---- Drawer ---- */
.drawer-overlay { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.28); display: flex; justify-content: flex-end; z-index: 30; }
.drawer { width: min(560px, 92vw); height: 100%; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--border); box-shadow: -12px 0 30px rgba(16, 24, 40, 0.12); padding: 18px 20px; }
.drawer-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.drawer-id { font-family: var(--mono); font-size: 12px; color: var(--text-mute); }
.drawer-proj { font-size: 11px; color: var(--accent); background: #eff4ff; padding: 2px 8px; border-radius: 999px; }
.drawer-close { margin-left: auto; border: 0; background: transparent; color: var(--text-mute); font-size: 18px; cursor: pointer; }
.drawer-close:hover { color: var(--text); }
.drawer-title { font-size: 20px; font-weight: 700; margin: 4px 0 14px; }
.drawer-why { font-size: 13px; font-weight: 600; padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; }
.drawer-section { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-mute); margin: 18px 0 8px; }
.drawer-tasks { list-style: none; margin: 0; padding: 0; }
.drawer-tasks li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border-soft); font-size: 13px; }
.drawer-tasks-empty { color: var(--text-mute); }
.task-state { color: var(--text-dim); }
.task-loops { margin-left: auto; font-size: 11px; color: #b45309; background: #fffbeb; padding: 2px 8px; border-radius: 999px; }
.drawer-cost { display: flex; align-items: baseline; gap: 10px; }
.drawer-cost-usd { font-family: var(--mono); font-size: 22px; font-weight: 700; }
.drawer-cost-tok { color: var(--text-mute); font-size: 13px; }
.cost-partial { color: var(--paused); font-weight: 600; font-size: 12px; }
.drawer-cost-report { margin-left: auto; font-size: 13px; }
.drawer-cost-breakdown { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 10px 0 0; font-size: 12px; color: var(--text-dim); }
.drawer-cost-breakdown div { display: flex; }
.drawer-cost-breakdown dt { margin: 0; }
.drawer-cost-breakdown dd { margin: 0 0 0 auto; color: #374151; font-weight: 600; }

/* ---- Timeline (reuso) ---- */
.timeline-notes { list-style: none; margin: 0; padding: 0; font-size: 12px; color: var(--text-dim); display: flex; flex-direction: column; gap: 5px; max-height: 200px; overflow-y: auto; }
.timeline-notes time { font-family: var(--mono); font-size: 10px; color: var(--text-mute); }
.timeline-notes b { color: var(--text); }
.timeline-docs { display: flex; gap: 8px; margin-top: 10px; }
.timeline-docs a { font-size: 13px; color: var(--accent); background: #eff4ff; padding: 6px 14px; border-radius: 8px; }

/* responsivo: colunas empilham em telas estreitas */
@media (max-width: 880px) {
  .kboard { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Verificação visual**

Run: `npm run dev` (sobe back+front). Abrir `http://127.0.0.1:5173` (porta do Vite).
Checar:
- Tema claro, sem preto puro.
- 3 colunas (Precisa de você / Em andamento / Pronto) com contagem.
- Cards com borda esquerda colorida por status; em atenção, o motivo aparece.
- Toggle Kanban/Tabela funciona; tabela ordena ao clicar nos cabeçalhos.
- Clicar num card abre o drawer da direita; ✕ ou clicar fora fecha.
- Filtro por projeto e busca funcionam; ocultar/mostrar projeto funciona.

- [ ] **Step 3: Commit**

```bash
git add web/src/app.css
git commit -m "feat(web): tema claro + estilos de kanban, tabela e drawer"
```

---

## Task 14: Verificação final

- [ ] **Step 1: Suíte completa**

Run: `npm test`
Expected: PASS — todos os testes (back + front), sem referências quebradas.

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build do Vite sem erro de TypeScript.

- [ ] **Step 3: Conferir o diff e o estado do git**

Run: `git status` e `git log --oneline -15`
Expected: working tree limpa; commits das Tasks 1–13 presentes.

---

## Notas de fechamento

- **Fora desta fase (Fase 2):** tarefa colapsável rica (lê `outputs/` + `dispatch-manifest.json`), `Task.dispatches[]` no store. A lista de tarefas do drawer é plana por enquanto.
- **Limites honestos:** sem $ por tarefa, sem diff colorido, sem decisão-por-finding (→ [ai-squad#43](https://github.com/gaabscps/ai-squad/issues/43)).
- **Backend:** intocado. Nenhuma mudança em `src/`.
- **Preferência visual:** light apenas; dark fora de escopo (e, se voltar, nunca preto puro).
```
