import { useEffect, useRef, useState, useCallback } from "react";
import { specSummaryClient as defaultClient, type SpecSummaryClient, type SpecSummaryServerMsg } from "./specSummaryClient";
import type { ModelAlias } from "../lib/modelLabel";

export type SpecSummaryState = "idle" | "loading" | "streaming" | "ready" | "stale" | "error";

export interface SpecSummary {
  state: SpecSummaryState;
  text: string;
  generatedAt: string | null;
  costUsd: number | null;
  modelId: string | null;
  streamed: boolean;
  error: string | null;
  fetch: () => void;
  generate: (model: ModelAlias) => void;
}

export function useSpecSummary(
  projectId: string,
  specId: string,
  client: SpecSummaryClient = defaultClient,
): SpecSummary {
  const [state, setState] = useState<SpecSummaryState>("idle");
  const [text, setText] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: SpecSummaryServerMsg) => {
      if (m.type === "spec-summary:cached") {
        textRef.current = m.text ?? "";
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setStreamed(false);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "spec-summary:chunk") {
        textRef.current += m.delta ?? "";
        setText(textRef.current);
        setStreamed(true);
        setState("streaming");
      } else if (m.type === "spec-summary:done") {
        textRef.current = m.text ?? textRef.current;
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setModelId(m.modelId ?? null);
        setState("ready");
      } else if (m.type === "spec-summary:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    return off;
  }, [projectId, specId, client]);

  const doFetch = useCallback(() => {
    client.fetch(projectId, specId);
  }, [projectId, specId, client]);

  const doGenerate = useCallback((model: ModelAlias) => {
    textRef.current = "";
    setText("");
    setError(null);
    setCostUsd(null);
    setModelId(null);
    setStreamed(false);
    setState("loading");
    client.generate(projectId, specId, model);
  }, [projectId, specId, client]);

  return {
    state,
    text,
    generatedAt,
    costUsd,
    modelId,
    streamed,
    error,
    fetch: doFetch,
    generate: doGenerate,
  };
}
