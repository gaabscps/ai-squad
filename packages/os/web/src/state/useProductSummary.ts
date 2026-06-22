import { useEffect, useState, useCallback } from "react";
import { productClient as defaultClient, type ProductClient, type ProductServerMsg, type ModelAlias } from "./productClient";
import type { ProductSummary } from "../../../src/product/types";

// Espelha useObservedNarrative.ts para o resumo de produto. Ao montar faz fetch (só
// cache, sem custo). generate/regenerate gastam uma chamada de LLM.

export type ProductSummaryState = "empty" | "loading" | "ready" | "stale" | "error";

export interface ObservedProductSummary {
  state: ProductSummaryState;
  summary: ProductSummary | null;
  generatedAt: string | null;
  costUsd: number | null;
  modelId: string | null;
  source: "sealed" | "generated" | null;
  error: string | null;
  generate: (model?: ModelAlias) => void;
  regenerate: (model?: ModelAlias) => void;
}

export function useProductSummary(projectId: string, specId: string, client: ProductClient = defaultClient): ObservedProductSummary {
  const [state, setState] = useState<ProductSummaryState>("empty");
  const [summary, setSummary] = useState<ProductSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [source, setSource] = useState<"sealed" | "generated" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: ProductServerMsg) => {
      if (m.type === "product:cached") {
        setSummary(m.summary ?? null);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setSource(m.source ?? null);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "product:generating") {
        setState("loading");
      } else if (m.type === "product:done") {
        setSummary(m.summary ?? null);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setModelId(m.modelId ?? null);
        setSource("generated");
        setState("ready");
      } else if (m.type === "product:error") {
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
    state, summary, generatedAt, costUsd, modelId, source, error,
    generate: (model?: ModelAlias) => start(false, model),
    regenerate: (model?: ModelAlias) => start(true, model),
  };
}
