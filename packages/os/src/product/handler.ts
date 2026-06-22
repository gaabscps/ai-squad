import { join } from "node:path";
import type { spawn as realSpawn } from "node:child_process";
import type { Store } from "../store/store.js";
import type { Spec } from "../store/types.js";
import type { ModelAlias } from "../ai/run.js";
import { buildNarrativeSource } from "../narrative/source.js";
import { observedFingerprint } from "../narrative/fingerprint.js";
import { runNarrative, type NarrativeHandle } from "../narrative/service.js";
import { buildProductPrompt } from "./prompt.js";
import { parseProductSummary } from "./parse.js";
import { readProductSummary, writeProductSummary, type CachedProductSummary } from "./cache.js";
import { readSealedProductSummary, type SealedProductSummary } from "./sealed.js";

// Handler do resumo de PRODUTO. Espelha narrative/handler.ts (mesmo ciclo fetch/generate,
// cancelamento, cache por fingerprint), mas usa o prompt/parse/cache de produto. Reusa
// buildNarrativeSource (transcript), runNarrative (LLM) e observedFingerprint do OBS sem
// tocá-los. Mensagens próprias product:* — isolado do caminho dev.

export interface ProductMsg {
  type: "product:fetch" | "product:generate";
  projectId?: unknown;
  specId?: unknown;
  model?: unknown;
}
type Send = (data: string) => void;

export interface ProductHandlerDeps {
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

/** true se o selado deve vencer o cache: mais recente vence; empate e timestamps inválidos favorecem o selado (fonte canônica do framework). */
function preferSealed(sealed: SealedProductSummary | null, cached: CachedProductSummary | null): boolean {
  if (!sealed) return false;
  if (!cached) return true;
  const ts = (s: string): number | null => { const d = Date.parse(s); return Number.isNaN(d) ? null : d; };
  const a = ts(sealed.sealedAt), b = ts(cached.generatedAt);
  if (a !== null && b !== null) return a >= b;
  if (a !== null) return true;   // cache sem carimbo válido
  if (b !== null) return false;  // selado sem carimbo válido
  return true;                   // ambos inválidos → selado
}

/** Handler das mensagens product:* ligado a UM socket (o `send`). Só sessões observadas. */
export function makeProductHandler(store: Store, deps: ProductHandlerDeps = {}) {
  const cacheRoot = deps.cacheRoot ?? join(process.cwd(), ".aios-cache");
  const now = deps.now ?? (() => new Date().toISOString());
  const active = new Map<string, { id: number; handle: NarrativeHandle }>();
  let nextId = 0;

  return function handle(msg: ProductMsg, send: Send): void {
    if (typeof msg.projectId !== "string" || typeof msg.specId !== "string") return;
    const projectId = msg.projectId, specId = msg.specId;
    const key = `${projectId}|${specId}`;
    const found = find(store, projectId, specId);

    if (msg.type === "product:fetch") {
      const cached = readProductSummary(cacheRoot, projectId, specId);
      // projectPath tolerando found=null (corrida do coletor): a Project pode existir sem o Spec
      const projectPath = found?.projectPath ?? store.getSnapshot().find((p) => p.id === projectId)?.path ?? null;
      const sealed = projectPath ? readSealedProductSummary(join(projectPath, ".agent-session", specId)) : null;
      if (!cached && !sealed) return;
      if (preferSealed(sealed, cached) && sealed) {
        send(JSON.stringify({ type: "product:cached", projectId, specId, summary: sealed.summary, generatedAt: sealed.sealedAt, costUsd: null, stale: false, source: "sealed" }));
        return;
      }
      const c = cached as CachedProductSummary;
      const stale = found?.spec.observed
        ? observedFingerprint(found.spec.observed, found.spec.status) !== c.fingerprint
        : true;
      send(JSON.stringify({ type: "product:cached", projectId, specId, summary: c.summary, generatedAt: c.generatedAt, costUsd: c.costUsd ?? null, stale, source: "generated" }));
      return;
    }

    if (msg.type === "product:generate") {
      if (!found || !found.spec.observed) {
        send(JSON.stringify({ type: "product:error", projectId, specId, message: "sessão observada não encontrada" }));
        return;
      }
      const observed = found.spec.observed;
      const model: ModelAlias = (msg.model === "haiku" || msg.model === "opus" || msg.model === "sonnet") ? msg.model : "sonnet";
      active.get(key)?.handle.cancel();
      const sessionDir = join(found.projectPath, ".agent-session", specId);
      const source = buildNarrativeSource(observed, sessionDir);
      const prompt = buildProductPrompt(source, observed.outputLocale);
      const fingerprint = observedFingerprint(observed, found.spec.status);
      const id = ++nextId;
      const clearIfCurrent = () => { if (active.get(key)?.id === id) active.delete(key); };
      send(JSON.stringify({ type: "product:generating", projectId, specId }));
      let acc = "";
      const handle = runNarrative(prompt, {
        onChunk: (delta) => { acc += delta; },
        onDone: (full, costUsd, modelId) => {
          const parsed = parseProductSummary(full || acc);
          clearIfCurrent();
          if (!parsed) {
            send(JSON.stringify({ type: "product:error", projectId, specId, message: "não consegui montar o resumo (resposta inválida)" }));
            return;
          }
          const rec = writeProductSummary(cacheRoot, projectId, specId, { summary: parsed, fingerprint, costUsd }, now);
          send(JSON.stringify({ type: "product:done", projectId, specId, summary: parsed, generatedAt: rec.generatedAt, costUsd: rec.costUsd, modelId: modelId ?? null }));
        },
        onError: (message) => { clearIfCurrent(); send(JSON.stringify({ type: "product:error", projectId, specId, message })); },
      }, { spawnFn: deps.spawnFn, model });
      active.set(key, { id, handle });
    }
  };
}
