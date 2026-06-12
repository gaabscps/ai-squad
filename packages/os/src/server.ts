import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, saveHidden, saveConfigFields, type AiosConfig } from "./config.js";
import { Store } from "./store/store.js";
import { watchProjects } from "./collector/watcher.js";
import { resolveAddablePath } from "./collector/browse.js";
import { createServer } from "./ui/app.js";

const CONFIG_PATH = join(process.cwd(), "aios.config.json");
const config: AiosConfig = loadConfig(CONFIG_PATH);
// 4717 por padrão; configurável via AIOS_PORT (evita-se 4317, que é a porta do OpenTelemetry/OTLP).
const port = Number(process.env.AIOS_PORT ?? 4717);

// O Store recebe `config` por função, então cada rebuild lê o hide mais atual em vez de uma cópia congelada.
const store = new Store(() => config);
store.rebuild();

const toggleHide = (id: string, hidden: boolean): void => {
  const proj = store.getSnapshot().find((p) => p.id === id);
  if (!proj) return; // id desconhecido: ignora
  const next = new Set(config.hide);
  if (hidden) next.add(proj.path);
  else next.delete(proj.path);
  config.hide = [...next];
  try {
    saveHidden(CONFIG_PATH, config.hide); // única escrita, no repo do aiOS
  } catch (err) {
    // falha de escrita (permissão/disco) não pode derrubar o servidor no meio
    // de um handler WS — loga e segue; o estado em memória já reflete o toggle.
    console.error(`aviso: não consegui persistir o hide em ${CONFIG_PATH}:`, err);
  }
  store.rebuild(); // relê com o novo hide → emite changed → broadcast
};

// `let` para que rearmWatcher() possa fechar e reabrir o chokidar com os includes atuais.
let watcher = watchProjects(config.roots, config.include ?? [], () => store.rebuild());

function rearmWatcher(): void {
  void watcher.close();
  watcher = watchProjects(config.roots, config.include ?? [], () => store.rebuild());
}

async function addInclude(path: string): Promise<{ persisted: boolean; alreadyExisted: boolean }> {
  const canonicalPath = await resolveAddablePath(path, homedir()); // lança se inválido; retorna realpath

  if ((config.include ?? []).includes(canonicalPath)) {
    return { persisted: true, alreadyExisted: true };
  }

  // Segundo check síncrono imediatamente antes da mutação: elimina a janela de
  // race entre dois POSTs concorrentes que passaram o check acima enquanto o
  // await de resolveAddablePath estava pendente (Node.js é single-threaded —
  // entre aqui e a mutação nenhum outro handler intercala).
  if ((config.include ?? []).includes(canonicalPath)) {
    return { persisted: true, alreadyExisted: true };
  }

  config.include = [...(config.include ?? []), canonicalPath];
  store.rebuild();
  rearmWatcher();

  const result = await saveConfigFields({ include: config.include }, CONFIG_PATH);
  if (!result.persisted) {
    console.warn(`[aiOS] addInclude: estado aplicado em memória mas não persistido em ${CONFIG_PATH}`);
  }
  return { ...result, alreadyExisted: false };
}

async function removeInclude(path: string): Promise<{ persisted: boolean }> {
  if (!(config.include ?? []).includes(path)) {
    return { persisted: true };
  }

  config.include = (config.include ?? []).filter((p) => p !== path);
  store.rebuild();
  rearmWatcher();

  const result = await saveConfigFields({ include: config.include }, CONFIG_PATH);
  if (!result.persisted) {
    console.warn(`[aiOS] removeInclude: estado aplicado em memória mas não persistido em ${CONFIG_PATH}`);
  }
  return result;
}

const server = createServer(store, toggleHide, config.archiveAfterDays, () => config.include ?? [], addInclude, removeInclude);
// As roots são lidas só aqui, na inicialização: mudá-las em aios.config.json exige reiniciar
// o servidor (o hide, ao contrário, é relido a cada rebuild via a função passada ao Store).

server.listen(port, () => {
  console.log(`ai-squad-os ouvindo em http://127.0.0.1:${port}  (config: ${CONFIG_PATH})`);
  console.log(`roots: ${config.roots.join(", ") || "(nenhuma — edite aios.config.json)"}`);
});

const shutdown = (): void => {
  void watcher.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
