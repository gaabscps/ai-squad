# Plano 1 — Núcleo de Dados (Coletor + Store)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dado um diretório de projetos, descobrir os repos, ler cada `session.yml` + `costs/`, montar o modelo Project → Spec → Task em memória, e um script que imprime tudo em JSON — provando o invariante de custo antes de existir qualquer UI.

**Architecture:** Três módulos puros e testáveis isoladamente: `collector/cost.ts` (soma os `total_cost_usd` já gravados), `collector/session.ts` (parseia o `session.yml` num `Spec` e deriva status), `collector/discovery.ts` (auto-scan híbrido de projetos). Um `cli.ts` junta tudo. Tudo read-only — nunca escreve nos `.agent-session/`.

**Tech Stack:** Node + TypeScript (ESM), `yaml` (parse de YAML), Vitest (testes), `tsx` (rodar TS direto).

**Escopo deste plano:** só o núcleo de dados. Servidor HTTP/WebSocket e o file-watcher ficam pro Plano 2; a UI React pro Plano 3.

**Referência:** design em `docs/specs/2026-06-01-aios-observer-design.md` (§3 modelo de dados, §5 custo + invariante).

---

### Task 0: Bootstrap do projeto

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "ai-squad-os",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dump": "tsx src/cli.ts"
  },
  "dependencies": {
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

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
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 4: Criar `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 5: Instalar dependências**

Run: `cd ~/Developer/ai-squad-os && npm install`
Expected: cria `node_modules/` e `package-lock.json` sem erro.

- [ ] **Step 6: Rodar a suíte vazia pra confirmar o setup**

Run: `npm test`
Expected: Vitest roda e diz "No test files found" (exit 0) — o tooling está de pé.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: bootstrap node+ts+vitest"
```

---

### Task 1: Tipos do Store

Os tipos são o contrato entre Coletor e (futura) UI. Sem teste — são declarações; o compilador é o teste.

**Files:**
- Create: `src/store/types.ts`

- [ ] **Step 1: Criar `src/store/types.ts`**

```typescript
// Status derivado da Session inteira (não lido cru do YAML).
export type SpecStatus = "running" | "paused" | "blocked" | "done" | "escalated";

// Estado de uma task individual (task_states.<T>.state no session.yml).
export type TaskState = "pending" | "running" | "done" | "blocked";

export interface Task {
  id: string; // "T-008"
  state: TaskState;
  loops: number; // loops>1 = reviewer rejeitou (retrabalho)
}

// Custo: SEMPRE somado dos total_cost_usd já gravados; nunca recalculado.
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
}

export interface TimelineEntry {
  kind: string;
  timestamp: string;
  note: string;
  phase?: string;
}

export interface Spec {
  id: string; // "FEAT-006" / "DISC-001"
  squad: "sdd" | "discovery";
  title: string;
  phase: string; // current_phase cru
  plannedPhases: string[];
  status: SpecStatus; // derivado
  tasks: Task[];
  health: {
    pendingHuman: number;
    escalationRate: number;
    auditException: boolean;
  };
  lastActivityAt: string | null;
  timeline: TimelineEntry[];
  cost: CostRollup;
}

export interface Project {
  id: string; // slug do path, ex. "ai-squad"
  path: string;
  name: string;
  specs: Spec[];
  hidden: boolean;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/store/types.ts
git commit -m "feat: tipos do Store (Project/Spec/Task/CostRollup)"
```

---

### Task 2: Cost rollup — somar os `total_cost_usd` já gravados

Esta é a tarefa que prova o invariante de custo (design §5). Lê todos os `costs/*.json` de uma Session e soma o que já está gravado. **Nunca aplica pricing.**

**Files:**
- Create: `test/fixtures/spec-com-custo/costs/agent-aaa.json`
- Create: `test/fixtures/spec-com-custo/costs/session-bbb.json`
- Create: `test/fixtures/spec-sem-custo/.keep`
- Create: `test/cost.test.ts`
- Create: `src/collector/cost.ts`

- [ ] **Step 1: Criar fixture com dois arquivos de custo (números conhecidos)**

`test/fixtures/spec-com-custo/costs/agent-aaa.json`:

```json
{
  "agent_id": "aaa",
  "scope": "implementation",
  "total_cost_usd": 0.3,
  "by_model": {
    "claude-opus-4-8": {
      "input_tokens": 100,
      "output_tokens": 50,
      "cache_read_input_tokens": 1000,
      "cache_creation_input_tokens": 200,
      "cost_usd": 0.3
    }
  },
  "unpriced_models": []
}
```

`test/fixtures/spec-com-custo/costs/session-bbb.json`:

```json
{
  "agent_id": "bbb",
  "scope": "main",
  "total_cost_usd": 0.2,
  "by_model": {
    "claude-haiku-4-5": {
      "input_tokens": 10,
      "output_tokens": 5,
      "cache_read_input_tokens": 0,
      "cache_creation_input_tokens": 0,
      "cost_usd": 0.2
    }
  },
  "unpriced_models": []
}
```

E uma pasta vazia (sem `costs/`) pra testar ausência — `test/fixtures/spec-sem-custo/.keep` (arquivo vazio só pra o git manter a pasta).

- [ ] **Step 2: Escrever o teste que falha**

`test/cost.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readCostRollup } from "../src/collector/cost.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixt = (name: string) => join(here, "fixtures", name);

describe("readCostRollup", () => {
  it("soma total_cost_usd e tokens de todos os costs/*.json", () => {
    const c = readCostRollup(fixt("spec-com-custo"));
    expect(c.totalCostUsd).toBeCloseTo(0.5, 6); // 0.3 + 0.2
    expect(c.tokens.input).toBe(110); // 100 + 10
    expect(c.tokens.output).toBe(55); // 50 + 5
    expect(c.tokens.cacheRead).toBe(1000);
    expect(c.tokens.cacheCreation).toBe(200);
    expect(c.totalTokens).toBe(110 + 55 + 1000 + 200);
    expect(c.partial).toBe(false);
  });

  it("retorna totalCostUsd null quando não há pasta costs/", () => {
    const c = readCostRollup(fixt("spec-sem-custo"));
    expect(c.totalCostUsd).toBeNull();
    expect(c.totalTokens).toBe(0);
  });
});
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/cost.test.ts`
Expected: FAIL — `readCostRollup` não existe (erro de import).

- [ ] **Step 4: Implementar `src/collector/cost.ts`**

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup } from "../store/types.js";

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

function emptyRollup(reportPath: string | null): CostRollup {
  return {
    totalCostUsd: null,
    partial: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    totalTokens: 0,
    reportPath,
  };
}

/**
 * Soma os custos JÁ GRAVADOS nos costs/*.json de uma Session.
 * NUNCA aplica pricing — apenas soma total_cost_usd e tokens já persistidos,
 * exatamente como o report do ai-squad faz. Read-only.
 */
export function readCostRollup(specDir: string): CostRollup {
  const reportPath = existsSync(join(specDir, "report.html"))
    ? join(specDir, "report.html")
    : null;
  const costsDir = join(specDir, "costs");
  if (!existsSync(costsDir)) return emptyRollup(reportPath);

  const files = readdirSync(costsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return emptyRollup(reportPath);

  let totalCostUsd = 0;
  let partial = false;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const f of files) {
    let raw: RawCostFile;
    try {
      raw = JSON.parse(readFileSync(join(costsDir, f), "utf-8"));
    } catch {
      continue; // arquivo corrompido: ignora, não inventa número
    }
    if (typeof raw.total_cost_usd === "number") totalCostUsd += raw.total_cost_usd;
    if (Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0)
      partial = true;
    for (const usage of Object.values(raw.by_model ?? {})) {
      tokens.input += usage.input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
      tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
  }

  const totalTokens =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { totalCostUsd, partial, tokens, totalTokens, reportPath };
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/cost.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/spec-com-custo test/fixtures/spec-sem-custo test/cost.test.ts src/collector/cost.ts
git commit -m "feat: cost rollup soma total_cost_usd ja gravados (invariante de custo)"
```

---

### Task 3: Session parser + derivação de status

Lê o `session.yml` num `Spec`, deriva o `status` de campos reais, e pendura o `CostRollup` da Task 2.

**Files:**
- Create: `test/fixtures/feat-done/session.yml`
- Create: `test/fixtures/feat-paused/session.yml`
- Create: `test/session.test.ts`
- Create: `src/collector/session.ts`

- [ ] **Step 1: Criar fixture de uma Session concluída**

`test/fixtures/feat-done/session.yml`:

```yaml
task_id: "FEAT-099"
squad: "sdd"
feature_name: "exemplo concluido"
current_phase: "done"
last_activity_at: "2026-05-20T10:00:00Z"
audit_exception: false
planned_phases:
  - "specify"
  - "plan"
  - "tasks"
  - "implementation"
task_states:
  T-001:
    state: "done"
    loops: 1
  T-002:
    state: "done"
    loops: 2
escalation_metrics:
  pending_human_tasks: 0
  total_tasks: 2
  escalation_rate: 0
notes:
  - kind: pm_init
    timestamp: "2026-05-20T09:00:00Z"
    note: "inicio"
```

- [ ] **Step 2: Criar fixture de uma Session pausada (com uma task blocked)**

`test/fixtures/feat-paused/session.yml`:

```yaml
task_id: "FEAT-100"
squad: "sdd"
feature_name: "exemplo pausado"
current_phase: "implementation"
last_activity_at: "2026-05-21T10:00:00Z"
paused_at: "2026-05-21T11:00:00Z"
paused_reason: "aguardando --resume"
planned_phases:
  - "specify"
  - "implementation"
task_states:
  T-001:
    state: "blocked"
    loops: 3
escalation_metrics:
  pending_human_tasks: 1
  total_tasks: 1
  escalation_rate: 1
```

- [ ] **Step 3: Escrever o teste que falha**

`test/session.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSession, deriveStatus } from "../src/collector/session.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixt = (name: string) => join(here, "fixtures", name);

describe("parseSession", () => {
  it("mapeia campos do session.yml num Spec", () => {
    const s = parseSession(fixt("feat-done"))!;
    expect(s.id).toBe("FEAT-099");
    expect(s.squad).toBe("sdd");
    expect(s.title).toBe("exemplo concluido");
    expect(s.plannedPhases).toEqual(["specify", "plan", "tasks", "implementation"]);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasks[1]).toEqual({ id: "T-002", state: "done", loops: 2 });
    expect(s.health.pendingHuman).toBe(0);
    expect(s.timeline[0].kind).toBe("pm_init");
    expect(s.status).toBe("done");
  });

  it("retorna null quando não há session.yml", () => {
    expect(parseSession(fixt("spec-sem-custo"))).toBeNull();
  });
});

describe("deriveStatus", () => {
  it("done quando current_phase é done", () => {
    expect(deriveStatus({ current_phase: "done" }, [])).toBe("done");
  });
  it("escalated quando current_phase é escalated", () => {
    expect(deriveStatus({ current_phase: "escalated" }, [])).toBe("escalated");
  });
  it("paused quando há paused_at", () => {
    expect(
      deriveStatus({ current_phase: "implementation", paused_at: "x" }, [])
    ).toBe("paused");
  });
  it("blocked quando alguma task está blocked", () => {
    expect(
      deriveStatus({ current_phase: "implementation" }, [
        { id: "T-001", state: "blocked", loops: 3 },
      ])
    ).toBe("blocked");
  });
  it("running no caso default", () => {
    expect(deriveStatus({ current_phase: "implementation" }, [])).toBe("running");
  });
});
```

- [ ] **Step 4: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — `parseSession`/`deriveStatus` não existem.

- [ ] **Step 5: Implementar `src/collector/session.ts`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Spec, SpecStatus, Task, TimelineEntry } from "../store/types.js";
import { readCostRollup } from "./cost.js";

interface RawSession {
  current_phase?: string;
  paused_at?: string;
}

/**
 * Deriva o status da Session inteira a partir de campos REAIS do session.yml.
 * Ordem importa: done/escalated (do current_phase) > paused (paused_at) >
 * blocked (alguma task) > running (default).
 */
export function deriveStatus(raw: RawSession, tasks: Task[]): SpecStatus {
  if (raw.current_phase === "done") return "done";
  if (raw.current_phase === "escalated") return "escalated";
  if (raw.paused_at) return "paused";
  if (tasks.some((t) => t.state === "blocked")) return "blocked";
  return "running";
}

/** Lê <specDir>/session.yml num Spec. Retorna null se não houver session.yml. */
export function parseSession(specDir: string): Spec | null {
  const file = join(specDir, "session.yml");
  if (!existsSync(file)) return null;

  const raw = parseYaml(readFileSync(file, "utf-8")) as Record<string, any>;

  const tasks: Task[] = Object.entries(raw.task_states ?? {}).map(
    ([id, v]: [string, any]) => ({
      id,
      state: v?.state ?? "pending",
      loops: v?.loops ?? 0,
    })
  );

  const timeline: TimelineEntry[] = (raw.notes ?? []).map((n: any) => ({
    kind: n?.kind ?? "",
    timestamp: n?.timestamp ?? "",
    note: n?.note ?? "",
    phase: n?.phase,
  }));

  const em = raw.escalation_metrics ?? {};

  return {
    id: raw.task_id ?? specDir,
    squad: raw.squad === "discovery" ? "discovery" : "sdd",
    title: raw.feature_name ?? raw.task_id ?? "(sem título)",
    phase: raw.current_phase ?? "",
    plannedPhases: raw.planned_phases ?? [],
    status: deriveStatus(raw, tasks),
    tasks,
    health: {
      pendingHuman: em.pending_human_tasks ?? 0,
      escalationRate: em.escalation_rate ?? 0,
      auditException: raw.audit_exception === true,
    },
    lastActivityAt: raw.last_activity_at ?? null,
    timeline,
    cost: readCostRollup(specDir),
  };
}
```

- [ ] **Step 6: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/session.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/feat-done test/fixtures/feat-paused test/session.test.ts src/collector/session.ts
git commit -m "feat: parseSession + deriveStatus (campos reais do session.yml)"
```

---

### Task 4: Descoberta híbrida de projetos

Varre uma ou mais pastas-raiz procurando subpastas que contêm `.agent-session/`, adiciona paths avulsos, e marca os ocultos. Para cada projeto, lê todas as Sessions.

**Files:**
- Create: `test/fixtures/workspace/projeto-a/.agent-session/FEAT-099/session.yml`
- Create: `test/fixtures/workspace/projeto-b/.agent-session/DISC-001/session.yml`
- Create: `test/fixtures/workspace/nao-projeto/.keep`
- Create: `test/discovery.test.ts`
- Create: `src/collector/discovery.ts`

- [ ] **Step 1: Criar uma árvore de workspace fake**

`test/fixtures/workspace/projeto-a/.agent-session/FEAT-099/session.yml`:

```yaml
task_id: "FEAT-099"
squad: "sdd"
feature_name: "feature do projeto A"
current_phase: "done"
last_activity_at: "2026-05-20T10:00:00Z"
planned_phases: ["specify", "implementation"]
```

`test/fixtures/workspace/projeto-b/.agent-session/DISC-001/session.yml`:

```yaml
task_id: "DISC-001"
squad: "discovery"
feature_name: "discovery do projeto B"
current_phase: "implementation"
last_activity_at: "2026-05-22T10:00:00Z"
planned_phases: ["frame", "investigate", "decide"]
```

E uma pasta SEM `.agent-session/` que NÃO deve virar projeto — `test/fixtures/workspace/nao-projeto/.keep` (arquivo vazio).

- [ ] **Step 2: Escrever o teste que falha**

`test/discovery.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverProjects } from "../src/collector/discovery.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

describe("discoverProjects", () => {
  it("acha só subpastas com .agent-session/", () => {
    const projects = discoverProjects({ roots: [workspace] });
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["projeto-a", "projeto-b"]); // nao-projeto fica de fora
  });

  it("lê as Sessions de cada projeto", () => {
    const projects = discoverProjects({ roots: [workspace] });
    const a = projects.find((p) => p.name === "projeto-a")!;
    expect(a.specs).toHaveLength(1);
    expect(a.specs[0].id).toBe("FEAT-099");
    expect(a.specs[0].status).toBe("done");
  });

  it("marca hidden os projetos em hide[]", () => {
    const projects = discoverProjects({ roots: [workspace], hide: ["projeto-b"] });
    const b = projects.find((p) => p.name === "projeto-b")!;
    expect(b.hidden).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar o teste pra confirmar que falha**

Run: `npx vitest run test/discovery.test.ts`
Expected: FAIL — `discoverProjects` não existe.

- [ ] **Step 4: Implementar `src/collector/discovery.ts`**

```typescript
import { readdirSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Project, Spec } from "../store/types.js";
import { parseSession } from "./session.js";

export interface DiscoveryOptions {
  roots: string[]; // pastas-raiz pra auto-scan (subpastas diretas)
  include?: string[]; // paths avulsos de projeto, fora das roots
  hide?: string[]; // nomes (ou paths) de projeto a marcar hidden
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Lê todas as Sessions em <projectPath>/.agent-session/<id>/session.yml. */
function loadSpecs(projectPath: string): Spec[] {
  const agentDir = join(projectPath, ".agent-session");
  if (!existsSync(agentDir)) return [];
  const specs: Spec[] = [];
  for (const entry of readdirSync(agentDir)) {
    const specDir = join(agentDir, entry);
    if (!isDir(specDir)) continue;
    const spec = parseSession(specDir);
    if (spec) specs.push(spec);
  }
  return specs;
}

function toProject(projectPath: string, hide: Set<string>): Project {
  const name = basename(projectPath);
  return {
    id: name,
    path: projectPath,
    name,
    specs: loadSpecs(projectPath),
    hidden: hide.has(name) || hide.has(projectPath),
  };
}

/**
 * Descoberta híbrida: auto-scan das subpastas diretas de cada root que tenham
 * .agent-session/, mais os paths avulsos de include[]. Dedup por path. Read-only.
 */
export function discoverProjects(opts: DiscoveryOptions): Project[] {
  const hide = new Set(opts.hide ?? []);
  const found = new Map<string, string>(); // path absoluto -> path

  for (const root of opts.roots) {
    if (!isDir(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = resolve(root, entry);
      if (!isDir(candidate)) continue;
      if (existsSync(join(candidate, ".agent-session"))) {
        found.set(candidate, candidate);
      }
    }
  }

  for (const p of opts.include ?? []) {
    const abs = resolve(p);
    if (existsSync(join(abs, ".agent-session"))) found.set(abs, abs);
  }

  return [...found.values()].map((p) => toProject(p, hide));
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Run: `npx vitest run test/discovery.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/workspace test/discovery.test.ts src/collector/discovery.ts
git commit -m "feat: descoberta hibrida de projetos (auto-scan + hide)"
```

---

### Task 5: CLI de dump — prova end-to-end

Um script que recebe uma pasta-raiz, roda o coletor e imprime o Store em JSON. É a prova viva de que o núcleo funciona sobre os seus projetos reais.

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implementar `src/cli.ts`**

```typescript
import { discoverProjects } from "./collector/discovery.js";

function main(): void {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("uso: npm run dump -- <pasta-raiz> [outra-raiz ...]");
    process.exit(1);
  }
  const projects = discoverProjects({ roots });
  console.log(JSON.stringify(projects, null, 2));
}

main();
```

- [ ] **Step 2: Rodar contra os fixtures pra confirmar a saída**

Run: `npm run dump -- test/fixtures/workspace`
Expected: JSON com `projeto-a` (FEAT-099, status "done") e `projeto-b` (DISC-001), cada um com `cost.totalCostUsd: null` (fixtures sem `costs/`).

- [ ] **Step 3: Rodar contra os SEUS projetos reais (smoke manual)**

Run: `npm run dump -- ~/Developer`
Expected: lista os repos reais com `.agent-session/`. Confira que pelo menos um spec com `costs/` mostra `totalCostUsd` não-nulo — e compare com o `$` do `report.html` daquela feature: **devem bater** (critério de aceitação do invariante de custo).

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — todos os testes das Tasks 2-4 verdes.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: CLI de dump do Store (prova end-to-end)"
```

---

## Self-review (cobertura do design)

- **§2 Coletor (lê disco, read-only)** → Tasks 2-4. Nenhuma escrita em `.agent-session/`. ✓
- **§3 modelo Project→Spec→Task** → Task 1 (tipos), Tasks 3-4 (montagem). ✓
- **§5 custo: somar `total_cost_usd`, nunca recalcular** → Task 2 + critério de aceite no smoke (Task 5, Step 3). ✓
- **§5 invariante: ausência explícita (null), `partial` em unpriced** → Task 2 (`emptyRollup`, flag `partial`). ✓
- **descoberta híbrida (auto-scan + hide)** → Task 4. ✓
- **Store em memória + saída inspecionável** → Task 5. ✓

**Fora deste plano (próximos):** servidor Express + WebSocket + watcher (Plano 2); UI React (Plano 3). O Store aqui é a fundação que ambos consomem.
