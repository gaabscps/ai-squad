import { useEffect, useState, useCallback } from "react";
import { narrativeClient as defaultClient, type NarrativeClient, type NarrativeServerMsg, type ModelAlias } from "./narrativeClient";
import type { SessionNarrative } from "../../../src/narrative/types";

export type NarrativeState = "empty" | "loading" | "ready" | "stale" | "error";

export interface ObservedNarrative {
  state: NarrativeState;
  narrative: SessionNarrative | null;
  generatedAt: string | null;
  costUsd: number | null;
  modelId: string | null;
  error: string | null;
  generate: (model?: ModelAlias) => void;
  regenerate: (model?: ModelAlias) => void;
}

/** Estado da narrativa de uma sessão observada. Ao montar faz fetch (só cache). generate/regenerate gastam quota. */
export function useObservedNarrative(projectId: string, specId: string, client: NarrativeClient = defaultClient): ObservedNarrative {
  const [state, setState] = useState<NarrativeState>("empty");
  const [narrative, setNarrative] = useState<SessionNarrative | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: NarrativeServerMsg) => {
      if (m.type === "narrative:cached") {
        setNarrative(m.narrative ?? null);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "narrative:generating") {
        setState("loading");
      } else if (m.type === "narrative:done") {
        setNarrative(m.narrative ?? null);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setModelId(m.modelId ?? null);
        setState("ready");
      } else if (m.type === "narrative:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    client.fetch(projectId, specId);
    return off;
  }, [projectId, specId, client]);

  const start = useCallback((force: boolean, model?: ModelAlias) => {
    setError(null);
    setState("loading");
    client.generate(projectId, specId, force, model);
  }, [projectId, specId, client]);

  return {
    state, narrative, generatedAt, costUsd, modelId, error,
    generate: (model?: ModelAlias) => start(false, model),
    regenerate: (model?: ModelAlias) => start(true, model),
  };
}
