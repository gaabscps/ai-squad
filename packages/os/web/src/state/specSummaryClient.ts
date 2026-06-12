import type { ModelAlias } from "../lib/modelLabel";

export interface SpecSummaryServerMsg {
  type:
    | "spec-summary:cached"
    | "spec-summary:chunk"
    | "spec-summary:done"
    | "spec-summary:error";
  projectId: string;
  specId: string;
  text?: string;
  delta?: string;
  generatedAt?: string;
  costUsd?: number | null;
  modelId?: string | null;
  stale?: boolean;
  message?: string;
}

type Handler = (msg: SpecSummaryServerMsg) => void;
type SocketFactory = () => WebSocket;

export interface SpecSummaryClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string) => void;
  generate: (projectId: string, specId: string, model: ModelAlias) => void;
}

export function createSpecSummaryClient(makeSocket: SocketFactory): SpecSummaryClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: SpecSummaryServerMsg;
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
    fetch(projectId, specId) {
      sendOrQueue({ type: "spec-summary:fetch", projectId, specId });
    },
    generate(projectId, specId, model) {
      sendOrQueue({ type: "spec-summary:generate", projectId, specId, model });
    },
  };
}

export const specSummaryClient: SpecSummaryClient = createSpecSummaryClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
