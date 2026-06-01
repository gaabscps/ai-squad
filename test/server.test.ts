import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { Store } from "../src/store/store.js";
import { createServer } from "../src/ui/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

function startedStore() {
  const store = new Store(() => ({ roots: [workspace] }));
  store.rebuild();
  return store;
}

/**
 * Coleta as mensagens do socket numa fila desde já e permite aguardar a próxima
 * sem perder nenhuma. Evita a janela de corrida do padrão "espera open, depois
 * escuta": uma mensagem pode chegar entre os dois passos e se perder.
 */
function messageReader(ws: WebSocket): () => Promise<string> {
  const queue: string[] = [];
  const waiters: Array<(m: string) => void> = [];
  ws.on("message", (d) => {
    const m = d.toString();
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return () =>
    new Promise<string>((resolve) => {
      const m = queue.shift();
      if (m !== undefined) resolve(m);
      else waiters.push(resolve);
    });
}

describe("createServer", () => {
  it("GET /api/projects retorna o snapshot atual", async () => {
    const server = createServer(startedStore(), () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/projects`);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(res.status).toBe(200);
    expect(body.map((p) => p.name).sort()).toEqual(["projeto-a", "projeto-b"]);

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("WS empurra o snapshot ao conectar", async () => {
    const server = createServer(startedStore(), () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const nextMessage = messageReader(ws); // listener registrado já, sem janela de corrida
    const msg = JSON.parse(await nextMessage());
    expect(msg.type).toBe("snapshot");
    expect(msg.projects).toHaveLength(2);

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("empurra um novo snapshot quando o Store muda", async () => {
    const store = startedStore();
    const server = createServer(store, () => {});
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const nextMessage = messageReader(ws);
    await nextMessage(); // drena o snapshot inicial
    const pending = nextMessage(); // aguarda a próxima (registra antes do rebuild)
    store.rebuild(); // dispara 'changed' → broadcast
    const msg = JSON.parse(await pending);
    expect(msg.type).toBe("snapshot");

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("encaminha comando hide ao callback com o id recebido", async () => {
    let resolveHide: (v: { id: string; hidden: boolean }) => void;
    const hidden = new Promise<{ id: string; hidden: boolean }>((res) => {
      resolveHide = res;
    });
    const server = createServer(startedStore(), (id, hidden) =>
      resolveHide({ id, hidden }),
    );
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    ws.send(JSON.stringify({ type: "hide", id: "projeto-x-abc123" }));

    const captured = await hidden;
    expect(captured).toEqual({ id: "projeto-x-abc123", hidden: true });

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
