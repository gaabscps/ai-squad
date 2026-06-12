import { useState, useEffect } from "react";
import { Markdown } from "./Markdown";
import { ModelSelector } from "./ModelSelector";
import { modelLabel } from "../lib/modelLabel";
import type { ModelAlias } from "../lib/modelLabel";
import { useSpecSummary } from "../state/useSpecSummary";
import { specSummaryClient, type SpecSummaryClient } from "../state/specSummaryClient";

interface SpecSummaryBlockProps {
  projectId: string;
  specId: string;
  specPath: string | null | undefined;
  client?: SpecSummaryClient;
}

export function SpecSummaryBlock({
  projectId,
  specId,
  specPath,
  client = specSummaryClient,
}: SpecSummaryBlockProps) {
  const [model, setModel] = useState<ModelAlias>("haiku");
  const hasSpec = specPath != null;
  const s = useSpecSummary(projectId, specId, client);
  const label = modelLabel(s.modelId);

  useEffect(() => {
    if (hasSpec) s.fetch();
  // s.fetch is stable (useCallback), projectId/specId/hasSpec drive re-fetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, specId, hasSpec]);

  const isEmpty = s.state === "idle" || s.state === "error";

  return (
    <section className="spec-summary" data-state={s.state}>
      <header className="spec-summary-head">
        <span className="spec-summary-label">✨ Resumo da feature</span>
        {s.state === "ready" && s.generatedAt && (
          <span className="spec-summary-meta">
            gerado {new Date(s.generatedAt).toLocaleTimeString()}
            {label && <> · {label}</>}
          </span>
        )}
        {(s.state === "ready" || s.state === "stale") && hasSpec && (
          <button
            type="button"
            className="spec-summary-btn"
            onClick={() => s.generate(model)}
          >
            ↻ regerar
          </button>
        )}
        {isEmpty && (
          <>
            <ModelSelector
              storageKey="aios-model-spec"
              defaultValue="haiku"
              onChange={setModel}
            />
            <button
              type="button"
              className="spec-summary-btn primary"
              onClick={() => s.generate(model)}
              disabled={!hasSpec}
            >
              gerar resumo
            </button>
          </>
        )}
      </header>

      {!hasSpec && (
        <p className="spec-summary-hint">sem spec.md disponível</p>
      )}
      {hasSpec && s.state === "idle" && (
        <p className="spec-summary-hint">clique para gerar uma explicação desta feature</p>
      )}
      {hasSpec && s.state === "loading" && (
        <p className="spec-summary-hint">gerando…</p>
      )}
      {hasSpec && s.state === "stale" && (
        <p className="spec-summary-warn">regerar — spec.md foi modificado</p>
      )}
      {hasSpec && s.state === "error" && (
        <p className="spec-summary-warn">{s.error}</p>
      )}
      {(s.state === "streaming" || s.state === "ready" || s.state === "stale") && s.text && (
        <Markdown className="spec-summary-text">{s.text}</Markdown>
      )}
    </section>
  );
}
