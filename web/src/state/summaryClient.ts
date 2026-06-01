export interface SummaryServerMsg {
  type: "summary:cached" | "summary:chunk" | "summary:done" | "summary:error";
  projectId: string;
  specId: string;
  taskId: string;
  text?: string;
  delta?: string;
  generatedAt?: string;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: SummaryServerMsg) => void;
type SocketFactory = () => WebSocket;

export interface SummaryClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string, taskId: string) => void;
  generate: (projectId: string, specId: string, taskId: string, force?: boolean) => void;
}

/**
 * Cliente WS de summary. Conecta sob demanda na primeira ação, mantém uma fila de
 * envios até o socket abrir, e roteia cada mensagem do servidor ao subscriber da
 * chave `projectId|specId|taskId` (specId/taskId não são únicos entre projetos).
 * A fábrica de socket é injetável pra teste.
 */
export function createSummaryClient(makeSocket: SocketFactory): SummaryClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: SummaryServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (typeof msg?.projectId !== "string" || typeof msg?.specId !== "string" || typeof msg?.taskId !== "string") return;
      const fns = subs.get(`${msg.projectId}|${msg.specId}|${msg.taskId}`);
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
    fetch(projectId, specId, taskId) { sendOrQueue({ type: "summary:fetch", projectId, specId, taskId }); },
    generate(projectId, specId, taskId, force = false) { sendOrQueue({ type: "summary:generate", projectId, specId, taskId, force }); },
  };
}

/** Singleton padrão da app: socket real em /ws (mesmo endpoint do snapshot). */
export const summaryClient: SummaryClient = createSummaryClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
