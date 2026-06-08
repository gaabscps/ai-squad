import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";

// Modal read-only que busca um .md via /file (texto cru) e renderiza com <Markdown>.
// Não muda nada no backend: /file já serve .md como text/plain.
export function MarkdownViewer({
  path,
  title,
  onClose,
}: {
  path: string | null;
  title: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (path == null) {
      setText(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setText(null);
    fetch(`/file?path=${encodeURIComponent(path)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        setText(t);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [path]);

  useEffect(() => {
    if (path == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose]);

  if (path == null) return null;

  return (
    <div className="md-viewer-overlay" onClick={onClose}>
      <div className="md-viewer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="md-viewer-head">
          <span className="md-viewer-title mono">{title}</span>
          <button type="button" className="md-viewer-close" aria-label="fechar" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="md-viewer-body">
          {loading && <p className="md-viewer-hint">carregando…</p>}
          {error && <p className="md-viewer-hint">erro ao carregar: {error}</p>}
          {text != null && <Markdown>{text}</Markdown>}
        </div>
      </div>
    </div>
  );
}
