import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { Store } from "../store/store.js";

// pasta do build do Vite (npm run build → dist/web); em dev pode não existir.
const FRONT_DIR = join(process.cwd(), "dist", "web");

/** target está DENTRO de root (ou é a própria root)? Sem string-prefix frágil. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Monta o servidor HTTP + WebSocket sobre um Store pronto.
 * - GET /api/projects: snapshot atual (contrato HTTP; primeiro load via curl/debug).
 * - GET /file?path=<abs>: serve report.html/.md READ-ONLY, só se o path estiver
 *   dentro de um project.path conhecido (anti path-traversal). Cumpre o §6.
 * - WS em /ws: empurra { type: "snapshot", projects } ao conectar e a cada
 *   'changed' do Store; recebe { type: "hide"|"unhide", id } e delega a onToggleHide.
 * - resto: serve o build do Vite (dist/web) com fallback de SPA pro index.html.
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

  app.get("/file", (req, res) => {
    const requested = req.query.path;
    if (typeof requested !== "string") {
      res.status(400).send("path obrigatório");
      return;
    }
    const target = resolve(requested);
    // só serve arquivos dentro de um projeto que o board conhece
    const known = store.getSnapshot().map((p) => p.path);
    if (!known.some((root) => isInside(root, target))) {
      res.status(403).send("fora das pastas conhecidas");
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.status(404).send("arquivo não encontrado");
      return;
    }
    if (target.endsWith(".md")) res.type("text/plain"); // .md como texto, não download
    res.sendFile(target);
  });

  // build do Vite (estático) + fallback de SPA. Em dev (sem build) cai no else.
  app.use(express.static(FRONT_DIR));
  app.get("*", (_req, res, next) => {
    const index = join(FRONT_DIR, "index.html");
    if (existsSync(index)) res.sendFile(index);
    else res.type("text").send("ai-squad-os server up (front não buildado — rode npm run build, ou use o Vite em dev)");
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
