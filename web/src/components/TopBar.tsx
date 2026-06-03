/**
 * Barra superior: marca + pílula de conexão (ao vivo / reconectando, vindo do WS)
 * + busca (controlada pelo Board) + toggle Kanban|Tabela. Não tem estado próprio;
 * tudo sobe via callbacks pro Board, que é o dono do estado de UI.
 */
export type ViewMode = "kanban" | "table" | "archived";

export function TopBar({
  connected,
  query,
  onQuery,
  view,
  onView,
}: {
  connected: boolean;
  query: string;
  onQuery: (q: string) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
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
      <div className="seg" role="group" aria-label="visão">
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
