import { join } from "node:path";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Spec } from "../store/types.js";
import type { ModelAlias } from "../ai/run.js";
import { buildNarrativeSource } from "./source.js";
import { buildNarrativePrompt } from "./prompt.js";
import { observedFingerprint } from "./fingerprint.js";
import { readNarrative, writeNarrative } from "./cache.js";
import { parseNarrative } from "./parse.js";
import { runNarrative, type NarrativeHandle } from "./service.js";

export interface NarrativeMsg {
  type: "narrative:fetch" | "narrative:generate";
  projectId?: unknown;
  specId?: unknown;
  model?: unknown;
}
type Send = (data: string) => void;

export interface NarrativeHandlerDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

function find(store: Store, projectId: string, specId: string): { projectPath: string; spec: Spec } | null {
  for (const p of store.getSnapshot()) {
    if (p.id !== projectId) continue;
    const spec = p.specs.find((s) => s.id === specId);
    if (spec) return { projectPath: p.path, spec };
  }
  return null;
}

/** Handler das mensagens narrative:* ligado a UM socket (o `send`). Só sessões observadas. */
export function makeNarrativeHandler(store: Store, deps: NarrativeHandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  const active = new Map<string, { id: number; handle: NarrativeHandle }>();
  let nextId = 0;

  return function handle(msg: NarrativeMsg, send: Send): void {
    if (typeof msg.projectId !== "string" || typeof msg.specId !== "string") return;
    const projectId = msg.projectId, specId = msg.specId;
    const key = `${projectId}|${specId}`;
    const found = find(store, projectId, specId);

    if (msg.type === "narrative:fetch") {
      const cached = readNarrative(cacheRoot, projectId, specId);
      if (!cached) return;
      const stale = found?.spec.observed
        ? observedFingerprint(found.spec.observed, found.spec.status) !== cached.fingerprint
        : true;
      send(JSON.stringify({ type: "narrative:cached", projectId, specId, narrative: cached.narrative, generatedAt: cached.generatedAt, costUsd: cached.costUsd ?? null, stale }));
      return;
    }

    if (msg.type === "narrative:generate") {
      if (!found || !found.spec.observed) {
        send(JSON.stringify({ type: "narrative:error", projectId, specId, message: "sessão observada não encontrada" }));
        return;
      }
      const observed = found.spec.observed;
      const model: ModelAlias = (msg.model === "haiku" || msg.model === "opus" || msg.model === "sonnet") ? msg.model : "sonnet";
      active.get(key)?.handle.cancel();
      const sessionDir = join(found.projectPath, ".agent-session", specId);
      const source = buildNarrativeSource(observed, sessionDir);
      const prompt = buildNarrativePrompt(source, observed.outputLocale);
      const fingerprint = observedFingerprint(observed, found.spec.status);
      const id = ++nextId;
      const clearIfCurrent = () => { if (active.get(key)?.id === id) active.delete(key); };
      send(JSON.stringify({ type: "narrative:generating", projectId, specId }));
      let acc = "";
      const handle = runNarrative(prompt, {
        onChunk: (delta) => { acc += delta; },
        onDone: (full, costUsd, modelId) => {
          const parsed = parseNarrative(full || acc);
          clearIfCurrent();
          if (!parsed) {
            send(JSON.stringify({ type: "narrative:error", projectId, specId, message: "não consegui montar a narrativa (resposta inválida)" }));
            return;
          }
          const rec = writeNarrative(cacheRoot, projectId, specId, { narrative: parsed, fingerprint, costUsd }, now);
          send(JSON.stringify({ type: "narrative:done", projectId, specId, narrative: parsed, generatedAt: rec.generatedAt, costUsd: rec.costUsd, modelId: modelId ?? null }));
        },
        onError: (message) => { clearIfCurrent(); send(JSON.stringify({ type: "narrative:error", projectId, specId, message })); },
      }, { spawnFn: deps.spawnFn, model });
      active.set(key, { id, handle });
    }
  };
}
