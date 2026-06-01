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
    const raw = await new Promise<string>((res) =>
      ws.on("message", (d) => res(d.toString())),
    );
    const msg = JSON.parse(raw);
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
    await new Promise<void>((res) => ws.on("open", () => res()));
    await new Promise<void>((res) => ws.once("message", () => res())); // drena o snapshot inicial

    const next = new Promise<string>((res) => ws.once("message", (d) => res(d.toString())));
    store.rebuild(); // dispara 'changed' → broadcast
    const msg = JSON.parse(await next);
    expect(msg.type).toBe("snapshot");

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("encaminha comando hide ao callback com o id recebido", async () => {
    let captured: { id: string; hidden: boolean } | null = null;
    const server = createServer(startedStore(), (id, hidden) => {
      captured = { id, hidden };
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((res) => ws.on("open", () => res()));
    ws.send(JSON.stringify({ type: "hide", id: "projeto-x-abc123" }));

    await new Promise<void>((res) => setTimeout(res, 50)); // deixa a msg chegar
    expect(captured).toEqual({ id: "projeto-x-abc123", hidden: true });

    ws.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
