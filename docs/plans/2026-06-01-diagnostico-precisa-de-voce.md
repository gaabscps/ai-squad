# Diagnóstico da coluna "Precisa de você" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a coluna "Precisa de você" acionável — diagnóstico de bloqueio gerado por IA sob demanda (one-shot, streamado no drawer) + um prompt copiável pra retomar no Claude Code.

**Architecture:** Reusa a máquina do resumo (`src/summary/`): spawn do Claude → stream → cache → revelação typewriter. Extrai-se uma costura de adaptador (`src/ai/run.ts`) pra trocar de CLI no futuro; cria-se um domínio `src/attention/` que monta um `AttentionContext` (a partir de dados que já estão no Store) e o alimenta a duas saídas — um prompt de diagnóstico (IA) e um prompt de handoff (texto puro, sem IA). O front ganha um `AttentionPanel` no drawer, só para specs em atenção.

**Tech Stack:** Node + TypeScript (backend), WebSocket (`ws`), Vite + React (front), Vitest (testes). CLI `claude` via `child_process.spawn`.

---

## Decisões locked-in (do spec, com razão)

- **One-shot no app, conversa no Claude Code.** O diagnóstico não guarda estado; a ida-e-volta vive no Claude Code via handoff. Reusa toda a infra do resumo.
- **Costura de adaptador agora, só Claude no dia 1.** `runAgent(prompt, cb, {adapter})` com `claudeAdapter`. Sem seletor de modelo visível (UI viria quando houver 2º adaptador).
- **Handoff = só gera o prompt.** O app produz texto copiável; o usuário abre o Claude Code na mão. Nunca dá spawn de terminal.
- **Trava de `ANTHROPIC_API_KEY` no spawn.** Garante "nunca API on-demand", só quota da assinatura.
- **Não duplicar o cru.** O drawer já mostra a `timeline` (seção "Linha do tempo") e os `findings` (via `TaskItem` → "Detalhes técnicos"). O `AttentionPanel` só acrescenta o diagnóstico + o botão de handoff; o cru continua nas seções existentes logo abaixo — é a "fonte ao lado da síntese" sem código repetido.
- **Cache por fingerprint do contexto.** Reabrir o drawer não re-spawna; o cache invalida sozinho quando timeline/findings mudam.

## Estrutura de arquivos

**Backend (novos):**
- `src/ai/run.ts` — costura: `AgentAdapter`, `runAgent`, `claudeAdapter`. Responsável por spawnar uma CLI, fazer streaming linha-a-linha e traduzir via adaptador. (importa `ParsedEvent`/`parseStreamLine` do `src/summary/parse.ts` — reuso do parser já testado).
- `src/attention/context.ts` — `AttentionContext` + `buildAttentionContext(spec, projectPath)` (função pura).
- `src/attention/prompt.ts` — `buildDiagnosisPrompt(ctx)` (prompt one-shot, robusto a vazio).
- `src/attention/handoff.ts` — `buildHandoffPrompt(ctx)` (texto copiável, sem IA).
- `src/attention/fingerprint.ts` — `contextFingerprint(ctx)`.
- `src/attention/cache.ts` — `readDiagnosis`/`writeDiagnosis` (chave `projectId/specId`).
- `src/attention/handler.ts` — `makeDiagnosisHandler(store, deps)` (rota WS `attention:fetch`/`attention:generate`).

**Backend (modificados):**
- `src/summary/service.ts` — `runSummary` vira wrapper fino sobre `runAgent(..., {adapter: claudeAdapter})`.
- `src/ui/app.ts` — liga o handler de diagnóstico no roteamento WS.

**Front (novos):**
- `web/src/state/attentionClient.ts` — cliente WS singleton (espelha `summaryClient`), chave `projectId|specId`.
- `web/src/state/useAttentionDiagnosis.ts` — máquina de estados (espelha `useTaskSummary`) + guarda o texto de handoff.
- `web/src/components/AttentionPanel.tsx` — bloco de diagnóstico + botão "Copiar prompt pro Claude Code".

**Front (modificados):**
- `web/src/components/DetailDrawer.tsx` — renderiza `AttentionPanel` quando a spec está em atenção.
- `web/src/app.css` — estilos do painel (tokens light, espelha `.task-summary`).

---

## Task 1: Costura de adaptador — `src/ai/run.ts`

**Files:**
- Create: `src/ai/run.ts`
- Test: `src/ai/run.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/ai/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runAgent, claudeAdapter } from "./run.js";

/** Processo falso: stdout/stderr são EventEmitters; stdin.write/end espionáveis. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("runAgent + claudeAdapter", () => {
  it("spawna o comando do adaptador, manda o prompt no stdin e emite chunk + done", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();

    runAgent("PROMPT", { onChunk, onDone, onError }, { adapter: claudeAdapter, spawnFn });

    expect(spawnFn).toHaveBeenCalledWith("claude", expect.arrayContaining(["--print", "--output-format=stream-json"]), expect.any(Object));
    expect(proc.stdin.write).toHaveBeenCalledWith("PROMPT");
    expect(proc.stdin.end).toHaveBeenCalled();

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Oi" } } }) + "\n"));
    expect(onChunk).toHaveBeenCalledWith("Oi");

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Oi mundo", total_cost_usd: 0.02 }) + "\n"));
    expect(onDone).toHaveBeenCalledWith("Oi mundo", 0.02);
  });

  it("remove ANTHROPIC_API_KEY do env do filho (trava: nunca API on-demand)", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    process.env.ANTHROPIC_API_KEY = "sk-fake";
    try {
      runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { adapter: claudeAdapter, spawnFn });
      const opts = spawnFn.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("emite error quando a CLI não existe (ENOENT) citando o comando", () => {
    const proc = fakeProc();
    const onError = vi.fn();
    runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError }, { adapter: claudeAdapter, spawnFn: (() => proc) as any });
    proc.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/claude/i));
  });

  it("cancel() mata o processo", () => {
    const proc = fakeProc();
    const handle = runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { adapter: claudeAdapter, spawnFn: (() => proc) as any });
    handle.cancel();
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/ai/run.test.ts`
Expected: FAIL — `Cannot find module './run.js'`.

- [ ] **Step 3: Implementar `src/ai/run.ts`**

```ts
import { spawn as realSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { parseStreamLine, type ParsedEvent } from "../summary/parse.js";

/**
 * Adaptador de uma CLI de IA: como montar o comando e traduzir cada linha da
 * saída em evento. Dia 1 só existe o do Claude; a interface é a costura pra
 * plugar Codex/Gemini/etc. depois sem mexer no streaming.
 */
export interface AgentAdapter {
  command: string;
  buildArgs: () => string[];
  parseLine: (line: string) => ParsedEvent | null;
}

export interface AgentCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null) => void;
  onError: (message: string) => void;
}

export interface AgentHandle {
  cancel: () => void;
}

export interface RunAgentDeps {
  adapter: AgentAdapter;
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

const CLAUDE_ARGS = ["--print", "--output-format=stream-json", "--include-partial-messages", "--model", "sonnet", "--verbose"];

/** Adaptador do Claude CLI: reusa o parser de stream-json já testado em summary/parse. */
export const claudeAdapter: AgentAdapter = {
  command: "claude",
  buildArgs: () => CLAUDE_ARGS,
  parseLine: parseStreamLine,
};

/**
 * Roda uma CLI de IA com o prompt via stdin (sem interpolação em shell → sem injeção)
 * e faz streaming dos pedaços de texto pelos callbacks. Processa linha a linha (NDJSON).
 * Trava "nunca API on-demand": remove ANTHROPIC_API_KEY do env do filho, forçando o
 * uso da quota da assinatura (OAuth) em vez da API metrada.
 */
export function runAgent(prompt: string, cb: AgentCallbacks, deps: RunAgentDeps): AgentHandle {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const { adapter } = deps;
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawnFn(adapter.command, adapter.buildArgs(), { cwd: deps.cwd ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"], env });

  let buffer = "";
  let done = false;
  // StringDecoder segura bytes de um caractere multi-byte (ã, ç) partido entre chunks.
  const decoder = new StringDecoder("utf8");
  const finishDone = (text: string, costUsd: number | null) => { if (!done) { done = true; cb.onDone(text, costUsd); } };
  const finishError = (msg: string) => { if (!done) { done = true; cb.onError(msg); } };

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const ev = adapter.parseLine(line);
      if (!ev) continue;
      if (ev.kind === "chunk") cb.onChunk(ev.text);
      else if (ev.kind === "done") finishDone(ev.text, ev.costUsd);
      else finishError(ev.message);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    finishError(err.code === "ENOENT" ? `${adapter.command} não encontrado (instale/cheque o PATH)` : `falha ao rodar ${adapter.command}: ${err.message}`);
  });

  proc.on("close", (code: number | null) => {
    if (!done) finishError(code === 0 ? "geração terminou sem resultado" : `${adapter.command} saiu com código ${code}`);
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();

  return { cancel: () => proc.kill() };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/ai/run.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/ai/run.ts src/ai/run.test.ts
git commit -m "feat(ai): costura de adaptador runAgent + claudeAdapter (trava API key)"
```

---

## Task 2: Refatorar `runSummary` pra usar a costura

**Files:**
- Modify: `src/summary/service.ts`

- [ ] **Step 1: Rodar os testes do summary pra confirmar verde ANTES**

Run: `npx vitest run src/summary/service.test.ts`
Expected: PASS (5 testes) — é a rede de segurança do refactor.

- [ ] **Step 2: Reescrever `src/summary/service.ts` como wrapper**

Substitua TODO o conteúdo por:

```ts
import type { spawn as realSpawn } from "node:child_process";
import { runAgent, claudeAdapter, type AgentHandle } from "../ai/run.js";

export interface SummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null) => void;
  onError: (message: string) => void;
}

export type SummaryHandle = AgentHandle;

export interface SummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

/** Resumo de task = runAgent com o adaptador do Claude. Mantém a assinatura antiga. */
export function runSummary(prompt: string, cb: SummaryCallbacks, deps: SummaryDeps = {}): SummaryHandle {
  return runAgent(prompt, cb, { adapter: claudeAdapter, spawnFn: deps.spawnFn, cwd: deps.cwd });
}
```

- [ ] **Step 3: Rodar os testes do summary de novo (não pode quebrar)**

Run: `npx vitest run src/summary/service.test.ts`
Expected: PASS (5 testes). A mensagem de ENOENT virou "claude não encontrado…" (ainda casa `/claude/i`); os args incluem os esperados; o command é "claude".

- [ ] **Step 4: Commit**

```bash
git add src/summary/service.ts
git commit -m "refactor(summary): runSummary delega a runAgent (sem mudança de comportamento)"
```

---

## Task 3: `AttentionContext` + builder — `src/attention/context.ts`

**Files:**
- Create: `src/attention/context.ts`
- Test: `src/attention/context.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { buildAttentionContext } from "./context.js";
import type { Spec } from "../store/types.js";

function makeSpec(over: Partial<Spec> = {}): Spec {
  return {
    id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation",
    plannedPhases: ["specify", "plan", "tasks", "implementation"],
    status: "blocked", tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: null, timeline: [], cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null },
    ...over,
  };
}

describe("buildAttentionContext", () => {
  it("achata findings dos dispatches com loc montado e mapeia notes da timeline", () => {
    const spec = makeSpec({
      timeline: [{ kind: "blocked", timestamp: "2026-06-01T14:02:00Z", note: "reviewer rejeitou" }],
      tasks: [{ id: "T-008", state: "blocked", loops: 2, dispatches: [
        { role: "code-reviewer", loop: 2, status: "rejected", summary: null, filesChanged: [], findings: [{ severity: "error", file: "auth.ts", line: 42, text: "sem validação" }], testEvidence: [], tokens: null },
      ] }],
    });
    const ctx = buildAttentionContext(spec, "/proj/login");
    expect(ctx.specId).toBe("FEAT-001");
    expect(ctx.projectPath).toBe("/proj/login");
    expect(ctx.status).toBe("blocked");
    expect(ctx.notes).toEqual([{ kind: "blocked", timestamp: "2026-06-01T14:02:00Z", note: "reviewer rejeitou" }]);
    expect(ctx.findings).toEqual([{ severity: "error", loc: "auth.ts:42", text: "sem validação" }]);
  });

  it("é robusto a vazio: sem timeline e sem tasks → arrays vazios", () => {
    const ctx = buildAttentionContext(makeSpec(), "/p");
    expect(ctx.notes).toEqual([]);
    expect(ctx.findings).toEqual([]);
    expect(ctx.auditException).toBe(false);
  });

  it("finding sem file vira loc null", () => {
    const spec = makeSpec({ tasks: [{ id: "T-1", state: "blocked", loops: 1, dispatches: [
      { role: "qa", loop: 1, status: "fail", summary: null, filesChanged: [], findings: [{ severity: "warning", file: null, line: null, text: "fluxo X falha" }], testEvidence: [], tokens: null },
    ] }] });
    expect(buildAttentionContext(spec, "/p").findings[0].loc).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/context.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/context.ts`**

```ts
import type { Spec } from "../store/types.js";

/**
 * Contexto normalizado de uma spec em atenção. Derivado SÓ de campos que já
 * existem no Store (status, timeline, dispatches). Alimenta tanto o prompt de
 * diagnóstico (IA) quanto o de handoff (texto puro). Robusto a dado escasso.
 */
export interface AttentionContext {
  specId: string;
  title: string;
  status: string;
  phase: string;
  plannedPhases: string[];
  projectPath: string;
  auditException: boolean;
  notes: { kind: string; timestamp: string; note: string }[];
  findings: { severity: string; loc: string | null; text: string }[];
}

export function buildAttentionContext(spec: Spec, projectPath: string): AttentionContext {
  const findings = spec.tasks
    .flatMap((t) => t.dispatches)
    .flatMap((d) => d.findings)
    .map((f) => ({
      severity: f.severity,
      loc: f.file ? `${f.file}${f.line != null ? `:${f.line}` : ""}` : null,
      text: f.text,
    }));
  return {
    specId: spec.id,
    title: spec.title,
    status: spec.status,
    phase: spec.phase,
    plannedPhases: spec.plannedPhases,
    projectPath,
    auditException: spec.health.auditException,
    notes: spec.timeline.map((e) => ({ kind: e.kind, timestamp: e.timestamp, note: e.note })),
    findings,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/context.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/context.ts src/attention/context.test.ts
git commit -m "feat(attention): AttentionContext + builder a partir do Store"
```

---

## Task 4: Prompt de diagnóstico — `src/attention/prompt.ts`

**Files:**
- Create: `src/attention/prompt.ts`
- Test: `src/attention/prompt.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { buildDiagnosisPrompt } from "./prompt.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "implementation", plannedPhases: [], projectPath: "/p", auditException: false, notes: [], findings: [], ...over };
}

describe("buildDiagnosisPrompt", () => {
  it("inclui a instrução anti-alucinação (não invente se vazio)", () => {
    expect(buildDiagnosisPrompt(ctx())).toMatch(/não invente/i);
  });

  it("com dados vazios, sinaliza ausência em vez de prometer conteúdo", () => {
    const p = buildDiagnosisPrompt(ctx());
    expect(p).toContain("(sem anotações na linha do tempo)");
    expect(p).toContain("(sem findings de review)");
  });

  it("renderiza notes e findings quando existem", () => {
    const p = buildDiagnosisPrompt(ctx({
      notes: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
      findings: [{ severity: "error", loc: "auth.ts:42", text: "sem validação" }],
    }));
    expect(p).toContain("reviewer rejeitou");
    expect(p).toContain("auth.ts:42");
    expect(p).toContain("sem validação");
  });

  it("pede os 3 blocos (por que / o que pedem / próximo passo)", () => {
    const p = buildDiagnosisPrompt(ctx());
    expect(p).toMatch(/POR QUE/);
    expect(p).toMatch(/PR[ÓO]XIMO PASSO/i);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/prompt.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/prompt.ts`**

```ts
import type { AttentionContext } from "./context.js";

const TONE = [
  "Você explica para um dev front-end (~3 anos) que estuda nestas explicações.",
  "Seja técnico, mas didático: diga o QUE, o PORQUÊ e o MECANISMO por baixo.",
  "Defina todo termo fora do domínio front na primeira aparição, com uma analogia curta.",
  "Comece pelo concreto. Português claro e conectado, sem estilo telegráfico.",
  "Use SÓ os dados abaixo. Se não houver dados suficientes para algum bloco, diga isso — NÃO invente.",
].join(" ");

function renderNotes(ctx: AttentionContext): string {
  if (ctx.notes.length === 0) return "(sem anotações na linha do tempo)";
  return ctx.notes.map((n) => `- [${n.timestamp}] (${n.kind}) ${n.note}`).join("\n");
}

function renderFindings(ctx: AttentionContext): string {
  if (ctx.findings.length === 0) return "(sem findings de review)";
  return ctx.findings.map((f) => `- [${f.severity}] ${f.loc ?? ""} ${f.text}`).join("\n");
}

/** Monta o prompt one-shot de diagnóstico: tom didático + contexto + pedido em 3 blocos. */
export function buildDiagnosisPrompt(ctx: AttentionContext): string {
  return [
    TONE,
    "",
    `Feature: ${ctx.title} (${ctx.specId})`,
    `Status: ${ctx.status}${ctx.auditException ? " + exceção de auditoria" : ""}`,
    `Fase atual: ${ctx.phase}`,
    "",
    "Linha do tempo:",
    renderNotes(ctx),
    "",
    "Findings de review:",
    renderFindings(ctx),
    "",
    "Explique, para esse dev, em 3 blocos curtos:",
    "(1) POR QUE parou; (2) O QUE estão te pedindo; (3) PRÓXIMO PASSO concreto.",
    "Se faltar dado para algum bloco, diga explicitamente que não há informação suficiente.",
  ].join("\n");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/prompt.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/prompt.ts src/attention/prompt.test.ts
git commit -m "feat(attention): prompt de diagnóstico one-shot (robusto a dado escasso)"
```

---

## Task 5: Prompt de handoff — `src/attention/handoff.ts`

**Files:**
- Create: `src/attention/handoff.ts`
- Test: `src/attention/handoff.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { buildHandoffPrompt } from "./handoff.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "implementation", plannedPhases: [], projectPath: "/proj/login", auditException: false, notes: [], findings: [], ...over };
}

describe("buildHandoffPrompt", () => {
  it("inclui caminho do projeto, spec id e o diretório .agent-session", () => {
    const p = buildHandoffPrompt(ctx());
    expect(p).toContain("/proj/login");
    expect(p).toContain("FEAT-001");
    expect(p).toContain("/proj/login/.agent-session/FEAT-001/");
  });

  it("embute notes e findings quando existem", () => {
    const p = buildHandoffPrompt(ctx({
      notes: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
      findings: [{ severity: "error", loc: "auth.ts:42", text: "sem validação" }],
    }));
    expect(p).toContain("reviewer rejeitou");
    expect(p).toContain("auth.ts:42");
  });

  it("não chama IA — é texto determinístico (mesmo ctx → mesmo texto)", () => {
    expect(buildHandoffPrompt(ctx())).toBe(buildHandoffPrompt(ctx()));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/handoff.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/handoff.ts`**

```ts
import type { AttentionContext } from "./context.js";

function renderNotes(ctx: AttentionContext): string {
  if (ctx.notes.length === 0) return "(sem anotações)";
  return ctx.notes.map((n) => `- [${n.timestamp}] (${n.kind}) ${n.note}`).join("\n");
}

function renderFindings(ctx: AttentionContext): string {
  if (ctx.findings.length === 0) return "(sem findings)";
  return ctx.findings.map((f) => `- [${f.severity}] ${f.loc ?? ""} ${f.text}`).join("\n");
}

/**
 * Bloco copiável pro Claude Code retomar a feature. Texto puro, SEM IA: junta o
 * contexto que o app já tem e aponta pros artefatos no disco. O usuário cola
 * numa sessão do Claude Code e abre na mão.
 */
export function buildHandoffPrompt(ctx: AttentionContext): string {
  return [
    "Estou retomando uma feature travada no meu pipeline ai-squad.",
    `Projeto: ${ctx.projectPath}`,
    `Spec: ${ctx.specId} — ${ctx.title}`,
    `Status: ${ctx.status}${ctx.auditException ? " (exceção de auditoria)" : ""} · fase ${ctx.phase}`,
    "",
    "Linha do tempo:",
    renderNotes(ctx),
    "",
    "Findings de review:",
    renderFindings(ctx),
    "",
    `Me ajude a entender por que parou e a retomar. Os artefatos estão em ${ctx.projectPath}/.agent-session/${ctx.specId}/.`,
  ].join("\n");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/handoff.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/handoff.ts src/attention/handoff.test.ts
git commit -m "feat(attention): prompt de handoff copiável pro Claude Code (sem IA)"
```

---

## Task 6: Fingerprint do contexto — `src/attention/fingerprint.ts`

**Files:**
- Create: `src/attention/fingerprint.ts`
- Test: `src/attention/fingerprint.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { contextFingerprint } from "./fingerprint.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "impl", plannedPhases: [], projectPath: "/p", auditException: false, notes: [], findings: [], ...over };
}

describe("contextFingerprint", () => {
  it("é estável para o mesmo contexto", () => {
    expect(contextFingerprint(ctx())).toBe(contextFingerprint(ctx()));
  });

  it("muda quando uma note muda", () => {
    const a = contextFingerprint(ctx({ notes: [{ kind: "blocked", timestamp: "T", note: "x" }] }));
    const b = contextFingerprint(ctx({ notes: [{ kind: "blocked", timestamp: "T", note: "y" }] }));
    expect(a).not.toBe(b);
  });

  it("muda quando o status muda", () => {
    expect(contextFingerprint(ctx({ status: "blocked" }))).not.toBe(contextFingerprint(ctx({ status: "escalated" })));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/fingerprint.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/fingerprint.ts`**

```ts
import { createHash } from "node:crypto";
import type { AttentionContext } from "./context.js";

/**
 * Hash determinístico do que define o diagnóstico (status, fase, notes, findings).
 * Se o fingerprint atual difere do gravado no cache, o diagnóstico está velho.
 */
export function contextFingerprint(ctx: AttentionContext): string {
  const shape = {
    specId: ctx.specId,
    status: ctx.status,
    auditException: ctx.auditException,
    phase: ctx.phase,
    notes: ctx.notes.map((n) => [n.kind, n.timestamp, n.note]),
    findings: ctx.findings.map((f) => [f.severity, f.loc, f.text]),
  };
  return createHash("sha1").update(JSON.stringify(shape)).digest("hex");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/fingerprint.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/fingerprint.ts src/attention/fingerprint.test.ts
git commit -m "feat(attention): fingerprint do contexto pra invalidar cache"
```

---

## Task 7: Cache do diagnóstico — `src/attention/cache.ts`

**Files:**
- Create: `src/attention/cache.ts`
- Test: `src/attention/cache.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { readDiagnosis, writeDiagnosis } from "./cache.js";

const ROOT = join(process.cwd(), ".aios-cache-test-attention");
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("cache do diagnóstico", () => {
  it("grava e lê de volta, chaveado por projectId/specId", () => {
    const rec = writeDiagnosis(ROOT, "proj-abc", "FEAT-001", { text: "porque X", fingerprint: "fp1", costUsd: 0.01 }, () => "2026-06-01T00:00:00Z");
    expect(rec.generatedAt).toBe("2026-06-01T00:00:00Z");
    const got = readDiagnosis(ROOT, "proj-abc", "FEAT-001");
    expect(got?.text).toBe("porque X");
    expect(got?.fingerprint).toBe("fp1");
  });

  it("readDiagnosis devolve null quando não existe", () => {
    expect(readDiagnosis(ROOT, "nada", "FEAT-999")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/cache.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/cache.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedDiagnosis {
  text: string;
  generatedAt: string;
  fingerprint: string;
  costUsd: number | null;
}

// Inclui projectId porque specId (FEAT-001) NÃO é único entre projetos.
function fileFor(cacheRoot: string, projectId: string, specId: string): string {
  return join(cacheRoot, "diagnoses", projectId, `${specId}.json`);
}

/** Lê o diagnóstico cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readDiagnosis(cacheRoot: string, projectId: string, specId: string): CachedDiagnosis | null {
  const file = fileFor(cacheRoot, projectId, specId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedDiagnosis;
    if (typeof parsed?.text === "string" && typeof parsed?.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o diagnóstico e devolve o registro (com generatedAt carimbado pelo `now`). */
export function writeDiagnosis(
  cacheRoot: string,
  projectId: string,
  specId: string,
  data: { text: string; fingerprint: string; costUsd: number | null },
  now: () => string,
): CachedDiagnosis {
  const file = fileFor(cacheRoot, projectId, specId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedDiagnosis = { text: data.text, fingerprint: data.fingerprint, costUsd: data.costUsd, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/cache.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/cache.ts src/attention/cache.test.ts
git commit -m "feat(attention): cache do diagnóstico por projectId/specId"
```

---

## Task 8: Handler WS — `src/attention/handler.ts`

**Files:**
- Create: `src/attention/handler.ts`
- Test: `src/attention/handler.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { makeDiagnosisHandler } from "./handler.js";
import type { Spec, Project } from "../store/types.js";

const ROOT = join(process.cwd(), ".aios-cache-test-handler");
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

function makeStore(spec: Spec, projectPath = "/proj/login") {
  const project: Project = { id: "proj-abc", path: projectPath, name: "login", specs: [spec], hidden: false };
  return { getSnapshot: () => [project] } as any;
}

const blockedSpec: Spec = {
  id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation", plannedPhases: [],
  status: "blocked", tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
  lastActivityAt: null, timeline: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
  cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null },
};

describe("makeDiagnosisHandler", () => {
  it("no fetch, sempre manda o handoff (mesmo sem cache)", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));
    const handoff = sent.find((m) => m.type === "attention:handoff");
    expect(handoff).toBeTruthy();
    expect(handoff.text).toContain("/proj/login/.agent-session/FEAT-001/");
  });

  it("no generate, streama chunk + done e grava cache", () => {
    const proc = fakeProc();
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT, spawnFn: (() => proc) as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Parou porque" } } }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Parou porque o reviewer rejeitou", total_cost_usd: 0.03 }) + "\n"));

    expect(sent.some((m) => m.type === "attention:chunk" && m.delta === "Parou porque")).toBe(true);
    const done = sent.find((m) => m.type === "attention:done");
    expect(done.text).toBe("Parou porque o reviewer rejeitou");
    expect(done.costUsd).toBe(0.03);
  });

  it("generate de spec inexistente → error", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "NOPE" }, (d) => sent.push(JSON.parse(d)));
    expect(sent.some((m) => m.type === "attention:error")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/attention/handler.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/attention/handler.ts`**

```ts
import { join } from "node:path";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Spec } from "../store/types.js";
import { runAgent, claudeAdapter, type AgentHandle } from "../ai/run.js";
import { buildAttentionContext } from "./context.js";
import { buildDiagnosisPrompt } from "./prompt.js";
import { buildHandoffPrompt } from "./handoff.js";
import { contextFingerprint } from "./fingerprint.js";
import { readDiagnosis, writeDiagnosis } from "./cache.js";

export interface AttentionMsg {
  type: "attention:fetch" | "attention:generate";
  projectId?: unknown;
  specId?: unknown;
  force?: unknown;
}
type Send = (data: string) => void;

export interface DiagnosisDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

// Casa por projectId+specId: specId (FEAT-001) se repete entre projetos.
function findSpec(store: Store, projectId: string, specId: string): { spec: Spec; projectPath: string } | null {
  for (const p of store.getSnapshot()) {
    if (p.id !== projectId) continue;
    const spec = p.specs.find((s) => s.id === specId);
    if (spec) return { spec, projectPath: p.path };
  }
  return null;
}

/**
 * Handler de diagnóstico ligado a UM socket (o `send`). No fetch, sempre manda o
 * handoff (texto puro) + o diagnóstico cacheado se houver. No generate, spawna o
 * Claude via runAgent, streama e grava o cache. Guarda a geração ativa por chave
 * projectId|specId pra cancelar duplicatas.
 */
export function makeDiagnosisHandler(store: Store, deps: DiagnosisDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  const active = new Map<string, { id: number; handle: AgentHandle }>();
  let nextId = 0;

  return function handle(msg: AttentionMsg, send: Send): void {
    if (typeof msg.projectId !== "string" || typeof msg.specId !== "string") return;
    const projectId = msg.projectId, specId = msg.specId;
    const key = `${projectId}|${specId}`;
    const found = findSpec(store, projectId, specId);

    if (msg.type === "attention:fetch") {
      if (found) {
        const ctx = buildAttentionContext(found.spec, found.projectPath);
        send(JSON.stringify({ type: "attention:handoff", projectId, specId, text: buildHandoffPrompt(ctx) }));
        const cached = readDiagnosis(cacheRoot, projectId, specId);
        if (cached) {
          const stale = contextFingerprint(ctx) !== cached.fingerprint;
          send(JSON.stringify({ type: "attention:cached", projectId, specId, text: cached.text, generatedAt: cached.generatedAt, costUsd: cached.costUsd ?? null, stale }));
        }
      }
      return;
    }

    if (msg.type === "attention:generate") {
      if (!found) {
        send(JSON.stringify({ type: "attention:error", projectId, specId, message: "spec não encontrada" }));
        return;
      }
      active.get(key)?.handle.cancel();
      const ctx = buildAttentionContext(found.spec, found.projectPath);
      const prompt = buildDiagnosisPrompt(ctx);
      const fingerprint = contextFingerprint(ctx);
      const id = ++nextId;
      const clearIfCurrent = () => { if (active.get(key)?.id === id) active.delete(key); };
      let acc = "";
      const handle = runAgent(prompt, {
        onChunk: (delta) => { acc += delta; send(JSON.stringify({ type: "attention:chunk", projectId, specId, delta })); },
        onDone: (full, costUsd) => {
          const text = full || acc;
          const rec = writeDiagnosis(cacheRoot, projectId, specId, { text, fingerprint, costUsd }, now);
          clearIfCurrent();
          send(JSON.stringify({ type: "attention:done", projectId, specId, text, generatedAt: rec.generatedAt, costUsd: rec.costUsd }));
        },
        onError: (message) => { clearIfCurrent(); send(JSON.stringify({ type: "attention:error", projectId, specId, message })); },
      }, { adapter: claudeAdapter, spawnFn: deps.spawnFn });
      active.set(key, { id, handle });
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/attention/handler.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/attention/handler.ts src/attention/handler.test.ts
git commit -m "feat(attention): handler WS de diagnóstico (fetch=handoff+cache, generate=stream)"
```

---

## Task 9: Ligar o handler no roteamento WS — `src/ui/app.ts`

**Files:**
- Modify: `src/ui/app.ts`

- [ ] **Step 1: Importar o handler**

No topo de `src/ui/app.ts`, logo após a linha `import { makeSummaryHandler } from "../summary/handler.js";`, adicione:

```ts
import { makeDiagnosisHandler } from "../attention/handler.js";
```

- [ ] **Step 2: Instanciar por conexão e rotear as mensagens**

Em `src/ui/app.ts`, dentro de `wss.on("connection", (socket) => {`, logo após a linha `const onSummary = makeSummaryHandler(store);`, adicione:

```ts
    const onDiagnosis = makeDiagnosisHandler(store);
```

Depois, dentro do `socket.on("message", ...)`, logo após o bloco `if (msg.type === "summary:fetch" || msg.type === "summary:generate") { ... return; }`, adicione:

```ts
      if (msg.type === "attention:fetch" || msg.type === "attention:generate") {
        onDiagnosis(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
```

- [ ] **Step 3: Verificar que a suíte inteira do backend continua verde**

Run: `npx vitest run src/ test/`
Expected: PASS (toda a suíte; nada quebrou ao adicionar a rota).

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.ts
git commit -m "feat(ui): roteia attention:fetch/generate pelo WS existente"
```

---

## Task 10: Cliente WS do front — `web/src/state/attentionClient.ts`

**Files:**
- Create: `web/src/state/attentionClient.ts`
- Test: `web/src/state/attentionClient.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi } from "vitest";
import { createAttentionClient } from "./attentionClient";

function fakeSocket() {
  const s: any = { readyState: 1, sent: [] as string[], onopen: null, onmessage: null, onclose: null };
  s.send = (m: string) => s.sent.push(m);
  return s;
}

describe("attentionClient", () => {
  it("fetch envia attention:fetch com projectId/specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    c.fetch("proj-abc", "FEAT-001");
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" });
  });

  it("roteia a mensagem do servidor ao subscriber da chave projectId|specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    const fn = vi.fn();
    c.subscribe("proj-abc|FEAT-001", fn);
    socket.onmessage({ data: JSON.stringify({ type: "attention:done", projectId: "proj-abc", specId: "FEAT-001", text: "ok" }) });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: "attention:done", text: "ok" }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/state/attentionClient.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `web/src/state/attentionClient.ts`**

```ts
export interface AttentionServerMsg {
  type: "attention:handoff" | "attention:cached" | "attention:chunk" | "attention:done" | "attention:error";
  projectId: string;
  specId: string;
  text?: string;
  delta?: string;
  generatedAt?: string;
  costUsd?: number | null;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: AttentionServerMsg) => void;
type SocketFactory = () => WebSocket;

export interface AttentionClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string) => void;
  generate: (projectId: string, specId: string, force?: boolean) => void;
}

/**
 * Cliente WS de diagnóstico. Conecta sob demanda, mantém fila até o socket abrir,
 * e roteia cada mensagem ao subscriber da chave `projectId|specId`. Fábrica de
 * socket injetável pra teste.
 */
export function createAttentionClient(makeSocket: SocketFactory): AttentionClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: AttentionServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (typeof msg?.projectId !== "string" || typeof msg?.specId !== "string") return;
      const fns = subs.get(`${msg.projectId}|${msg.specId}`);
      if (fns) for (const fn of fns) fn(msg);
    };
    socket.onclose = () => { socket = null; };
  };

  const sendOrQueue = (payload: object) => {
    ensure();
    const data = JSON.stringify(payload);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
    else queue.push(data);
  };

  return {
    subscribe(key, fn) {
      ensure();
      const set = subs.get(key) ?? new Set<Handler>();
      set.add(fn);
      subs.set(key, set);
      return () => { set.delete(fn); if (set.size === 0) subs.delete(key); };
    },
    fetch(projectId, specId) { sendOrQueue({ type: "attention:fetch", projectId, specId }); },
    generate(projectId, specId, force = false) { sendOrQueue({ type: "attention:generate", projectId, specId, force }); },
  };
}

/** Singleton padrão da app: socket real em /ws (mesmo endpoint do snapshot). */
export const attentionClient: AttentionClient = createAttentionClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run web/src/state/attentionClient.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/attentionClient.ts web/src/state/attentionClient.test.ts
git commit -m "feat(web): cliente WS de diagnóstico (chave projectId|specId)"
```

---

## Task 11: Hook de estado — `web/src/state/useAttentionDiagnosis.ts`

**Files:**
- Create: `web/src/state/useAttentionDiagnosis.ts`
- Test: `web/src/state/useAttentionDiagnosis.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttentionDiagnosis } from "./useAttentionDiagnosis";
import type { AttentionClient, AttentionServerMsg } from "./attentionClient";

function fakeClient() {
  let handler: ((m: AttentionServerMsg) => void) | null = null;
  const client: AttentionClient = {
    subscribe: (_k, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: vi.fn(),
    generate: vi.fn(),
  };
  return { client, emit: (m: AttentionServerMsg) => handler && handler(m) };
}

describe("useAttentionDiagnosis", () => {
  it("ao montar, faz fetch", () => {
    const { client } = fakeClient();
    renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    expect(client.fetch).toHaveBeenCalledWith("p", "FEAT-001");
  });

  it("guarda o handoff que chega na mensagem attention:handoff", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    act(() => emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" }));
    expect(result.current.handoff).toBe("COLE ISSO");
  });

  it("acumula chunks no texto e marca streaming", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    act(() => result.current.generate());
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "Parou " }));
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "porque X" }));
    expect(result.current.text).toBe("Parou porque X");
    expect(result.current.state).toBe("streaming");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/state/useAttentionDiagnosis.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `web/src/state/useAttentionDiagnosis.ts`**

```ts
import { useEffect, useRef, useState, useCallback } from "react";
import { attentionClient as defaultClient, type AttentionClient, type AttentionServerMsg } from "./attentionClient";

export type DiagnosisState = "empty" | "loading" | "streaming" | "ready" | "stale" | "error";

export interface AttentionDiagnosis {
  state: DiagnosisState;
  text: string;
  generatedAt: string | null;
  costUsd: number | null;
  streamed: boolean;
  error: string | null;
  /** Prompt copiável pro Claude Code; chega no attention:handoff, independente do diagnóstico. */
  handoff: string;
  generate: () => void;
  regenerate: () => void;
}

/**
 * Máquina de estados do diagnóstico de uma spec em atenção. Ao montar, faz `fetch`
 * (lê cache + recebe o handoff). `generate`/`regenerate` chamam o CLI (gasta quota,
 * só por clique). Acumula os chunks de streaming em `text`. Cliente injetável.
 */
export function useAttentionDiagnosis(projectId: string, specId: string, client: AttentionClient = defaultClient): AttentionDiagnosis {
  const [state, setState] = useState<DiagnosisState>("empty");
  const [text, setText] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState("");
  const textRef = useRef("");

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: AttentionServerMsg) => {
      if (m.type === "attention:handoff") {
        setHandoff(m.text ?? "");
      } else if (m.type === "attention:cached") {
        textRef.current = m.text ?? "";
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setStreamed(false);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "attention:chunk") {
        textRef.current += m.delta ?? "";
        setText(textRef.current);
        setStreamed(true);
        setState("streaming");
      } else if (m.type === "attention:done") {
        textRef.current = m.text ?? textRef.current;
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setState("ready");
      } else if (m.type === "attention:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    client.fetch(projectId, specId);
    return off;
  }, [projectId, specId, client]);

  const start = useCallback((force: boolean) => {
    textRef.current = "";
    setText("");
    setError(null);
    setCostUsd(null);
    setStreamed(false);
    setState("loading");
    client.generate(projectId, specId, force);
  }, [projectId, specId, client]);

  return {
    state, text, generatedAt, costUsd, streamed, error, handoff,
    generate: () => start(false),
    regenerate: () => start(true),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run web/src/state/useAttentionDiagnosis.test.tsx`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/useAttentionDiagnosis.ts web/src/state/useAttentionDiagnosis.test.tsx
git commit -m "feat(web): hook useAttentionDiagnosis (estado + handoff)"
```

---

## Task 12: Painel de diagnóstico — `web/src/components/AttentionPanel.tsx`

**Files:**
- Create: `web/src/components/AttentionPanel.tsx`
- Test: `web/src/components/AttentionPanel.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttentionPanel } from "./AttentionPanel";
import type { AttentionClient, AttentionServerMsg } from "../state/attentionClient";

function fakeClient(): { client: AttentionClient; emit: (m: AttentionServerMsg) => void } {
  let handler: ((m: AttentionServerMsg) => void) | null = null;
  return {
    client: { subscribe: (_k, fn) => { handler = fn; return () => {}; }, fetch: vi.fn(), generate: vi.fn() },
    emit: (m) => handler && handler(m),
  };
}

describe("AttentionPanel", () => {
  it("mostra o botão de gerar diagnóstico e dispara generate ao clicar", () => {
    const { client } = fakeClient();
    render(<AttentionPanel projectId="p" specId="FEAT-001" client={client} />);
    fireEvent.click(screen.getByRole("button", { name: /o que preciso fazer/i }));
    expect(client.generate).toHaveBeenCalledWith("p", "FEAT-001", false);
  });

  it("habilita 'copiar prompt' quando o handoff chega e copia pro clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { client, emit } = fakeClient();
    render(<AttentionPanel projectId="p" specId="FEAT-001" client={client} />);
    emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" });
    const btn = screen.getByRole("button", { name: /copiar prompt/i });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("COLE ISSO");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/components/AttentionPanel.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `web/src/components/AttentionPanel.tsx`**

```tsx
import { useState } from "react";
import { useAttentionDiagnosis } from "../state/useAttentionDiagnosis";
import { useTypewriter } from "../state/useTypewriter";
import { MarkdownText } from "../lib/markdown";
import { fmtUsd } from "../format";
import type { AttentionClient } from "../state/attentionClient";

/**
 * Painel da coluna "Precisa de você": diagnóstico de bloqueio gerado por IA sob
 * demanda (one-shot, streamado) + botão que copia o prompt de handoff pro Claude
 * Code. O cru (timeline/findings) NÃO é repetido aqui — fica nas seções de
 * "Linha do tempo" e "Tarefas" do drawer, logo abaixo. `client` injetável p/ teste.
 */
export function AttentionPanel({ projectId, specId, client }: { projectId: string; specId: string; client?: AttentionClient }) {
  const d = useAttentionDiagnosis(projectId, specId, client);
  const [copied, setCopied] = useState(false);
  const animate = d.streamed && (d.state === "streaming" || d.state === "ready");
  const display = useTypewriter(d.text, animate);
  const typing = d.state === "streaming" || (animate && display.length < d.text.length);

  const copyHandoff = async () => {
    if (!d.handoff) return;
    await navigator.clipboard.writeText(d.handoff);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="attention-panel" data-state={d.state}>
      <header className="attention-head">
        <span className="attention-label">🧭 O que fazer aqui</span>
        {(d.state === "ready" || d.state === "stale") && (
          <button type="button" className="attention-btn" onClick={d.regenerate}>↻ regerar</button>
        )}
        {(d.state === "empty" || d.state === "error") && (
          <button type="button" className="attention-btn primary" onClick={d.generate}>
            O que preciso fazer aqui?
          </button>
        )}
      </header>

      {d.state === "empty" && <p className="attention-hint">clique para diagnosticar por que parou e o que fazer</p>}
      {d.state === "loading" && <p className="attention-hint">gerando…</p>}
      {d.state === "stale" && <p className="attention-warn">desatualizado — regerar para refletir o progresso recente</p>}
      {d.state === "error" && <p className="attention-warn">{d.error}</p>}

      {(d.state === "streaming" || d.state === "ready" || d.state === "stale") && d.text && (
        <div className="attention-text">
          <MarkdownText source={display} />
          {typing && <span className="attention-cursor" aria-hidden="true">▋</span>}
        </div>
      )}

      {d.costUsd != null && !typing && (d.state === "ready" || d.state === "stale") && (
        <p className="attention-cost" title="custo real reportado pelo Claude CLI">
          custo desta geração · {fmtUsd(d.costUsd)}
        </p>
      )}

      <button type="button" className="attention-handoff-btn" onClick={copyHandoff} disabled={!d.handoff}>
        {copied ? "copiado ✓" : "Copiar prompt pro Claude Code"}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run web/src/components/AttentionPanel.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/AttentionPanel.tsx web/src/components/AttentionPanel.test.tsx
git commit -m "feat(web): AttentionPanel (diagnóstico IA + copiar prompt de handoff)"
```

---

## Task 13: Plugar o painel no drawer — `web/src/components/DetailDrawer.tsx`

**Files:**
- Modify: `web/src/components/DetailDrawer.tsx`
- Test: `web/src/components/DetailDrawer.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao arquivo `web/src/components/DetailDrawer.test.tsx` (mantenha os imports existentes; se faltar algum destes, acrescente no topo):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailDrawer } from "./DetailDrawer";
import type { SpecWithProject } from "../lib/kanban";
import type { Spec } from "../../../src/store/types";

function specWith(status: Spec["status"]): SpecWithProject {
  const spec: Spec = {
    id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation", plannedPhases: [],
    status, tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: null, timeline: [],
    cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null },
  };
  return { spec, projectId: "p", projectName: "login", projectPath: "/p" };
}

describe("DetailDrawer — painel de atenção", () => {
  it("renderiza o AttentionPanel quando a spec está em atenção (blocked)", () => {
    render(<DetailDrawer item={specWith("blocked")} onClose={() => {}} />);
    expect(screen.getByText(/o que fazer aqui/i)).toBeInTheDocument();
  });

  it("NÃO renderiza o AttentionPanel quando a spec está running", () => {
    render(<DetailDrawer item={specWith("running")} onClose={() => {}} />);
    expect(screen.queryByText(/o que fazer aqui/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx`
Expected: FAIL — `o que fazer aqui` não encontrado (painel ainda não plugado).

- [ ] **Step 3: Plugar o `AttentionPanel` no `DetailDrawer.tsx`**

No topo de `web/src/components/DetailDrawer.tsx`, troque a linha de import do kanban e acrescente o import do painel:

```tsx
import { attentionReason, columnForSpec } from "../lib/kanban";
import { AttentionPanel } from "./AttentionPanel";
```

Depois, no JSX, logo após o bloco do motivo (a expressão `{reason && (...)}` que renderiza `<div className={`drawer-why why-${reason.kind}`}>`), adicione:

```tsx
        {columnForSpec(spec) === "attention" && (
          <AttentionPanel projectId={projectId} specId={spec.id} />
        )}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx`
Expected: PASS (incluindo os testes já existentes do drawer).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DetailDrawer.tsx web/src/components/DetailDrawer.test.tsx
git commit -m "feat(web): drawer mostra o painel de diagnóstico em specs de atenção"
```

---

## Task 14: Estilos do painel — `web/src/app.css`

**Files:**
- Modify: `web/src/app.css`

- [ ] **Step 1: Acrescentar os estilos (tokens light, espelhando `.task-summary`)**

Ao final de `web/src/app.css`, adicione:

```css
/* Painel "Precisa de você": diagnóstico IA + handoff. Tokens light do redesign. */
.attention-panel {
  margin: 0.75rem 0 1rem;
  padding: 0.75rem 0.875rem;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e7e9ee);
  border-left: 3px solid var(--accent, #2563eb);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
}
.attention-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.attention-label {
  font-weight: 600;
  color: var(--text, #111827);
}
.attention-btn {
  margin-left: auto;
  font-size: 0.8125rem;
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--border, #e7e9ee);
  border-radius: 8px;
  background: var(--surface, #fff);
  color: var(--text-dim, #6b7280);
  cursor: pointer;
}
.attention-btn.primary {
  background: var(--accent, #2563eb);
  border-color: var(--accent, #2563eb);
  color: #fff;
}
.attention-btn:hover { filter: brightness(0.97); }
.attention-hint { color: var(--text-dim, #6b7280); font-size: 0.875rem; margin: 0.25rem 0; }
.attention-warn { color: #b45309; font-size: 0.875rem; margin: 0.25rem 0; }
.attention-text { color: var(--text, #111827); line-height: 1.5; }
.attention-cursor { color: var(--accent, #2563eb); animation: attention-blink 1s steps(2) infinite; }
@keyframes attention-blink { 50% { opacity: 0; } }
.attention-cost { color: var(--text-dim, #9ca3af); font-size: 0.75rem; margin-top: 0.5rem; }
.attention-handoff-btn {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.5rem;
  border: 1px dashed var(--border, #e7e9ee);
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim, #6b7280);
  cursor: pointer;
  font-size: 0.8125rem;
}
.attention-handoff-btn:hover:not(:disabled) { border-color: var(--accent, #2563eb); color: var(--accent, #2563eb); }
.attention-handoff-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 2: Verificação visual no preview**

Suba o preview e confirme: abrir uma spec em atenção mostra o painel; o botão "O que preciso fazer aqui?" gera o diagnóstico streamado; "Copiar prompt pro Claude Code" fica habilitado e copia. (Verificação manual via `preview_*`; sem teste automatizado de CSS.)

- [ ] **Step 3: Commit**

```bash
git add web/src/app.css
git commit -m "style(web): estilos do painel de diagnóstico (Precisa de você)"
```

---

## Verificação final

- [ ] **Suíte inteira verde**

Run: `npm test`
Expected: PASS — toda a suíte (backend + front), incluindo os testes pré-existentes do summary (rede de segurança do refactor da Task 2).

---

## Self-review (cobertura do spec)

- **§3 forma (um contexto, duas saídas):** Task 3 (`context.ts`) → Task 4 (diagnóstico) + Task 5 (handoff). ✓
- **§4 backend — costura `runAgent`:** Task 1 + refactor Task 2. ✓
- **§4 backend — `src/attention/` (context/prompt/handoff/fingerprint/cache/handler):** Tasks 3–8. ✓
- **§4 backend — trava de `ANTHROPIC_API_KEY`:** Task 1, Step 3 + teste dedicado. ✓
- **§4 backend — WS `attention:diagnose` (fetch/generate, cache por fingerprint):** Task 8 + Task 9. ✓
- **§5 front — cru sempre visível:** decisão de NÃO duplicar — reusa "Linha do tempo" + "Tarefas" existentes no drawer (documentado em "Decisões locked-in" e no comentário do `AttentionPanel`). ✓
- **§5 front — botão diagnóstico one-shot streamado:** Tasks 11 + 12. ✓
- **§5 front — botão copiar handoff:** Task 12. ✓
- **§5 front — sem seletor de modelo visível:** nenhum dropdown nas Tasks 12/13. ✓
- **§7 risco — robusto a dado escasso:** Task 4 (prompt "não invente") + Task 3 (arrays vazios). ✓
