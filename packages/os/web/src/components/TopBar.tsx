/**
 * Barra superior: marca + pílula de conexão + busca + toggle Kanban|Tabela|Arquivadas
 * + botão Pastas. Sem estado próprio; recebe tudo via props/callbacks.
 */
export type ViewMode = "overview" | "kanban" | "table" | "archived";

export function TopBar({
  connected,
  query,
  onQuery,
  view,
  onView,
  onOpenFolderManager,
}: {
  connected: boolean;
  query: string;
  onQuery: (q: string) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  onOpenFolderManager?: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        ai-squad-os
      </div>
      <span className={`conn conn-${connected ? "up" : "down"}`}>
        {connected ? "ao vivo" : "reconectando…"}
      </span>
      <input
        className="search"
        type="search"
        placeholder="buscar spec, projeto…"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <button
        type="button"
        className="topbar-folders-btn"
        onClick={() => onOpenFolderManager?.()}
      >
        Pastas
      </button>
      <div className="seg" role="group" aria-label="visão">
        <button
          type="button"
          className={view === "overview" ? "on" : ""}
          onClick={() => onView("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={view === "kanban" ? "on" : ""}
          onClick={() => onView("kanban")}
        >
          Kanban
        </button>
        <button
          type="button"
          className={view === "table" ? "on" : ""}
          onClick={() => onView("table")}
        >
          Tabela
        </button>
        <button
          type="button"
          className={view === "archived" ? "on" : ""}
          onClick={() => onView("archived")}
        >
          Arquivadas
        </button>
      </div>
    </header>
  );
}
