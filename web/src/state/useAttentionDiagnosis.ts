import { useEffect, useRef, useState, useCallback } from "react";
import { attentionClient as defaultClient, type AttentionClient, type AttentionServerMsg } from "./attentionClient";

export type DiagnosisState = "empty" | "loading" | "streaming" | "ready" | "stale" | "error";

export interface AttentionDiagnosis {
  state: DiagnosisState;
  text: string;
  generatedAt: string | null;
  costUsd: number | null;
  streamed: boolean;
  error: string | null;
  /** Prompt copiável pro Claude Code; chega no attention:handoff, independente do diagnóstico. */
  handoff: string;
  generate: () => void;
  regenerate: () => void;
}

/**
 * Máquina de estados do diagnóstico de uma spec em atenção. Ao montar, faz `fetch`
 * (lê cache + recebe o handoff). `generate`/`regenerate` chamam o CLI (gasta quota,
 * só por clique). Acumula os chunks de streaming em `text`. Cliente injetável.
 */
export function useAttentionDiagnosis(projectId: string, specId: string, client: AttentionClient = defaultClient): AttentionDiagnosis {
  const [state, setState] = useState<DiagnosisState>("empty");
  const [text, setText] = useState("");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState("");
  const textRef = useRef("");

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: AttentionServerMsg) => {
      if (m.type === "attention:handoff") {
        setHandoff(m.text ?? "");
      } else if (m.type === "attention:cached") {
        textRef.current = m.text ?? "";
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setStreamed(false);
        setState(m.stale ? "stale" : "ready");
      } else if (m.type === "attention:chunk") {
        textRef.current += m.delta ?? "";
        setText(textRef.current);
        setStreamed(true);
        setState("streaming");
      } else if (m.type === "attention:done") {
        textRef.current = m.text ?? textRef.current;
        setText(textRef.current);
        setGeneratedAt(m.generatedAt ?? null);
        setCostUsd(m.costUsd ?? null);
        setState("ready");
      } else if (m.type === "attention:error") {
        setError(m.message ?? "erro ao gerar");
        setState("error");
      }
    });
    client.fetch(projectId, specId);
    return off;
  }, [projectId, specId, client]);

  const start = useCallback((force: boolean) => {
    textRef.current = "";
    setText("");
    setError(null);
    setCostUsd(null);
    setStreamed(false);
    setState("loading");
    client.generate(projectId, specId, force);
  }, [projectId, specId, client]);

  return {
    state, text, generatedAt, costUsd, streamed, error, handoff,
    generate: () => start(false),
    regenerate: () => start(true),
  };
}
