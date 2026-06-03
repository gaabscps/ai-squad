import { useEffect, useState, useCallback } from "react";
import { attentionClient as defaultClient, type AttentionClient, type AttentionServerMsg } from "./attentionClient";
import { useDiagnosisJobs } from "./diagnosisJobs";

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

interface CachedResult {
  text: string;
  generatedAt: string | null;
  costUsd: number | null;
  stale: boolean;
}

function jobStateToDiagnosisState(jobState: string): DiagnosisState {
  if (jobState === "queued" || jobState === "generating") return "loading";
  if (jobState === "streaming") return "streaming";
  if (jobState === "ready") return "ready";
  if (jobState === "error") return "error";
  if (jobState === "cancelled") return "empty";
  return "empty";
}

/**
 * Máquina de estados do diagnóstico de uma spec em atenção.
 * Lê o estado vivo do store global (DiagnosisJobsProvider) como fonte única de verdade;
 * mantém apenas o cache local (attention:cached) e o handoff (attention:handoff)
 * que chegam fora do ciclo de geração.
 */
export function useAttentionDiagnosis(projectId: string, specId: string, client: AttentionClient = defaultClient): AttentionDiagnosis {
  const { getJob, generate: storeGenerate } = useDiagnosisJobs();
  const job = getJob(projectId, specId);

  const [cached, setCached] = useState<CachedResult | null>(null);
  const [handoff, setHandoff] = useState("");
  const [streamed, setStreamed] = useState(false);

  useEffect(() => {
    const key = `${projectId}|${specId}`;
    const off = client.subscribe(key, (m: AttentionServerMsg) => {
      if (m.type === "attention:handoff") {
        setHandoff(m.text ?? "");
      } else if (m.type === "attention:cached") {
        setCached({
          text: m.text ?? "",
          generatedAt: m.generatedAt ?? null,
          costUsd: m.costUsd ?? null,
          stale: m.stale ?? false,
        });
      } else if (m.type === "attention:chunk") {
        setStreamed(true);
      }
    });
    client.fetch(projectId, specId);
    return off;
  }, [projectId, specId, client]);

  const effectiveHandoff = job?.handoff ?? handoff;

  const generate = useCallback(() => {
    setCached(null);
    setStreamed(false);
    storeGenerate(projectId, specId);
  }, [projectId, specId, storeGenerate]);

  if (job && job.state !== "cancelled") {
    const diagState = jobStateToDiagnosisState(job.state);
    return {
      state: diagState,
      text: job.text,
      generatedAt: job.generatedAt,
      costUsd: job.costUsd,
      // streamed local persiste após streaming→ready para que o caller saiba que o conteúdo veio ao vivo
      streamed: job.state === "streaming" || (job.state === "ready" && streamed),
      error: job.error,
      handoff: effectiveHandoff,
      generate,
      regenerate: generate,
    };
  }

  if (cached) {
    return {
      state: cached.stale ? "stale" : "ready",
      text: cached.text,
      generatedAt: cached.generatedAt,
      costUsd: cached.costUsd,
      streamed: false,
      error: null,
      handoff: effectiveHandoff,
      generate,
      regenerate: generate,
    };
  }

  return {
    state: "empty",
    text: "",
    generatedAt: null,
    costUsd: null,
    streamed: false,
    error: null,
    handoff: effectiveHandoff,
    generate,
    regenerate: generate,
  };
}
