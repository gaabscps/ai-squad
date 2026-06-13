import { useState } from "react";
import type { ObservedMarker, ObservedEditFile } from "../../../src/store/types";

const LABELS: Record<"pt" | "en", Record<string, string>> = {
  pt: {
    open: "Aberto",
    close: "Fechado",
    block: "Bloqueou",
    edit: "Editou",
    decision: "Decidiu",
    verify: "Verificou",
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
    waiting: "waiting",
    loose: "approximate time (recording order)",
    empty: "no markers recorded",
  },
};

function pickLabels(locale: string | null): Record<string, string> {
  return locale && locale.toLowerCase().startsWith("pt") ? LABELS.pt : LABELS.en;
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
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
          {open === f.path && f.patch && (
            <pre className="tl-patch mono">{f.patch}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ObservedTimeline({
  markers,
  outputLocale,
}: {
  markers: ObservedMarker[];
  outputLocale: string | null;
}) {
  const L = pickLabels(outputLocale);
  if (markers.length === 0) return <p className="drawer-empty">{L.empty}</p>;
  return (
    <ol className="obs-timeline" data-testid="obs-timeline">
      {markers.map((m, i) => (
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
            </span>
            {m.decision && (
              <>
                <span className="tl-what">{m.decision.what}</span>
                {m.decision.rejected && (
                  <span className="tl-rej">✕ {m.decision.rejected}</span>
                )}
                {m.decision.why && (
                  <span className="tl-why">{m.decision.why}</span>
                )}
              </>
            )}
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
          </div>
        </li>
      ))}
    </ol>
  );
}
