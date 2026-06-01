import { useCallback, useEffect, useRef } from "react";
import { useProjectsDispatch } from "./projects";

/**
 * Conecta ao WS /ws (caminho relativo), despacha cada snapshot, marca connected,
 * e reconecta com backoff (1s,2s,4s… teto 10s) quando cai — ex.: você reinicia o
 * `npm run serve` e o board volta sozinho, sem F5. Devolve toggleHide pra o board
 * mandar hide/unhide pelo mesmo socket. Sem lib, coerente com o estado sem-lib.
 */
export function useLiveProjects(): {
  toggleHide: (id: string, hidden: boolean) => void;
} {
  const dispatch = useProjectsDispatch();
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const wsUrl = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      return `${proto}://${location.host}/ws`;
    };

    const connect = (): void => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        dispatchRef.current({ type: "connected", connected: true });
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "snapshot" && Array.isArray(msg.projects)) {
            dispatchRef.current({ type: "snapshot", projects: msg.projects });
          }
        } catch {
          /* frame inválido: ignora */
        }
      };
      ws.onclose = () => {
        dispatchRef.current({ type: "connected", connected: false });
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempt, 10000); // backoff com teto
        attempt++;
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true; // evita reconectar depois do unmount
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  const toggleHide = useCallback((id: string, hidden: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: hidden ? "hide" : "unhide", id }));
    }
  }, []);

  return { toggleHide };
}
