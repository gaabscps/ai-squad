import { useEffect, useRef, useState, useCallback } from "react";
import { summaryClient as defaultClient, type SummaryClient, type SummaryServerMsg } from "./summaryClient";

export type SummaryState = "empty" | "loading" | "streaming" | "ready" | "stale" | "error";

export interface TaskSummary {
  state: SummaryState;
  text: string;
  generatedAt: string | null;
  costUsd: number | null;
  /** true quando o texto chegou via streaming (anima); false quando veio do cache (instantâneo). */
  streamed: boolean;
  error: string | null;
  generate: () => void;
  regenerate: () => void;
}

/**
 * Máquina de estados do resumo de uma task. Ao montar, faz `fetch` (só lê cache).
 * `generate`/`regenerate` chamam o CLI (gasta quota — só por clique). Acumula os
 * chunks de streaming em `text`. O cliente é injetável pra teste.
 */
export function useTaskSummary(projectId: string, specId: string, taskId: string, client: SummaryClient = defaultClient): TaskSummary {
  const [state, setState] = useState<SummaryState>("empty");
  const [text, setText] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    const key = `${projectId}|${specId}|${taskId}`;
    const off = client.subscribe(key, (m: SummaryServerMsg) => {
      if (m.type === "summary:cached") {
        textRef.current = m.text ?? "";
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setStreamed(false); // veio do cache → mostra inteiro, sem animar
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "summary:chunk") {
        textRef.current += m.delta ?? "";
        setText(textRef.current);
        setStreamed(true); // chegou via stream → anima o typewriter
        setState("streaming");
      } else if (m.type === "summary:done") {
        textRef.current = m.text ?? textRef.current;
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setState("ready");
      } else if (m.type === "summary:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    client.fetch(projectId, specId, taskId);
    return off;
  }, [projectId, specId, taskId, client]);

  const start = useCallback((force: boolean) => {
    textRef.current = "";
    setText("");
    setError(null);
    setCostUsd(null);
    setStreamed(false);
    setState("loading");
    client.generate(projectId, specId, taskId, force);
  }, [projectId, specId, taskId, client]);

  return {
    state, text, generatedAt, costUsd, streamed, error,
    generate: () => start(false),
    regenerate: () => start(true),
  };
}
