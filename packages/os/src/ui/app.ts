import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import { existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import type { Store } from "../store/store.js";
import { makeSummaryHandler } from "../summary/handler.js";
import { makeSpecSummaryHandler } from "../spec-summary/handler.js";
import { makeDiagnosisHandler } from "../attention/handler.js";
import { makeNarrativeHandler } from "../narrative/handler.js";
import { makeProductHandler } from "../product/handler.js";
import { listDirs } from "../collector/browse.js";

// pasta do build do Vite (npm run build → dist/web); em dev pode não existir.
const FRONT_DIR = join(process.cwd(), "dist", "web");

/** target está DENTRO de root (ou é a própria root)? Sem string-prefix frágil. */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Ação de correção manual da camada de feature (o C do design); validada na forma aqui,
// aplicada no server.ts (overlay + rebuild).
export type FeatureAction =
  | { type: "feature:assign"; projectId: string; sessionId: string; featureId: string | null }
  | { type: "feature:markDone"; projectId: string; featureId: string; done: boolean }
  | { type: "feature:rename"; projectId: string; featureId: string; name: string };

/** Devolve o http.Server SEM dar listen — separa criação de binding de porta. */
export function createServer(
  store: Store,
  onToggleHide: (id: string, hidden: boolean) => void,
  archiveAfterDays: number = 7,
  getInclude: () => string[] = () => [],
  addInclude: (path: string) => Promise<{ persisted: boolean; alreadyExisted: boolean }> = () =>
    Promise.resolve({ persisted: false, alreadyExisted: false }),
  removeInclude: (path: string) => Promise<{ persisted: boolean }> = () =>
    Promise.resolve({ persisted: false }),
  onFeatureAction: (msg: FeatureAction) => void = () => {},
): Server {
  const app = express();
  app.use(express.json());

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

  app.get("/api/browse", async (req, res) => {
    const rawPath = req.query.path;
    if (typeof rawPath !== "string") {
      res.status(400).json({ error: "parâmetro path obrigatório" });
      return;
    }
    const resolvedPath = rawPath.trim() === "" ? homedir() : rawPath.trim();
    try {
      const dirs = await listDirs(resolvedPath, homedir());
      res.json({ dirs, resolvedPath });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "OUTSIDE_HOME") return res.status(403).json({ error: "path fora do home do usuário" });
      return res.status(400).json({ error: code === "NOT_A_DIR" ? "path não existe ou não é diretório" : "erro ao listar diretório" });
    }
  });

  app.post("/api/include", async (req, res) => {
    const { path } = req.body as { path?: unknown };
    if (typeof path !== "string" || path.trim() === "") {
      res.status(400).json({ error: "campo path obrigatório" });
      return;
    }
    try {
      const result = await addInclude(path);
      res.status(result.alreadyExisted ? 200 : 201).json({ persisted: result.persisted });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "OUTSIDE_HOME") {
        res.status(403).json({ error: "path fora do home do usuário" });
        return;
      }
      res.status(400).json({ error: code === "NO_AGENT_SESSION" ? "diretório não contém .agent-session/" : "path inválido ou inexistente" });
    }
  });

  app.delete("/api/include", async (req, res) => {
    const { path } = req.body as { path?: unknown };
    if (typeof path !== "string" || path.trim() === "") {
      res.status(400).json({ error: "campo path obrigatório" });
      return;
    }
    const result = await removeInclude(path);
    res.status(200).json({ persisted: result.persisted });
  });

  app.use(express.static(FRONT_DIR));
  app.get("*", (_req, res, _next) => {
    const index = join(FRONT_DIR, "index.html");
    if (existsSync(index)) res.sendFile(index);
    else res.type("text").send("ai-squad-os server up (front não buildado — rode npm run build, ou use o Vite em dev)");
  });

  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  // archiveAfterDays é lido uma vez na inicialização — mudar no aios.config.json exige reiniciar
  // o servidor (igual às roots; ao contrário do hide, que é relido a cada rebuild).
  const snapshotMessage = () =>
    JSON.stringify({ type: "snapshot", projects: store.getSnapshot(), archiveAfterDays, include: getInclude() });

  wss.on("connection", (socket) => {
    // Envia no próximo tick (não no mesmo tick do 'connection'): garante que o
    // socket terminou de inicializar e que o consumidor já registrou seu listener
    // antes do primeiro frame chegar. Entrega mais previsível; custo ~0 (app local).
    setTimeout(() => socket.send(snapshotMessage()), 0);
    const onSummary = makeSummaryHandler(store);
    const onSpecSummary = makeSpecSummaryHandler(store);
    const onDiagnosis = makeDiagnosisHandler(store);
    const onNarrative = makeNarrativeHandler(store);
    const onProduct = makeProductHandler(store);
    socket.on("message", (raw) => {
      let msg: {
        type?: string;
        id?: string;
        specId?: string;
        taskId?: string;
        force?: boolean;
        projectId?: string;
        featureId?: string | null;
        sessionId?: string;
        done?: boolean;
        name?: string;
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // mensagem inválida: ignora
      }
      if (msg.type === "summary:fetch" || msg.type === "summary:generate") {
        onSummary(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
      if (msg.type === "spec-summary:fetch" || msg.type === "spec-summary:generate") {
        try {
          onSpecSummary(msg as never, (data) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data);
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[spec-summary] erro síncrono inesperado:", err);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "spec-summary:error", message }));
          }
        }
        return;
      }
      if (msg.type === "attention:fetch" || msg.type === "attention:generate") {
        onDiagnosis(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
      if (msg.type === "narrative:fetch" || msg.type === "narrative:generate") {
        onNarrative(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
      if (msg.type === "product:fetch" || msg.type === "product:generate") {
        onProduct(msg as never, (data) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        });
        return;
      }
      if (msg.type === "feature:assign" || msg.type === "feature:markDone" || msg.type === "feature:rename") {
        const m = msg as Record<string, unknown>;
        const okAssign = msg.type === "feature:assign" && typeof m.projectId === "string" &&
          typeof m.sessionId === "string" && (typeof m.featureId === "string" || m.featureId === null);
        const okDone = msg.type === "feature:markDone" && typeof m.projectId === "string" &&
          typeof m.featureId === "string" && typeof m.done === "boolean";
        const okRename = msg.type === "feature:rename" && typeof m.projectId === "string" &&
          typeof m.featureId === "string" && typeof m.name === "string" && m.name !== "";
        if (okAssign || okDone || okRename) onFeatureAction(msg as FeatureAction);
        return;
      }
      if (typeof msg.id !== "string") return;
      if (msg.type === "hide") onToggleHide(msg.id, true);
      else if (msg.type === "unhide") onToggleHide(msg.id, false);
    });
  });

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
