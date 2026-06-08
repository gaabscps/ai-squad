import { spawn as realSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { parseStreamLine, type ParsedEvent } from "../summary/parse.js";

/**
 * Adaptador de uma CLI de IA: como montar o comando e traduzir cada linha da
 * saída em evento. Dia 1 só existe o do Claude; a interface é a costura pra
 * plugar Codex/Gemini/etc. depois sem mexer no streaming.
 */
export interface AgentAdapter {
  command: string;
  buildArgs: () => string[];
  parseLine: (line: string) => ParsedEvent | null;
}

export type ModelAlias = "haiku" | "sonnet" | "opus";

export interface AgentCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null, modelId: string | null) => void;
  onError: (message: string) => void;
}

export interface AgentHandle {
  cancel: () => void;
}

export interface RunAgentDeps {
  adapter: AgentAdapter;
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

const CLAUDE_BASE_ARGS = ["--print", "--output-format=stream-json", "--include-partial-messages", "--verbose"];

export function buildClaudeAdapter(model: ModelAlias): AgentAdapter {
  return {
    command: "claude",
    buildArgs: () => [...CLAUDE_BASE_ARGS, "--model", model],
    parseLine: parseStreamLine,
  };
}

export const claudeAdapter: AgentAdapter = buildClaudeAdapter("sonnet");

/**
 * Roda uma CLI de IA com o prompt via stdin (sem interpolação em shell → sem injeção)
 * e faz streaming dos pedaços de texto pelos callbacks. Processa linha a linha (NDJSON).
 * Trava "nunca API on-demand": remove ANTHROPIC_API_KEY do env do filho, forçando o
 * uso da quota da assinatura (OAuth) em vez da API metrada.
 */
export function runAgent(prompt: string, cb: AgentCallbacks, deps: RunAgentDeps): AgentHandle {
  const spawnFn = deps.spawnFn ?? realSpawn;
  const { adapter } = deps;
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawnFn(adapter.command, adapter.buildArgs(), { cwd: deps.cwd ?? process.cwd(), stdio: ["pipe", "pipe", "pipe"], env });

  let buffer = "";
  let done = false;
  let modelId: string | null = null;
  // StringDecoder segura bytes de um caractere multi-byte (ã, ç) partido entre chunks.
  const decoder = new StringDecoder("utf8");
  const finishDone = (text: string, costUsd: number | null) => { if (!done) { done = true; cb.onDone(text, costUsd, modelId); } };
  const finishError = (msg: string) => { if (!done) { done = true; cb.onError(msg); } };

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const ev = adapter.parseLine(line);
      if (!ev) continue;
      if (ev.kind === "init") { modelId = ev.modelId; continue; }
      if (ev.kind === "chunk") cb.onChunk(ev.text);
      else if (ev.kind === "done") finishDone(ev.text, ev.costUsd);
      else finishError(ev.message);
    }
  });

  proc.on("error", (err: NodeJS.ErrnoException) => {
    finishError(err.code === "ENOENT" ? `${adapter.command} não encontrado (instale/cheque o PATH)` : `falha ao rodar ${adapter.command}: ${err.message}`);
  });

  proc.on("close", (code: number | null) => {
    if (!done) finishError(code === 0 ? "geração terminou sem resultado" : `${adapter.command} saiu com código ${code}`);
  });

  proc.stdin?.write(prompt);
  proc.stdin?.end();

  return { cancel: () => proc.kill() };
}
