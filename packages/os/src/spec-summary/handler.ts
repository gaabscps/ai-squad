import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Spec } from "../store/types.js";
import type { ModelAlias } from "../ai/run.js";
import { computeSpecFingerprint } from "./fingerprint.js";
import { readSpecSummary, writeSpecSummary } from "./cache.js";
import { runSpecSummary, type SpecSummaryHandle } from "./service.js";

export interface SpecSummaryMsg {
  type: "spec-summary:fetch" | "spec-summary:generate";
  projectId?: unknown;
  specId?: unknown;
  model?: unknown;
}
type Send = (data: string) => void;

export interface SpecSummaryHandlerDeps {
  cacheRoot?: string;
  spawnFn?: typeof realSpawn;
  now?: () => string;
}

function findSpec(store: Store, projectId: string, specId: string): Spec | null {
  for (const p of store.getSnapshot()) {
    if (p.id !== projectId) continue;
    const spec = p.specs.find((s) => s.id === specId);
    if (spec) return spec;
  }
  return null;
}

/**
 * Devolve um handler de mensagens spec-summary ligado a UM socket (o `send`).
 * Guarda a geração ativa por chave projectId|specId pra cancelar duplicatas (AC-009).
 */
export function makeSpecSummaryHandler(store: Store, deps: SpecSummaryHandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  const active = new Map<string, { id: number; handle: SpecSummaryHandle }>();
  let nextId = 0;

  return function handle(msg: SpecSummaryMsg, send: Send): void {
    if (typeof msg.projectId !== "string" || typeof msg.specId !== "string") return;
    const projectId = msg.projectId;
    const specId = msg.specId;
    const key = `${projectId}|${specId}`;

    if (msg.type === "spec-summary:fetch") {
      const cached = readSpecSummary(cacheRoot, projectId, specId);
      if (!cached) return;
      const spec = findSpec(store, projectId, specId);
      let stale = true;
      if (spec?.specPath) {
        try {
          const current = readFileSync(spec.specPath, "utf-8");
          stale = computeSpecFingerprint(current) !== cached.fingerprint;
        } catch {
          stale = true;
        }
      }
      send(JSON.stringify({ type: "spec-summary:cached", projectId, specId, summary: cached.text, generatedAt: cached.generatedAt, costUsd: cached.costUsd ?? null, modelId: cached.modelId ?? null, stale }));
      return;
    }

    if (msg.type === "spec-summary:generate") {
      const spec = findSpec(store, projectId, specId);
      if (!spec) {
        send(JSON.stringify({ type: "spec-summary:error", projectId, specId, message: "feature não encontrada" }));
        return;
      }
      if (!spec.specPath) {
        send(JSON.stringify({ type: "spec-summary:error", projectId, specId, message: "spec.md não disponível" }));
        return;
      }
      const specPath = spec.specPath;
      const model: ModelAlias = (msg.model === "haiku" || msg.model === "sonnet" || msg.model === "opus") ? msg.model : "haiku";

      active.get(key)?.handle.cancel();

      const id = ++nextId;
      const clearIfCurrent = () => { if (active.get(key)?.id === id) active.delete(key); };
      let acc = "";

      const handle_ = runSpecSummary({
        specPath,
        model,
        projectId,
        specId,
        callbacks: {
          onChunk: (delta) => {
            acc += delta;
            send(JSON.stringify({ type: "spec-summary:chunk", projectId, specId, delta }));
          },
          onDone: (full, costUsd, modelId) => {
            const text = full || acc;
            let fingerprint = "";
            try {
              const content = readFileSync(specPath, "utf-8");
              fingerprint = computeSpecFingerprint(content);
            } catch {
              fingerprint = computeSpecFingerprint("");
            }
            const rec = writeSpecSummary(cacheRoot, projectId, specId, { text, fingerprint, costUsd, modelId: modelId ?? null }, now);
            clearIfCurrent();
            send(JSON.stringify({ type: "spec-summary:done", projectId, specId, text, generatedAt: rec.generatedAt, costUsd: rec.costUsd, modelId: rec.modelId }));
          },
          onError: (message) => {
            clearIfCurrent();
            send(JSON.stringify({ type: "spec-summary:error", projectId, specId, message }));
          },
        },
        deps: { spawnFn: deps.spawnFn },
      });
      active.set(key, { id, handle: handle_ });
    }
  };
}
