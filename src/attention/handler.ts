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
  type: "attention:fetch" | "attention:generate" | "attention:cancel";
  projectId?: unknown;
  specId?: unknown;
}
type Send = (data: string) => void;

export interface HandlerDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

const MAX_CONCURRENT = 3;

interface PendingEntry {
  projectId: string;
  specId: string;
  prompt: string;
  fingerprint: string;
  send: Send;
}

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
 * Claude via runAgent, streama e grava o cache.
 */
export function makeDiagnosisHandler(store: Store, deps: HandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  // Cada geração ganha um id; o mapa guarda { id, handle } por chave projectId|specId.
  // O id permite a limpeza guardada por identidade (ver clearIfCurrent abaixo).
  const active = new Map<string, { id: number; handle: AgentHandle }>();
  const pending: PendingEntry[] = [];
  let nextId = 0;

  function startGeneration(projectId: string, specId: string, prompt: string, fingerprint: string, send: Send): void {
    const key = `${projectId}|${specId}`;
    const id = ++nextId;
    // kill() é assíncrono: o proc cancelado ainda dispara um terminal tardio (close/error)
    // DEPOIS da geração nova já ter assumido a chave. Guardar por id garante que só ESTA
    // geração mexe no mapa e fala pelo `send` — o proc morto vira no-op em vez de marcar
    // um job vivo como error nem furar o slot da nova.
    const isCurrent = () => active.get(key)?.id === id;
    const clearIfCurrent = () => { if (isCurrent()) active.delete(key); };

    const onRelease = () => {
      clearIfCurrent();
      drainPending();
    };

    let acc = "";
    const handle = runAgent(prompt, {
      onChunk: (delta) => {
        if (!isCurrent()) return;
        acc += delta;
        send(JSON.stringify({ type: "attention:chunk", projectId, specId, delta }));
      },
      onDone: (full, costUsd) => {
        if (!isCurrent()) return;
        const text = full || acc;
        let rec: ReturnType<typeof writeDiagnosis> | undefined;
        try {
          rec = writeDiagnosis(cacheRoot, projectId, specId, { text, fingerprint, costUsd }, now);
        } finally {
          onRelease();
        }
        if (rec) send(JSON.stringify({ type: "attention:done", projectId, specId, text, generatedAt: rec.generatedAt, costUsd: rec.costUsd }));
      },
      onError: (message) => {
        if (!isCurrent()) return;
        onRelease();
        send(JSON.stringify({ type: "attention:error", projectId, specId, message }));
      },
    }, { adapter: claudeAdapter, spawnFn: deps.spawnFn });
    active.set(key, { id, handle });
  }

  function drainPending(): void {
    if (pending.length === 0 || active.size >= MAX_CONCURRENT) return;
    const entry = pending.shift()!;
    startGeneration(entry.projectId, entry.specId, entry.prompt, entry.fingerprint, entry.send);
  }

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

      const pendingIdx = pending.findIndex((e) => `${e.projectId}|${e.specId}` === key);
      if (pendingIdx !== -1) {
        const [orphan] = pending.splice(pendingIdx, 1);
        orphan.send(JSON.stringify({ type: "attention:error", projectId, specId, message: "substituído por nova geração" }));
      }

      const ctx = buildAttentionContext(found.spec, found.projectPath);
      const prompt = buildDiagnosisPrompt(ctx);
      const fingerprint = contextFingerprint(ctx);

      // Se a chave já ocupa uma vaga (active.has), reusa o slot sem incrementar o cap.
      if (active.has(key) || active.size < MAX_CONCURRENT) {
        startGeneration(projectId, specId, prompt, fingerprint, send);
      } else {
        pending.push({ projectId, specId, prompt, fingerprint, send });
        send(JSON.stringify({ type: "attention:queued", projectId, specId }));
      }
    }

    if (msg.type === "attention:cancel") {
      const activeEntry = active.get(key);
      if (activeEntry) {
        activeEntry.handle.cancel();
        active.delete(key);
        send(JSON.stringify({ type: "attention:cancelled", projectId, specId }));
        drainPending();
        return;
      }

      const pendingIdx = pending.findIndex((e) => e.projectId === projectId && e.specId === specId);
      if (pendingIdx !== -1) {
        pending.splice(pendingIdx, 1);
        send(JSON.stringify({ type: "attention:cancelled", projectId, specId }));
      }
    }
  };
}
