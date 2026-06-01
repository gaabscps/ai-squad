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
      if (!cached) return;
      const stale = found ? taskFingerprint(found.task) !== cached.fingerprint : true;
      send(JSON.stringify({ type: "summary:cached", specId, taskId, text: cached.text, generatedAt: cached.generatedAt, stale }));
      return;
    }

    if (msg.type === "summary:generate") {
      if (!found) {
        send(JSON.stringify({ type: "summary:error", specId, taskId, message: "tarefa não encontrada" }));
        return;
      }
      active.get(key)?.cancel();
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
