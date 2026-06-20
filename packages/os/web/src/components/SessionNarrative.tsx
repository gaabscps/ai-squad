import { useObservedNarrative } from "../state/useObservedNarrative";
import type { NarrativeClient } from "../state/narrativeClient";
import { narrativeClient } from "../state/narrativeClient";
import type { ObservedMeta, ObservedEditFile } from "../../../src/store/types";
import type { NarrativeChange } from "../../../src/narrative/types";
import { DiffView } from "./DiffView";
import { MarkdownText } from "../lib/markdown";

/** Indexa os diffs reais (path → editFile) a partir dos markers de edição do Store. */
function patchIndex(observed: ObservedMeta): Map<string, ObservedEditFile> {
  const idx = new Map<string, ObservedEditFile>();
  for (const m of observed.markers) {
    if (m.kind === "edit" && m.editFiles) for (const f of m.editFiles) idx.set(f.path, f);
  }
  return idx;
}

function ChangeBlock({ change, idx, open }: { change: NarrativeChange; idx: Map<string, ObservedEditFile>; open: boolean }) {
  const file = change.primaryFile ? idx.get(change.primaryFile) : null;
  const body = (
    <>
      <MarkdownText source={change.prose} />
      {file?.patch && (
        <>
          {/* raw patch como texto acessível para testes e leitores de tela */}
          <code className="narr-patch-raw" aria-hidden="true" style={{ display: "none" }}>{file.patch}</code>
          <DiffView patch={file.patch} path={file.path} />
        </>
      )}
    </>
  );
  return (
    <details className="narr-change" open={open}>
      <summary className="narr-change-head">{change.title}</summary>
      <div className="narr-change-body">{body}</div>
    </details>
  );
}

export function SessionNarrative({
  projectId, specId, observed, client = narrativeClient,
}: { projectId: string; specId: string; observed: ObservedMeta; client?: NarrativeClient }) {
  const n = useObservedNarrative(projectId, specId, client);
  const idx = patchIndex(observed);

  if (n.state === "empty" || (n.state === "loading" && !n.narrative)) {
    return (
      <div className="narr-empty">
        <button type="button" className="narr-generate" disabled={n.state === "loading"} onClick={() => n.generate()}>
          {n.state === "loading" ? "gerando apresentação…" : "gerar apresentação da sessão"}
        </button>
      </div>
    );
  }
  if (n.state === "error") {
    return <p className="narr-error">{n.error} · <button type="button" className="narr-retry" onClick={() => n.regenerate()}>tentar de novo</button></p>;
  }
  const data = n.narrative;
  if (!data) return null;

  return (
    <div className="narr" data-testid="session-narrative">
      <div className="narr-meta">
        {n.state === "stale" && <span className="narr-stale">desatualizada</span>}
        {n.costUsd !== null && <span className="narr-cost">${n.costUsd.toFixed(2)}</span>}
        <button type="button" className="narr-regen" onClick={() => n.regenerate()}>regerar</button>
      </div>

      <p className="narr-tldr">{data.tldr}</p>
      {data.why && <div className="narr-why"><MarkdownText source={data.why} /></div>}

      {data.changes.length > 0 && (
        <>
          <h5 className="narr-section">O que mudou</h5>
          {data.changes.map((c, i) => <ChangeBlock key={i} change={c} idx={idx} open={i === 0} />)}
        </>
      )}

      {data.decisions.length > 0 && (
        <>
          <h5 className="narr-section">Decisões</h5>
          <ul className="narr-decisions">
            {data.decisions.map((d, i) => (
              <li key={i}><strong>{d.what}</strong>{d.why && <span className="narr-d-why"> — {d.why}</span>}{d.tradeoff && <span className="narr-d-trade"> · trade-off: {d.tradeoff}</span>}</li>
            ))}
          </ul>
        </>
      )}

      {data.verifications.length > 0 && (
        <>
          <h5 className="narr-section">Verificações</h5>
          <ul className="narr-verifs">
            {data.verifications.map((v, i) => (
              <li key={i} className={v.passed === true ? "ok" : v.passed === false ? "fail" : "unk"}><code>{v.cmd}</code></li>
            ))}
          </ul>
        </>
      )}

      {(data.prReview.groups.length > 0 || data.prReview.risk) && (
        <div className="narr-pr">
          <h5 className="narr-section">Ao revisar a PR, espere</h5>
          {data.prReview.groups.map((g, i) => (
            <div key={i} className="narr-pr-group">
              <span className="narr-pr-label">{g.label}{g.lookFirst && <span className="narr-pr-first"> — olhe primeiro</span>}</span>
              <span className="narr-pr-files mono">{g.files.join(" · ")}</span>
            </div>
          ))}
          {data.prReview.risk && <p className="narr-pr-risk">⚠ {data.prReview.risk}</p>}
        </div>
      )}
    </div>
  );
}
