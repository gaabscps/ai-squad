import chokidar from "chokidar";
import { join } from "node:path";

/**
 * debounce: só dispara `fn` após `ms` sem novas chamadas. Uma gravação do
 * orchestrator pode ser uma rajada; isto evita reprocessar N vezes (design §4).
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

export interface WatchHandle {
  close: () => Promise<void>;
}

/**
 * Observa só os arquivos que afetam o board — session.yml, costs/*.json,
 * manifests, outputs/*.json (packets de dispatch), report.html e cost-report.json —
 * e NÃO os .md (mudam na escrita interativa e não mexem em status/custo: design §4).
 * Chama onChange (debounced) a cada mudança.
 * Glob anchorado em "*\/.agent-session" pra não varrer a árvore inteira.
 */
export function watchProjects(
  roots: string[],
  include: string[],
  onChange: () => void,
  debounceMs = 200,
): WatchHandle {
  const patterns = [
    ...roots.flatMap((r) => [
      join(r, "*", ".agent-session", "**", "session.yml"),
      join(r, "*", ".agent-session", "**", "costs", "*.json"),
      join(r, "*", ".agent-session", "**", "*manifest*.json"),
      join(r, "*", ".agent-session", "**", "outputs", "*.json"),
      join(r, "*", ".agent-session", "**", "report.html"),
      join(r, "*", ".agent-session", "**", "cost-report.json"),
    ]),
    ...include.flatMap((inc) => [
      join(inc, ".agent-session", "**", "session.yml"),
      join(inc, ".agent-session", "**", "costs", "*.json"),
      join(inc, ".agent-session", "**", "*manifest*.json"),
      join(inc, ".agent-session", "**", "outputs", "*.json"),
      join(inc, ".agent-session", "**", "report.html"),
      join(inc, ".agent-session", "**", "cost-report.json"),
    ]),
  ];
  const debounced = debounce(onChange, debounceMs);
  const watcher = chokidar.watch(patterns, {
    ignoreInitial: true, // não dispara pelos arquivos que já existiam ao subir
    ignored: (p: string) => p.endsWith(".md"), // defensivo: nunca os .md
  });
  watcher.on("all", () => debounced());
  return { close: () => watcher.close() };
}
