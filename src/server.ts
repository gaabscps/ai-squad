import { join } from "node:path";
import { loadConfig, saveHidden, type AiosConfig } from "./config.js";
import { Store } from "./store/store.js";
import { watchProjects } from "./collector/watcher.js";
import { createServer } from "./ui/app.js";

const configPath = join(process.cwd(), "aios.config.json");
const config: AiosConfig = loadConfig(configPath);
const port = Number(process.env.AIOS_PORT ?? 4317);

// O Store lê `config` por função → cada rebuild pega o hide atual.
const store = new Store(() => config);
store.rebuild();

/** Traduz o id (chave do cliente) pro path do projeto, persiste e reprocessa. */
const toggleHide = (id: string, hidden: boolean): void => {
  const proj = store.getSnapshot().find((p) => p.id === id);
  if (!proj) return; // id desconhecido: ignora
  const next = new Set(config.hide);
  if (hidden) next.add(proj.path);
  else next.delete(proj.path);
  config.hide = [...next];
  try {
    saveHidden(configPath, config.hide); // única escrita, no repo do aiOS
  } catch (err) {
    // falha de escrita (permissão/disco) não pode derrubar o servidor no meio
    // de um handler WS — loga e segue; o estado em memória já reflete o toggle.
    console.error(`aviso: não consegui persistir o hide em ${configPath}:`, err);
  }
  store.rebuild(); // relê com o novo hide → emite changed → broadcast
};

const server = createServer(store, toggleHide);
const watcher = watchProjects(config.roots, () => store.rebuild());

server.listen(port, () => {
  console.log(`ai-squad-os ouvindo em http://127.0.0.1:${port}  (config: ${configPath})`);
  console.log(`roots: ${config.roots.join(", ") || "(nenhuma — edite aios.config.json)"}`);
});

const shutdown = (): void => {
  void watcher.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
