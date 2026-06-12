import { useState, useCallback } from "react";
import type { SpecWithProject } from "../lib/kanbanObserved";
import { attentionReason, columnForSpec } from "../lib/kanbanObserved";
import { fmtTokens, fmtUsd, fmtDate } from "../format";
import { PhaseBar } from "./PhaseBar";
import { PhaseJourney } from "./PhaseJourney";
import { StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";
import { TaskItem } from "./TaskItem";
import { AttentionPanel } from "./AttentionPanel";
import { SpecJobIndicator } from "./SpecJobIndicator";
import { SpecSummaryBlock } from "./SpecSummaryBlock";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { MarkdownViewer } from "./MarkdownViewer";
import { buildStory } from "../lib/buildStory";
import type { ObservedDecision, ObservedEvidence } from "../../../src/store/types";

export function DetailDrawer({
  item,
  onClose,
}: {
  item: SpecWithProject | null;
  onClose: () => void;
}) {
  // Hooks ANTES de qualquer return condicional (Regras dos Hooks): a gaveta é
  // sempre montada e renderiza null quando item é null; chamar useState após o
  // early-return mudaria a contagem de hooks entre renders e quebraria o React.
  const [viewer, setViewer] = useState<{ path: string; title: string } | null>(null);
  const closeViewer = useCallback(() => setViewer(null), []);

  if (!item) return null;

  const { spec, projectId, projectName, projectPath } = item;
  const openFile = (path: string, title: string) => setViewer({ path, title });
  const reason = attentionReason(spec);
  const t = spec.cost.tokens;
  const story = buildStory(spec);
  const obs = spec.observed;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`detalhe ${spec.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <span className="drawer-id">{spec.id}</span>
          {obs ? (
            <span className="obs-pill">OBSERVADO</span>
          ) : (
            <span className="drawer-proj">
              {projectName} · {spec.squad.toUpperCase()}
            </span>
          )}
          <StatusBadge spec={spec} />
          <SpecJobIndicator projectId={projectId} specId={spec.id} />
          <button
            type="button"
            className="drawer-close"
            aria-label="fechar"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <h2 className="drawer-title">{spec.title}</h2>

        <p className="drawer-story" data-testid="drawer-story">{story}</p>

        {reason && (
          <div className={`drawer-why why-${reason.kind}`}>{reason.label}</div>
        )}

        {columnForSpec(spec) === "attention" && (
          <AttentionPanel projectId={projectId} specId={spec.id} />
        )}

        {/* ── Observed-only sections ─────────────────────────────────── */}
        {obs && (
          <>
            <section className="obs-window">
              <span className="obs-window-label">aberto em</span>{" "}
              <span className="obs-window-date">{fmtDate(obs.createdAt)}</span>
              {obs.closedAt && (
                <>
                  {" · "}
                  <span className="obs-window-label">fechado em</span>{" "}
                  <span className="obs-window-date">{fmtDate(obs.closedAt)}</span>
                </>
              )}
            </section>

            {obs.driftFlags.length > 0 && (
              <p className="obs-drift">⚠ estado inconsistente no session.yml</p>
            )}

            <h3 className="drawer-section">Decisões</h3>
            {obs.decisions.length === 0 ? (
              <p className="drawer-empty">nenhuma decisão registrada</p>
            ) : (
              <ol className="obs-decisions">
                {obs.decisions.map((d: ObservedDecision, i: number) => (
                  <li key={i} className="obs-decision">
                    <p className="obs-decision-what">{d.what}</p>
                    {d.why && <p className="obs-decision-why">{d.why}</p>}
                    {d.rejected && (
                      <p className="obs-decision-rejected">rejeitado: {d.rejected}</p>
                    )}
                    {d.ref && (
                      <code className="obs-decision-ref">{d.ref}</code>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <h3 className="drawer-section">Evidências</h3>
            {obs.evidence.length === 0 ? (
              <p className="drawer-empty">nenhuma evidência registrada</p>
            ) : (
              <ol className="obs-evidence">
                {obs.evidence.map((e: ObservedEvidence, i: number) => (
                  <li key={i} className="obs-evidence-item">
                    {e.cmd && <code className="obs-evidence-cmd">{e.cmd}</code>}
                    {e.result && <p className="obs-evidence-result">{e.result}</p>}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        {/* ── SDD-only sections (hidden for observed) ────────────────── */}
        {!obs && (
          <>
            <SpecSummaryBlock
              projectId={projectId}
              specId={spec.id}
              specPath={spec.specPath ?? null}
            />

            <h4 className="drawer-section">Parecer de entrega</h4>
            <DeliveryReportBlock report={spec.deliveryReport} onOpenFile={openFile} />

            <h4 className="drawer-section">Fases</h4>
            <PhaseBar spec={spec} />

            <h4 className="drawer-section">Jornada de custo</h4>
            <PhaseJourney cost={spec.cost} />

            {spec.cost.reportPath && (
              <a
                className="drawer-cost-report"
                href={`/file?path=${encodeURIComponent(spec.cost.reportPath)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                report.html →
              </a>
            )}

            <h4 className="drawer-section">Tarefas</h4>
            <ul className="drawer-tasks">
              {spec.tasks.length === 0 && (
                <li className="drawer-tasks-empty">nenhuma tarefa ainda</li>
              )}
              {spec.tasks.map((task) => (
                <TaskItem key={task.id} task={task} projectId={projectId} specId={spec.id} />
              ))}
            </ul>
          </>
        )}

        {/* ── Cost section — present in BOTH modes ──────────────────── */}
        <h4 className="drawer-section">Custo</h4>
        <div className="drawer-cost">
          <span className="drawer-cost-usd">{fmtUsd(spec.cost.totalCostUsd)}</span>
          <span className="mono drawer-cost-tok">
            {fmtTokens(spec.cost.totalTokens)} tokens
          </span>
          {spec.cost.partial && <span className="cost-partial">$ parcial</span>}
          {spec.cost.source === "partial" && (
            <span className="cost-preliminary" title="soma crua dos costs/*.json — cost-report.json ainda não publicado">
              preliminar
            </span>
          )}
        </div>
        <dl className="drawer-cost-breakdown mono">
          <div>
            <dt>input</dt>
            <dd>{fmtTokens(t.input)}</dd>
          </div>
          <div>
            <dt>output</dt>
            <dd>{fmtTokens(t.output)}</dd>
          </div>
          <div>
            <dt>cache read</dt>
            <dd>{fmtTokens(t.cacheRead)}</dd>
          </div>
          <div>
            <dt>cache creation</dt>
            <dd>{fmtTokens(t.cacheCreation)}</dd>
          </div>
        </dl>

        {spec.cost.source === "report" && spec.cost.byPhase && (
          <dl className="drawer-cost-phases mono">
            <div>
              <dt>planning</dt>
              <dd>{fmtUsd(spec.cost.byPhase.planning)}</dd>
            </div>
            <div>
              <dt>orchestration</dt>
              <dd>{fmtUsd(spec.cost.byPhase.orchestration)}</dd>
            </div>
            <div>
              <dt>implementation</dt>
              <dd>{fmtUsd(spec.cost.byPhase.implementation)}</dd>
            </div>
          </dl>
        )}

        {/* ── SDD-only: Timeline placed AFTER cost (legacy order) ─────── */}
        {!obs && (
          <>
            <h4 className="drawer-section">Linha do tempo</h4>
            <Timeline spec={spec} projectPath={projectPath} onOpenFile={openFile} />
          </>
        )}

        {/* DeliveryReportBlock for observed sessions too (null-safe; chronicler is future work) */}
        {obs && (
          <>
            <h4 className="drawer-section">Parecer de entrega</h4>
            <DeliveryReportBlock report={spec.deliveryReport} onOpenFile={openFile} />

            {spec.cost.reportPath && (
              <a
                className="drawer-cost-report"
                href={`/file?path=${encodeURIComponent(spec.cost.reportPath)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                report.html →
              </a>
            )}
          </>
        )}

        <MarkdownViewer
          path={viewer?.path ?? null}
          title={viewer?.title ?? ""}
          onClose={closeViewer}
        />
      </aside>
    </div>
  );
}
