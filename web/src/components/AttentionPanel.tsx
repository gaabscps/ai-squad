import { useState } from "react";
import { useAttentionDiagnosis } from "../state/useAttentionDiagnosis";
import { useTypewriter } from "../state/useTypewriter";
import { MarkdownText } from "../lib/markdown";
import { fmtUsd } from "../format";
import type { AttentionClient } from "../state/attentionClient";

/**
 * Painel da coluna "Precisa de você": diagnóstico de bloqueio gerado por IA sob
 * demanda (one-shot, streamado) + botão que copia o prompt de handoff pro Claude
 * Code. O cru (timeline/findings) NÃO é repetido aqui — fica nas seções de
 * "Linha do tempo" e "Tarefas" do drawer, logo abaixo. `client` injetável p/ teste.
 */
export function AttentionPanel({ projectId, specId, client }: { projectId: string; specId: string; client?: AttentionClient }) {
  const d = useAttentionDiagnosis(projectId, specId, client);
  const [copied, setCopied] = useState(false);
  const animate = d.streamed && (d.state === "streaming" || d.state === "ready");
  const display = useTypewriter(d.text, animate);
  const typing = d.state === "streaming" || (animate && display.length < d.text.length);

  const copyHandoff = async () => {
    if (!d.handoff) return;
    try {
      await navigator.clipboard.writeText(d.handoff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard indisponível (sem foco / permissão / contexto não-seguro):
      // falha silenciosa — o prompt segue visível pra cópia manual.
      setCopied(false);
    }
  };

  return (
    <section className="attention-panel" data-state={d.state}>
      <header className="attention-head">
        <span className="attention-label">🧭 O que fazer aqui</span>
        {(d.state === "ready" || d.state === "stale") && (
          <button type="button" className="attention-btn" onClick={d.regenerate}>↻ regerar</button>
        )}
        {(d.state === "empty" || d.state === "error") && (
          <button type="button" className="attention-btn primary" onClick={d.generate}>
            O que preciso fazer aqui?
          </button>
        )}
      </header>

      {d.state === "empty" && <p className="attention-hint">clique para diagnosticar por que parou e o que fazer</p>}
      {d.state === "loading" && <p className="attention-hint">gerando…</p>}
      {d.state === "stale" && <p className="attention-warn">desatualizado — regerar para refletir o progresso recente</p>}
      {d.state === "error" && <p className="attention-warn">{d.error}</p>}

      {(d.state === "streaming" || d.state === "ready" || d.state === "stale") && d.text && (
        <div className="attention-text">
          <MarkdownText source={display} />
          {typing && <span className="attention-cursor" aria-hidden="true">▋</span>}
        </div>
      )}

      {d.costUsd != null && !typing && (d.state === "ready" || d.state === "stale") && (
        <p className="attention-cost" title="custo real reportado pelo Claude CLI">
          custo desta geração · {fmtUsd(d.costUsd)}
        </p>
      )}

      <button type="button" className="attention-handoff-btn" onClick={copyHandoff} disabled={!d.handoff}>
        {copied ? "copiado ✓" : "Copiar prompt pro Claude Code"}
      </button>
    </section>
  );
}
