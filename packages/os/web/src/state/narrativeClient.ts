import type { SessionNarrative } from "../../../src/narrative/types";

export interface NarrativeServerMsg {
  type: "narrative:cached" | "narrative:generating" | "narrative:done" | "narrative:error";
  projectId: string;
  specId: string;
  narrative?: SessionNarrative;
  generatedAt?: string;
  costUsd?: number | null;
  modelId?: string | null;
  stale?: boolean;
  message?: string;
}
type Handler = (msg: NarrativeServerMsg) => void;
type SocketFactory = () => WebSocket;

export type ModelAlias = "haiku" | "sonnet" | "opus";

export interface NarrativeClient {
  subscribe: (key: string, fn: Handler) => () => void;
  fetch: (projectId: string, specId: string) => void;
  generate: (projectId: string, specId: string, force?: boolean, model?: ModelAlias) => void;
}

export function createNarrativeClient(makeSocket: SocketFactory): NarrativeClient {
  const subs = new Map<string, Set<Handler>>();
  let socket: WebSocket | null = null;
  let queue: string[] = [];

  const ensure = () => {
    if (socket) return;
    socket = makeSocket();
    socket.onopen = () => { for (const m of queue) socket!.send(m); queue = []; };
    socket.onmessage = (ev: MessageEvent) => {
      let msg: NarrativeServerMsg;
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
    fetch(projectId, specId) { sendOrQueue({ type: "narrative:fetch", projectId, specId }); },
    generate(projectId, specId, force = false, model?: ModelAlias) {
      sendOrQueue({ type: "narrative:generate", projectId, specId, force, ...(model ? { model } : {}) });
    },
  };
}

export const narrativeClient: NarrativeClient = createNarrativeClient(() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/ws`);
});
