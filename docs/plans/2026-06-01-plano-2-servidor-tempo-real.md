# Plano 2 — Servidor Express + WebSocket + File-watcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr o Store do Plano 1 vivo em memória, observar o disco com `chokidar`, e servir o estado por HTTP + WebSocket — quando um `session.yml`/`costs` muda, o servidor reprocessa e empurra o snapshot novo pros clientes conectados, ao vivo.

**Architecture:** Quatro peças puras e testáveis isoladamente, montadas por um entrypoint. (1) `collector/project-id.ts` dá um `id` estável e único por projeto (resolve a colisão de `basename`). (2) `config.ts` lê `aios.config.json` (roots/include/hide) e persiste o `hide` — a **única** escrita do app, e no próprio repo do aiOS. (3) `store/store.ts` mantém o snapshot em memória e emite `changed` a cada `rebuild()`. (4) `collector/watcher.ts` observa só os arquivos que mexem no board (não os `.md`) e dispara `rebuild()` com debounce. `ui/app.ts` junta Express + WebSocket sobre o Store; `server.ts` é o entrypoint. Tudo read-only nos repos do usuário.

**Tech Stack:** Node + TypeScript (ESM), `express` (HTTP), `ws` (WebSocket cru), `chokidar` v3 (file-watching com glob), Vitest (testes), `tsx` (rodar TS direto).

**Escopo deste plano:** servidor + tempo real. A UI React fica pro Plano 3 — aqui a prova end-to-end é um cliente WebSocket de teste (e `curl`), não tela.

**Referência:** design em `docs/specs/2026-06-01-aios-observer-design.md` (§2 arquitetura, §4 tempo real); Plano 1 em `docs/plans/2026-06-01-plano-1-coletor-store.md` (núcleo de dados + as **Notas pro Plano 2**, que este plano resolve).

**Decisões travadas antes de planejar (sessão 2026-06-01):**

| Decisão | Escolha | Alternativa rejeitada / porquê |
|---|---|---|
| `Project.id` estável | `name-<sha256(path).slice(0,12)>` | path cru (longo, com `/`, vaza árvore de dirs) · slug (idem) — hash é curto, opaco e único; `name` cobre a exibição |
| WebSocket | `ws` | `socket.io` — reconnect/fallback/rooms são peso morto em localhost single-user |
| Protocolo de update | snapshot completo a cada `changed` | diff/patch — exige merge no cliente; só compensa com muitos projetos/rede lenta (YAGNI) |
| Config + persistência do `hide` | `aios.config.json` no repo do aiOS | argv/env sem persistir — board esqueceria o que foi ocultado (atrito que o design quis evitar) |

---

### Task 0: Bootstrap das dependências do servidor

Adiciona as três libs do servidor e o script `serve`. Nada de código ainda — só tooling de pé.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Reescrever `package.json` com as deps novas e o script `serve`**

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
    "serve": "tsx src/server.ts"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

> **Por que `chokidar` v3 e não v4:** a v4 (set/2024) **removeu** o suporte a glob. Este plano observa os arquivos por padrão glob (`*/.agent-session/**/session.yml`), o jeito mais enxuto de pegar só os arquivos certos. A v3.6 mantém glob e é madura. Trade-off: a v4 traz menos dependências, mas exigiria observar diretórios inteiros e filtrar por função — mais código e mais eventos de FS. `chokidar` já inclui seus próprios tipos, então não há `@types/chokidar`.

- [ ] **Step 2: Instalar**

Run: `cd ~/Developer/ai-squad-os && npm install`
Expected: instala `express`, `ws`, `chokidar` e os `@types/*` sem erro; atualiza `package-lock.json`.

- [ ] **Step 3: Confirmar que a suíte do Plano 1 segue verde**

Run: `npm test`
Expected: PASS — os testes de `cost`/`session`/`discovery` continuam passando (nada de código mudou ainda).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: deps do servidor (express + ws + chokidar v3) + script serve"
```

---

### Task 1: `Project.id` estável — resolve a Nota do Plano 1

A Nota do Plano 1: hoje `id = name = basename(path)`, então `~/work/foo` e `~/personal/foo` colidem em `id = "foo"`. No Plano 2 o WebSocket usa `id` como chave (cliente manda "ocultar `<id>`"; servidor empurra "`<id>` mudou"). Colisão → comando no card errado. A correção separa **identidade** (`id`, único+estável, derivado do path) de **exibição** (`name`, o basename legível).

**Files:**
- Create: `src/collector/project-id.ts`
- Create: `test/project-id.test.ts`
- Modify: `src/collector/discovery.ts` (a função `toProject`)

- [ ] **Step 1: Escrever o teste que falha**

`test/project-id.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { projectId } from "../src/collector/project-id.js";

describe("projectId", () => {
  it("é determinístico — mesmo path gera sempre o mesmo id", () => {
    expect(projectId("/a/b/foo")).toBe(projectId("/a/b/foo"));
  });

  it("desambigua basenames iguais em roots diferentes", () => {
    expect(projectId("/work/foo")).not.toBe(projectId("/personal/foo"));
  });

  it("começa com o basename (legível pra debug)", () => {
    expect(projectId("/x/y/ai-squad").startsWith("ai-squad-")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/project-id.test.ts`
Expected: FAIL — `projectId` não existe (erro de import).

- [ ] **Step 3: Implementar `src/collector/project-id.ts`**

```typescript
import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * id estável e único de um projeto, derivado do path ABSOLUTO.
 * O `name` (basename) é só exibição e pode colidir entre roots diferentes;
 * o sufixo de hash desambigua. Determinístico: mesmo path → mesmo id, sempre.
 * sha256 aqui é só desambiguação (não é segurança); 12 hex (48 bits) bastam
 * pra dezenas de projetos sem colisão prática.
 */
export function projectId(absPath: string): string {
  const hash = createHash("sha256").update(absPath).digest("hex").slice(0, 12);
  return `${basename(absPath)}-${hash}`;
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/project-id.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Ligar o `projectId` no `discovery.ts`**

Em `src/collector/discovery.ts`, adicionar o import no topo (junto dos outros):

```typescript
import { projectId } from "./project-id.js";
```

E trocar a função `toProject` (atualmente em `src/collector/discovery.ts:45-54`) por:

```typescript
function toProject(projectPath: string, hide: Set<string>): Project {
  const name = basename(projectPath);
  return {
    id: projectId(projectPath), // estável e único; name pode colidir entre roots
    path: projectPath,
    name,
    specs: loadSpecs(projectPath),
    hidden: hide.has(name) || hide.has(projectPath),
  };
}
```

- [ ] **Step 6: Atualizar o comentário do contrato em `types.ts`**

Em `src/store/types.ts`, na interface `Project`, trocar o comentário da linha `id` (atualmente `// slug do path, ex. "ai-squad"`) por:

```typescript
  id: string; // estável e único: `${name}-${hash12(path)}` (ver collector/project-id.ts)
```

- [ ] **Step 7: Rodar a suíte inteira — nada pode quebrar**

Run: `npm test`
Expected: PASS. Os testes de `discovery` checam `p.name` (segue o basename) e `hidden` (segue por name/path), então não dependem do formato do `id`. Tudo verde.

- [ ] **Step 8: Commit**

```bash
git add src/collector/project-id.ts test/project-id.test.ts src/collector/discovery.ts src/store/types.ts
git commit -m "fix: Project.id estavel por hash do path (resolve colisao de basename)"
```

---

### Task 2: Config `aios.config.json` — fonte das roots e persistência do `hide`

O servidor precisa saber **quais pastas escanear** e **lembrar o que o usuário ocultou** entre reinícios. Tudo num arquivo `aios.config.json` na raiz do repo do aiOS. Persistir o `hide` é a **única escrita** do app — e no próprio repo do aiOS, jamais nos `.agent-session/` alheios (invariante read-only do design §6 preservado).

**Files:**
- Create: `src/config.ts`
- Create: `test/config.test.ts`
- Create: `aios.config.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Escrever o teste que falha**

`test/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveHidden } from "../src/config.js";

function tmpConfig(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aios-"));
  const p = join(dir, "aios.config.json");
  if (content !== undefined) writeFileSync(p, content);
  return p;
}

describe("loadConfig", () => {
  it("lê roots/include/hide de um arquivo válido", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["/x"], include: ["/y"], hide: ["z"] }));
    const c = loadConfig(p);
    expect(c.roots).toEqual(["/x"]);
    expect(c.include).toEqual(["/y"]);
    expect(c.hide).toEqual(["z"]);
  });

  it("devolve defaults vazios quando o arquivo não existe", () => {
    const c = loadConfig(join(tmpdir(), "nao-existe-aios-xyz.json"));
    expect(c).toEqual({ roots: [], include: [], hide: [] });
  });

  it("expande ~ nas roots (Node não faz isso sozinho)", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["~/Dev"] }));
    expect(loadConfig(p).roots[0]).toBe(join(homedir(), "Dev"));
  });
});

describe("saveHidden", () => {
  it("persiste o hide preservando roots e relê com loadConfig", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["/x"], include: [], hide: [] }));
    saveHidden(p, ["/x/foo"]);
    const reread = JSON.parse(readFileSync(p, "utf-8"));
    expect(reread.roots).toEqual(["/x"]); // roots preservadas
    expect(reread.hide).toEqual(["/x/foo"]);
    expect(loadConfig(p).hide).toEqual(["/x/foo"]);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `loadConfig`/`saveHidden` não existem.

- [ ] **Step 3: Implementar `src/config.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AiosConfig {
  roots: string[]; // pastas-raiz pra auto-scan
  include: string[]; // paths avulsos de projeto, fora das roots
  hide: string[]; // names ou paths de projeto a ocultar (persistido)
}

const DEFAULTS: AiosConfig = { roots: [], include: [], hide: [] };

/** Expande um ~ inicial para o home do usuário (Node não faz isso sozinho). */
export function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Lê aios.config.json; devolve defaults se ausente ou inválido. Paths com ~ expandidos. */
export function loadConfig(configPath: string): AiosConfig {
  if (!existsSync(configPath)) return { ...DEFAULTS };
  let raw: Partial<AiosConfig>;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return { ...DEFAULTS }; // config corrompida: não derruba o servidor, não inventa nada
  }
  return {
    roots: (raw.roots ?? []).map(expandTilde),
    include: (raw.include ?? []).map(expandTilde),
    hide: raw.hide ?? [],
  };
}

/**
 * Reescreve só o hide[] preservando roots/include. ÚNICA escrita do aiOS —
 * e no PRÓPRIO repo do aiOS (aios.config.json), nunca nos .agent-session/ alheios.
 */
export function saveHidden(configPath: string, hide: string[]): void {
  const current: Partial<AiosConfig> = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf-8"))
    : {};
  const next: AiosConfig = {
    roots: current.roots ?? [],
    include: current.include ?? [],
    hide,
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
}
```

> Nota: `loadConfig` expande `~`, mas `saveHidden` relê o arquivo cru (sem expandir) e preserva as roots como o usuário escreveu — o `~` continua no arquivo, legível.

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Criar o exemplo de config (commitado) e ignorar o real**

`aios.config.example.json`:

```json
{
  "roots": ["~/Developer"],
  "include": [],
  "hide": []
}
```

Em `.gitignore`, acrescentar uma linha (o arquivo real tem paths da máquina; só o exemplo entra no git):

```
aios.config.json
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts aios.config.example.json .gitignore
git commit -m "feat: aios.config.json (roots/include/hide) + persistencia do hide"
```

---

### Task 3: Store em memória — snapshot vivo + evento `changed`

A peça **Store** do design (§2): mantém o array de Projects em memória e avisa (`changed`) sempre que reprocessa. É o contrato entre o watcher (que pede `rebuild`) e o servidor (que escuta `changed` pra empurrar). Recebe as opções por uma **função** — assim cada `rebuild()` lê o estado atual de config (ex.: o `hide` recém-persistido).

**Files:**
- Create: `src/store/store.ts`
- Create: `test/store.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

`test/store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store } from "../src/store/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

describe("Store", () => {
  it("getSnapshot é vazio antes do primeiro rebuild", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    expect(store.getSnapshot()).toEqual([]);
  });

  it("rebuild monta o snapshot a partir das DiscoveryOptions", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    const snap = store.rebuild();
    expect(snap.map((p) => p.name).sort()).toEqual(["projeto-a", "projeto-b"]);
    expect(store.getSnapshot()).toBe(snap);
  });

  it("emite 'changed' a cada rebuild", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    let calls = 0;
    store.on("changed", () => calls++);
    store.rebuild();
    store.rebuild();
    expect(calls).toBe(2);
  });

  it("reflete mudança de options (hide) no rebuild seguinte", () => {
    const opts = { roots: [workspace], hide: [] as string[] };
    const store = new Store(() => opts);
    store.rebuild();
    expect(store.getSnapshot().find((p) => p.name === "projeto-b")!.hidden).toBe(false);
    opts.hide = ["projeto-b"];
    store.rebuild();
    expect(store.getSnapshot().find((p) => p.name === "projeto-b")!.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — `Store` não existe.

- [ ] **Step 3: Implementar `src/store/store.ts`**

```typescript
import { EventEmitter } from "node:events";
import { discoverProjects, type DiscoveryOptions } from "../collector/discovery.js";
import type { Project } from "./types.js";

/**
 * Estado normalizado em memória (design §2). Guarda o último snapshot e emite
 * 'changed' a cada rebuild. As opções vêm por FUNÇÃO pra que cada rebuild leia
 * o estado atual de config (ex.: o hide recém-persistido). Read-only no disco.
 */
export class Store extends EventEmitter {
  private snapshot: Project[] = [];

  constructor(private getOptions: () => DiscoveryOptions) {
    super();
  }

  /** O último snapshot calculado (vazio até o primeiro rebuild). */
  getSnapshot(): Project[] {
    return this.snapshot;
  }

  /** Reprocessa do disco, guarda e emite 'changed'. Devolve o novo snapshot. */
  rebuild(): Project[] {
    this.snapshot = discoverProjects(this.getOptions());
    this.emit("changed", this.snapshot);
    return this.snapshot;
  }
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts test/store.test.ts
git commit -m "feat: Store em memoria (snapshot + evento changed)"
```

---

### Task 4: File-watcher + debounce

O design §4: o SO avisa quando o arquivo muda (em vez de polling), e um debounce de 200ms colapsa a rajada de escritas do orchestrator numa única reação. O watcher observa **só** o que muda o board — `session.yml`, `costs/*.json`, manifests — e **não** os `.md` (mudam na escrita interativa e não afetam status/custo). A função pura `debounce` é o que tem teste determinístico; o `chokidar` real (dependência de FS/SO, lento e sujeito a timing) fica pro smoke da Task 6.

**Files:**
- Create: `src/collector/watcher.ts`
- Create: `test/watcher.test.ts`

- [ ] **Step 1: Escrever o teste que falha (só o `debounce`, com timers falsos)**

`test/watcher.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { debounce } from "../src/collector/watcher.js";

describe("debounce", () => {
  it("colapsa uma rajada numa única chamada após o silêncio", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);

    d();
    d();
    d(); // rajada de 3
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled(); // ainda dentro da janela

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1); // 3 chamadas → 1 reação

    vi.useRealTimers();
  });

  it("dispara de novo após uma nova rajada", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);

    d();
    vi.advanceTimersByTime(200);
    d();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/watcher.test.ts`
Expected: FAIL — `debounce` não existe.

- [ ] **Step 3: Implementar `src/collector/watcher.ts`**

```typescript
import chokidar from "chokidar";
import { join } from "node:path";

/**
 * debounce: só dispara `fn` após `ms` sem novas chamadas. Uma gravação do
 * orchestrator pode ser uma rajada; isto evita reprocessar N vezes (design §4).
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

export interface WatchHandle {
  close: () => Promise<void>;
}

/**
 * Observa só os arquivos que afetam o board — session.yml, costs/*.json e
 * manifests — e NÃO os .md (mudam na escrita interativa e não mexem em
 * status/custo: design §4). Chama onChange (debounced) a cada mudança.
 * Glob anchorado em `*/.agent-session` pra não varrer a árvore inteira. Read-only.
 */
export function watchProjects(
  roots: string[],
  onChange: () => void,
  debounceMs = 200,
): WatchHandle {
  const patterns = roots.flatMap((r) => [
    join(r, "*", ".agent-session", "**", "session.yml"),
    join(r, "*", ".agent-session", "**", "costs", "*.json"),
    join(r, "*", ".agent-session", "**", "*manifest*.json"),
  ]);
  const debounced = debounce(onChange, debounceMs);
  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true, // não dispara pelos arquivos que já existiam ao subir
    ignored: (p: string) => p.endsWith(".md"), // defensivo: nunca os .md
  });
  watcher.on("all", () => debounced());
  return { close: () => watcher.close() };
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/watcher.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/collector/watcher.ts test/watcher.test.ts
git commit -m "feat: file-watcher (chokidar) + debounce 200ms (so arquivos do board)"
```

---

### Task 5: Servidor Express + WebSocket (`ui/app.ts`)

A peça **UI-servidor** do design (§2/§4): `GET /api/projects` para o primeiro load (HTTP é pergunta-resposta), e um WebSocket que empurra o snapshot ao conectar e a cada `changed` do Store (cano de mão dupla sempre aberto). Recebe comandos `hide`/`unhide` e delega a um callback — quem persiste e manda `rebuild` é o entrypoint (Task 6). Fábrica testável: recebe um Store pronto, devolve um `http.Server` que o teste sobe numa porta efêmera.

**Files:**
- Create: `src/ui/app.ts`
- Create: `test/server.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

`test/server.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { Store } from "../src/store/store.js";
import { createServer } from "../src/ui/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

function startedStore() {
  const store = new Store(() => ({ roots: [workspace] }));
  store.rebuild();
  return store;
}

describe("createServer", () => {
  it("GET /api/projects retorna o snapshot atual", async () => {
    const server = createServer(startedStore(), () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(res.status).toBe(200);
    expect(body.map((p) => p.name).sort()).toEqual(["projeto-a", "projeto-b"]);

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("WS empurra o snapshot ao conectar", async () => {
    const server = createServer(startedStore(), () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const raw = await new Promise<string>((res) =>
      ws.on("message", (d) => res(d.toString())),
    );
    const msg = JSON.parse(raw);
    expect(msg.type).toBe("snapshot");
    expect(msg.projects).toHaveLength(2);

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("empurra um novo snapshot quando o Store muda", async () => {
    const store = startedStore();
    const server = createServer(store, () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    await new Promise<void>((res) => ws.once("message", () => res())); // drena o snapshot inicial

    const next = new Promise<string>((res) => ws.once("message", (d) => res(d.toString())));
    store.rebuild(); // dispara 'changed' → broadcast
    const msg = JSON.parse(await next);
    expect(msg.type).toBe("snapshot");

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("encaminha comando hide ao callback com o id recebido", async () => {
    let captured: { id: string; hidden: boolean } | null = null;
    const server = createServer(startedStore(), (id, hidden) => {
      captured = { id, hidden };
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    ws.send(JSON.stringify({ type: "hide", id: "projeto-x-abc123" }));

    await new Promise<void>((res) => setTimeout(res, 50)); // deixa a msg chegar
    expect(captured).toEqual({ id: "projeto-x-abc123", hidden: true });

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — `createServer` não existe.

- [ ] **Step 3: Implementar `src/ui/app.ts`**

```typescript
import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Store } from "../store/store.js";

/**
 * Monta o servidor HTTP + WebSocket sobre um Store pronto.
 * - GET /api/projects: snapshot atual (primeiro load).
 * - WS em /ws: empurra { type: "snapshot", projects } ao conectar e a cada
 *   'changed' do Store; recebe { type: "hide"|"unhide", id } e delega a
 *   onToggleHide (o entrypoint persiste e manda rebuild).
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
  app.get("/", (_req, res) => {
    res.type("text").send("ai-squad-os server up");
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const snapshotMessage = () =>
    JSON.stringify({ type: "snapshot", projects: store.getSnapshot() });

  wss.on("connection", (socket) => {
    socket.send(snapshotMessage()); // estado atual assim que conecta
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
  store.on("changed", () => {
    const data = snapshotMessage();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  });

  return server;
}
```

- [ ] **Step 4: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.ts test/server.test.ts
git commit -m "feat: servidor Express + WebSocket (snapshot + push + comandos hide)"
```

---

### Task 6: Entrypoint `server.ts` + smoke end-to-end

Junta as peças: lê `aios.config.json` → cria o Store → sobe o watcher → cria o servidor → escuta. O `toggleHide` traduz o `id` (que o cliente manda) de volta pro `path` do projeto (chave estável no `hide`, sem a colisão da Task 1), persiste com `saveHidden` e dá `rebuild` (que emite `changed` → broadcast).

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Implementar `src/server.ts`**

```typescript
import { join } from "node:path";
import { loadConfig, saveHidden, type AiosConfig } from "./config.js";
import { Store } from "./store/store.js";
import { watchProjects } from "./collector/watcher.js";
import { createServer } from "./ui/app.js";

const configPath = join(process.cwd(), "aios.config.json");
const config: AiosConfig = loadConfig(configPath);
const port = Number(process.env.AIOS_PORT ?? 4317);

// O Store lê `config` por função → cada rebuild pega o hide atual.
const store = new Store(() => config);
store.rebuild();

/** Traduz o id (chave do cliente) pro path do projeto, persiste e reprocessa. */
const toggleHide = (id: string, hidden: boolean): void => {
  const proj = store.getSnapshot().find((p) => p.id === id);
  if (!proj) return; // id desconhecido: ignora
  const next = new Set(config.hide);
  if (hidden) next.add(proj.path);
  else next.delete(proj.path);
  config.hide = [...next];
  saveHidden(configPath, config.hide); // única escrita, no repo do aiOS
  store.rebuild(); // relê com o novo hide → emite changed → broadcast
};

const server = createServer(store, toggleHide);
const watcher = watchProjects(config.roots, () => store.rebuild());

server.listen(port, () => {
  console.log(`ai-squad-os ouvindo em http://127.0.0.1:${port}  (config: ${configPath})`);
  console.log(`roots: ${config.roots.join(", ") || "(nenhuma — edite aios.config.json)"}`);
});

const shutdown = (): void => {
  void watcher.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Criar um `aios.config.json` local apontando pros seus projetos**

Copie o exemplo e ajuste as roots (este arquivo é gitignored — não vai pro repo):

```bash
cp aios.config.example.json aios.config.json
```

Confira que `roots` lista onde estão seus repos com `.agent-session/` (ex.: `["~/Developer"]`).

- [ ] **Step 3: Subir o servidor**

Run: `npm run serve`
Expected: imprime `ai-squad-os ouvindo em http://127.0.0.1:4317` e a lista de roots. Deixe rodando neste terminal.

- [ ] **Step 4: Conferir o primeiro load por HTTP (outro terminal)**

Run: `curl -s http://127.0.0.1:4317/api/projects | head -c 400`
Expected: um array JSON dos seus projetos reais, cada um com `id` no formato `<nome>-<hash>` (ex.: `"ai-squad-3f9a2b1c8d04"`), `name`, `path`, `specs[]`. Pelo menos um spec com `costs/` deve mostrar `cost.totalCostUsd` não-nulo — e bater com o `$` do `report.html` daquela feature (critério de aceitação do invariante de custo do design §5).

- [ ] **Step 5: Provar o push ao vivo pelo WebSocket**

Num terminal, conecte um cliente WebSocket de teste (usa o `ws` já instalado):

```bash
node --input-type=module -e "import { WebSocket } from 'ws'; const ws = new WebSocket('ws://127.0.0.1:4317/ws'); ws.on('message', d => console.log('PUSH', d.toString().slice(0, 120)));"
```

Expected (imediato): uma linha `PUSH {\"type\":\"snapshot\",...}` — o snapshot inicial ao conectar.

Agora, com o cliente ainda aberto, **toque** num `session.yml` real pra simular uma escrita do orchestrator (outro terminal):

```bash
touch ~/Developer/<algum-projeto>/.agent-session/<algum-spec>/session.yml
```

Expected (~200ms depois): uma **nova** linha `PUSH {\"type\":\"snapshot\",...}` aparece no cliente — prova de que watcher → debounce → rebuild → broadcast funciona ponta a ponta. Encerre o servidor com Ctrl-C (shutdown limpo).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — todos os testes (Plano 1 + Tasks 1-5 deste plano) verdes.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts
git commit -m "feat: entrypoint server.ts (config + store + watcher + http/ws) + smoke"
```

---

## Self-review (cobertura do design + Notas do Plano 1)

- **§2 Store (estado normalizado em memória)** → Task 3 (`store.ts`, snapshot + `changed`). ✓
- **§2 UI-servidor (Express + WebSocket, consome o Store, não lê disco)** → Task 5 (`ui/app.ts`). ✓
- **§4 watcher `chokidar` + debounce 200ms** → Task 4. ✓
- **§4 observa só `session.yml`/manifests, não os `.md`** → Task 4 (globs + `ignored`). ✓
- **§4 WebSocket empurra a atualização (push, não polling)** → Task 5 (`store.on("changed")` → broadcast) + smoke Task 6. ✓
- **descoberta híbrida com "ocultar" persistido** → Task 2 (`aios.config.json` + `saveHidden`) + Task 6 (`toggleHide`). ✓
- **§6 invariante read-only nos repos do usuário** → única escrita é `aios.config.json` no repo do aiOS (Task 2/6); watcher e coletor só leem. ✓
- **Nota Plano 1 — `Project.id` estável** → Task 1 (`projectId` por hash do path; chave do WebSocket). ✓
- **Nota Plano 1 — `notes` ora array ora string** → já tratado no coletor do Plano 1 (`parseSession`); nada a fazer aqui. Normalizar no próprio ai-squad segue como item externo, fora do escopo do aiOS. ✓

**Fora deste plano (próximo):** UI React (Vite) consumindo `GET /api/projects` + o WebSocket `/ws` — Plano 3. O contrato HTTP/WS deste plano é a fundação que o front consome.
