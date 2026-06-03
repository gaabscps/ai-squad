import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSummaryHandler } from "./handler.js";
import type { Project } from "../store/types.js";

function proj(): Project {
  return {
    id: "p1", path: "/x", name: "x", hidden: false,
    specs: [{
      id: "FEAT-001", squad: "sdd", title: "Coletor", phase: "implementation", plannedPhases: [],
      status: "running", health: { pendingHuman: 0, escalationRate: 0, auditException: false },
      lastActivityAt: null, timeline: [], cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null, source: "empty", scopingSuspect: false, excludedSubagents: null, recoveredSubagents: null, byPhase: null, complete: null },
      tasks: [{ id: "T-001", state: "done", loops: 1, dispatches: [{ role: "dev", loop: 1, status: "done", summary: "fez X", filesChanged: [], findings: [], testEvidence: [], tokens: null }] }],
    }],
  };
}
const store = { getSnapshot: () => [proj()] } as any;

function fakeProc() {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
  p.stdin = { write: vi.fn(), end: vi.fn() }; p.kill = vi.fn();
  return p;
}

describe("makeSummaryHandler", () => {
  it("fetch sem cache: não responde nada", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root });
    handle({ type: "summary:fetch", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send);
    expect(send).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("generate: faz streaming e responde chunk + done, e grava cache", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "summary:generate", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send);
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Re" } } }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Resumo", total_cost_usd: 0.07 }) + "\n"));

    const sent = send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(sent.map((m) => m.type)).toContain("summary:chunk");
    const doneMsg = sent.find((m) => m.type === "summary:done");
    expect(doneMsg.costUsd).toBe(0.07);

    const send2 = vi.fn();
    handle({ type: "summary:fetch", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send2);
    const cached = JSON.parse(send2.mock.calls[0][0]);
    expect(cached.type).toBe("summary:cached");
    expect(cached.text).toBe("Resumo");
    expect(cached.costUsd).toBe(0.07);
    expect(cached.stale).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("generate com task inexistente: responde error", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn: (() => fakeProc()) as any });
    handle({ type: "summary:generate", projectId: "p1", specId: "FEAT-001", taskId: "T-999" }, send);
    expect(JSON.parse(send.mock.calls[0][0]).type).toBe("summary:error");
    rmSync(root, { recursive: true, force: true });
  });

  it("isola por projectId: mesmo spec/task em outro projeto não casa", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn: (() => fakeProc()) as any });
    // store só tem o projeto "p1"; pedir o MESMO FEAT-001/T-001 noutro projeto → erro.
    handle({ type: "summary:generate", projectId: "p2", specId: "FEAT-001", taskId: "T-001" }, send);
    const msg = JSON.parse(send.mock.calls[0][0]);
    expect(msg.type).toBe("summary:error");
    expect(msg.projectId).toBe("p2");
    rmSync(root, { recursive: true, force: true });
  });

  it("regerar a mesma task: o close do processo antigo não vaza o handle do novo", () => {
    const root = mkdtempSync(join(tmpdir(), "h-"));
    const procs: any[] = [];
    const spawnFn = (() => { const p = fakeProc(); procs.push(p); return p; }) as any;
    const send = vi.fn();
    const handle = makeSummaryHandler(store, { cacheRoot: root, spawnFn, now: () => "T0" });

    handle({ type: "summary:generate", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send); // proc 0
    handle({ type: "summary:generate", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send); // cancela 0, vira proc 1
    expect(procs[0].kill).toHaveBeenCalled();

    // O processo ANTIGO (0), já cancelado, fecha agora e dispara seu onError tardio.
    procs[0].emit("close", null);

    // Um terceiro generate ainda deve achar e cancelar o proc 1 (o atual) —
    // só acontece se o close do 0 NÃO apagou a entrada do 1 do mapa.
    handle({ type: "summary:generate", projectId: "p1", specId: "FEAT-001", taskId: "T-001" }, send); // cancela 1, vira proc 2
    expect(procs[1].kill).toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });
});
