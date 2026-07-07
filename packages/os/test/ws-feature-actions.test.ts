import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { createServer } from "../src/ui/app.js";
import type { Store } from "../src/store/store.js";

function fakeStore(): Store {
  const em = new EventEmitter() as unknown as Store;
  (em as unknown as { getSnapshot: () => unknown[] }).getSnapshot = () => [];
  return em;
}

function connect(port: number): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => res(ws));
    ws.on("error", rej);
  });
}

describe("WS feature:*", () => {
  it("roteia assign/markDone/rename pro callback", async () => {
    const received: unknown[] = [];
    const server = createServer(
      fakeStore(), () => {}, 7, () => [],
      () => Promise.resolve({ persisted: false, alreadyExisted: false }),
      () => Promise.resolve({ persisted: false }),
      (msg) => { received.push(msg); },
    );
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const ws = await connect(port);

    ws.send(JSON.stringify({ type: "feature:assign", projectId: "P", sessionId: "OBS-001", featureId: "PAY-1" }));
    ws.send(JSON.stringify({ type: "feature:markDone", projectId: "P", featureId: "PAY-1", done: true }));
    ws.send(JSON.stringify({ type: "feature:rename", projectId: "P", featureId: "PAY-1", name: "Novo" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toHaveLength(3);
    expect((received[0] as { type: string }).type).toBe("feature:assign");
    ws.close();
    await new Promise((r) => server.close(r));
  });

  it("mensagem malformada é ignorada sem derrubar", async () => {
    const received: unknown[] = [];
    const server = createServer(
      fakeStore(), () => {}, 7, () => [],
      () => Promise.resolve({ persisted: false, alreadyExisted: false }),
      () => Promise.resolve({ persisted: false }),
      (msg) => { received.push(msg); },
    );
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const ws = await connect(port);
    ws.send(JSON.stringify({ type: "feature:assign" })); // sem projectId/sessionId
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);
    ws.close();
    await new Promise((r) => server.close(r));
  });
});
