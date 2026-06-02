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
  // Cada geração ganha um id; o mapa guarda { id, handle } por chave projectId|specId.
  // O id permite a limpeza guardada por identidade (ver clearIfCurrent abaixo).
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
      active.get(key)?.handle.cancel(); // cancela a geração anterior dessa spec, se houver
      const ctx = buildAttentionContext(found.spec, found.projectPath);
      const prompt = buildDiagnosisPrompt(ctx);
      const fingerprint = contextFingerprint(ctx);
      const id = ++nextId;
      // Só limpa o mapa se a entrada ainda for ESTA geração. Sem isso, o `close`
      // assíncrono de um processo já cancelado apagaria a entrada da geração nova.
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
