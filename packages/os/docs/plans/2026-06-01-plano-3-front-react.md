# Plano 3 — Front React (Vite) que consome o servidor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um board React (Vite) que mostra ao vivo os Projects→Specs→Tasks que o servidor (Plano 2) empurra por WebSocket — cards por spec agrupados/filtráveis por projeto, barra de fases, status colorido + flags, tokens/$ agregados com link pro report, e timeline com links pros `.md` — cobrindo SDD e Discovery, 100% read-only, sem nunca recalcular custo.

**Architecture:** O front vive em `web/` no mesmo `package.json` do backend e reusa os tipos do contrato (`src/store/types.ts`) via `import type`. O estado é um único `Project[]` num `useReducer` distribuído por Context — o WebSocket empurra o snapshot inteiro e o front só troca o array (sem merge). Um hook `useLiveProjects` abre o WS, despacha cada snapshot e reconecta com backoff. Componentes folha (`CostTag`, `StatusBadge`, `PhaseBar`, `Timeline`) compõem o `SpecCard`, que o `Board` agrupa por projeto. Uma rota nova de backend `GET /file` serve, read-only e restrita às pastas conhecidas, o `report.html` e os `.md` que os links apontam; o Express também passa a servir o build do Vite (mesma origem em uso real).

**Tech Stack:** Vite + React 18 + TypeScript, `@vitejs/plugin-react`, Vitest + Testing Library + jsdom (testes de componente), proxy do Vite em dev. Backend já existente: Express + `ws` (Plano 2).

**Decisões travadas antes de planejar (brainstorming 2026-06-01):**

| Decisão | Escolha | Alternativa rejeitada / porquê |
|---|---|---|
| Estado/data-fetching | `useReducer` + Context, sem lib | Zustand / React Query — o WS empurra o `Project[]` inteiro; não há merge nem request para cachear (YAGNI) |
| Primeiro load | frame do WS na conexão (servidor já envia no connect) | `fetch` no mount — segundo caminho pro mesmo snapshot; duplica a fonte sem ganho |
| Transporte | caminhos relativos: proxy do Vite em dev, Express serve o build em uso real | URL absoluta + CORS — hardcoda porta no front, acopla e exige desligar CORS |
| Conexão WS | hook `useLiveProjects` próprio, reconnect + backoff | `react-use-websocket` — dep para ~40 linhas; foge do padrão sem-lib |
| Empacotamento | mesmo `package.json`, front em `web/`, tipos via `import type` de `src/store/types.ts` | workspace npm separado — cerimônia para single-user |
| Testes | Vitest + Testing Library + jsdom | só-lógica (perde regressão de render) / Playwright (pesado, camada posterior) |
| Links de arquivo | rota `GET /file` read-only, validada contra os `project.path` do snapshot | só `report.html` (descumpre §6) / texto copiável (atrito) |

**Referência:** design em `docs/specs/2026-06-01-aios-observer-design.md` (§3 modelo Project→Spec→Task, §5 invariante de custo, §6 recorte do MVP); contrato do servidor em `docs/plans/2026-06-01-plano-2-servidor-tempo-real.md` (porta 4717, `GET /api/projects`, WS `/ws` com `{type:"snapshot",projects}` e comandos `{type:"hide"|"unhide",id}`).

---

### Task 0: Bootstrap do front (Vite + React + Vitest/jsdom)

Adiciona as deps de front no `package.json` existente, configura o Vite (root `web/`, proxy pro 4717, build pra `dist/web`), ensina o tsc e o Vitest sobre JSX/DOM/jsdom, e prova o pipeline de teste com um render mínimo descartável.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Create: `vite.config.ts`
- Create: `vitest.setup.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/__pipeline__.test.tsx` (descartável — prova jsdom+RTL, removido no fim da task)

- [ ] **Step 1: Acrescentar as deps de front e os scripts `dev`/`build` no `package.json`**

```json
{
  "name": "ai-squad-os",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dump": "tsx src/cli.ts",
    "serve": "tsx src/server.ts",
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "express": "^4.21.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "ws": "^8.18.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@types/ws": "^8.5.12",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

> **Por que essas libs:** `@vitejs/plugin-react` ensina o Vite/Vitest a transformar JSX. `@testing-library/react` renderiza componentes e busca por texto/papel (role) como o usuário vê, não por classe CSS. `jsdom` é um DOM falso em memória — deixa renderizar React sem abrir navegador. `@testing-library/jest-dom` adiciona asserções de DOM (`toBeInTheDocument`, `toHaveTextContent`). `vite` aqui é dependência direta porque os scripts `dev`/`build` o chamam.

- [ ] **Step 2: Instalar**

Run: `cd ~/Developer/ai-squad-os && npm install`
Expected: instala react, vite, testing-library, jsdom e os `@types/*` sem erro; atualiza `package-lock.json`.

- [ ] **Step 3: Criar `vite.config.ts` (root `web/`, proxy, build)**

`vite.config.ts` (na raiz do repo):

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O front mora em web/; o build sai pra dist/web, que o Express serve em uso real.
// Em dev, o proxy encaminha /api, /ws e /file pro backend (porta 4717) — assim o
// front usa SEMPRE caminhos relativos e nunca hardcoda porta nem precisa de CORS.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:4717", changeOrigin: true },
      "/file": { target: "http://127.0.0.1:4717", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4717", ws: true },
    },
    // o front importa SÓ tipos de ../src (type-only, sumem no build); liberar o
    // fs pro pai deixa o dev server resolver esses imports sem reclamar.
    fs: { allow: [".."] },
  },
});
```

- [ ] **Step 4: Ensinar o `tsconfig.json` sobre JSX, DOM e a pasta `web`**

`tsconfig.json` (substituir o conteúdo inteiro):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test", "web", "vitest.setup.ts"]
}
```

> O backend ganha as libs `DOM` no type-check, mas não as usa — inofensivo. `jsx: "react-jsx"` liga o JSX automático (não precisa `import React` em cada arquivo).

- [ ] **Step 5: Criar o setup global do Vitest (só os matchers de DOM)**

`vitest.setup.ts` (na raiz):

```typescript
// Registra os matchers de DOM (toBeInTheDocument, etc.). Só estende o expect —
// seguro de importar mesmo nos testes de backend (ambiente node), pois os
// matchers só rodam quando chamados, dentro dos testes jsdom.
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: Apontar o Vitest pro jsdom só na pasta `web/` e ligar o plugin react**

`vitest.config.ts` (substituir o conteúdo inteiro):

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node", // backend continua em node...
    environmentMatchGlobs: [["web/**", "jsdom"]], // ...e o front roda em jsdom
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 7: Criar o HTML e o entrypoint do front**

`web/index.html`:

```html
<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ai-squad-os</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

> `App` ainda não existe — será criado na Task 7. Por isso o `npm run dev` só sobe de fato ao fim do plano; aqui validamos o pipeline de teste, não a tela.

- [ ] **Step 8: Provar o pipeline jsdom+RTL com um render descartável**

`web/src/__pipeline__.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("pipeline jsdom + RTL", () => {
  it("renderiza e encontra texto no DOM falso", () => {
    render(<div>aios pipeline ok</div>);
    expect(screen.getByText("aios pipeline ok")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Rodar só esse teste pra confirmar o pipeline**

Run: `npx vitest run web/src/__pipeline__.test.tsx`
Expected: PASS (1 teste) — prova que jsdom, o plugin react e os matchers do jest-dom estão de pé.

- [ ] **Step 10: Remover o teste descartável e confirmar a suíte do backend verde**

```bash
rm web/src/__pipeline__.test.tsx
```

Run: `npm test`
Expected: PASS — os testes de `cost`/`session`/`discovery`/`store`/`server`/etc. (Planos 1-2) continuam passando; nada de código de produção mudou.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts vitest.setup.ts web/index.html web/src/main.tsx
git commit -m "chore: bootstrap front (vite+react+rtl/jsdom, proxy, build dist/web)"
```

---

### Task 1: Backend — rota `GET /file` (read-only) + servir o build do Vite

Os links do card (`report.html` e `.md`) precisam de uma rota que sirva esses arquivos. Ela valida o `?path=` contra os `project.path` que o Store conhece — só serve o que está **dentro** de um projeto do board (sem path-traversal pra `/etc/...`). É leitura pura: preserva o invariante read-only do §6. Na mesma passada, o Express passa a servir o `dist/web` (o build do Vite), fechando o transporte "mesma origem em uso real".

**Files:**
- Modify: `src/ui/app.ts`
- Create: `test/fixtures/workspace/projeto-a/.agent-session/FEAT-099/report.html`
- Create: `test/file-route.test.ts`

- [ ] **Step 1: Criar um arquivo real pra servir no fixture de workspace**

`test/fixtures/workspace/projeto-a/.agent-session/FEAT-099/report.html`:

```html
<!doctype html><html><body><h1>report fake do FEAT-099</h1></body></html>
```

- [ ] **Step 2: Escrever o teste que falha**

`test/file-route.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store/store.js";
import { createServer } from "../src/ui/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

function startedStore() {
  const store = new Store(() => ({ roots: [workspace] }));
  store.rebuild();
  return store;
}

async function listen(server: import("node:http").Server) {
  await new Promise<void>((r) => server.listen(0, r));
  return (server.address() as AddressInfo).port;
}

describe("GET /file", () => {
  it("serve um arquivo dentro de um projeto conhecido (200)", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const abs = join(workspace, "projeto-a/.agent-session/FEAT-099/report.html");

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(abs)}`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("report fake do FEAT-099");

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejeita path fora das pastas conhecidas (403)", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const fora = join(here, "..", "package.json"); // existe, mas fora do workspace

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(fora)}`);
    expect(res.status).toBe(403);

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("404 quando o arquivo não existe dentro da pasta conhecida", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const inexistente = join(workspace, "projeto-a/.agent-session/FEAT-099/nao-existe.md");

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(inexistente)}`);
    expect(res.status).toBe(404);

    await new Promise<void>((r) => server.close(() => r()));
  });
});
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/file-route.test.ts`
Expected: FAIL — não há rota `/file` (recebe 404 de SPA fallback ou o handler de texto do `/`, não os status esperados).

- [ ] **Step 4: Reescrever `src/ui/app.ts` com a rota `/file` e o serving do build**

`src/ui/app.ts` (substituir o conteúdo inteiro):

```typescript
import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { Store } from "../store/store.js";

// pasta do build do Vite (npm run build → dist/web); em dev pode não existir.
const FRONT_DIR = join(process.cwd(), "dist", "web");

/** target está DENTRO de root (ou é a própria root)? Sem string-prefix frágil. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Monta o servidor HTTP + WebSocket sobre um Store pronto.
 * - GET /api/projects: snapshot atual (contrato HTTP; primeiro load via curl/debug).
 * - GET /file?path=<abs>: serve report.html/.md READ-ONLY, só se o path estiver
 *   dentro de um project.path conhecido (anti path-traversal). Cumpre o §6.
 * - WS em /ws: empurra { type: "snapshot", projects } ao conectar e a cada
 *   'changed' do Store; recebe { type: "hide"|"unhide", id } e delega a onToggleHide.
 * - resto: serve o build do Vite (dist/web) com fallback de SPA pro index.html.
 * Devolve o http.Server SEM dar listen — quem chama escolhe a porta.
 */
export function createServer(
  store: Store,
  onToggleHide: (id: string, hidden: boolean) => void,
): Server {
  const app = express();

  app.get("/api/projects", (_req, res) => {
    res.json(store.getSnapshot());
  });

  app.get("/file", (req, res) => {
    const requested = req.query.path;
    if (typeof requested !== "string") {
      res.status(400).send("path obrigatório");
      return;
    }
    const target = resolve(requested);
    // só serve arquivos dentro de um projeto que o board conhece
    const known = store.getSnapshot().map((p) => p.path);
    if (!known.some((root) => isInside(root, target))) {
      res.status(403).send("fora das pastas conhecidas");
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.status(404).send("arquivo não encontrado");
      return;
    }
    if (target.endsWith(".md")) res.type("text/plain"); // .md como texto, não download
    res.sendFile(target);
  });

  // build do Vite (estático) + fallback de SPA. Em dev (sem build) cai no else.
  app.use(express.static(FRONT_DIR));
  app.get("*", (_req, res, next) => {
    const index = join(FRONT_DIR, "index.html");
    if (existsSync(index)) res.sendFile(index);
    else res.type("text").send("ai-squad-os server up (front não buildado — rode npm run build, ou use o Vite em dev)");
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const snapshotMessage = () =>
    JSON.stringify({ type: "snapshot", projects: store.getSnapshot() });

  wss.on("connection", (socket) => {
    // Envia no próximo tick (não no mesmo tick do 'connection'): garante que o
    // socket terminou de inicializar e que o consumidor já registrou seu listener
    // antes do primeiro frame chegar. Entrega mais previsível; custo ~0 (app local).
    setTimeout(() => socket.send(snapshotMessage()), 0);
    socket.on("message", (raw) => {
      let msg: { type?: string; id?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // mensagem inválida: ignora
      }
      if (typeof msg.id !== "string") return;
      if (msg.type === "hide") onToggleHide(msg.id, true);
      else if (msg.type === "unhide") onToggleHide(msg.id, false);
    });
  });

  // o Store é a fonte; quando ele muda, todo cliente conectado recebe o novo snapshot.
  const onChanged = (): void => {
    const data = snapshotMessage();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };
  store.on("changed", onChanged);
  // remove o listener ao fechar — createServer pode ser chamado de novo sobre o mesmo Store
  server.on("close", () => store.removeListener("changed", onChanged));

  return server;
}
```

> O `app.get("*")` (fallback de SPA) vem **depois** de `/api/projects`, `/file` e do estático, então essas rotas têm precedência; o `*` só pega o que sobra (ex.: `/`, `/qualquer-rota-do-front`). O upgrade do WebSocket em `/ws` é interceptado pelo `ws` antes do Express.

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/file-route.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Confirmar que os testes de servidor do Plano 2 não quebraram**

Run: `npx vitest run test/server.test.ts`
Expected: PASS — `GET /api/projects`, push de snapshot e comando `hide` seguem iguais (a assinatura `createServer(store, onToggleHide)` não mudou).

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.ts test/fixtures/workspace/projeto-a/.agent-session/FEAT-099/report.html test/file-route.test.ts
git commit -m "feat: rota GET /file read-only (anti path-traversal) + Express serve o build do Vite"
```

---

### Task 2: Estado do front — reducer (snapshot inteiro) + Context + Provider

A peça de estado. O reducer é trivial de propósito: a ação `snapshot` **substitui** o array inteiro (o WS manda tudo pronto — não há merge). Um Context distribui o estado e o `dispatch` pros componentes. Também cria o `test-utils.tsx` com fábricas de `Project`/`Spec` que as próximas tasks reusam (DRY nos testes).

**Files:**
- Create: `web/src/state/projects.tsx`
- Create: `web/src/test-utils.tsx`
- Create: `web/src/state/projects.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

`web/src/state/projects.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { projectsReducer, type ProjectsState } from "./projects";
import { makeProject } from "../test-utils";

describe("projectsReducer", () => {
  it("snapshot substitui o array de projects por inteiro", () => {
    const s0: ProjectsState = { projects: [makeProject({ id: "antigo" })], connected: true };
    const s1 = projectsReducer(s0, {
      type: "snapshot",
      projects: [makeProject({ id: "novo-1" }), makeProject({ id: "novo-2" })],
    });
    expect(s1.projects.map((p) => p.id)).toEqual(["novo-1", "novo-2"]);
    expect(s1.connected).toBe(true); // snapshot não mexe na flag de conexão
  });

  it("connected atualiza só a flag de conexão", () => {
    const s0: ProjectsState = { projects: [makeProject()], connected: false };
    const s1 = projectsReducer(s0, { type: "connected", connected: true });
    expect(s1.connected).toBe(true);
    expect(s1.projects).toBe(s0.projects); // não recria os projects à toa
  });
});
```

- [ ] **Step 2: Criar as fábricas de teste `web/src/test-utils.tsx`**

```tsx
import type { Project, Spec, CostRollup } from "../../src/store/types";

export function makeCost(over: Partial<CostRollup> = {}): CostRollup {
  return {
    totalCostUsd: 0.5,
    partial: false,
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 },
    totalTokens: 1350,
    reportPath: null,
    ...over,
  };
}

export function makeSpec(over: Partial<Spec> = {}): Spec {
  return {
    id: "FEAT-001",
    squad: "sdd",
    title: "exemplo",
    phase: "implementation",
    plannedPhases: ["specify", "plan", "tasks", "implementation"],
    status: "running",
    tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: "2026-05-20T10:00:00Z",
    timeline: [],
    cost: makeCost(),
    ...over,
  };
}

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: "proj-abc", path: "/x/proj", name: "proj", specs: [], hidden: false, ...over };
}
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `npx vitest run web/src/state/projects.test.tsx`
Expected: FAIL — `./projects` não existe (erro de import).

- [ ] **Step 4: Implementar `web/src/state/projects.tsx`**

```tsx
import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { Project } from "../../../src/store/types";

export interface ProjectsState {
  projects: Project[];
  connected: boolean;
}

export type ProjectsAction =
  | { type: "snapshot"; projects: Project[] }
  | { type: "connected"; connected: boolean };

/**
 * O WS empurra o Project[] INTEIRO a cada mudança; por isso 'snapshot' só troca
 * o array (sem merge). 'connected' reflete o estado da conexão (pra UI mostrar
 * "ao vivo" / "reconectando"). Reducer puro — fácil de testar isolado.
 */
export function projectsReducer(
  state: ProjectsState,
  action: ProjectsAction,
): ProjectsState {
  switch (action.type) {
    case "snapshot":
      return { ...state, projects: action.projects };
    case "connected":
      return { ...state, connected: action.connected };
    default:
      return state;
  }
}

const INITIAL: ProjectsState = { projects: [], connected: false };

const StateCtx = createContext<ProjectsState>(INITIAL);
const DispatchCtx = createContext<Dispatch<ProjectsAction>>(() => {});

export function ProjectsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Project[];
}) {
  const [state, dispatch] = useReducer(projectsReducer, {
    projects: initial ?? [],
    connected: false,
  });
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export const useProjects = (): ProjectsState => useContext(StateCtx);
export const useProjectsDispatch = (): Dispatch<ProjectsAction> => useContext(DispatchCtx);
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `npx vitest run web/src/state/projects.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add web/src/state/projects.tsx web/src/test-utils.tsx web/src/state/projects.test.tsx
git commit -m "feat: estado do front (reducer snapshot-inteiro + Context + Provider)"
```

---

### Task 3: Hook `useLiveProjects` — WS + reconnect com backoff

Abre o WebSocket em `/ws` (caminho relativo: o proxy resolve em dev, mesma origem em uso real), despacha cada `snapshot`, marca `connected`, e **reconecta com backoff** (1s, 2s, 4s… teto 10s) quando a conexão cai — ex.: você reinicia o `npm run serve` e o board volta sozinho. Devolve `toggleHide` pra o board mandar `hide`/`unhide` pelo mesmo socket.

**Files:**
- Create: `web/src/state/useLiveProjects.ts`
- Create: `web/src/state/useLiveProjects.test.tsx`

- [ ] **Step 1: Escrever o teste que falha (com WebSocket fake e timers falsos)**

`web/src/state/useLiveProjects.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ProjectsProvider, useProjects } from "./projects";
import { useLiveProjects } from "./useLiveProjects";
import { makeProject } from "../test-utils";

// WebSocket falso e controlável: o teste dispara open/message/close na mão.
class FakeWS {
  static last: FakeWS | null = null;
  static instances = 0;
  static OPEN = 1;
  static CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWS.last = this;
    FakeWS.instances++;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.();
  }
  _open() {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  _message(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function Probe() {
  useLiveProjects();
  const { projects, connected } = useProjects();
  return <div data-testid="probe">{connected ? "up" : "down"}:{projects.length}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWS.last = null;
  FakeWS.instances = 0;
});

describe("useLiveProjects", () => {
  it("conecta e despacha o snapshot recebido", () => {
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    render(
      <ProjectsProvider>
        <Probe />
      </ProjectsProvider>,
    );
    act(() => FakeWS.last!._open());
    act(() =>
      FakeWS.last!._message({
        type: "snapshot",
        projects: [makeProject({ id: "p1" }), makeProject({ id: "p2" })],
      }),
    );
    expect(screen.getByTestId("probe").textContent).toBe("up:2");
  });

  it("reconecta após a conexão cair (backoff)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    render(
      <ProjectsProvider>
        <Probe />
      </ProjectsProvider>,
    );
    act(() => FakeWS.last!._open());
    expect(FakeWS.instances).toBe(1);

    act(() => FakeWS.last!.close()); // conexão cai
    expect(screen.getByTestId("probe").textContent).toBe("down:0");

    act(() => {
      vi.advanceTimersByTime(1000); // backoff de 1s → tenta de novo
    });
    expect(FakeWS.instances).toBe(2); // reconectou sozinho
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run web/src/state/useLiveProjects.test.tsx`
Expected: FAIL — `./useLiveProjects` não existe.

- [ ] **Step 3: Implementar `web/src/state/useLiveProjects.ts`**

```typescript
import { useCallback, useEffect, useRef } from "react";
import { useProjectsDispatch } from "./projects";

/**
 * Conecta ao WS /ws (caminho relativo), despacha cada snapshot, marca connected,
 * e reconecta com backoff (1s,2s,4s… teto 10s) quando cai — ex.: você reinicia o
 * `npm run serve` e o board volta sozinho, sem F5. Devolve toggleHide pra o board
 * mandar hide/unhide pelo mesmo socket. Sem lib, coerente com o estado sem-lib.
 */
export function useLiveProjects(): {
  toggleHide: (id: string, hidden: boolean) => void;
} {
  const dispatch = useProjectsDispatch();
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const wsUrl = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      return `${proto}://${location.host}/ws`;
    };

    const connect = (): void => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatchRef.current({ type: "connected", connected: true });
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "snapshot" && Array.isArray(msg.projects)) {
            dispatchRef.current({ type: "snapshot", projects: msg.projects });
          }
        } catch {
          /* frame inválido: ignora */
        }
      };
      ws.onclose = () => {
        dispatchRef.current({ type: "connected", connected: false });
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempt, 10000); // backoff com teto
        attempt++;
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true; // evita reconectar depois do unmount
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const toggleHide = useCallback((id: string, hidden: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: hidden ? "hide" : "unhide", id }));
    }
  }, []);

  return { toggleHide };
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run web/src/state/useLiveProjects.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/useLiveProjects.ts web/src/state/useLiveProjects.test.tsx
git commit -m "feat: hook useLiveProjects (WS + reconnect com backoff + toggleHide)"
```

---

### Task 4: `format.ts` + `CostTag` — o invariante de custo no front

O `format.ts` formata tokens compactos e `$` — espelhando o report, **nunca recalculando**. O `CostTag` exibe SÓ o que veio no `CostRollup` (§5): `totalCostUsd` null vira `—`; `partial` marca "$ parcial"; `reportPath` vira um link pra rota `/file`. Não soma, não multiplica, não estima nada.

**Files:**
- Create: `web/src/format.ts`
- Create: `web/src/format.test.ts`
- Create: `web/src/components/CostTag.tsx`
- Create: `web/src/components/CostTag.test.tsx`

- [ ] **Step 1: Escrever o teste do `format.ts` que falha**

`web/src/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fmtTokens, fmtUsd } from "./format";

describe("fmtTokens", () => {
  it("milhões com 1 casa", () => {
    expect(fmtTokens(1_400_000)).toBe("1.4M");
  });
  it("milhares arredondados com K", () => {
    expect(fmtTokens(775_000)).toBe("775K");
  });
  it("abaixo de mil, número cru", () => {
    expect(fmtTokens(350)).toBe("350");
  });
});

describe("fmtUsd", () => {
  it("2 casas com prefixo", () => {
    expect(fmtUsd(0.5)).toBe("US$ 0.50");
  });
  it("null vira travessão", () => {
    expect(fmtUsd(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/format.test.ts`
Expected: FAIL — `./format` não existe.

- [ ] **Step 3: Implementar `web/src/format.ts`**

```typescript
/**
 * Formata tokens compactos: 1_400_000 → "1.4M", 775_000 → "775K", 350 → "350".
 * Espelha o fmt_tokens do report do ai-squad. NÃO recalcula nada — só formata
 * um número que já existe no CostRollup.
 */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Formata $ com 2 casas; null (sem dados de custo) vira "—". */
export function fmtUsd(v: number | null): string {
  return v === null ? "—" : `US$ ${v.toFixed(2)}`;
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/format.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Escrever o teste do `CostTag` que falha**

`web/src/components/CostTag.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostTag } from "./CostTag";
import { makeCost } from "../test-utils";

describe("CostTag", () => {
  it("mostra $ e tokens quando há dados", () => {
    render(<CostTag cost={makeCost({ totalCostUsd: 0.5, totalTokens: 1_400_000 })} />);
    expect(screen.getByText("US$ 0.50")).toBeInTheDocument();
    expect(screen.getByText("1.4M tok")).toBeInTheDocument();
  });

  it("sem dados de custo, mostra — e nenhum link de report", () => {
    render(<CostTag cost={makeCost({ totalCostUsd: null, reportPath: null })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "report" })).toBeNull();
  });

  it("marca '$ parcial' quando partial é true", () => {
    render(<CostTag cost={makeCost({ partial: true })} />);
    expect(screen.getByText("$ parcial")).toBeInTheDocument();
  });

  it("linka o report.html pela rota /file quando há reportPath", () => {
    render(<CostTag cost={makeCost({ reportPath: "/x/proj/.agent-session/FEAT-1/report.html" })} />);
    const link = screen.getByRole("link", { name: "report" });
    expect(link).toHaveAttribute(
      "href",
      "/file?path=" + encodeURIComponent("/x/proj/.agent-session/FEAT-1/report.html"),
    );
  });
});
```

- [ ] **Step 6: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/CostTag.test.tsx`
Expected: FAIL — `./CostTag` não existe.

- [ ] **Step 7: Implementar `web/src/components/CostTag.tsx`**

```tsx
import type { CostRollup } from "../../../src/store/types";
import { fmtTokens, fmtUsd } from "../format";

/**
 * Exibe SÓ o que veio no CostRollup (invariante §5): nunca soma, multiplica nem
 * estima. totalCostUsd null → "—"; partial → marca "$ parcial"; reportPath → link
 * que abre o report.html servido pela rota /file. O número já vem somado do Store.
 */
export function CostTag({ cost }: { cost: CostRollup }) {
  return (
    <div className="cost-tag">
      <span className="cost-usd">{fmtUsd(cost.totalCostUsd)}</span>
      {cost.partial && (
        <span className="cost-partial" title="modelo sem preço — soma parcial">
          $ parcial
        </span>
      )}
      <span className="cost-tokens">{fmtTokens(cost.totalTokens)} tok</span>
      {cost.reportPath && (
        <a
          className="cost-report"
          href={`/file?path=${encodeURIComponent(cost.reportPath)}`}
          target="_blank"
          rel="noreferrer"
        >
          report
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/CostTag.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 9: Commit**

```bash
git add web/src/format.ts web/src/format.test.ts web/src/components/CostTag.tsx web/src/components/CostTag.test.tsx
git commit -m "feat: format + CostTag (invariante de custo: —/parcial/link, nunca recalcula)"
```

---

### Task 5: `StatusBadge` + `PhaseBar` — status colorido, flags e fases

O `StatusBadge` mostra o status (com classe de cor) e a flag `audit_exception`. O `PhaseBar` desenha `plannedPhases` na ordem, marcando cada fase como feita/atual/futura conforme a posição de `phase` — e quando o status é `done`, todas viram feitas. SDD e Discovery usam os mesmos componentes: os rótulos das fases vêm de `plannedPhases`, então o squad não muda a forma.

**Files:**
- Create: `web/src/components/StatusBadge.tsx`
- Create: `web/src/components/StatusBadge.test.tsx`
- Create: `web/src/components/PhaseBar.tsx`
- Create: `web/src/components/PhaseBar.test.tsx`

- [ ] **Step 1: Escrever o teste do `StatusBadge` que falha**

`web/src/components/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { makeSpec } from "../test-utils";

describe("StatusBadge", () => {
  it("mostra o rótulo do status e a classe de cor", () => {
    render(<StatusBadge spec={makeSpec({ status: "blocked" })} />);
    const badge = screen.getByText("bloqueado");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("status-blocked");
  });

  it("mostra a flag de audit_exception quando ligada", () => {
    render(
      <StatusBadge
        spec={makeSpec({ health: { pendingHuman: 0, escalationRate: 0, auditException: true } })}
      />,
    );
    expect(screen.getByText("⚠ audit")).toBeInTheDocument();
  });

  it("sem audit_exception, não mostra a flag", () => {
    render(<StatusBadge spec={makeSpec()} />);
    expect(screen.queryByText("⚠ audit")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/StatusBadge.test.tsx`
Expected: FAIL — `./StatusBadge` não existe.

- [ ] **Step 3: Implementar `web/src/components/StatusBadge.tsx`**

```tsx
import type { Spec } from "../../../src/store/types";

const STATUS_LABEL: Record<Spec["status"], string> = {
  running: "rodando",
  paused: "pausado",
  blocked: "bloqueado",
  done: "concluído",
  escalated: "escalado",
};

/**
 * Status colorido (a cor vem da classe status-<status> no CSS) + flag de
 * audit_exception, que pode coexistir com qualquer status. blocked/paused já
 * são status próprios; audit é a flag extra do §6.
 */
export function StatusBadge({ spec }: { spec: Spec }) {
  return (
    <div className="status-badge">
      <span className={`status status-${spec.status}`}>{STATUS_LABEL[spec.status]}</span>
      {spec.health.auditException && (
        <span className="flag flag-audit" title="exceção de auditoria">
          ⚠ audit
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/StatusBadge.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 5: Escrever o teste do `PhaseBar` que falha**

`web/src/components/PhaseBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseBar } from "./PhaseBar";
import { makeSpec } from "../test-utils";

describe("PhaseBar", () => {
  it("marca feita/atual/futura conforme a posição de phase", () => {
    render(
      <PhaseBar
        spec={makeSpec({
          status: "running",
          phase: "tasks",
          plannedPhases: ["specify", "plan", "tasks", "implementation"],
        })}
      />,
    );
    expect(screen.getByText("specify")).toHaveClass("phase-done");
    expect(screen.getByText("plan")).toHaveClass("phase-done");
    expect(screen.getByText("tasks")).toHaveClass("phase-current");
    expect(screen.getByText("implementation")).toHaveClass("phase-future");
  });

  it("status done marca todas as fases como feitas", () => {
    render(
      <PhaseBar
        spec={makeSpec({ status: "done", phase: "done", plannedPhases: ["specify", "implementation"] })}
      />,
    );
    expect(screen.getByText("specify")).toHaveClass("phase-done");
    expect(screen.getByText("implementation")).toHaveClass("phase-done");
  });

  it("usa os rótulos de plannedPhases (serve Discovery também)", () => {
    render(
      <PhaseBar
        spec={makeSpec({
          squad: "discovery",
          phase: "investigate",
          plannedPhases: ["frame", "investigate", "decide"],
        })}
      />,
    );
    expect(screen.getByText("frame")).toBeInTheDocument();
    expect(screen.getByText("investigate")).toHaveClass("phase-current");
    expect(screen.getByText("decide")).toHaveClass("phase-future");
  });
});
```

- [ ] **Step 6: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/PhaseBar.test.tsx`
Expected: FAIL — `./PhaseBar` não existe.

- [ ] **Step 7: Implementar `web/src/components/PhaseBar.tsx`**

```tsx
import type { Spec } from "../../../src/store/types";

/**
 * Barra de fases: plannedPhases na ordem, cada uma feita/atual/futura conforme a
 * posição de `phase`. status done marca todas feitas. Os rótulos vêm de
 * plannedPhases, então Discovery (frame/investigate/decide) e SDD
 * (specify/plan/tasks/implementation) usam o MESMO componente — só os rótulos mudam.
 */
export function PhaseBar({ spec }: { spec: Spec }) {
  const current = spec.plannedPhases.indexOf(spec.phase);
  return (
    <ol className="phase-bar">
      {spec.plannedPhases.map((p, i) => {
        const state =
          spec.status === "done" || i < current
            ? "done"
            : i === current
              ? "current"
              : "future";
        return (
          <li
            key={p}
            className={`phase phase-${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            {p}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 8: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/PhaseBar.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/StatusBadge.tsx web/src/components/StatusBadge.test.tsx web/src/components/PhaseBar.tsx web/src/components/PhaseBar.test.tsx
git commit -m "feat: StatusBadge (cor + flag audit) e PhaseBar (plannedPhases vs phase)"
```

---

### Task 6: `Timeline` + `SpecCard` — notas, links pros `.md` e composição do card

O `Timeline` lista os `notes[]` e oferece links pros `.md` da Session, servidos pela rota `/file` — e respeita o squad: SDD linka `spec.md`/`plan.md`/`tasks.md`, Discovery linka `memo.md`. O `SpecCard` é a composição: junta `StatusBadge` + `PhaseBar` + `CostTag` + `Timeline` num card, com o `data-squad` pra estilizar SDD e Discovery diferente.

**Files:**
- Create: `web/src/components/Timeline.tsx`
- Create: `web/src/components/Timeline.test.tsx`
- Create: `web/src/components/SpecCard.tsx`
- Create: `web/src/components/SpecCard.test.tsx`

- [ ] **Step 1: Escrever o teste do `Timeline` que falha**

`web/src/components/Timeline.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import { makeSpec } from "../test-utils";

describe("Timeline", () => {
  it("lista as notas e linka os .md de SDD pela rota /file", () => {
    const spec = makeSpec({
      id: "FEAT-007",
      squad: "sdd",
      timeline: [{ kind: "pm_init", timestamp: "2026-05-20T09:00:00Z", note: "início" }],
    });
    render(<Timeline spec={spec} projectPath="/x/proj" />);
    expect(screen.getByText("início")).toBeInTheDocument();
    const specLink = screen.getByRole("link", { name: "spec.md" });
    expect(specLink).toHaveAttribute(
      "href",
      "/file?path=" + encodeURIComponent("/x/proj/.agent-session/FEAT-007/spec.md"),
    );
    expect(screen.getByRole("link", { name: "plan.md" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tasks.md" })).toBeInTheDocument();
  });

  it("Discovery linka memo.md (não spec/plan/tasks)", () => {
    const spec = makeSpec({ id: "DISC-001", squad: "discovery", plannedPhases: ["frame"], phase: "frame" });
    render(<Timeline spec={spec} projectPath="/x/proj" />);
    expect(screen.getByRole("link", { name: "memo.md" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "spec.md" })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/Timeline.test.tsx`
Expected: FAIL — `./Timeline` não existe.

- [ ] **Step 3: Implementar `web/src/components/Timeline.tsx`**

```tsx
import type { Spec } from "../../../src/store/types";

/**
 * Lista os notes[] da Session e oferece links pros .md, servidos pela rota /file.
 * O path do .md deriva de projectPath + spec.id (a Session vive em
 * <projectPath>/.agent-session/<id>/). O squad decide QUAIS docs: SDD tem
 * spec/plan/tasks; Discovery tem memo. O card só linka — não lê o conteúdo (§3 YAGNI).
 */
export function Timeline({ spec, projectPath }: { spec: Spec; projectPath: string }) {
  const specDir = `${projectPath}/.agent-session/${spec.id}`;
  const docs = spec.squad === "discovery" ? ["memo.md"] : ["spec.md", "plan.md", "tasks.md"];
  return (
    <div className="timeline">
      <ul className="timeline-notes">
        {spec.timeline.map((e, i) => (
          <li key={i}>
            <time>{e.timestamp}</time> <b>{e.kind}</b> {e.note}
          </li>
        ))}
      </ul>
      <nav className="timeline-docs">
        {docs.map((d) => (
          <a
            key={d}
            href={`/file?path=${encodeURIComponent(`${specDir}/${d}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            {d}
          </a>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/Timeline.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Escrever o teste do `SpecCard` que falha**

`web/src/components/SpecCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpecCard } from "./SpecCard";
import { makeSpec } from "../test-utils";

describe("SpecCard", () => {
  it("mostra id, título, status, fases e custo de uma spec SDD", () => {
    const spec = makeSpec({
      id: "FEAT-020",
      title: "feature legal",
      status: "running",
      phase: "plan",
      plannedPhases: ["specify", "plan", "tasks", "implementation"],
    });
    render(<SpecCard spec={spec} projectPath="/x/proj" />);
    expect(screen.getByText("FEAT-020")).toBeInTheDocument();
    expect(screen.getByText("feature legal")).toBeInTheDocument();
    expect(screen.getByText("rodando")).toBeInTheDocument();
    expect(screen.getByText("plan")).toHaveClass("phase-current");
    expect(screen.getByText("US$ 0.50")).toBeInTheDocument();
  });

  it("marca o squad no card (SDD vs Discovery)", () => {
    const { container } = render(
      <SpecCard spec={makeSpec({ squad: "discovery" })} projectPath="/x/proj" />,
    );
    expect(container.querySelector(".spec-card")).toHaveAttribute("data-squad", "discovery");
  });
});
```

- [ ] **Step 6: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/SpecCard.test.tsx`
Expected: FAIL — `./SpecCard` não existe.

- [ ] **Step 7: Implementar `web/src/components/SpecCard.tsx`**

```tsx
import type { Spec } from "../../../src/store/types";
import { PhaseBar } from "./PhaseBar";
import { StatusBadge } from "./StatusBadge";
import { CostTag } from "./CostTag";
import { Timeline } from "./Timeline";

/**
 * O card de uma spec: compõe status + fases + custo + timeline. data-squad deixa
 * o CSS distinguir SDD de Discovery sem mudar a estrutura (o discriminador do §3).
 * projectPath desce pro Timeline montar os links dos .md.
 */
export function SpecCard({ spec, projectPath }: { spec: Spec; projectPath: string }) {
  return (
    <article className="spec-card" data-squad={spec.squad}>
      <header className="spec-head">
        <span className="spec-id">{spec.id}</span>
        <h3 className="spec-title">{spec.title}</h3>
        <StatusBadge spec={spec} />
      </header>
      <PhaseBar spec={spec} />
      <CostTag cost={spec.cost} />
      <Timeline spec={spec} projectPath={projectPath} />
    </article>
  );
}
```

- [ ] **Step 8: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/SpecCard.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/Timeline.tsx web/src/components/Timeline.test.tsx web/src/components/SpecCard.tsx web/src/components/SpecCard.test.tsx
git commit -m "feat: Timeline (notas + links .md por squad) e SpecCard (composicao do card)"
```

---

### Task 7: `Board` + `ProjectGroup` + `App` — agrupar, filtrar, ocultar e ligar tudo

O `ProjectGroup` é o cabeçalho de um projeto (a tag) + botão ocultar + seus cards. O `Board` lê o estado, mostra a barra de filtro por tag e o indicador "ao vivo/reconectando", e lista os grupos (escondendo os `hidden` por padrão, com um toggle "mostrar ocultos"). O `App` embrulha tudo no `ProjectsProvider`, liga o `useLiveProjects` e passa o `toggleHide` pro board. Fecha com o smoke end-to-end real.

**Files:**
- Create: `web/src/components/ProjectGroup.tsx`
- Create: `web/src/components/Board.tsx`
- Create: `web/src/components/Board.test.tsx`
- Create: `web/src/App.tsx`

- [ ] **Step 1: Implementar `web/src/components/ProjectGroup.tsx`** (sem teste isolado — coberto pelo `Board.test.tsx`, que o renderiza)

```tsx
import type { Project } from "../../../src/store/types";
import { SpecCard } from "./SpecCard";

/**
 * Um projeto: a tag (name), o botão ocultar/mostrar (manda hide/unhide pelo WS via
 * onHide), e os cards das suas specs. A identidade usada no comando é o id estável
 * (project.id); o name é só exibição.
 */
export function ProjectGroup({
  project,
  onHide,
}: {
  project: Project;
  onHide: (id: string, hidden: boolean) => void;
}) {
  return (
    <section className="project-group">
      <header className="project-head">
        <span className="project-tag">{project.name}</span>
        <button className="project-hide" onClick={() => onHide(project.id, !project.hidden)}>
          {project.hidden ? "mostrar" : "ocultar"}
        </button>
      </header>
      <div className="cards">
        {project.specs.map((s) => (
          <SpecCard key={s.id} spec={s} projectPath={project.path} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Escrever o teste do `Board` que falha**

`web/src/components/Board.test.tsx`:

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
  it("lista os projetos visíveis e seus cards", () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "um" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2", title: "dois" })] },
    ]);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("FEAT-2")).toBeInTheDocument();
  });

  it("filtra por tag de projeto ao clicar", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull(); // proj-b sumiu do filtro
  });

  it("esconde projetos hidden por padrão, com toggle pra mostrar", async () => {
    renderBoard([{ id: "a", name: "proj-a", hidden: true, specs: [makeSpec({ id: "FEAT-1" })] }]);
    expect(screen.queryByText("FEAT-1")).toBeNull(); // hidden não aparece
    await userEvent.click(screen.getByLabelText("mostrar ocultos"));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
  });

  it("o botão ocultar manda o id estável pro callback", async () => {
    const { onHide } = renderBoard([{ id: "proj-abc", name: "proj-a", specs: [] }]);
    await userEvent.click(screen.getByRole("button", { name: "ocultar" }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
  });
});
```

- [ ] **Step 3: Rodar pra confirmar que falha**

Run: `npx vitest run web/src/components/Board.test.tsx`
Expected: FAIL — `./Board` não existe.

- [ ] **Step 4: Implementar `web/src/components/Board.tsx`**

```tsx
import { useState } from "react";
import { useProjects } from "../state/projects";
import { ProjectGroup } from "./ProjectGroup";

/**
 * O board: barra com indicador de conexão (ao vivo/reconectando) + filtro por tag
 * de projeto, e a lista de grupos. Por padrão esconde os projetos hidden (o
 * "ocultar avulso" do §6), com um toggle pra revê-los. O filtro e o toggle são
 * estado de UI puramente local (useState) — não tocam o estado vindo do WS.
 */
export function Board({ onHide }: { onHide: (id: string, hidden: boolean) => void }) {
  const { projects, connected } = useProjects();
  const [filter, setFilter] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const visible = projects
    .filter((p) => showHidden || !p.hidden)
    .filter((p) => filter === null || p.id === filter);

  return (
    <div className="board">
      <header className="board-bar">
        <span className={`conn conn-${connected ? "up" : "down"}`}>
          {connected ? "ao vivo" : "reconectando…"}
        </span>
        <div className="tags">
          <button className={filter === null ? "tag active" : "tag"} onClick={() => setFilter(null)}>
            todos
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={filter === p.id ? "tag active" : "tag"}
              onClick={() => setFilter(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <label className="show-hidden">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />{" "}
          mostrar ocultos
        </label>
      </header>
      {visible.map((p) => (
        <ProjectGroup key={p.id} project={p} onHide={onHide} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Rodar pra confirmar que passa**

Run: `npx vitest run web/src/components/Board.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 6: Implementar `web/src/App.tsx` (liga o estado, o WS e o board)**

```tsx
import { ProjectsProvider } from "./state/projects";
import { useLiveProjects } from "./state/useLiveProjects";
import { Board } from "./components/Board";

// Componente interno: vive DENTRO do Provider, então o hook acha o dispatch do
// Context. O toggleHide do hook (envia hide/unhide pelo WS) desce pro Board.
function BoardLive() {
  const { toggleHide } = useLiveProjects();
  return <Board onHide={toggleHide} />;
}

export function App() {
  return (
    <ProjectsProvider>
      <BoardLive />
    </ProjectsProvider>
  );
}
```

- [ ] **Step 7: Rodar a suíte inteira (backend + front)**

Run: `npm test`
Expected: PASS — todos os testes dos Planos 1-2 e das Tasks 1-7 deste plano verdes.

- [ ] **Step 8: Type-check do projeto todo**

Run: `npx tsc --noEmit`
Expected: sem erros — backend e front compilam sob o mesmo tsconfig.

- [ ] **Step 9: Smoke em DEV — board ao vivo pelo proxy do Vite**

Com o backend já rodando (`npm run serve` num terminal, como no Plano 2), suba o Vite noutro:

Run: `npm run dev`
Expected: o Vite imprime algo como `Local: http://localhost:5173/`. Abra essa URL. O board deve carregar seus projetos reais (o snapshot chega pelo WS via proxy), com o indicador "ao vivo". Toque num `session.yml` real (`touch ~/Developer/<projeto>/.agent-session/<spec>/session.yml`) e veja um card reagir em ~200ms. Clique numa tag pra filtrar, e em "ocultar" num projeto — ele some e **persiste** (o `hide` foi gravado no `aios.config.json` pelo backend).

- [ ] **Step 10: Smoke em USO REAL — Express servindo o build (uma porta só)**

```bash
npm run build
```

Expected: gera `dist/web/` (o `index.html` + assets). Agora, **sem** o Vite, com só o backend rodando (`npm run serve`), abra `http://127.0.0.1:4717/`. O board carrega da mesma origem (o Express serve o `dist/web`), o WS conecta em `/ws` sem proxy, e o link "report" de um card abre o `report.html` pela rota `/file`. Encerre o servidor com Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add web/src/components/ProjectGroup.tsx web/src/components/Board.tsx web/src/components/Board.test.tsx web/src/App.tsx
git commit -m "feat: Board + ProjectGroup + App (agrupa, filtra, oculta, board ao vivo ponta a ponta)"
```

---

## Self-review (cobertura do design §6 + §3 + §5)

- **§6 cards por spec agrupados/filtráveis por projeto (tags)** → Task 7 (`Board` agrupa + filtra por tag; `ProjectGroup`). ✓
- **§6 barra de fases (`plannedPhases` vs `phase`)** → Task 5 (`PhaseBar`). ✓
- **§6 status colorido + flags (`blocked`/`paused`/`audit_exception`)** → Task 5 (`StatusBadge`: status com classe de cor + flag audit; blocked/paused são status próprios derivados no Plano 1). ✓
- **§6 tokens agregados + link pro report.html** → Task 4 (`CostTag` + `fmtTokens`) + Task 1 (rota `/file` serve o `report.html`). ✓
- **§6 timeline (`notes[]`) + link pros `.md`** → Task 6 (`Timeline`) + Task 1 (rota `/file` serve os `.md`). ✓
- **§6 SDD e Discovery (squad discriminador)** → Task 5 (`PhaseBar` usa `plannedPhases`), Task 6 (`Timeline` escolhe `memo.md` vs `spec/plan/tasks.md` por squad; `SpecCard` marca `data-squad`). ✓
- **§6 invariante read-only (nunca escreve nos `.agent-session/`)** → o front só lê; a rota `/file` é read-only e a única escrita segue sendo o `aios.config.json` (Plano 2). ✓
- **§5 invariante de custo (front NUNCA recalcula; `null`→`—`, parcial→"$ parcial")** → Task 4 (`CostTag` exibe só `CostRollup`; `format.ts` só formata). ✓
- **§3 modelo Project→Spec→Task** → reusa os tipos de `src/store/types.ts` via `import type` (Tasks 2-7); sem redefinir o contrato. ✓
- **Tempo real (WS empurra, front troca o snapshot inteiro)** → Task 2 (reducer snapshot-inteiro) + Task 3 (`useLiveProjects` + reconnect) + smoke Task 7. ✓
- **Transporte (proxy em dev, Express serve o build em uso real)** → Task 0 (`vite.config` proxy) + Task 1 (Express serve `dist/web`) + smokes Task 7 (Steps 9-10). ✓

**Decisão de granularidade explicada:** `Timeline` ganhou teste próprio (Task 6) por causa da regra do squad (memo vs spec/plan/tasks) — uma lógica de bifurcação que merece cobertura direta. `ProjectGroup` **não** ganhou teste isolado (Task 7, Step 1): é um componente de composição sem lógica própria, e o `Board.test.tsx` já o exercita de ponta (renderiza cards, dispara o `onHide`). Critério: testar onde há decisão (bifurcação, formatação, derivação), não onde há só montagem — mesma régua dos Planos 1-2. Custo: se o `ProjectGroup` ganhar lógica depois, aí merece teste próprio.

**Fora deste plano (próximos):** estilo visual fino (CSS/tema) foi deixado em classes semânticas (`status-blocked`, `phase-current`, etc.) sem um arquivo de tema — o MVP entrega a estrutura e os ganchos; um polimento de CSS pode vir como passo seguinte sem tocar a lógica. Fase 2 (montar comandos) e Fase 3 (controle) seguem bloqueadas pelo §7 do design.
