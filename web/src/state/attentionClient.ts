export interface AttentionServerMsg {
  type: "attention:handoff" | "attention:cached" | "attention:chunk" | "attention:done" | "attention:error";
  projectId: string;
  specId: string;
  text?: string;
  delta?: string;
  generatedAt?: string;
  costUsd?: number | null;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: AttentionServerMsg) => void;
type SocketFactory = () => WebSocket;

export interface AttentionClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string) => void;
  generate: (projectId: string, specId: string) => void;
}

/**
 * Cliente WS de diagnóstico. Conecta sob demanda, mantém fila até o socket abrir,
 * e roteia cada mensagem ao subscriber da chave `projectId|specId`. Fábrica de
 * socket injetável pra teste.
 */
export function createAttentionClient(makeSocket: SocketFactory): AttentionClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: AttentionServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (typeof msg?.projectId !== "string" || typeof msg?.specId !== "string") return;
      const fns = subs.get(`${msg.projectId}|${msg.specId}`);
      if (fns) for (const fn of fns) fn(msg);
    };
    socket.onclose = () => { socket = null; };
  };

  const sendOrQueue = (payload: object) => {
    ensure();
    const data = JSON.stringify(payload);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
    else queue.push(data);
  };

  return {
    subscribe(key, fn) {
      ensure();
      const set = subs.get(key) ?? new Set<Handler>();
      set.add(fn);
      subs.set(key, set);
      return () => { set.delete(fn); if (set.size === 0) subs.delete(key); };
    },
    fetch(projectId, specId) { sendOrQueue({ type: "attention:fetch", projectId, specId }); },
    generate(projectId, specId) { sendOrQueue({ type: "attention:generate", projectId, specId }); },
  };
}

/** Singleton padrão da app: socket real em /ws (mesmo endpoint do snapshot). */
export const attentionClient: AttentionClient = createAttentionClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
