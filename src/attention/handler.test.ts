import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeDiagnosisHandler } from "./handler.js";
import type { Spec, Project } from "../store/types.js";

const ROOT = join(process.cwd(), ".aios-cache-test-handler");
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

function makeStore(spec: Spec, projectPath = "/proj/login") {
  const project: Project = { id: "proj-abc", path: projectPath, name: "login", specs: [spec], hidden: false };
  return { getSnapshot: () => [project] } as any;
}

function makeMultiSpecStore(specs: Spec[], projectPath = "/proj/login") {
  const project: Project = { id: "proj-abc", path: projectPath, name: "login", specs, hidden: false };
  return { getSnapshot: () => [project] } as any;
}

const blockedSpec: Spec = {
  id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation", plannedPhases: [],
  status: "blocked", tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
  lastActivityAt: null, timeline: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
  cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null, source: "empty", scopingSuspect: false, excludedSubagents: null, recoveredSubagents: null, byPhase: null, complete: null },
};

function makeSpec(id: string): Spec {
  return { ...blockedSpec, id };
}

describe("makeDiagnosisHandler", () => {
  it("no fetch, sempre manda o handoff (mesmo sem cache)", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));
    const handoff = sent.find((m) => m.type === "attention:handoff");
    expect(handoff).toBeTruthy();
    expect(handoff.text).toContain("/proj/login/.agent-session/FEAT-001/");
  });

  it("no generate, streama chunk + done e grava cache", () => {
    const proc = fakeProc();
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT, spawnFn: (() => proc) as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Parou porque" } } }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Parou porque o reviewer rejeitou", total_cost_usd: 0.03 }) + "\n"));

    expect(sent.some((m) => m.type === "attention:chunk" && m.delta === "Parou porque")).toBe(true);
    const done = sent.find((m) => m.type === "attention:done");
    expect(done.text).toBe("Parou porque o reviewer rejeitou");
    expect(done.costUsd).toBe(0.03);
  });

  it("generate de spec inexistente → error", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "NOPE" }, (d) => sent.push(JSON.parse(d)));
    expect(sent.some((m) => m.type === "attention:error")).toBe(true);
  });

  it("inicia geração imediatamente quando há menos de 3 ativas", () => {
    const procs = [fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([makeSpec("FEAT-001"), makeSpec("FEAT-002")]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);

    expect(sent.filter((m) => m.type === "attention:queued")).toHaveLength(0);
    expect(spawnCount).toBe(2);
  });

  it("enfileira a 4ª geração e emite attention:queued", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);
    const queued = sent.filter((m) => m.type === "attention:queued");
    expect(queued).toHaveLength(1);
    expect(queued[0].specId).toBe("FEAT-004");
    expect(queued[0].projectId).toBe("proj-abc");
  });

  it("ao concluir uma geração, inicia a próxima da fila automaticamente", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);

    procs[0].stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Resultado FEAT-001", total_cost_usd: 0.01 }) + "\n"));

    expect(spawnCount).toBe(4);
    expect(sent.some((m) => m.type === "attention:done" && m.specId === "FEAT-001")).toBe(true);
  });

  it("ao falhar uma geração, inicia a próxima da fila automaticamente", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);

    procs[0].emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    expect(spawnCount).toBe(4);
  });

  it("re-gerar a mesma spec cancela a anterior, não afeta outras specs", () => {
    const proc1 = fakeProc();
    const proc2 = fakeProc();
    const proc3 = fakeProc();
    let spawnCount = 0;
    const spawnFn = () => [proc1, proc2, proc3][spawnCount++];
    const store = makeMultiSpecStore([makeSpec("FEAT-001"), makeSpec("FEAT-002")]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    expect(proc1.kill).toHaveBeenCalledTimes(1);
    expect(proc2.kill).not.toHaveBeenCalled();
    expect(spawnCount).toBe(3);
  });

  it("falha imediata (ENOENT) libera a vaga e puxa próxima da fila", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);

    procs[0].emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    expect(spawnCount).toBe(4);
    expect(sent.some((m) => m.type === "attention:error" && m.specId === "FEAT-001")).toBe(true);
  });

  it("grava cache em disco ao concluir mesmo que o drawer esteja fechado", () => {
    const proc = fakeProc();
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT, spawnFn: (() => proc) as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Diagnóstico gravado", total_cost_usd: 0.05 }) + "\n"));

    const sentFetch: any[] = [];
    handle({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sentFetch.push(JSON.parse(d)));
    const cached = sentFetch.find((m) => m.type === "attention:cached");
    expect(cached).toBeTruthy();
    expect(cached.text).toBe("Diagnóstico gravado");
    expect(cached.costUsd).toBe(0.05);
  });

  it("mensagem attention:queued contém projectId e specId do job enfileirado", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent4: any[] = [];

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, (d) => sent4.push(JSON.parse(d)));

    const queued = sent4.find((m) => m.type === "attention:queued");
    expect(queued).toBeTruthy();
    expect(queued.type).toBe("attention:queued");
    expect(queued.projectId).toBe("proj-abc");
    expect(queued.specId).toBe("FEAT-004");
  });

  it("FIFO — a primeira da fila é puxada primeiro ao abrir vaga", () => {
    const procs = Array.from({ length: 6 }, fakeProc);
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"),
      makeSpec("FEAT-004"), makeSpec("FEAT-005"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });
    const started: string[] = [];

    const track = (specId: string) => (d: string) => {
      const m = JSON.parse(d);
      if (m.type === "attention:chunk" || m.type === "attention:done") started.push(specId);
    };

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, track("FEAT-001"));
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, track("FEAT-002"));
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, track("FEAT-003"));
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, track("FEAT-004"));
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-005" }, track("FEAT-005"));

    expect(spawnCount).toBe(3);

    procs[0].stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "R1", total_cost_usd: 0.01 }) + "\n"));
    expect(spawnCount).toBe(4);

    procs[1].stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "R2", total_cost_usd: 0.01 }) + "\n"));
    expect(spawnCount).toBe(5);
  });

  it("writeDiagnosis lança → vaga libera e fila drena mesmo assim (f-001)", () => {
    // ROOT is made into a file so writeDiagnosis (which calls mkdirSync inside ROOT) throws ENOTDIR.
    // This simulates disk-full or permission failure.
    writeFileSync(ROOT, "not-a-dir");

    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);

    // writeDiagnosis will throw (ROOT is a file, not a dir), but the slot must still release
    expect(() => {
      procs[0].stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "R", total_cost_usd: 0.01 }) + "\n"));
    }).toThrow();

    // Despite the throw, onRelease ran via finally → drainPending ran → FEAT-004 spawned
    expect(spawnCount).toBe(4);
  });

  it("re-geração com 3 ativas inicia imediatamente (mesmo slot, não fura o cap) (f-002/f-003)", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    expect(spawnCount).toBe(4);
    expect(sent.filter((m) => m.type === "attention:queued")).toHaveLength(0);
    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(procs[1].kill).not.toHaveBeenCalled();
    expect(procs[2].kill).not.toHaveBeenCalled();
  });

  it("re-geração remove órfão da fila e envia terminal ao socket original (f-004)", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });

    const sentOriginal: any[] = [];
    const sentNew: any[] = [];
    const collectOriginal = (d: string) => sentOriginal.push(JSON.parse(d));
    const collectNew = (d: string) => sentNew.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, () => {});
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collectOriginal);

    expect(sentOriginal.some((m) => m.type === "attention:queued")).toBe(true);

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collectNew);

    expect(sentOriginal.some((m) => m.type === "attention:error" && m.specId === "FEAT-004")).toBe(true);

    procs[0].stdout.emit("data", Buffer.from(JSON.stringify({
      type: "result", subtype: "success", is_error: false, result: "R1", total_cost_usd: 0.01,
    }) + "\n"));

    expect(spawnCount).toBe(4);
    expect(sentNew.filter((m) => m.type === "attention:queued")).toHaveLength(1);
  });

  it("proc cancelado que emite terminal tardio na mesma chave/socket é suprimido (f-005)", () => {
    const proc1 = fakeProc();
    const proc2 = fakeProc();
    let spawnCount = 0;
    const spawnFn = () => [proc1, proc2][spawnCount++];
    const store = makeMultiSpecStore([makeSpec("FEAT-001")]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    expect(proc1.kill).toHaveBeenCalledTimes(1);
    expect(spawnCount).toBe(2);

    proc2.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "geração nova streamando" } } }) + "\n"));

    proc1.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    proc1.emit("close", 1);

    expect(sent.some((m) => m.type === "attention:error" && m.specId === "FEAT-001")).toBe(false);
    expect(sent.some((m) => m.type === "attention:chunk" && m.delta === "geração nova streamando")).toBe(true);

    proc2.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "diagnóstico novo", total_cost_usd: 0.02 }) + "\n"));
    const done = sent.find((m) => m.type === "attention:done" && m.specId === "FEAT-001");
    expect(done).toBeTruthy();
    expect(done.text).toBe("diagnóstico novo");
  });

  it("attention:cancel de job ativo chama cancel(), libera vaga e puxa a fila (AC-019)", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);
    expect(sent.some((m) => m.type === "attention:queued" && m.specId === "FEAT-004")).toBe(true);

    // Cancel the active FEAT-001 job — deve chamar kill, liberar a vaga e puxar FEAT-004 da fila
    handle({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    expect(procs[0].kill).toHaveBeenCalledTimes(1);
    expect(procs[1].kill).not.toHaveBeenCalled();
    expect(procs[2].kill).not.toHaveBeenCalled();
    expect(spawnCount).toBe(4);
  });

  it("attention:cancel de job ativo emite cancelled e não dispara toast (AC-019)", () => {
    const proc = fakeProc();
    const spawnFn = () => proc;
    const store = makeStore(blockedSpec);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    expect(sent.some((m) => m.type === "attention:cancelled" && m.projectId === "proj-abc" && m.specId === "FEAT-001")).toBe(true);
    expect(sent.some((m) => m.type === "attention:done")).toBe(false);
    expect(sent.some((m) => m.type === "attention:error")).toBe(false);
  });

  it("attention:cancel de chave inexistente (não ativo nem na fila) é no-op (AC-019 edge)", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    expect(() => {
      handle({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    }).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("attention:cancel de job na fila remove-o sem matar processo e sem abrir vaga indevida (AC-021)", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"), makeSpec("FEAT-004"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);

    handle({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(procs[0].kill).not.toHaveBeenCalled();
    expect(procs[1].kill).not.toHaveBeenCalled();
    expect(procs[2].kill).not.toHaveBeenCalled();
    expect(spawnCount).toBe(3);
    expect(sent.some((m) => m.type === "attention:cancelled" && m.specId === "FEAT-004")).toBe(true);
  });

  it("cancelar job na fila não libera vaga dos 3 ativos (AC-021 invariante de cap)", () => {
    const procs = [fakeProc(), fakeProc(), fakeProc(), fakeProc(), fakeProc()];
    let spawnCount = 0;
    const spawnFn = () => procs[spawnCount++];
    const store = makeMultiSpecStore([
      makeSpec("FEAT-001"), makeSpec("FEAT-002"), makeSpec("FEAT-003"),
      makeSpec("FEAT-004"), makeSpec("FEAT-005"),
    ]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-002" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-003" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-004" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-005" }, collect);

    expect(spawnCount).toBe(3);

    handle({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-004" }, collect);

    expect(spawnCount).toBe(3);
    const cancelledFeat5 = sent.some((m) => m.type === "attention:cancelled" && m.specId === "FEAT-005");
    expect(cancelledFeat5).toBe(false);
  });

  it("done tardio de proc cancelado não sobrescreve o cache da geração nova (f-005)", () => {
    const proc1 = fakeProc();
    const proc2 = fakeProc();
    let spawnCount = 0;
    const spawnFn = () => [proc1, proc2][spawnCount++];
    const store = makeMultiSpecStore([makeSpec("FEAT-001")]);
    const handle = makeDiagnosisHandler(store, { cacheRoot: ROOT, spawnFn: spawnFn as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    const collect = (d: string) => sent.push(JSON.parse(d));

    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, collect);

    proc1.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "resultado antigo cancelado", total_cost_usd: 0.99 }) + "\n"));
    proc2.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "resultado novo", total_cost_usd: 0.02 }) + "\n"));

    const dones = sent.filter((m) => m.type === "attention:done" && m.specId === "FEAT-001");
    expect(dones).toHaveLength(1);
    expect(dones[0].text).toBe("resultado novo");

    const fetched: any[] = [];
    handle({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" }, (d) => fetched.push(JSON.parse(d)));
    const cached = fetched.find((m) => m.type === "attention:cached");
    expect(cached.text).toBe("resultado novo");
    expect(cached.costUsd).toBe(0.02);
  });
});
