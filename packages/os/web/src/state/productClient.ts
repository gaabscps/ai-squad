import type { ProductSummary } from "../../../src/product/types";

// Espelha narrativeClient.ts para o caminho de produto (mensagens product:*).
// Socket próprio /ws, igual ao da narrativa — isolado do caminho dev.

export interface ProductServerMsg {
  type: "product:cached" | "product:generating" | "product:done" | "product:error";
  projectId: string;
  specId: string;
  summary?: ProductSummary;
  generatedAt?: string;
  costUsd?: number | null;
  modelId?: string | null;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: ProductServerMsg) => void;
type SocketFactory = () => WebSocket;

export type ModelAlias = "haiku" | "sonnet" | "opus";

export interface ProductClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string) => void;
  generate: (projectId: string, specId: string, force?: boolean, model?: ModelAlias) => void;
}

export function createProductClient(makeSocket: SocketFactory): ProductClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: ProductServerMsg;
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
      set.add(fn); subs.set(key, set);
      return () => { set.delete(fn); if (set.size === 0) subs.delete(key); };
    },
    fetch(projectId, specId) { sendOrQueue({ type: "product:fetch", projectId, specId }); },
    generate(projectId, specId, force = false, model?: ModelAlias) {
      sendOrQueue({ type: "product:generate", projectId, specId, force, ...(model ? { model } : {}) });
    },
  };
}

export const productClient: ProductClient = createProductClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
