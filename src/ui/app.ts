import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Store } from "../store/store.js";

/**
 * Monta o servidor HTTP + WebSocket sobre um Store pronto.
 * - GET /api/projects: snapshot atual (primeiro load).
 * - WS em /ws: empurra { type: "snapshot", projects } ao conectar e a cada
 *   'changed' do Store; recebe { type: "hide"|"unhide", id } e delega a
 *   onToggleHide (o entrypoint persiste e manda rebuild).
 * Devolve o http.Server SEM dar listen — quem chama escolhe a porta.
 */
export function createServer(
  store: Store,
  onToggleHide: (id: string, hidden: boolean) => void,
): Server {
  const app = express();
  app.get("/api/projects", (_req, res) => {
    res.json(store.getSnapshot());
  });
  app.get("/", (_req, res) => {
    res.type("text").send("ai-squad-os server up");
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const snapshotMessage = () =>
    JSON.stringify({ type: "snapshot", projects: store.getSnapshot() });

  wss.on("connection", (socket) => {
    // Envia no próximo tick (não no mesmo tick do 'connection'): garante que o
    // socket terminou de inicializar e que o consumidor já registrou seu listener
    // antes do primeiro frame chegar. Entrega mais previsível; custo ~0 (app local).
    setTimeout(() => socket.send(snapshotMessage()), 0);
    socket.on("message", (raw) => {
      let msg: { type?: string; id?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // mensagem inválida: ignora
      }
      if (typeof msg.id !== "string") return;
      if (msg.type === "hide") onToggleHide(msg.id, true);
      else if (msg.type === "unhide") onToggleHide(msg.id, false);
    });
  });

  // o Store é a fonte; quando ele muda, todo cliente conectado recebe o novo snapshot.
  const onChanged = (): void => {
    const data = snapshotMessage();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };
  store.on("changed", onChanged);
  // remove o listener ao fechar — createServer pode ser chamado de novo sobre o mesmo Store
  server.on("close", () => store.removeListener("changed", onChanged));

  return server;
}
