import { spawn as realSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { parseStreamLine } from "./parse.js";

export interface SummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
}

export interface SummaryHandle {
  cancel: () => void;
}

export interface SummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

const CLI_ARGS = ["--print", "--output-format=stream-json", "--include-partial-messages", "--model", "sonnet", "--verbose"];

/**
 * Roda o Claude CLI com o prompt via stdin (sem interpolação em shell → sem injeção)
 * e faz streaming dos pedaços de texto pelos callbacks. Acumula stdout num buffer e
 * processa linha a linha (o CLI emite NDJSON: um JSON por linha).
 */
export function runSummary(prompt: string, cb: SummaryCallbacks, deps: SummaryDeps = {}): SummaryHandle {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const proc = spawnFn("claude", CLI_ARGS, { cwd: deps.cwd ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"] });

  let buffer = "";
  let done = false;
  // StringDecoder segura bytes de um caractere multi-byte (ã, ç, é) que ficou partido
  // entre dois chunks do pipe — sem ele, cada metade viraria '�'. O resumo é em
  // português, então esse split aconteceria na prática.
  const decoder = new StringDecoder("utf8");
  const finishDone = (text: string) => { if (!done) { done = true; cb.onDone(text); } };
  const finishError = (msg: string) => { if (!done) { done = true; cb.onError(msg); } };

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const ev = parseStreamLine(line);
      if (!ev) continue;
      if (ev.kind === "chunk") cb.onChunk(ev.text);
      else if (ev.kind === "done") finishDone(ev.text);
      else finishError(ev.message);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    finishError(err.code === "ENOENT" ? "Claude CLI não encontrado (instale/cheque o PATH)" : `falha ao rodar o Claude CLI: ${err.message}`);
  });

  proc.on("close", (code: number | null) => {
    if (!done) finishError(code === 0 ? "geração terminou sem resultado" : `Claude CLI saiu com código ${code}`);
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();

  return { cancel: () => proc.kill() };
}
