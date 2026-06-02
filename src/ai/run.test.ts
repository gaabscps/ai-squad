import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runAgent, claudeAdapter } from "./run.js";

/** Processo falso: stdout/stderr são EventEmitters; stdin.write/end espionáveis. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("runAgent + claudeAdapter", () => {
  it("spawna o comando do adaptador, manda o prompt no stdin e emite chunk + done", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();

    runAgent("PROMPT", { onChunk, onDone, onError }, { adapter: claudeAdapter, spawnFn });

    expect(spawnFn).toHaveBeenCalledWith("claude", expect.arrayContaining(["--print", "--output-format=stream-json"]), expect.any(Object));
    expect(proc.stdin.write).toHaveBeenCalledWith("PROMPT");
    expect(proc.stdin.end).toHaveBeenCalled();

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Oi" } } }) + "\n"));
    expect(onChunk).toHaveBeenCalledWith("Oi");

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Oi mundo", total_cost_usd: 0.02 }) + "\n"));
    expect(onDone).toHaveBeenCalledWith("Oi mundo", 0.02);
  });

  it("remove ANTHROPIC_API_KEY do env do filho (trava: nunca API on-demand)", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    process.env.ANTHROPIC_API_KEY = "sk-fake";
    try {
      runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { adapter: claudeAdapter, spawnFn });
      const opts = spawnFn.mock.calls[0][2];
      expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("emite error quando a CLI não existe (ENOENT) citando o comando", () => {
    const proc = fakeProc();
    const onError = vi.fn();
    runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError }, { adapter: claudeAdapter, spawnFn: (() => proc) as any });
    proc.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/claude/i));
  });

  it("cancel() mata o processo", () => {
    const proc = fakeProc();
    const handle = runAgent("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { adapter: claudeAdapter, spawnFn: (() => proc) as any });
    handle.cancel();
    expect(proc.kill).toHaveBeenCalled();
  });
});
