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

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Olá mundo", total_cost_usd: 0.05 }) + "\n"));
    expect(onDone).toHaveBeenCalledWith("Olá mundo", 0.05, null);
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

  it("não corrompe caractere multi-byte (ã) partido entre dois chunks", () => {
    const proc = fakeProc();
    const onChunk = vi.fn(), onDone = vi.fn(), onError = vi.fn();
    runSummary("P", { onChunk, onDone, onError }, { spawnFn: (() => proc) as any });
    // "Implementação" tem 'ç' e 'ã' (2 bytes cada em UTF-8). Cortamos os bytes no meio.
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Implementação" } } }) + "\n";
    const bytes = Buffer.from(line, "utf8");
    const cut = bytes.indexOf(Buffer.from("ç", "utf8")) + 1; // corta NO MEIO do 'ç'
    proc.stdout.emit("data", bytes.subarray(0, cut));
    proc.stdout.emit("data", bytes.subarray(cut));
    expect(onChunk).toHaveBeenCalledWith("Implementação");
    expect(onChunk).not.toHaveBeenCalledWith(expect.stringContaining("�"));
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

  it("passa modelId resolvido do evento system/init para onDone", () => {
    const proc = fakeProc();
    const onDone = vi.fn(), onError = vi.fn();
    runSummary("P", { onChunk: vi.fn(), onDone, onError }, { spawnFn: (() => proc) as any });

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "system", subtype: "init", model: "claude-haiku-4-5-20251001" }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0.01 }) + "\n"));

    expect(onDone).toHaveBeenCalledWith("ok", 0.01, "claude-haiku-4-5-20251001");
    expect(onError).not.toHaveBeenCalled();
  });

  it("passa modelId null quando não há evento system/init", () => {
    const proc = fakeProc();
    const onDone = vi.fn();
    runSummary("P", { onChunk: vi.fn(), onDone, onError: vi.fn() }, { spawnFn: (() => proc) as any });

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0 }) + "\n"));

    expect(onDone).toHaveBeenCalledWith("ok", 0, null);
  });
});
