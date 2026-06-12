import { join } from "node:path";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Task } from "../store/types.js";
import type { ModelAlias } from "../ai/run.js";
import { taskFingerprint } from "./fingerprint.js";
import { buildSummaryPrompt } from "./prompt.js";
import { readSummary, writeSummary } from "./cache.js";
import { runSummary, type SummaryHandle } from "./service.js";

export interface SummaryMsg {
  type: "summary:fetch" | "summary:generate";
  projectId?: unknown;
  specId?: unknown;
  taskId?: unknown;
  model?: unknown;
}
type Send = (data: string) => void;

export interface HandlerDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

// Casa por projectId+specId+taskId: specId/taskId se repetem entre projetos
// (cada projeto tem seu FEAT-001/T-001), então só specId pegaria a task errada.
function findTask(store: Store, projectId: string, specId: string, taskId: string): { title: string; task: Task } | null {
  for (const p of store.getSnapshot()) {
    if (p.id !== projectId) continue;
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
 * Guarda a geração ativa por chave projectId|specId|taskId pra cancelar duplicatas.
 */
export function makeSummaryHandler(store: Store, deps: HandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  // Cada geração ganha um id; o mapa guarda { id, handle } por chave projectId|specId|taskId.
  // O id permite a limpeza guardada por identidade (ver clearIfCurrent abaixo).
  const active = new Map<string, { id: number; handle: SummaryHandle }>();
  let nextId = 0;

  return function handle(msg: SummaryMsg, send: Send): void {
    if (typeof msg.projectId !== "string" || typeof msg.specId !== "string" || typeof msg.taskId !== "string") return;
    const projectId = msg.projectId, specId = msg.specId, taskId = msg.taskId;
    const key = `${projectId}|${specId}|${taskId}`;
    const found = findTask(store, projectId, specId, taskId);

    if (msg.type === "summary:fetch") {
      const cached = readSummary(cacheRoot, projectId, specId, taskId);
      if (!cached) return;
      const stale = found ? taskFingerprint(found.task) !== cached.fingerprint : true;
      send(JSON.stringify({ type: "summary:cached", projectId, specId, taskId, text: cached.text, generatedAt: cached.generatedAt, costUsd: cached.costUsd ?? null, stale }));
      return;
    }

    if (msg.type === "summary:generate") {
      if (!found) {
        send(JSON.stringify({ type: "summary:error", projectId, specId, taskId, message: "tarefa não encontrada" }));
        return;
      }
      const model = (msg.model === "haiku" || msg.model === "opus" || msg.model === "sonnet") ? msg.model as ModelAlias : "sonnet";
      active.get(key)?.handle.cancel(); // cancela a geração anterior dessa task, se houver
      const prompt = buildSummaryPrompt(found.title, found.task);
      const fingerprint = taskFingerprint(found.task);
      const id = ++nextId;
      // Só limpa o mapa se a entrada ainda for ESTA geração. Sem isso, o `close`
      // assíncrono de um processo já cancelado apagaria a entrada da geração nova.
      const clearIfCurrent = () => { if (active.get(key)?.id === id) active.delete(key); };
      let acc = "";
      const handle = runSummary(prompt, {
        onChunk: (delta) => { acc += delta; send(JSON.stringify({ type: "summary:chunk", projectId, specId, taskId, delta })); },
        onDone: (full, costUsd, modelId) => {
          const text = full || acc;
          const rec = writeSummary(cacheRoot, projectId, specId, taskId, { text, fingerprint, costUsd }, now);
          clearIfCurrent();
          send(JSON.stringify({ type: "summary:done", projectId, specId, taskId, text, generatedAt: rec.generatedAt, costUsd: rec.costUsd, modelId: modelId ?? null }));
        },
        onError: (message) => { clearIfCurrent(); send(JSON.stringify({ type: "summary:error", projectId, specId, taskId, message })); },
      }, { spawnFn: deps.spawnFn, model });
      active.set(key, { id, handle });
    }
  };
}
