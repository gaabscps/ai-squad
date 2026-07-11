import { useState } from "react";
import type { FeatureWithProject } from "../lib/kanbanFeatures";
import { bucketFeaturesByColumn } from "../lib/kanbanFeatures";
import type { SpecWithProject } from "../lib/kanban";
import { COLUMN_DEFS, type ColumnKey } from "../lib/kanbanObserved";
import { FeatureCard, type FeatureActionMsg } from "./FeatureCard";

// Mapa de coluna → state que soltar um card ali dispara (mesma mensagem que os
// botões do FeatureCard emitem). "attention" fica de fora de propósito: essa
// coluna é derivada de atenção, não é um estado que se possa arrastar pra dentro.
const DROP_STATE: Partial<Record<ColumnKey, "open" | "awaiting_deploy" | "done">> = {
  running: "open",
  deploy: "awaiting_deploy",
  done: "done",
};

/**
 * O kanban: agrupa os itens (já filtrados pelo Board) por coluna e renderiza as 3
 * colunas na ordem de COLUMN_DEFS. Não conhece filtro/busca — recebe a lista
 * pronta. onSelectSession sobe pro Board abrir o drawer; onFeatureAction desce
 * até o FeatureCard pra correção manual (mover sessão, marcar entregue) e também
 * é chamada quando um card é arrastado e solto numa coluna que aceita drop.
 */
export function KanbanBoard({
  items,
  onSelectSession,
  onFeatureAction,
  knownFeaturesByProject,
}: {
  items: FeatureWithProject[];
  onSelectSession: (s: SpecWithProject) => void;
  onFeatureAction?: (msg: FeatureActionMsg) => void;
  knownFeaturesByProject?: Map<string, { id: string; name: string }[]>;
}) {
  const buckets = bucketFeaturesByColumn(items);
  const [dragOverCol, setDragOverCol] = useState<ColumnKey | null>(null);

  return (
    <div className="kboard">
      {COLUMN_DEFS.map((c) => {
        const dropState = DROP_STATE[c.key];
        return (
          <section
            className={`kcol${dragOverCol === c.key ? " kcol-dragover" : ""}`}
            data-col={c.key}
            key={c.key}
            onDragOver={dropState ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
            onDragEnter={dropState ? (e) => { e.preventDefault(); setDragOverCol(c.key); } : undefined}
            onDragLeave={dropState ? () => setDragOverCol((cur) => (cur === c.key ? null : cur)) : undefined}
            onDrop={dropState ? (e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (!onFeatureAction) return;
              const raw = e.dataTransfer.getData("application/json");
              if (!raw) return;
              try {
                const { projectId, featureId } = JSON.parse(raw) as { projectId: string; featureId: string };
                onFeatureAction({ type: "feature:setDelivery", projectId, featureId, state: dropState });
              } catch {
                // payload malformado (drag de fora do board, ex.: texto arrastado) — ignora
              }
            } : undefined}
          >
            <header className="kcol-head">
              <span className="kcol-dot" />
              <span className="kcol-label">{c.label}</span>
              <span className="kcol-count">{buckets[c.key].length}</span>
            </header>
            {buckets[c.key].length === 0 ? (
              <p className="kcol-empty">nada aqui</p>
            ) : (
              buckets[c.key].map((it) => (
                <FeatureCard
                  key={`${it.projectId}/${it.feature.id}`}
                  item={it}
                  onSelectSession={onSelectSession}
                  onFeatureAction={onFeatureAction}
                  knownFeatures={knownFeaturesByProject?.get(it.projectId) ?? []}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
