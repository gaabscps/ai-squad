import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { runSummary } from "./service.js";

/** Processo falso: stdout/stderr são EventEmitters; expõe stdin.write/end espionáveis. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("runSummary", () => {
  it("manda o prompt pelo stdin e emite chunks + done", () => {
    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();

    runSummary("PROMPT", { onChunk, onDone, onError }, { spawnFn });

    expect(spawnFn).toHaveBeenCalledWith("claude", expect.arrayContaining(["--print", "--output-format=stream-json", "--include-partial-messages", "--model", "sonnet"]), expect.any(Object));
    expect(proc.stdin.write).toHaveBeenCalledWith("PROMPT");
    expect(proc.stdin.end).toHaveBeenCalled();

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá" } } }) + "\n"));
    expect(onChunk).toHaveBeenCalledWith("Olá");

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Olá mundo" }) + "\n"));
    expect(onDone).toHaveBeenCalledWith("Olá mundo");
    expect(onError).not.toHaveBeenCalled();
  });

  it("lida com linha quebrada entre dois chunks de data", () => {
    const proc = fakeProc();
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();
    runSummary("P", { onChunk, onDone, onError }, { spawnFn: (() => proc) as any });
    const full = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "X" } } }) + "\n";
    proc.stdout.emit("data", Buffer.from(full.slice(0, 10)));
    proc.stdout.emit("data", Buffer.from(full.slice(10)));
    expect(onChunk).toHaveBeenCalledWith("X");
  });

  it("emite error quando o CLI não existe (ENOENT)", () => {
    const proc = fakeProc();
    const onError = vi.fn();
    runSummary("P", { onChunk: vi.fn(), onDone: vi.fn(), onError }, { spawnFn: (() => proc) as any });
    proc.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/claude/i));
  });

  it("cancel() mata o processo", () => {
    const proc = fakeProc();
    const handle = runSummary("P", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, { spawnFn: (() => proc) as any });
    handle.cancel();
    expect(proc.kill).toHaveBeenCalled();
  });
});
