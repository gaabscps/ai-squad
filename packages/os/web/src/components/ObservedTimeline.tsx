import { useState } from "react";
import type { ObservedMarker, ObservedEditFile, ObservedDecision } from "../../../src/store/types";
import { DiffView } from "./DiffView";

const LABELS: Record<"pt" | "en", Record<string, string>> = {
  pt: {
    open: "Aberto",
    close: "Fechado",
    block: "Bloqueou",
    edit: "Editou",
    decision: "Decidiu",
    verify: "Verificou",
    run: "Executou",
    waiting: "aguardando",
    loose: "hora aproximada (ordem de registro)",
    empty: "sem marcos registrados",
  },
  en: {
    open: "Opened",
    close: "Closed",
    block: "Blocked",
    edit: "Edited",
    decision: "Decided",
    verify: "Verified",
    run: "Ran",
    waiting: "waiting",
    loose: "approximate time (recording order)",
    empty: "no markers recorded",
  },
};

// Vocabulário de PRODUTO: a timeline espelha a linguagem do ProductSummary
// (Aberta / Decisão / Pergunta / Fechada), não os verbos de execução do dev.
const LABELS_PRODUCT: Record<"pt" | "en", Record<string, string>> = {
  pt: {
    open: "Aberta",
    close: "Fechada",
    block: "Pergunta levantada",
    decision: "Decisão",
    why: "por quê?",
    waiting: "aguardando",
    loose: "hora aproximada (ordem de registro)",
    empty: "sem marcos registrados",
  },
  en: {
    open: "Opened",
    close: "Closed",
    block: "Question raised",
    decision: "Decision",
    why: "why?",
    waiting: "waiting",
    loose: "approximate time (recording order)",
    empty: "no markers recorded",
  },
};

// Na vista de produto, só os 4 marcos do MVP entram na timeline; run/edit/verify
// são jargão de execução e ficam de fora (o "Entregável" é Fase 2).
const PRODUCT_KINDS = new Set(["open", "decision", "block", "close"]);

function pickLabels(locale: string | null, product = false): Record<string, string> {
  const set = product ? LABELS_PRODUCT : LABELS;
  return locale && locale.toLowerCase().startsWith("pt") ? set.pt : set.en;
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function fmtClock(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EditFiles({ files }: { files: ObservedEditFile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="tl-files">
      {files.map((f) => (
        <li key={f.path} className="tl-file">
          <button
            type="button"
            className="tl-file-row"
            onClick={() => setOpen(open === f.path ? null : f.path)}
          >
            <span className="tl-file-path">{f.path}</span>
            <span className="tl-file-stat mono">
              {f.added !== null && <span className="add">+{f.added}</span>}{" "}
              {f.removed !== null && <span className="del">−{f.removed}</span>}
            </span>
          </button>
          {open === f.path && f.patch && <DiffView patch={f.patch} path={f.path} />}
        </li>
      ))}
    </ul>
  );
}

// Corpo da decisão na vista de produto: o `what` aparece sempre; o critério
// (`why`) e a alternativa descartada (`rejected`) ficam atrás de "por quê?",
// para a timeline ficar limpa e a pessoa aprofundar sob demanda.
function ProductDecisionBody({
  decision,
  whyLabel,
  onOpenRef,
}: {
  decision: ObservedDecision;
  whyLabel: string;
  onOpenRef?: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(decision.why || decision.rejected);
  return (
    <>
      <span className="tl-what">{decision.what}</span>
      {hasDetail && (
        <button
          type="button"
          className="tl-why-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {whyLabel}
        </button>
      )}
      {open && decision.rejected && (
        <span className="tl-rej">✕ {decision.rejected}</span>
      )}
      {open && decision.why && <span className="tl-why">{decision.why}</span>}
      {decision.ref && (
        <button
          type="button"
          className="tl-ref mono"
          onClick={() => onOpenRef?.(decision.ref!)}
        >
          {decision.ref}
        </button>
      )}
    </>
  );
}

export function ObservedTimeline({
  markers,
  outputLocale,
  onOpenRef,
  workType,
}: {
  markers: ObservedMarker[];
  outputLocale: string | null;
  onOpenRef?: (ref: string) => void;
  workType?: string | null;
}) {
  const isProduct = workType === "product";
  const L = pickLabels(outputLocale, isProduct);
  // Vista de produto: só os 4 marcos do MVP; run/edit/verify ficam de fora.
  const shown = isProduct ? markers.filter((m) => PRODUCT_KINDS.has(m.kind)) : markers;
  if (shown.length === 0) return <p className="drawer-empty">{L.empty}</p>;
  return (
    <ol className="obs-timeline" data-testid="obs-timeline">
      {shown.map((m, i) => (
        <li key={i} className={`tl-item tl-${m.kind}`}>
          <span className="tl-dot" aria-hidden="true" />
          <div className="tl-body">
            <span className="tl-label">
              {L[m.kind] ?? m.kind}
              {m.kind === "block" && (
                <span className="tl-dur">
                  {" "}
                  {m.blockMs !== null ? fmtDuration(m.blockMs) : L.waiting}
                </span>
              )}
              {!m.exact && (
                <span className="tl-loose" title={L.loose}>
                  {" "}
                  ·
                </span>
              )}
              {fmtClock(m.at) && <span className="tl-time mono"> · {fmtClock(m.at)}</span>}
            </span>
            {m.decision &&
              (isProduct ? (
                <ProductDecisionBody
                  decision={m.decision}
                  whyLabel={L.why}
                  onOpenRef={onOpenRef}
                />
              ) : (
                <>
                  <span className="tl-what">{m.decision.what}</span>
                  {m.decision.rejected && (
                    <span className="tl-rej">✕ {m.decision.rejected}</span>
                  )}
                  {m.decision.why && (
                    <span className="tl-why">{m.decision.why}</span>
                  )}
                  {m.decision.ref && (
                    <button
                      type="button"
                      className="tl-ref mono"
                      onClick={() => onOpenRef?.(m.decision!.ref!)}
                    >
                      {m.decision.ref}
                    </button>
                  )}
                </>
              ))}
            {m.evidence && (
              <span className="tl-verify">
                {m.evidence.cmd && <code>{m.evidence.cmd}</code>}
                {m.evidence.result && (
                  <span className="tl-result">→ {m.evidence.result}</span>
                )}
              </span>
            )}
            {m.editFiles && m.editFiles.length > 0 && (
              <EditFiles files={m.editFiles} />
            )}
            {m.kind === "run" && m.note && (
              <code className="tl-cmd mono">{m.note}</code>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
