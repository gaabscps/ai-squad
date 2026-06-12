# Arquivamento de features `done` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Features `done` há mais de `archiveAfterDays` dias (default 7) somem do board/tabela e passam a aparecer só numa aba "Arquivadas".

**Architecture:** Arquivamento é 100% derivado — uma função pura `isArchived(spec, now, archiveAfterDays)`, calculada no front em render-time. O único estado novo é o campo de config `archiveAfterDays`, lido no back e empurrado ao front no payload WebSocket. Nada é escrito nos artefatos do ai-squad; espelha o padrão derivado do `columnForSpec`.

**Tech Stack:** Node + TypeScript (back), Vite + React (front), Vitest (testes). Comando de teste: `npx vitest run <arquivo>`.

**Spec:** `docs/specs/2026-06-03-arquivamento-features-design.md`

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `src/config.ts` | Lê/escreve `aios.config.json`; ganha `archiveAfterDays` | Modificar |
| `test/config.test.ts` | Testa config | Modificar |
| `src/ui/app.ts` | Servidor HTTP+WS; payload `snapshot` ganha `archiveAfterDays` | Modificar |
| `src/server.ts` | Cola config→servidor; passa `archiveAfterDays` | Modificar |
| `web/src/lib/kanban.ts` | Lógica pura do board; ganha `isArchived` | Modificar |
| `web/src/lib/kanban.test.ts` | Testa lógica pura | Modificar |
| `web/src/state/projects.tsx` | Estado/reducer; guarda `archiveAfterDays` | Modificar |
| `web/src/state/projects.test.tsx` | Testa reducer | Modificar |
| `web/src/state/useLiveProjects.ts` | WS client; lê `archiveAfterDays` do frame | Modificar |
| `web/src/components/TopBar.tsx` | Barra superior; aba "Arquivadas" | Modificar |
| `web/src/components/TopBar.test.tsx` | Testa TopBar | Modificar |
| `web/src/components/Board.tsx` | Orquestra; bifurca visível/arquivada por view | Modificar |
| `web/src/components/Board.test.tsx` | Testa Board | Modificar |

Sem arquivos novos: tudo encaixa nas peças existentes, seguindo os padrões `hide`/`columnForSpec`/`ViewMode` já presentes.

---

## Task 1: Config — campo `archiveAfterDays`

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Escreve os testes que falham**

Em `test/config.test.ts`, adicione dentro do `describe("loadConfig", ...)`:

```ts
  it("lê archiveAfterDays quando presente", () => {
    const p = tmpConfig(JSON.stringify({ archiveAfterDays: 14 }));
    expect(loadConfig(p).archiveAfterDays).toBe(14);
  });

  it("default archiveAfterDays = 7 quando ausente", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["/x"] }));
    expect(loadConfig(p).archiveAfterDays).toBe(7);
  });
```

E adicione dentro do `describe("saveHidden", ...)`:

```ts
  it("preserva archiveAfterDays após o save", () => {
    const p = tmpConfig(JSON.stringify({ roots: [], include: [], hide: [], archiveAfterDays: 14 }));
    saveHidden(p, ["/x/foo"]);
    expect(JSON.parse(readFileSync(p, "utf-8")).archiveAfterDays).toBe(14);
  });
```

Também ATUALIZE o teste existente "devolve defaults vazios quando o arquivo não existe", que vai quebrar porque o objeto agora tem um campo a mais:

```ts
  it("devolve defaults vazios quando o arquivo não existe", () => {
    const c = loadConfig(join(tmpdir(), "nao-existe-aios-xyz.json"));
    expect(c).toEqual({ roots: [], include: [], hide: [], archiveAfterDays: 7 });
  });
```

- [ ] **Step 2: Roda os testes pra ver falhar**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `archiveAfterDays` é `undefined` (não lido) e o `toEqual` não bate.

- [ ] **Step 3: Implementa**

Em `src/config.ts`:

```ts
export interface AiosConfig {
  roots: string[];
  include: string[];
  hide: string[];
  archiveAfterDays: number; // dias após concluir até a feature done sair do board
}

const DEFAULTS: AiosConfig = { roots: [], include: [], hide: [], archiveAfterDays: 7 };
```

No `loadConfig`, no objeto de retorno, adicione a última linha:

```ts
  return {
    roots: (raw.roots ?? []).map(expandTilde),
    include: (raw.include ?? []).map(expandTilde),
    hide: raw.hide ?? [],
    archiveAfterDays: raw.archiveAfterDays ?? 7,
  };
```

No `saveHidden`, o objeto `next` preserva o campo (espelha roots/include):

```ts
  const next: AiosConfig = {
    roots: current.roots ?? [],
    include: current.include ?? [],
    hide,
    archiveAfterDays: current.archiveAfterDays ?? 7,
  };
```

- [ ] **Step 4: Roda os testes pra ver passar**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (todos, incluindo o atualizado).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): campo archiveAfterDays (default 7)"
```

---

## Task 2: Payload WS leva `archiveAfterDays` ao front

**Files:**
- Modify: `src/ui/app.ts:29-32` (assinatura), `src/ui/app.ts:71-72` (snapshotMessage)
- Modify: `src/server.ts:34`
- Test: `test/server.test.ts`

- [ ] **Step 1: Escreve o teste que falha**

Veja o estilo atual em `test/server.test.ts` (como ele sobe o servidor e abre o WS). Adicione um teste que conecta e checa o campo no primeiro frame. Modelo (ajuste os helpers `startServer`/porta ao que o arquivo já usa):

```ts
import WebSocket from "ws";

it("primeiro frame snapshot inclui archiveAfterDays", async () => {
  // store fake com getSnapshot() => [] basta; o valor vem do parâmetro do createServer
  const server = createServer(fakeStore, () => {}, 14);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msg = await new Promise<any>((resolve) => {
    ws.on("message", (d) => resolve(JSON.parse(d.toString())));
  });
  expect(msg.type).toBe("snapshot");
  expect(msg.archiveAfterDays).toBe(14);
  ws.close();
  await new Promise<void>((r) => server.close(() => r()));
});
```

> Se `test/server.test.ts` já tem um helper que cria store+server, reuse-o e só passe `14` como terceiro argumento do `createServer`.

- [ ] **Step 2: Roda pra ver falhar**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — `createServer` aceita 2 args (erro de tipo/arity) e `msg.archiveAfterDays` é `undefined`.

- [ ] **Step 3: Implementa**

Em `src/ui/app.ts`, a assinatura e o `snapshotMessage`:

```ts
export function createServer(
  store: Store,
  onToggleHide: (id: string, hidden: boolean) => void,
  archiveAfterDays: number,
): Server {
```

```ts
  const snapshotMessage = () =>
    JSON.stringify({ type: "snapshot", projects: store.getSnapshot(), archiveAfterDays });
```

Em `src/server.ts:34`:

```ts
const server = createServer(store, toggleHide, config.archiveAfterDays);
```

> `archiveAfterDays` é lido uma vez na inicialização — mudá-lo em `aios.config.json` exige reiniciar o servidor, igual `roots`. Isso é intencional: o valor não muda via UI.

- [ ] **Step 4: Roda pra ver passar**

Run: `npx vitest run test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.ts src/server.ts test/server.test.ts
git commit -m "feat(server): payload snapshot leva archiveAfterDays ao front"
```

---

## Task 3: `isArchived` — a regra pura

**Files:**
- Modify: `web/src/lib/kanban.ts`
- Test: `web/src/lib/kanban.test.ts`

- [ ] **Step 1: Escreve os testes que falham**

Em `web/src/lib/kanban.test.ts`, importe `isArchived` no bloco de imports e adicione:

```ts
describe("isArchived", () => {
  // 2026-06-10T00:00:00Z em ms — "agora" fixo pros testes
  const NOW = Date.parse("2026-06-10T00:00:00Z");

  it("done + idade > limite → arquivada", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: "2026-06-01T00:00:00Z" }); // 9 dias
    expect(isArchived(spec, NOW, 7)).toBe(true);
  });

  it("done + idade < limite → não arquivada", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: "2026-06-06T00:00:00Z" }); // 4 dias
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });

  it("done + lastActivityAt null → não arquivada (idade desconhecida)", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: null });
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });

  it("status ≠ done → nunca arquiva, por mais velha que seja", () => {
    const spec = makeSpec({ status: "blocked", lastActivityAt: "2020-01-01T00:00:00Z" });
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });

  it("borda: idade exatamente no limite NÃO arquiva (> estrito)", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: "2026-06-03T00:00:00Z" }); // 7 dias exatos
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });
});
```

- [ ] **Step 2: Roda pra ver falhar**

Run: `npx vitest run web/src/lib/kanban.test.ts`
Expected: FAIL — `isArchived` não existe.

- [ ] **Step 3: Implementa**

No fim de `web/src/lib/kanban.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Feature arquivada = done E com data conhecida E parada há mais que o limite.
 * `now` entra por parâmetro (testável sem mexer no relógio); o componente passa
 * Date.now(). Sem data não dá pra medir idade → conservador, NÃO arquiva.
 * Limite é exclusivo: idade == limite ainda aparece.
 */
export function isArchived(spec: Spec, now: number, archiveAfterDays: number): boolean {
  if (spec.status !== "done") return false;
  if (spec.lastActivityAt == null) return false;
  const ageDays = (now - Date.parse(spec.lastActivityAt)) / DAY_MS;
  return ageDays > archiveAfterDays;
}
```

- [ ] **Step 4: Roda pra ver passar**

Run: `npx vitest run web/src/lib/kanban.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/kanban.ts web/src/lib/kanban.test.ts
git commit -m "feat(web): isArchived — regra pura de arquivamento por idade"
```

---

## Task 4: Estado do front guarda `archiveAfterDays`

**Files:**
- Modify: `web/src/state/projects.tsx`
- Modify: `web/src/state/useLiveProjects.ts:35-44`
- Test: `web/src/state/projects.test.tsx`

- [ ] **Step 1: Escreve os testes que falham**

Em `web/src/state/projects.test.tsx`:

```ts
  it("snapshot atualiza archiveAfterDays quando vem no frame", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7 };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [], archiveAfterDays: 14 });
    expect(s1.archiveAfterDays).toBe(14);
  });

  it("snapshot sem archiveAfterDays preserva o valor atual", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 14 };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [] });
    expect(s1.archiveAfterDays).toBe(14);
  });
```

> Os testes existentes desse arquivo montam `ProjectsState` sem `archiveAfterDays`. Adicione `archiveAfterDays: 7` aos literais `s0` deles para satisfazer o tipo.

- [ ] **Step 2: Roda pra ver falhar**

Run: `npx vitest run web/src/state/projects.test.tsx`
Expected: FAIL — `archiveAfterDays` não existe em `ProjectsState`/na action.

- [ ] **Step 3: Implementa**

Em `web/src/state/projects.tsx`:

```ts
export interface ProjectsState {
  projects: Project[];
  connected: boolean;
  archiveAfterDays: number;
}

export type ProjectsAction =
  | { type: "snapshot"; projects: Project[]; archiveAfterDays?: number }
  | { type: "connected"; connected: boolean };
```

No reducer, o caso `snapshot` (mantém o valor quando o frame não traz):

```ts
    case "snapshot":
      return {
        ...state,
        projects: action.projects,
        archiveAfterDays: action.archiveAfterDays ?? state.archiveAfterDays,
      };
```

`INITIAL` e o `useReducer` do Provider ganham o default:

```ts
const INITIAL: ProjectsState = { projects: [], connected: false, archiveAfterDays: 7 };
```

```ts
  const [state, dispatch] = useReducer(projectsReducer, {
    projects: initial ?? [],
    connected: false,
    archiveAfterDays: 7,
  });
```

Em `web/src/state/useLiveProjects.ts`, no `ws.onmessage`, repasse o campo:

```ts
          if (msg?.type === "snapshot" && Array.isArray(msg.projects)) {
            dispatchRef.current({
              type: "snapshot",
              projects: msg.projects,
              archiveAfterDays: msg.archiveAfterDays,
            });
          }
```

- [ ] **Step 4: Roda pra ver passar**

Run: `npx vitest run web/src/state/projects.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/state/projects.tsx web/src/state/useLiveProjects.ts web/src/state/projects.test.tsx
git commit -m "feat(web): estado guarda archiveAfterDays vindo do snapshot"
```

---

## Task 5: TopBar — aba "Arquivadas"

**Files:**
- Modify: `web/src/components/TopBar.tsx:6` (tipo) e `:37-52` (botões)
- Test: `web/src/components/TopBar.test.tsx`

- [ ] **Step 1: Escreve o teste que falha**

Em `web/src/components/TopBar.test.tsx`, adicione (ajuste props ao helper de render do arquivo):

```ts
  it("clicar em Arquivadas chama onView('archived')", async () => {
    const onView = vi.fn();
    render(
      <TopBar connected query="" onQuery={() => {}} view="kanban" onView={onView} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(onView).toHaveBeenCalledWith("archived");
  });
```

- [ ] **Step 2: Roda pra ver falhar**

Run: `npx vitest run web/src/components/TopBar.test.tsx`
Expected: FAIL — não existe botão "Arquivadas"; e `view="kanban"` já não casa o novo union até o tipo mudar.

- [ ] **Step 3: Implementa**

Em `web/src/components/TopBar.tsx`:

```ts
export type ViewMode = "kanban" | "table" | "archived";
```

Adicione um terceiro botão dentro da `<div className="seg">`, depois do botão "Tabela":

```tsx
        <button
          type="button"
          className={view === "archived" ? "on" : ""}
          onClick={() => onView("archived")}
        >
          Arquivadas
        </button>
```

- [ ] **Step 4: Roda pra ver passar**

Run: `npx vitest run web/src/components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TopBar.tsx web/src/components/TopBar.test.tsx
git commit -m "feat(web): aba Arquivadas no TopBar (ViewMode archived)"
```

---

## Task 6: Board — bifurca visível × arquivada por view

**Files:**
- Modify: `web/src/components/Board.tsx`
- Modify: `web/src/state/projects.tsx` (Provider aceita `archiveAfterDays` inicial pra testes)
- Test: `web/src/components/Board.test.tsx`

- [ ] **Step 1: Provider aceita valor inicial de archiveAfterDays**

Em `web/src/state/projects.tsx`, estenda o Provider (sem teste próprio — é só facilitador de teste do Board):

```tsx
export function ProjectsProvider({
  children,
  initial,
  initialArchiveAfterDays = 7,
}: {
  children: ReactNode;
  initial?: Project[];
  initialArchiveAfterDays?: number;
}) {
  const [state, dispatch] = useReducer(projectsReducer, {
    projects: initial ?? [],
    connected: false,
    archiveAfterDays: initialArchiveAfterDays,
  });
```

- [ ] **Step 2: Escreve os testes que falham**

Em `web/src/components/Board.test.tsx`. Primeiro, ajuste o helper `renderBoard` para aceitar `archiveAfterDays` e repassar ao Provider:

```tsx
function renderBoard(
  projects: Parameters<typeof makeProject>[0][] = [],
  onHide = vi.fn(),
  archiveAfterDays = 7,
) {
  const built = projects.map((p) => makeProject(p));
  return {
    onHide,
    ...render(
      <ProjectsProvider initial={built} initialArchiveAfterDays={archiveAfterDays}>
        <Board onHide={onHide} />
      </ProjectsProvider>,
    ),
  };
}
```

Depois, adicione os testes. Usam `vi.useFakeTimers`/`setSystemTime` pra cravar "agora" e tornar a idade determinística:

```tsx
import { beforeEach, afterEach } from "vitest";

describe("Board — arquivamento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const doneVelha = () =>
    makeSpec({ id: "FEAT-OLD", status: "done", lastActivityAt: "2026-06-01T00:00:00Z" }); // 9 dias
  const doneNova = () =>
    makeSpec({ id: "FEAT-NEW", status: "done", lastActivityAt: "2026-06-09T00:00:00Z" }); // 1 dia

  it("kanban esconde a done velha (arquivada)", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    expect(screen.queryByText("FEAT-OLD")).toBeNull();
    expect(screen.getByText("FEAT-NEW")).toBeInTheDocument(); // done nova ainda aparece
  });

  it("aba Arquivadas mostra só a done velha", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    await userEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText("FEAT-OLD")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-NEW")).toBeNull();
  });

  it("aba Arquivadas vazia mostra empty state", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneNova()] }]);
    await userEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText(/nenhuma feature arquivada/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Roda pra ver falhar**

Run: `npx vitest run web/src/components/Board.test.tsx`
Expected: FAIL — board ainda mostra FEAT-OLD; não há aba nem empty state.

- [ ] **Step 4: Implementa o Board**

Em `web/src/components/Board.tsx`:

1. Importe `isArchived`:

```ts
import { flattenSpecs, matchesQuery, isArchived, type SpecWithProject } from "../lib/kanban";
```

2. Leia `archiveAfterDays` do estado:

```ts
  const { projects, connected, archiveAfterDays } = useProjects();
```

3. Depois de calcular `visible`, separe por arquivamento e escolha o conjunto a exibir conforme a view:

```ts
  const now = Date.now();
  const shown = visible.filter((sp) =>
    view === "archived"
      ? isArchived(sp.spec, now, archiveAfterDays)
      : !isArchived(sp.spec, now, archiveAfterDays),
  );
```

4. No `<main>`, troque o bloco de render. `archived` e `table` usam a tabela; `kanban` usa o kanban; `archived` vazio mostra o empty state:

```tsx
      <main className="board-body">
        {view === "kanban" ? (
          <KanbanBoard items={shown} onSelect={handleSelect} />
        ) : view === "archived" && shown.length === 0 ? (
          <p className="empty-archived">Nenhuma feature arquivada.</p>
        ) : (
          <SpecTable items={shown} onSelect={handleSelect} />
        )}
      </main>
```

> `shown` substitui `visible` SÓ na renderização da lista/board. `selectedItem` continua resolvendo de `all` (o drawer abre qualquer spec, inclusive arquivada).

- [ ] **Step 5: Roda pra ver passar**

Run: `npx vitest run web/src/components/Board.test.tsx`
Expected: PASS (novos + os existentes, que usam specs `running` e não são afetados pelo filtro).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Board.tsx web/src/state/projects.tsx web/src/components/Board.test.tsx
git commit -m "feat(web): board exclui arquivadas; aba Arquivadas lista as done frias"
```

---

## Task 7: Verificação end-to-end

- [ ] **Step 1: Suíte inteira verde**

Run: `npm test`
Expected: PASS — toda a suíte, sem regressão.

- [ ] **Step 2: Build do front sem erro de tipo**

Run: `npm run build`
Expected: build conclui (o novo `ViewMode` e os campos de estado tipam corretamente).

- [ ] **Step 3: Sanidade visual (opcional, manual)**

Com `npm run dev`, abra o board: uma feature `done` com `last_activity_at` > 7 dias não aparece no kanban/tabela e aparece na aba "Arquivadas"; uma `done` recente continua no board.

---

## Self-Review

**Spec coverage:**
- Regra de arquivamento (status/idade/null/limite exclusivo) → Task 3 ✓
- `archiveAfterDays` configurável default 7 → Task 1 ✓
- Cálculo no front em render-time (`Date.now()`) → Task 6 step 4 (`now`) ✓
- `archiveAfterDays` no payload WS → Task 2 ✓; recebido no estado → Task 4 ✓
- Aba "Arquivadas" como terceiro ViewMode → Task 5 ✓
- Board exclui arquivadas / aba mostra só elas → Task 6 ✓
- Tabela (não kanban), ordenada por atividade desc → Task 6 usa `SpecTable`, que já ordena por `activity` desc por default ✓
- Empty state → Task 6 ✓
- Filtros/busca/drawer continuam → Task 6 step 4 preserva `all`/`ProjectFilter`/`query` ✓
- Zero escrita em `.agent-session/` → nenhuma task escreve lá ✓

**Placeholders:** nenhum — todo step de código tem o código real.

**Type consistency:** `isArchived(spec, now, archiveAfterDays)` com a mesma assinatura na Task 3 (def), Task 6 (uso). `archiveAfterDays: number` consistente em `AiosConfig` (T1), payload (T2), `ProjectsState`/action (T4), uso no Board (T6). `ViewMode` union `"kanban"|"table"|"archived"` em T5, consumido em T6.
