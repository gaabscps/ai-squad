# UX da task no drawer + resumo de ensino via Claude CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro do aside (`DetailDrawer` → `TaskItem`), pôr um resumo de ensino gerado por IA (disparado por clique, em streaming) no topo da task e recolher os dados crus em cards legíveis embaixo.

**Architecture:** Backend novo em `src/summary/` (funções puras: fingerprint, prompt, parser do stream-json; mais cache em disco e um serviço que faz `spawn` do `claude` CLI). O WS já existente em `src/ui/app.ts` ganha duas mensagens (`summary:fetch` lê cache; `summary:generate` chama o CLI). No front, um cliente WS singleton + hook `useTaskSummary` alimentam o `TaskItem` reestruturado. Persistência em `.aios-cache/` (nunca no framework).

**Tech Stack:** Node + TypeScript, Express, `ws`, `node:child_process` (spawn), React 18, Vite, Vitest + Testing Library.

**Referências:** Spec em `docs/superpowers/specs/2026-06-01-drawer-task-ux-resumo-ia-design.md`. Tipos em `src/store/types.ts` (`Task`, `Dispatch`). Testes backend rodam em `node`, front em `jsdom` (ver `vitest.config.ts`). Comando de teste: `npm test` (= `vitest run`). Helpers de teste front em `web/src/test-utils.tsx` (`makeTask`, `makeDispatch`, `makeSpec`).

**Shape REAL do stream-json do CLI** (capturado em 2026-06-01 com `claude --print --output-format=stream-json --include-partial-messages --model sonnet`):
- Linhas de ruído ignoráveis: `type:"system"`, `type:"assistant"`, `type:"rate_limit_event"`, `type:"user"`, etc.
- **Delta de texto:** `{ "type":"stream_event", "event":{ "type":"content_block_delta", "index":0, "delta":{ "type":"text_delta", "text":"ok" } } }`
- **Resultado final:** `{ "type":"result", "subtype":"success", "is_error":false, "result":"ok", ... }` — `result` é o texto completo. `is_error:true` ou `subtype` ≠ `"success"` = falha.

---

## File Structure

**Backend (novos, em `src/summary/`):**
- `fingerprint.ts` — `taskFingerprint(task)`: hash determinístico dos dispatches.
- `prompt.ts` — `buildSummaryPrompt(specTitle, task)`: instrução de ensino + dados da task.
- `parse.ts` — `parseStreamLine(line)`: traduz uma linha do stream-json em chunk/done/error/null.
- `cache.ts` — `readSummary` / `writeSummary` em `.aios-cache/summaries/<specId>/<taskId>.json`.
- `service.ts` — `runSummary(prompt, cb, deps)`: faz spawn do `claude`, lê stdout linha a linha, usa `parse.ts`.
- `handler.ts` — `makeSummaryHandler(store, deps)`: orquestra fetch/generate por socket, escreve cache.

**Backend (modificado):**
- `src/ui/app.ts` — registra o handler de summary no `socket.on("message")`.

**Frontend (novos):**
- `web/src/state/summaryClient.ts` — cliente WS singleton para summary (subscribe/fetch/generate).
- `web/src/state/useTaskSummary.ts` — hook React sobre o cliente.

**Frontend (modificado):**
- `web/src/components/TaskItem.tsx` — bloco "Resumo" no topo + "Detalhes técnicos" recolhível.
- `web/src/components/DetailDrawer.tsx` — passa `specId={spec.id}` ao `TaskItem`.
- `web/src/components/TaskItem.test.tsx` — atualiza asserts pra nova estrutura (blocos crus agora sob "Detalhes técnicos").
- `web/src/app.css` — cria estilos faltantes (cards, resumo, mono restrita).
- `.gitignore` — adiciona `.aios-cache/`.

---

## Task 1: Ignorar o cache no git

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Adicionar a entrada**

No `.gitignore`, logo abaixo da linha `.superpowers/`, adicionar:

```
# cache do aiOS (resumos de task gerados por IA; regenerável, não é fonte)
.aios-cache/
```

- [ ] **Step 2: Verificar**

Run: `git check-ignore .aios-cache/x.json`
Expected: imprime `.aios-cache/x.json` (está ignorado).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignora .aios-cache/ (resumos de task gerados por IA)"
```

---

## Task 2: Fingerprint determinístico da task

Detecta quando o resumo cacheado está velho. Hash estável: mesma task → mesmo hash; dispatch novo → hash diferente.

**Files:**
- Create: `src/summary/fingerprint.ts`
- Test: `src/summary/fingerprint.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { taskFingerprint } from "./fingerprint.js";
import type { Task, Dispatch } from "../store/types.js";

function disp(over: Partial<Dispatch> = {}): Dispatch {
  return { role: "dev", loop: 1, status: "done", summary: null, filesChanged: [], findings: [], testEvidence: [], tokens: null, ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: "T-001", state: "done", loops: 1, dispatches: [], ...over };
}

describe("taskFingerprint", () => {
  it("é estável: mesma task → mesmo hash", () => {
    const t = task({ dispatches: [disp({ summary: "fez X" })] });
    expect(taskFingerprint(t)).toBe(taskFingerprint(task({ dispatches: [disp({ summary: "fez X" })] })));
  });

  it("muda quando um dispatch muda", () => {
    const a = task({ dispatches: [disp({ summary: "fez X" })] });
    const b = task({ dispatches: [disp({ summary: "fez Y" })] });
    expect(taskFingerprint(a)).not.toBe(taskFingerprint(b));
  });

  it("muda quando um dispatch é adicionado", () => {
    const a = task({ dispatches: [disp()] });
    const b = task({ dispatches: [disp(), disp({ loop: 2 })] });
    expect(taskFingerprint(a)).not.toBe(taskFingerprint(b));
  });

  it("retorna string hex não-vazia", () => {
    expect(taskFingerprint(task())).toMatch(/^[0-9a-f]+$/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/fingerprint.test.ts`
Expected: FAIL (`Cannot find module './fingerprint.js'`).

- [ ] **Step 3: Implementar**

```ts
// src/summary/fingerprint.ts
import { createHash } from "node:crypto";
import type { Task } from "../store/types.js";

/**
 * Hash determinístico dos dispatches da task. Serializa só os campos que
 * definem "o que foi feito" (role, loop, status, summary, arquivos, findings,
 * testes) numa ordem fixa, e tira o SHA-1. Usado para detectar resumo velho:
 * se o fingerprint atual difere do gravado, o cache está desatualizado.
 */
export function taskFingerprint(task: Task): string {
  const shape = task.dispatches.map((d) => ({
    role: d.role,
    loop: d.loop,
    status: d.status,
    summary: d.summary,
    files: d.filesChanged,
    findings: d.findings.map((f) => [f.severity, f.file, f.line, f.text]),
    tests: d.testEvidence.map((t) => [t.command, t.passed, t.detail]),
  }));
  return createHash("sha1").update(JSON.stringify({ id: task.id, dispatches: shape })).digest("hex");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/fingerprint.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/fingerprint.ts src/summary/fingerprint.test.ts
git commit -m "feat(summary): fingerprint determinístico da task"
```

---

## Task 3: Prompt de ensino

Monta o texto enviado ao CLI: instrução fixa de tom (espelha o `CLAUDE.md`) + dados da task vindos do Store.

**Files:**
- Create: `src/summary/prompt.ts`
- Test: `src/summary/prompt.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "./prompt.js";
import type { Task, Dispatch } from "../store/types.js";

function disp(over: Partial<Dispatch> = {}): Dispatch {
  return { role: "dev", loop: 1, status: "done", summary: null, filesChanged: [], findings: [], testEvidence: [], tokens: null, ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: "T-001", state: "done", loops: 1, dispatches: [], ...over };
}

describe("buildSummaryPrompt", () => {
  it("inclui a instrução de tom de ensino", () => {
    const p = buildSummaryPrompt("Coletor de dispatches", task());
    expect(p).toMatch(/did[áa]tico/i);
    expect(p).toMatch(/front-end/i);
  });

  it("inclui título da spec, id e estado da task", () => {
    const p = buildSummaryPrompt("Coletor de dispatches", task({ id: "T-008", state: "done" }));
    expect(p).toContain("Coletor de dispatches");
    expect(p).toContain("T-008");
  });

  it("inclui os summaries, arquivos e findings dos dispatches", () => {
    const p = buildSummaryPrompt("X", task({
      dispatches: [disp({ summary: "implementou o reader", filesChanged: ["src/a.ts"], findings: [{ severity: "warning", file: "src/a.ts", line: 3, text: "ajustar parsing" }] })],
    }));
    expect(p).toContain("implementou o reader");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("ajustar parsing");
  });

  it("não quebra com task sem dispatches", () => {
    expect(() => buildSummaryPrompt("X", task({ dispatches: [] }))).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/prompt.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/summary/prompt.ts
import type { Task } from "../store/types.js";

const TONE = [
  "Você explica para um dev front-end (~3 anos) que estuda nestas explicações.",
  "Seja técnico, mas didático: diga o QUE foi feito, o PORQUÊ e o MECANISMO por baixo.",
  "Defina todo termo fora do domínio front na primeira aparição, com uma analogia curta do cotidiano.",
  "Comece pelo concreto, depois abstraia. Português claro e conectado, sem estilo telegráfico.",
  "Não invente o que não está nos dados. Responda só com o resumo, em 1 a 3 parágrafos curtos.",
].join(" ");

/** Serializa os dispatches da task em texto legível pro modelo (dados do Store, sem ler disco). */
function tasksData(task: Task): string {
  if (task.dispatches.length === 0) return "(sem dispatches registrados)";
  return task.dispatches
    .map((d) => {
      const parts = [`- ${d.role} (loop ${d.loop}, status ${d.status})`];
      if (d.summary) parts.push(`  resumo: ${d.summary}`);
      if (d.filesChanged.length) parts.push(`  arquivos: ${d.filesChanged.join(", ")}`);
      for (const f of d.findings) parts.push(`  finding [${f.severity}] ${f.file ?? ""}${f.line != null ? `:${f.line}` : ""} ${f.text}`);
      for (const t of d.testEvidence) parts.push(`  teste ${t.passed === true ? "ok" : t.passed === false ? "falhou" : "?"}: ${t.command}`);
      return parts.join("\n");
    })
    .join("\n");
}

/** Monta o prompt completo: instrução de tom + contexto da task. */
export function buildSummaryPrompt(specTitle: string, task: Task): string {
  return [
    TONE,
    "",
    `Feature: ${specTitle}`,
    `Tarefa: ${task.id} (estado: ${task.state}, loops: ${task.loops})`,
    "",
    "O que os agentes registraram nesta tarefa:",
    tasksData(task),
    "",
    "Explique, para esse dev, o que foi feito nesta tarefa.",
  ].join("\n");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/prompt.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/prompt.ts src/summary/prompt.test.ts
git commit -m "feat(summary): prompt de ensino a partir dos dados da task"
```

---

## Task 4: Parser do stream-json do CLI

A peça mais arriscada: traduzir uma linha crua do CLI em evento. Pura e 100% testável.

**Files:**
- Create: `src/summary/parse.ts`
- Test: `src/summary/parse.test.ts`

- [ ] **Step 1: Escrever o teste que falha** (usa o shape REAL capturado)

```ts
import { describe, it, expect } from "vitest";
import { parseStreamLine } from "./parse.js";

describe("parseStreamLine", () => {
  it("extrai o delta de texto de um content_block_delta", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } } });
    expect(parseStreamLine(line)).toEqual({ kind: "chunk", text: "ok" });
  });

  it("extrai o texto completo do result de sucesso", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "resumo final" });
    expect(parseStreamLine(line)).toEqual({ kind: "done", text: "resumo final" });
  });

  it("trata result com erro", () => {
    const line = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "" });
    const out = parseStreamLine(line);
    expect(out?.kind).toBe("error");
  });

  it("ignora linhas de ruído (system, assistant, rate_limit)", () => {
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "assistant", message: {} }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "rate_limit_event" }))).toBeNull();
  });

  it("ignora stream_event que não é text_delta", () => {
    expect(parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }))).toBeNull();
  });

  it("ignora linha vazia ou JSON inválido sem lançar", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
    expect(parseStreamLine("{nao é json")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/parse.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/summary/parse.ts

export type ParsedEvent =
  | { kind: "chunk"; text: string }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string };

/**
 * Traduz UMA linha do stream-json do `claude --output-format=stream-json` num evento.
 * O CLI emite muito ruído (system/assistant/rate_limit/init); só nos interessam:
 *  - content_block_delta com text_delta → pedaço de texto (chunk)
 *  - result → texto final (done) ou falha (error)
 * Qualquer outra linha, vazio ou JSON inválido → null (ignora, nunca lança).
 */
export function parseStreamLine(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;

  if (m.type === "stream_event") {
    const event = m.event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return { kind: "chunk", text: delta.text };
      }
    }
    return null;
  }

  if (m.type === "result") {
    if (m.is_error === true || m.subtype !== "success") {
      return { kind: "error", message: typeof m.result === "string" && m.result ? m.result : "geração falhou" };
    }
    return { kind: "done", text: typeof m.result === "string" ? m.result : "" };
  }

  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/parse.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/parse.ts src/summary/parse.test.ts
git commit -m "feat(summary): parser do stream-json do Claude CLI"
```

---

## Task 5: Cache em disco

Lê/grava o resumo em `.aios-cache/summaries/<specId>/<taskId>.json` na raiz do aiOS.

**Files:**
- Create: `src/summary/cache.ts`
- Test: `src/summary/cache.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSummary, writeSummary } from "./cache.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-cache-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("cache de resumo", () => {
  it("retorna null quando não há cache", () => {
    expect(readSummary(tmp(), "FEAT-001", "T-001")).toBeNull();
  });

  it("round-trip: o que grava, lê de volta", () => {
    const root = tmp();
    const written = writeSummary(root, "FEAT-001", "T-001", { text: "resumo", fingerprint: "abc" }, () => "2026-06-01T10:00:00Z");
    expect(written).toEqual({ text: "resumo", fingerprint: "abc", generatedAt: "2026-06-01T10:00:00Z" });
    expect(readSummary(root, "FEAT-001", "T-001")).toEqual(written);
  });

  it("isola por specId e taskId", () => {
    const root = tmp();
    writeSummary(root, "FEAT-001", "T-001", { text: "a", fingerprint: "x" }, () => "t");
    expect(readSummary(root, "FEAT-001", "T-002")).toBeNull();
    expect(readSummary(root, "FEAT-002", "T-001")).toBeNull();
  });

  it("readSummary não lança em JSON corrompido (retorna null)", () => {
    const root = tmp();
    writeSummary(root, "F", "T", { text: "a", fingerprint: "x" }, () => "t");
    // sobrescreve com lixo
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(root, "summaries", "F", "T.json"), "{corrompido");
    expect(readSummary(root, "F", "T")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/cache.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/summary/cache.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedSummary {
  text: string;
  generatedAt: string; // ISO
  fingerprint: string;
}

function fileFor(cacheRoot: string, specId: string, taskId: string): string {
  return join(cacheRoot, "summaries", specId, `${taskId}.json`);
}

/** Lê o resumo cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readSummary(cacheRoot: string, specId: string, taskId: string): CachedSummary | null {
  const file = fileFor(cacheRoot, specId, taskId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedSummary;
    if (typeof parsed?.text === "string" && typeof parsed?.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o resumo e devolve o objeto salvo (com generatedAt carimbado pelo `now`). */
export function writeSummary(
  cacheRoot: string,
  specId: string,
  taskId: string,
  data: { text: string; fingerprint: string },
  now: () => string,
): CachedSummary {
  const file = fileFor(cacheRoot, specId, taskId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedSummary = { text: data.text, fingerprint: data.fingerprint, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/cache.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/cache.ts src/summary/cache.test.ts
git commit -m "feat(summary): cache de resumo em .aios-cache"
```

---

## Task 6: Serviço que roda o Claude CLI

Faz `spawn` do `claude`, lê stdout linha a linha, usa `parseStreamLine`, e chama callbacks. `spawn` é injetável pra testar sem rodar o CLI de verdade.

**Files:**
- Create: `src/summary/service.ts`
- Test: `src/summary/service.test.ts`

- [ ] **Step 1: Escrever o teste que falha** (injeta um spawn falso baseado em `EventEmitter`)

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runSummary } from "./service.js";

/** Processo falso: stdout/stderr são EventEmitters; expõe stdin.write/end espionáveis. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("runSummary", () => {
  it("manda o prompt pelo stdin e emite chunks + done", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();

    runSummary("PROMPT", { onChunk, onDone, onError }, { spawnFn });

    expect(spawnFn).toHaveBeenCalledWith("claude", expect.arrayContaining(["--print", "--output-format=stream-json", "--include-partial-messages", "--model", "sonnet"]), expect.any(Object));
    expect(proc.stdin.write).toHaveBeenCalledWith("PROMPT");
    expect(proc.stdin.end).toHaveBeenCalled();

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá" } } }) + "\n"));
    expect(onChunk).toHaveBeenCalledWith("Olá");

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Olá mundo" }) + "\n"));
    expect(onDone).toHaveBeenCalledWith("Olá mundo");
    expect(onError).not.toHaveBeenCalled();
  });

  it("lida com linha quebrada entre dois chunks de data", () => {
    const proc = fakeProc();
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();
    runSummary("P", { onChunk, onDone, onError }, { spawnFn: (() => proc) as any });
    const full = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "X" } } }) + "\n";
    proc.stdout.emit("data", Buffer.from(full.slice(0, 10)));
    proc.stdout.emit("data", Buffer.from(full.slice(10)));
    expect(onChunk).toHaveBeenCalledWith("X");
  });

  it("emite error quando o CLI não existe (ENOENT)", () => {
    const proc = fakeProc();
    const onError = vi.fn();
    runSummary("P", { onChunk: vi.fn(), onDone: vi.fn(), onError }, { spawnFn: (() => proc) as any });
    proc.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/claude/i));
  });

  it("cancel() mata o processo", () => {
    const proc = fakeProc();
    const handle = runSummary("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { spawnFn: (() => proc) as any });
    handle.cancel();
    expect(proc.kill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/service.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/summary/service.ts
import { spawn as realSpawn } from "node:child_process";
import { parseStreamLine } from "./parse.js";

export interface SummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export interface SummaryHandle {
  cancel: () => void;
}

export interface SummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

const CLI_ARGS = ["--print", "--output-format=stream-json", "--include-partial-messages", "--model", "sonnet", "--verbose"];

/**
 * Roda o Claude CLI com o prompt via stdin (sem interpolação em shell → sem injeção)
 * e faz streaming dos pedaços de texto pelos callbacks. Acumula stdout num buffer e
 * processa linha a linha (o CLI emite NDJSON: um JSON por linha).
 */
export function runSummary(prompt: string, cb: SummaryCallbacks, deps: SummaryDeps = {}): SummaryHandle {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const proc = spawnFn("claude", CLI_ARGS, { cwd: deps.cwd ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"] });

  let buffer = "";
  let done = false;
  const finishDone = (text: string) => { if (!done) { done = true; cb.onDone(text); } };
  const finishError = (msg: string) => { if (!done) { done = true; cb.onError(msg); } };

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const ev = parseStreamLine(line);
      if (!ev) continue;
      if (ev.kind === "chunk") cb.onChunk(ev.text);
      else if (ev.kind === "done") finishDone(ev.text);
      else finishError(ev.message);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    finishError(err.code === "ENOENT" ? "Claude CLI não encontrado (instale/cheque o PATH)" : `falha ao rodar o Claude CLI: ${err.message}`);
  });

  proc.on("close", (code: number | null) => {
    if (!done) finishError(code === 0 ? "geração terminou sem resultado" : `Claude CLI saiu com código ${code}`);
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();

  return { cancel: () => proc.kill() };
}
```

Nota: `--verbose` é necessário porque `--output-format=stream-json` exige verbose pra emitir os `stream_event` (confirmado na captura). Mantemos o `console`/stderr fora dos callbacks — ruído não atrapalha o parser.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/service.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/service.ts src/summary/service.test.ts
git commit -m "feat(summary): serviço que faz streaming do Claude CLI"
```

---

## Task 7: Handler de mensagens summary (orquestra fetch/generate)

Liga tudo: acha a task no Store, lê/grava cache, dispara o serviço, e empurra as mensagens WS. Independente de socket real (recebe um `send` e um `spawnFn` injetáveis).

**Files:**
- Create: `src/summary/handler.ts`
- Test: `src/summary/handler.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSummaryHandler } from "./handler.js";
import type { Project } from "../store/types.js";

function proj(): Project {
  return {
    id: "p1", path: "/x", name: "x", hidden: false,
    specs: [{
      id: "FEAT-001", squad: "sdd", title: "Coletor", phase: "implementation", plannedPhases: [],
      status: "running", health: { pendingHuman: 0, escalationRate: 0, auditException: false },
      lastActivityAt: null, timeline: [], cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null },
      tasks: [{ id: "T-001", state: "done", loops: 1, dispatches: [{ role: "dev", loop: 1, status: "done", summary: "fez X", filesChanged: [], findings: [], testEvidence: [], tokens: null }] }],
    }],
  };
}
const store = { getSnapshot: () => [proj()] } as any;

function fakeProc() {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.stdin = { write: vi.fn(), end: vi.fn() }; p.kill = vi.fn();
  return p;
}

describe("makeSummaryHandler", () => {
  it("fetch sem cache: não responde nada", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root });
    handle({ type: "summary:fetch", specId: "FEAT-001", taskId: "T-001" }, send);
    expect(send).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("generate: faz streaming e responde chunk + done, e grava cache", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "summary:generate", specId: "FEAT-001", taskId: "T-001" }, send);
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Re" } } }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Resumo" }) + "\n"));

    const types = send.mock.calls.map((c) => JSON.parse(c[0]).type);
    expect(types).toContain("summary:chunk");
    expect(types).toContain("summary:done");

    // depois de done, um fetch acha o cache
    const send2 = vi.fn();
    handle({ type: "summary:fetch", specId: "FEAT-001", taskId: "T-001" }, send2);
    const cached = JSON.parse(send2.mock.calls[0][0]);
    expect(cached.type).toBe("summary:cached");
    expect(cached.text).toBe("Resumo");
    expect(cached.stale).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("generate com task inexistente: responde error", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn: (() => fakeProc()) as any });
    handle({ type: "summary:generate", specId: "FEAT-001", taskId: "T-999" }, send);
    expect(JSON.parse(send.mock.calls[0][0]).type).toBe("summary:error");
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/summary/handler.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/summary/handler.ts
import { join } from "node:path";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Task } from "../store/types.js";
import { taskFingerprint } from "./fingerprint.js";
import { buildSummaryPrompt } from "./prompt.js";
import { readSummary, writeSummary } from "./cache.js";
import { runSummary, type SummaryHandle } from "./service.js";

export interface SummaryMsg {
  type: "summary:fetch" | "summary:generate";
  specId?: unknown;
  taskId?: unknown;
  force?: unknown;
}
type Send = (data: string) => void;

export interface HandlerDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

function findTask(store: Store, specId: string, taskId: string): { title: string; task: Task } | null {
  for (const p of store.getSnapshot()) {
    for (const s of p.specs) {
      if (s.id !== specId) continue;
      const task = s.tasks.find((t) => t.id === taskId);
      if (task) return { title: s.title, task };
    }
  }
  return null;
}

/**
 * Devolve um handler de mensagens summary ligado a UM socket (o `send`).
 * Guarda a geração ativa por chave specId|taskId pra cancelar duplicatas.
 */
export function makeSummaryHandler(store: Store, deps: HandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  const active = new Map<string, SummaryHandle>();

  return function handle(msg: SummaryMsg, send: Send): void {
    if (typeof msg.specId !== "string" || typeof msg.taskId !== "string") return;
    const specId = msg.specId, taskId = msg.taskId, key = `${specId}|${taskId}`;
    const found = findTask(store, specId, taskId);

    if (msg.type === "summary:fetch") {
      const cached = readSummary(cacheRoot, specId, taskId);
      if (!cached) return; // sem cache → UI fica no estado vazio
      const stale = found ? taskFingerprint(found.task) !== cached.fingerprint : true;
      send(JSON.stringify({ type: "summary:cached", specId, taskId, text: cached.text, generatedAt: cached.generatedAt, stale }));
      return;
    }

    if (msg.type === "summary:generate") {
      if (!found) {
        send(JSON.stringify({ type: "summary:error", specId, taskId, message: "tarefa não encontrada" }));
        return;
      }
      active.get(key)?.cancel(); // cancela geração anterior dessa task, se houver
      const prompt = buildSummaryPrompt(found.title, found.task);
      const fingerprint = taskFingerprint(found.task);
      let acc = "";
      const handle = runSummary(prompt, {
        onChunk: (delta) => { acc += delta; send(JSON.stringify({ type: "summary:chunk", specId, taskId, delta })); },
        onDone: (full) => {
          const text = full || acc;
          const rec = writeSummary(cacheRoot, specId, taskId, { text, fingerprint }, now);
          active.delete(key);
          send(JSON.stringify({ type: "summary:done", specId, taskId, text, generatedAt: rec.generatedAt }));
        },
        onError: (message) => { active.delete(key); send(JSON.stringify({ type: "summary:error", specId, taskId, message })); },
      }, { spawnFn: deps.spawnFn });
      active.set(key, handle);
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/summary/handler.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/summary/handler.ts src/summary/handler.test.ts
git commit -m "feat(summary): handler que orquestra fetch/generate + cache"
```

---

## Task 8: Registrar o handler no WS do servidor

**Files:**
- Modify: `src/ui/app.ts:77-87` (bloco `socket.on("message")`)
- Test: manual (smoke) — a lógica já é testada no Task 7.

- [ ] **Step 1: Importar o handler**

No topo de `src/ui/app.ts`, junto dos imports existentes, adicionar:

```ts
import { makeSummaryHandler } from "../summary/handler.js";
```

- [ ] **Step 2: Instanciar o handler por conexão e rotear as mensagens**

Localizar o bloco atual em `wss.on("connection", (socket) => { ... })`. Logo após `setTimeout(() => socket.send(snapshotMessage()), 0);`, adicionar:

```ts
    const onSummary = makeSummaryHandler(store);
```

E dentro do `socket.on("message", (raw) => { ... })`, **depois** do parse de `msg` e antes/junto dos `if (msg.type === "hide")`, trocar a checagem de `msg.id` por um roteamento que também cubra summary. O bloco final fica:

```ts
    socket.on("message", (raw) => {
      let msg: { type?: string; id?: string; specId?: string; taskId?: string; force?: boolean };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // mensagem inválida: ignora
      }
      if (msg.type === "summary:fetch" || msg.type === "summary:generate") {
        onSummary(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
      if (typeof msg.id !== "string") return;
      if (msg.type === "hide") onToggleHide(msg.id, true);
      else if (msg.type === "unhide") onToggleHide(msg.id, false);
    });
```

- [ ] **Step 3: Verificar tipos e testes**

Run: `npx tsc --noEmit && npm test`
Expected: tsc sem erros; toda a suíte passa.

- [ ] **Step 4: Smoke manual do streaming end-to-end**

Run: `npm run serve` (noutro terminal) e, com um projeto real com `.agent-session`, abrir `ws://127.0.0.1:4717/ws` e mandar `{"type":"summary:generate","specId":"<id real>","taskId":"<T real>"}`. Confirmar chegada de `summary:chunk` seguidos de `summary:done`. (Opcional nesta fase — a UI do Task 11 valida de novo.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.ts
git commit -m "feat(ui): roteia summary:fetch/generate pelo WS existente"
```

---

## Task 9: Cliente WS de summary no front (singleton)

Um socket dedicado a summary, conectado sob demanda, com subscribe por chave. Separado do `useLiveProjects` pra não refatorar a posse do socket de snapshot (fora de escopo).

**Files:**
- Create: `web/src/state/summaryClient.ts`
- Test: `web/src/state/summaryClient.test.ts`

- [ ] **Step 1: Escrever o teste que falha** (injeta uma fábrica de socket falsa)

```ts
import { describe, it, expect, vi } from "vitest";
import { createSummaryClient } from "./summaryClient";

function fakeSocket() {
  const s: any = { readyState: 1, sent: [] as string[], onopen: null as any, onmessage: null as any, onclose: null as any };
  s.send = (d: string) => s.sent.push(d);
  s.close = vi.fn();
  return s;
}

describe("createSummaryClient", () => {
  it("manda summary:fetch com specId/taskId", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.fetch("FEAT-001", "T-001");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:fetch", specId: "FEAT-001", taskId: "T-001" });
  });

  it("generate manda type generate + force", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.generate("FEAT-001", "T-001", true);
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:generate", force: true });
  });

  it("entrega mensagens só ao subscriber da chave certa", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("FEAT-001|T-001", (m) => got.push(m));
    const other: any[] = [];
    client.subscribe("FEAT-001|T-999", (m) => other.push(m));
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", specId: "FEAT-001", taskId: "T-001", delta: "oi" }) });
    expect(got).toHaveLength(1);
    expect(got[0].delta).toBe("oi");
    expect(other).toHaveLength(0);
  });

  it("unsubscribe para de receber", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    const off = client.subscribe("K|1", (m) => got.push(m));
    off();
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", specId: "K", taskId: "1", delta: "x" }) });
    expect(got).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- web/src/state/summaryClient.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// web/src/state/summaryClient.ts

export interface SummaryServerMsg {
  type: "summary:cached" | "summary:chunk" | "summary:done" | "summary:error";
  specId: string;
  taskId: string;
  text?: string;
  delta?: string;
  generatedAt?: string;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: SummaryServerMsg) => void;
type SocketFactory = () => WebSocket;

export interface SummaryClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (specId: string, taskId: string) => void;
  generate: (specId: string, taskId: string, force?: boolean) => void;
}

/**
 * Cliente WS de summary. Conecta sob demanda na primeira ação, mantém uma fila de
 * envios até o socket abrir, e roteia cada mensagem do servidor ao subscriber da
 * chave `specId|taskId`. A fábrica de socket é injetável pra teste.
 */
export function createSummaryClient(makeSocket: SocketFactory): SummaryClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: SummaryServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (typeof msg?.specId !== "string" || typeof msg?.taskId !== "string") return;
      const fns = subs.get(`${msg.specId}|${msg.taskId}`);
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
      const set = subs.get(key) ?? new Set<Handler>();
      set.add(fn);
      subs.set(key, set);
      return () => { set.delete(fn); if (set.size === 0) subs.delete(key); };
    },
    fetch(specId, taskId) { sendOrQueue({ type: "summary:fetch", specId, taskId }); },
    generate(specId, taskId, force = false) { sendOrQueue({ type: "summary:generate", specId, taskId, force }); },
  };
}

/** Singleton padrão da app: socket real em /ws (mesmo endpoint do snapshot). */
export const summaryClient: SummaryClient = createSummaryClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- web/src/state/summaryClient.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/summaryClient.ts web/src/state/summaryClient.test.ts
git commit -m "feat(web): cliente WS singleton para resumos de task"
```

---

## Task 10: Hook useTaskSummary

Envolve o cliente numa máquina de estados React: `empty → loading → streaming → ready` (ou `stale`/`error`).

**Files:**
- Create: `web/src/state/useTaskSummary.ts`
- Test: `web/src/state/useTaskSummary.test.tsx`

- [ ] **Step 1: Escrever o teste que falha** (injeta um cliente falso)

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskSummary } from "./useTaskSummary";
import type { SummaryClient, SummaryServerMsg } from "./summaryClient";

function fakeClient() {
  let handler: ((m: SummaryServerMsg) => void) | null = null;
  const client: SummaryClient = {
    subscribe: (_key, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: vi.fn(),
    generate: vi.fn(),
  };
  return { client, emit: (m: SummaryServerMsg) => handler?.(m) };
}

describe("useTaskSummary", () => {
  it("começa em empty e faz fetch ao montar", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("FEAT-001", "T-001", client));
    expect(result.current.state).toBe("empty");
    expect(client.fetch).toHaveBeenCalledWith("FEAT-001", "T-001");
  });

  it("cached não-stale → ready com texto", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:cached", specId: "FEAT-001", taskId: "T-001", text: "oi", generatedAt: "T0", stale: false }));
    expect(result.current.state).toBe("ready");
    expect(result.current.text).toBe("oi");
  });

  it("cached stale → state stale", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:cached", specId: "FEAT-001", taskId: "T-001", text: "velho", generatedAt: "T0", stale: true }));
    expect(result.current.state).toBe("stale");
  });

  it("generate() → loading, chunks acumulam → streaming, done → ready", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("FEAT-001", "T-001", client));
    act(() => result.current.generate());
    expect(result.current.state).toBe("loading");
    expect(client.generate).toHaveBeenCalledWith("FEAT-001", "T-001", false);
    act(() => emit({ type: "summary:chunk", specId: "FEAT-001", taskId: "T-001", delta: "Re" }));
    act(() => emit({ type: "summary:chunk", specId: "FEAT-001", taskId: "T-001", delta: "sumo" }));
    expect(result.current.state).toBe("streaming");
    expect(result.current.text).toBe("Resumo");
    act(() => emit({ type: "summary:done", specId: "FEAT-001", taskId: "T-001", text: "Resumo", generatedAt: "T1" }));
    expect(result.current.state).toBe("ready");
  });

  it("error → state error com mensagem", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:error", specId: "FEAT-001", taskId: "T-001", message: "falhou" }));
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("falhou");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- web/src/state/useTaskSummary.test.tsx`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```tsx
// web/src/state/useTaskSummary.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { summaryClient as defaultClient, type SummaryClient, type SummaryServerMsg } from "./summaryClient";

export type SummaryState = "empty" | "loading" | "streaming" | "ready" | "stale" | "error";

export interface TaskSummary {
  state: SummaryState;
  text: string;
  generatedAt: string | null;
  error: string | null;
  generate: () => void;
  regenerate: () => void;
}

/**
 * Máquina de estados do resumo de uma task. Ao montar, faz `fetch` (só lê cache).
 * `generate`/`regenerate` chamam o CLI (gasta quota — só por clique). Acumula os
 * chunks de streaming em `text`. O cliente é injetável pra teste.
 */
export function useTaskSummary(specId: string, taskId: string, client: SummaryClient = defaultClient): TaskSummary {
  const [state, setState] = useState<SummaryState>("empty");
  const [text, setText] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    const key = `${specId}|${taskId}`;
    const off = client.subscribe(key, (m: SummaryServerMsg) => {
      if (m.type === "summary:cached") {
        textRef.current = m.text ?? "";
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "summary:chunk") {
        textRef.current += m.delta ?? "";
        setText(textRef.current);
        setState("streaming");
      } else if (m.type === "summary:done") {
        textRef.current = m.text ?? textRef.current;
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setState("ready");
      } else if (m.type === "summary:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    client.fetch(specId, taskId);
    return off;
  }, [specId, taskId, client]);

  const start = useCallback((force: boolean) => {
    textRef.current = "";
    setText("");
    setError(null);
    setState("loading");
    client.generate(specId, taskId, force);
  }, [specId, taskId, client]);

  return {
    state, text, generatedAt, error,
    generate: () => start(false),
    regenerate: () => start(true),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- web/src/state/useTaskSummary.test.tsx`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add web/src/state/useTaskSummary.ts web/src/state/useTaskSummary.test.tsx
git commit -m "feat(web): hook useTaskSummary (máquina de estados do resumo)"
```

---

## Task 11: Reestruturar o TaskItem (resumo no topo + detalhes recolhidos)

Move os 5 blocos crus pra dentro de um `<details>` "Detalhes técnicos" recolhido, e põe o bloco "✨ Resumo" no topo. Adiciona prop `specId`.

**Files:**
- Modify: `web/src/components/TaskItem.tsx`
- Modify: `web/src/components/DetailDrawer.tsx:67-69` (passar `specId`)
- Modify: `web/src/components/TaskItem.test.tsx` (atualizar asserts à nova estrutura)

- [ ] **Step 1: Atualizar os testes existentes pra nova estrutura**

Os blocos crus agora ficam sob um `<summary>Detalhes técnicos</summary>` (elemento `<details>`) recolhido. No jsdom, o conteúdo de `<details>` está no DOM mesmo fechado, então os `getByText` dos blocos continuam achando o texto — **mas** o título "O que foi feito" agora é o cabeçalho do card, e o resumo IA é separado. Para isolar o resumo IA do teste (que não deve disparar WS), adicionar no topo de `TaskItem.test.tsx`, logo após os imports:

```tsx
import { vi } from "vitest";
// O resumo via WS não deve ser exercido nestes testes de estrutura: stub do hook.
vi.mock("../state/useTaskSummary", () => ({
  useTaskSummary: () => ({ state: "empty", text: "", generatedAt: null, error: null, generate: vi.fn(), regenerate: vi.fn() }),
}));
```

Trocar, em cada teste que renderiza `<TaskItem task={task} />`, por `<TaskItem task={task} specId="FEAT-001" />`. (Os asserts de conteúdo dos blocos crus seguem válidos porque `<details>` mantém o conteúdo no DOM.) Adicionar um teste novo no final:

```tsx
describe("Resumo IA + Detalhes técnicos", () => {
  it("expandido mostra o botão 'gerar resumo' e o grupo 'Detalhes técnicos'", async () => {
    const task = makeTask({ dispatches: [makeDispatch({ summary: "fez X" })] });
    render(<TaskItem task={task} specId="FEAT-001" />);
    await userEvent.click(screen.getByRole("button", { name: /T-001|tarefa/i }));
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeInTheDocument();
    expect(screen.getByText(/Detalhes t[ée]cnicos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- web/src/components/TaskItem.test.tsx`
Expected: FAIL (o botão "gerar resumo" e "Detalhes técnicos" ainda não existem; `specId` é prop nova não usada).

- [ ] **Step 3: Implementar o novo TaskItem**

Reescrever `web/src/components/TaskItem.tsx`. Manter `FindingRow` e a lógica de agregação do `ExpandedContent` atual, mas: (a) renomear o componente interno pra `TechDetails`, (b) envolvê-lo num `<details>` recolhido, (c) adicionar o componente `SummaryBlock` no topo, (d) `TaskItem` recebe `specId` e passa pro `SummaryBlock`.

```tsx
import { useState } from "react";
import type { Task, Dispatch, DispatchFinding } from "../../../src/store/types";
import { taskTotalTokens } from "../lib/taskTokens";
import { fmtTokens } from "../format";
import { STATE_LABEL } from "../lib/taskState";
import { useTaskSummary } from "../state/useTaskSummary";

const SEVERITY_CLASS: Record<string, string> = { error: "finding-error", warning: "finding-warning", info: "finding-info" };

function FindingRow({ finding }: { finding: DispatchFinding }) {
  const loc = finding.file ? `${finding.file}${finding.line != null ? `:${finding.line}` : ""}` : null;
  return (
    <li className={`finding-item ${SEVERITY_CLASS[finding.severity] ?? ""}`}>
      <span className="finding-severity">{finding.severity}</span>
      {loc && <span className="finding-loc mono">{loc}</span>}
      <span className="finding-text">{finding.text}</span>
    </li>
  );
}

/** Bloco de resumo de ensino, gerado por IA sob demanda (nunca automático). */
function SummaryBlock({ specId, task }: { specId: string; task: Task }) {
  const s = useTaskSummary(specId, task.id);
  const hasDispatches = task.dispatches.length > 0;
  return (
    <section className="task-summary" data-state={s.state}>
      <header className="task-summary-head">
        <span className="task-summary-label">✨ Resumo</span>
        {s.state === "ready" && s.generatedAt && (
          <span className="task-summary-meta">gerado {new Date(s.generatedAt).toLocaleTimeString()}</span>
        )}
        {(s.state === "ready" || s.state === "stale") && (
          <button type="button" className="task-summary-btn" onClick={s.regenerate}>↻ regerar</button>
        )}
        {(s.state === "empty" || s.state === "error") && (
          <button type="button" className="task-summary-btn primary" onClick={s.generate} disabled={!hasDispatches}>
            gerar resumo
          </button>
        )}
      </header>
      {s.state === "empty" && (
        <p className="task-summary-hint">{hasDispatches ? "clique para gerar uma explicação do que foi feito nesta task" : "sem dados para resumir"}</p>
      )}
      {s.state === "loading" && <p className="task-summary-hint">gerando…</p>}
      {s.state === "stale" && <p className="task-summary-warn">desatualizado — regerar para refletir o progresso recente</p>}
      {s.state === "error" && <p className="task-summary-warn">{s.error}</p>}
      {(s.state === "streaming" || s.state === "ready" || s.state === "stale") && s.text && (
        <p className="task-summary-text">{s.text}</p>
      )}
    </section>
  );
}

/** Os 5 blocos crus, agora dentro de cards, recolhidos por padrão num <details>. */
function TechDetails({ dispatches }: { dispatches: Dispatch[] }) {
  if (dispatches.length === 0) {
    return <p className="task-empty-dispatches">sem dispatches registrados</p>;
  }
  const summaries = dispatches.filter((d) => d.summary != null).map((d) => ({ role: d.role, loop: d.loop, summary: d.summary as string }));
  const uniqueFiles = Array.from(new Set(dispatches.flatMap((d) => d.filesChanged)));
  const allFindings = dispatches.flatMap((d) => d.findings);
  const allTestEvidence = dispatches.flatMap((d) => d.testEvidence);
  const loopMap = new Map<number, Dispatch[]>();
  for (const d of dispatches) loopMap.set(d.loop, [...(loopMap.get(d.loop) ?? []), d]);
  const sortedLoops = Array.from(loopMap.entries()).sort(([a], [b]) => a - b);

  return (
    <details className="task-details">
      <summary className="task-details-summary">Detalhes técnicos</summary>
      <div className="task-details-body">
        {summaries.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">O que foi feito ({summaries.length})</h5>
            <ul className="task-summaries">
              {summaries.map((s, i) => (
                <li key={i} className="task-summary-item">
                  <span className="mono task-dispatch-tag">{s.role} · loop {s.loop}</span>
                  <span>{s.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {uniqueFiles.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Arquivos mudados ({uniqueFiles.length})</h5>
            <ul className="task-files mono">{uniqueFiles.map((f) => <li key={f}>{f}</li>)}</ul>
          </section>
        )}
        {allFindings.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Findings de review ({allFindings.length})</h5>
            <ul className="task-findings">{allFindings.map((f, i) => <FindingRow key={i} finding={f} />)}</ul>
          </section>
        )}
        {allTestEvidence.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Testes ({allTestEvidence.length})</h5>
            <ul className="task-tests mono">
              {allTestEvidence.map((te, i) => (
                <li key={i} className={`test-item ${te.passed ? "test-pass" : te.passed === false ? "test-fail" : "test-unknown"}`}>
                  <span className="test-status">{te.passed ? "✓" : te.passed === false ? "✗" : "?"}</span>
                  <span className="test-command mono">{te.command}</span>
                  {te.detail && <span className="test-detail">{te.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="task-block">
          <h5 className="task-block-label">Histórico de loops</h5>
          <div className="task-loops-history">
            {sortedLoops.map(([loop, ds]) => (
              <div key={loop} className="task-loop-group">
                <span className="task-loop-num mono">loop {loop}</span>
                <ul className="task-loop-dispatches">
                  {ds.map((d, i) => (
                    <li key={i} className={`task-loop-dispatch task-loop-${d.role}`}>
                      <span className="mono">{d.role}</span>
                      <span className={`loop-status loop-status-${d.status}`}>{d.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

export function TaskItem({ task, specId }: { task: Task; specId: string }) {
  const [expanded, setExpanded] = useState(false);
  const totalTokens = taskTotalTokens(task);
  return (
    <li className="task-item" data-state={task.state} data-expanded={expanded ? "true" : "false"}>
      <button type="button" className="task-item-header" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="mono task-item-id">{task.id}</span>
        <span className="task-item-state">{STATE_LABEL[task.state] ?? task.state}</span>
        {task.loops > 1 && <span className="task-item-loops">↻ {task.loops} loops</span>}
        {totalTokens != null && <span className="task-item-tokens">{fmtTokens(totalTokens)} tok</span>}
        <span className="task-item-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="task-expanded">
          <SummaryBlock specId={specId} task={task} />
          <TechDetails dispatches={task.dispatches} />
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Passar `specId` no DetailDrawer**

Em `web/src/components/DetailDrawer.tsx`, trocar:

```tsx
          {spec.tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
```

por:

```tsx
          {spec.tasks.map((task) => (
            <TaskItem key={task.id} task={task} specId={spec.id} />
          ))}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- web/src/components/TaskItem.test.tsx web/src/components/DetailDrawer.test.tsx && npx tsc --noEmit`
Expected: PASS em ambos; tsc sem erros. (Se algum assert antigo falhar por o texto estar dentro de `<details>`, ajustar o teste para abrir o `<details>` antes — em jsdom, `details` mantém o conteúdo montado, então normalmente não precisa.)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/TaskItem.tsx web/src/components/TaskItem.test.tsx web/src/components/DetailDrawer.tsx
git commit -m "feat(web): resumo IA no topo da task + detalhes técnicos recolhidos"
```

---

## Task 12: Estilos (CSS) — matar a cara de terminal

Cria todas as classes faltantes no tema claro atual. Sem teste automatizado — validação visual via preview.

**Files:**
- Modify: `web/src/app.css` (append no fim do arquivo)

- [ ] **Step 1: Adicionar os estilos**

Acrescentar ao final de `web/src/app.css`:

```css
/* ── Task item (drawer) ─────────────────────────────────────────────── */
.task-item { list-style: none; border-bottom: 1px solid var(--border-soft); }
.task-item-header { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 0; background: transparent; border: 0; cursor: pointer; font-size: 13px; text-align: left; }
.task-item-id { color: var(--text); font-weight: 600; }
.task-item-state { color: var(--text-dim); }
.task-item-loops { font-size: 11px; color: #b45309; background: #fffbeb; padding: 2px 8px; border-radius: 999px; }
.task-item-tokens { margin-left: auto; font-size: 11px; color: var(--text-mute); }
.task-item-chevron { color: var(--text-mute); }

.task-expanded { padding: 4px 0 14px; display: flex; flex-direction: column; gap: 12px; }

/* Resumo de ensino (destaque no topo) */
.task-summary { background: #f7f9ff; border: 1px solid #e0e8ff; border-radius: 10px; padding: 12px 14px; }
.task-summary-head { display: flex; align-items: center; gap: 10px; }
.task-summary-label { font-weight: 700; font-size: 13px; }
.task-summary-meta { font-size: 11px; color: var(--text-mute); }
.task-summary-btn { margin-left: auto; border: 1px solid var(--border-soft); background: #fff; border-radius: 7px; padding: 4px 10px; font-size: 12px; cursor: pointer; color: var(--text); }
.task-summary-btn:hover { border-color: var(--accent); color: var(--accent); }
.task-summary-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.task-summary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.task-summary-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-mute); }
.task-summary-warn { margin: 8px 0 0; font-size: 12px; color: #b45309; }
.task-summary-text { margin: 8px 0 0; font-size: 13px; line-height: 1.55; color: var(--text); white-space: pre-wrap; }

/* Detalhes técnicos (recolhido) */
.task-details-summary { cursor: pointer; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-mute); padding: 4px 0; }
.task-details-body { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; }
.task-block { background: #fafbfc; border: 1px solid var(--border-soft); border-radius: 8px; padding: 8px 10px; }
.task-block-label { margin: 0 0 6px; font-size: 11px; font-weight: 700; color: var(--text-dim); }
.task-summaries, .task-files, .task-findings, .task-tests { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.task-summary-item { display: flex; gap: 8px; align-items: baseline; }
.task-dispatch-tag { font-size: 11px; color: var(--text-mute); white-space: nowrap; }
.task-files li { color: #374151; font-size: 12px; }
.finding-item { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.finding-severity { font-size: 10px; text-transform: uppercase; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
.finding-error .finding-severity { color: #b91c1c; background: #fef2f2; }
.finding-warning .finding-severity { color: #b45309; background: #fffbeb; }
.finding-info .finding-severity { color: #1d4ed8; background: #eff6ff; }
.finding-loc { font-size: 11px; color: var(--text-mute); }
.finding-text { color: var(--text); }
.test-item { display: flex; gap: 8px; align-items: baseline; }
.test-pass .test-status { color: #15803d; }
.test-fail .test-status { color: #b91c1c; }
.test-unknown .test-status { color: var(--text-mute); }
.test-detail { color: var(--text-mute); font-size: 11px; }
.task-loops-history { display: flex; flex-direction: column; gap: 6px; }
.task-loop-group { display: flex; gap: 10px; align-items: baseline; }
.task-loop-num { font-size: 11px; color: var(--text-mute); white-space: nowrap; }
.task-loop-dispatches { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.task-loop-dispatch { display: flex; gap: 6px; font-size: 11px; align-items: baseline; }
.loop-status { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #f3f4f6; color: #374151; }
.task-empty-dispatches { font-size: 12px; color: var(--text-mute); }
```

(Se algum token CSS como `--accent`, `--text-mute`, `--border-soft` não existir, conferir o `:root` no topo do `app.css` e reusar os nomes que já existirem — não inventar variável nova.)

- [ ] **Step 2: Verificar visualmente** (preview)

Subir o app (`npm run dev`), abrir o board, clicar num card que tenha tasks com dispatches, expandir uma task. Conferir: resumo no topo com botão "gerar resumo"; "Detalhes técnicos" recolhido; ao abrir, blocos como cards; sem fonte mono em rótulos/prosa (só em path/cmd/id). Tirar screenshot pra registrar.

- [ ] **Step 3: Verificar a suíte inteira**

Run: `npm test && npx tsc --noEmit`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add web/src/app.css
git commit -m "feat(web): estilos do resumo IA e dos cards de detalhe da task"
```

---

## Self-Review

**1. Cobertura do spec:**
- §3 Layout (resumo topo, detalhes recolhidos, cards contáveis) → Task 11 + 12.
- §4.1 Protocolo WS (fetch/generate/cached/chunk/done/error) → Task 7 (servidor) + 9 (cliente).
- §4.2 Serviço CLI (spawn, stdin, stream-json, timeout/ENOENT) → Task 6. **Gap:** o spec menciona timeout de 60s; o Task 6 cobre ENOENT/close mas não um timer de timeout. → ver "Itens deixados de fora" abaixo.
- §4.3 Cache em disco → Task 5.
- §5 Prompt de ensino → Task 3.
- §6 Fingerprint → Task 2, usado no Task 7.
- §7 Disparo manual (fetch só lê, generate só no clique) → Task 9/10 (fetch ao montar; generate no botão).
- §8 Arquivos → todos cobertos.
- §9 Bordas: CLI ausente (Task 6), task sem dispatches (botão disabled, Task 11), 1 geração por task (cancela anterior, Task 7), fechar drawer no meio (cache pega depois — comportamento implícito do cache). 
- §10 Testes → cada task tem testes.

**2. Itens deixados de fora (decisão explícita):**
- **Timeout de 60s no serviço:** omitido do código base do Task 6 pra manter o passo enxuto. Razão: num app local single-user, `close`/`error` já cobrem os modos de falha comuns; um processo travado é raro. Trade-off: se o CLI travar, a UI fica em "gerando…" até o usuário regerar/fechar. Se quiser fechar esse risco, adicionar no `runSummary`: um `setTimeout(() => { proc.kill(); finishError("tempo esgotado (60s)"); }, 60000)` limpo no `close`. **Marcado como follow-up opcional, não bloqueia o MVP.**
- **Custo do preâmbulo de hooks (~29k tokens/chamada):** a hook `SessionStart` local injeta contexto grande em todo `claude -p`. Não tratado aqui pra não mexer em config de hooks (fora do escopo do aside). Mitigação possível futura: rodar o serviço com `cwd` num diretório neutro e/ou flag de desabilitar hooks. **Registrado, não implementado.**

**3. Consistência de tipos:** `taskFingerprint(task)`, `buildSummaryPrompt(title, task)`, `parseStreamLine(line)`, `readSummary/writeSummary(cacheRoot, specId, taskId, …)`, `runSummary(prompt, cb, deps)` com `SummaryHandle.cancel()`, `makeSummaryHandler(store, deps)`, `createSummaryClient(factory)` / `summaryClient`, `useTaskSummary(specId, taskId, client?)` → nomes batem entre as tasks que os consomem (7 usa 2/3/5/6; 8 usa 7; 10 usa 9; 11 usa 10). Mensagens WS idênticas nos dois lados (`summary:fetch|generate|cached|chunk|done|error`). `TaskItem` ganha prop `specId` e o `DetailDrawer` passa — coerente.

Nenhum placeholder. Pronto para execução.
