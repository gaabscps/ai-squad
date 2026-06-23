import { useState, useEffect } from "react";

// Painel "copiar pro Jira": expõe o título sugerido (Summary) e a descrição
// Markdown (Description), cada um com um botão que escreve no clipboard.
export function CopyJiraPanel({ summaryLine, body }: { summaryLine: string; body: string }) {
  const [copied, setCopied] = useState<"none" | "summary" | "body">("none");

  // Volta o rótulo "copiado" ao normal após 2s; limpa o timer ao desmontar/mudar.
  useEffect(() => {
    if (copied === "none") return;
    const t = setTimeout(() => setCopied("none"), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // Escreve no clipboard e só marca "copiado" se a escrita teve sucesso.
  const copy = (text: string, which: "summary" | "body") => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(which),
      () => {},
    );
  };

  return (
    <section className="jira-panel" data-testid="jira-panel">
      <h4 className="drawer-section">Copiar pro Jira</h4>

      <div className="jira-field">
        <span className="jira-label">Resumo (título do issue)</span>
        <p className="jira-summary">{summaryLine}</p>
        <button type="button" className="jira-copy" onClick={() => copy(summaryLine, "summary")}>
          {copied === "summary" ? "copiado ✓" : "copiar resumo"}
        </button>
      </div>

      <div className="jira-field">
        <span className="jira-label">Descrição (cole no corpo do issue)</span>
        <pre className="jira-body">{body}</pre>
        <button type="button" className="jira-copy" onClick={() => copy(body, "body")}>
          {copied === "body" ? "copiado ✓" : "copiar descrição"}
        </button>
      </div>
    </section>
  );
}
