import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store/store.js";
import { createServer } from "../src/ui/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

function startedStore() {
  const store = new Store(() => ({ roots: [workspace] }));
  store.rebuild();
  return store;
}

async function listen(server: import("node:http").Server) {
  await new Promise<void>((r) => server.listen(0, r));
  return (server.address() as AddressInfo).port;
}

describe("GET /file", () => {
  it("serve um arquivo dentro de um projeto conhecido (200)", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const abs = join(workspace, "projeto-a/.agent-session/FEAT-099/report.html");

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(abs)}`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("report fake do FEAT-099");

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejeita path fora das pastas conhecidas (403)", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const fora = join(here, "..", "package.json"); // existe, mas fora do workspace

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(fora)}`);
    expect(res.status).toBe(403);

    await new Promise<void>((r) => server.close(() => r()));
  });

  it("404 quando o arquivo não existe dentro da pasta conhecida", async () => {
    const server = createServer(startedStore(), () => {});
    const port = await listen(server);
    const inexistente = join(workspace, "projeto-a/.agent-session/FEAT-099/nao-existe.md");

    const res = await fetch(`http://127.0.0.1:${port}/file?path=${encodeURIComponent(inexistente)}`);
    expect(res.status).toBe(404);

    await new Promise<void>((r) => server.close(() => r()));
  });
});
