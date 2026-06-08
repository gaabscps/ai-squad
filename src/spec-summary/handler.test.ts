import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSpecSummaryHandler } from "./handler.js";
import type { Project } from "../store/types.js";

function fakeProc() {
  const p: any = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.stdin = { write: vi.fn(), end: vi.fn() };
  p.kill = vi.fn();
  return p;
}

function specProj(specPath: string | null): Project {
  return {
    id: "p1", path: "/x", name: "x", hidden: false,
    specs: [{
      id: "FEAT-006",
      squad: "sdd",
      title: "Resumo de Feature",
      phase: "implementation",
      plannedPhases: [],
      status: "running",
      health: { pendingHuman: 0, escalationRate: 0, auditException: false },
      lastActivityAt: null,
      timeline: [],
      cost: {
        totalCostUsd: null, partial: false,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        totalTokens: 0, reportPath: null, source: "empty",
        scopingSuspect: false, excludedSubagents: null, recoveredSubagents: null,
        byPhase: null, complete: null,
      },
      tasks: [],
      specPath,
    }],
  };
}

const CHUNK_LINE = JSON.stringify({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type: "text_delta", text: "Olá" } },
});
const DONE_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Resumo completo.",
  total_cost_usd: 0.01,
});
const INIT_LINE = JSON.stringify({ type: "system", subtype: "init", model: "claude-haiku-4-5-20251001" });

// ─── AC-006: fetch retorna cached, verifica stale ───────────────────────────

describe("makeSpecSummaryHandler — fetch", () => {
  it("fetch sem cache: não responde nada", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const store = { getSnapshot: () => [specProj("/any/spec.md")] } as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root });
    handle({ type: "spec-summary:fetch", projectId: "p1", specId: "FEAT-006" }, send);
    expect(send).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("fetch com cache válido e fingerprint igual: emite spec-summary:cached com stale=false", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-fetch-test.md");
    writeFileSync(specFile, "conteúdo do spec");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.stdout.emit("data", Buffer.from(INIT_LINE + "\n"));
    proc.stdout.emit("data", Buffer.from(DONE_LINE + "\n"));

    const send2 = vi.fn();
    handle({ type: "spec-summary:fetch", projectId: "p1", specId: "FEAT-006" }, send2);
    const cached = JSON.parse(send2.mock.calls[0][0]);
    expect(cached.type).toBe("spec-summary:cached");
    expect(cached.stale).toBe(false);
    expect(cached.summary).toBe("Resumo completo.");

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("fetch com cache cujo fingerprint divergiu: stale=true", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-stale-test.md");
    writeFileSync(specFile, "conteúdo original");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.stdout.emit("data", Buffer.from(DONE_LINE + "\n"));

    // Muda o conteúdo do spec → fingerprint diverge
    writeFileSync(specFile, "conteúdo DIFERENTE");

    const send2 = vi.fn();
    handle({ type: "spec-summary:fetch", projectId: "p1", specId: "FEAT-006" }, send2);
    const cached = JSON.parse(send2.mock.calls[0][0]);
    expect(cached.type).toBe("spec-summary:cached");
    expect(cached.stale).toBe(true);

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});

// ─── AC-002: generate usa buildClaudeAdapter com alias correto ───────────────

describe("makeSpecSummaryHandler — generate AC-002", () => {
  it("spawn é chamado com --model haiku quando model='haiku'", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac002.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    expect(spawnFn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--model", "haiku"]),
      expect.any(Object),
    );

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("spawn é chamado com --model sonnet quando model='sonnet'", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac002b.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const spawnFn = vi.fn(() => proc) as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "sonnet" }, send);
    expect(spawnFn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--model", "sonnet"]),
      expect.any(Object),
    );

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});

// ─── AC-006: generate grava cache com fingerprint + modelId ─────────────────

describe("makeSpecSummaryHandler — generate AC-006 (cache)", () => {
  it("grava cache ao finalizar e inclui modelId do init", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac006.md");
    writeFileSync(specFile, "conteúdo spec");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.stdout.emit("data", Buffer.from(INIT_LINE + "\n"));
    proc.stdout.emit("data", Buffer.from(DONE_LINE + "\n"));

    const msgs = send.mock.calls.map((c) => JSON.parse(c[0]));
    const done = msgs.find((m) => m.type === "spec-summary:done");
    expect(done).toBeDefined();
    expect(done.text).toBe("Resumo completo.");
    expect(done.costUsd).toBe(0.01);
    expect(done.modelId).toBe("claude-haiku-4-5-20251001");
    expect(done.generatedAt).toBe("T0");

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("emite spec-summary:chunk durante streaming", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-chunk.md");
    writeFileSync(specFile, "spec");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.stdout.emit("data", Buffer.from(CHUNK_LINE + "\n"));

    const msgs = send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.some((m) => m.type === "spec-summary:chunk" && m.delta === "Olá")).toBe(true);

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});

// ─── AC-008: erro do CLI → spec-summary:error, socket não derruba ───────────

describe("makeSpecSummaryHandler — AC-008 (error)", () => {
  it("CLI ENOENT → emite spec-summary:error sem lançar", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac008.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));

    const msgs = send.mock.calls.map((c) => JSON.parse(c[0]));
    const err = msgs.find((m) => m.type === "spec-summary:error");
    expect(err).toBeDefined();
    expect(err.message).toMatch(/claude/i);

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("spec não encontrada no store → emite spec-summary:error", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const store = { getSnapshot: () => [specProj("/tmp/spec.md")] } as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => fakeProc()) as any });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-999" }, send);
    const msg = JSON.parse(send.mock.calls[0][0]);
    expect(msg.type).toBe("spec-summary:error");

    rmSync(root, { recursive: true, force: true });
  });

  it("specPath null → emite spec-summary:error (botão deve permanecer clicável)", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const store = { getSnapshot: () => [specProj(null)] } as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => fakeProc()) as any });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006" }, send);
    const msg = JSON.parse(send.mock.calls[0][0]);
    expect(msg.type).toBe("spec-summary:error");

    // Segundo generate ainda funciona (handler não travou)
    const send2 = vi.fn();
    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006" }, send2);
    const msg2 = JSON.parse(send2.mock.calls[0][0]);
    expect(msg2.type).toBe("spec-summary:error");

    rmSync(root, { recursive: true, force: true });
  });

  it("spec.md deletado entre guard e readFileSync → emite spec-summary:error, não lança", () => {
    // Reproduz a race condition: specPath não é null no store, mas o arquivo
    // some do disco antes do readFileSync em service.ts ser executado.
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac008-deleted.md");
    writeFileSync(specFile, "conteúdo");

    // spawnFn que apaga o arquivo antes de qualquer coisa — simula que o ENOENT
    // ocorre dentro de runSpecSummary (via readFileSync) e não no spawn do CLI.
    const spawnFn = vi.fn(() => {
      // Remove o arquivo para que, se readFileSync fosse chamado aqui, lançaria.
      // Como estamos substituindo spawn, o readFileSync já ocorreu antes de chegar
      // aqui — o teste real usa um fakeSpawn que lança para forçar o path síncrono.
      return fakeProc();
    }) as any;

    // Para testar o ENOENT síncrono no readFileSync, usamos um specPath que não existe.
    const nonExistentPath = join(tmpdir(), "spec-nao-existe-" + Date.now() + ".md");
    const storeWithMissing = {
      getSnapshot: () => [{
        id: "p1", path: "/x", name: "x", hidden: false,
        specs: [{
          id: "FEAT-006",
          squad: "sdd",
          title: "T",
          phase: "implementation",
          plannedPhases: [],
          status: "running",
          health: { pendingHuman: 0, escalationRate: 0, auditException: false },
          lastActivityAt: null,
          timeline: [],
          cost: {
            totalCostUsd: null, partial: false,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
            totalTokens: 0, reportPath: null, source: "empty",
            scopingSuspect: false, excludedSubagents: null, recoveredSubagents: null,
            byPhase: null, complete: null,
          },
          tasks: [],
          specPath: nonExistentPath,
        }],
      }],
    } as any;

    const send = vi.fn();
    const handle = makeSpecSummaryHandler(storeWithMissing, { cacheRoot: root, spawnFn, now: () => "T0" });

    // Não deve lançar — a exceção deve ser capturada e roteada para onError
    expect(() => {
      handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    }).not.toThrow();

    const msgs = send.mock.calls.map((c: [string]) => JSON.parse(c[0]));
    const err = msgs.find((m: { type: string }) => m.type === "spec-summary:error");
    expect(err).toBeDefined();
    expect(err.message).toMatch(/ENOENT|não encontrado|erro/i);

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});

// ─── AC-009: concorrência — segunda geração cancela a primeira ───────────────

describe("makeSpecSummaryHandler — AC-009 (concurrent)", () => {
  it("segunda geração da mesma feature cancela a primeira", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac009.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const procs: any[] = [];
    const spawnFn = (() => { const p = fakeProc(); procs.push(p); return p; }) as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);

    expect(procs[0].kill).toHaveBeenCalled();

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("close tardio do processo cancelado não apaga o handle do novo", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac009b.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const procs: any[] = [];
    const spawnFn = (() => { const p = fakeProc(); procs.push(p); return p; }) as any;
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send); // proc 0
    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send); // cancela 0, proc 1
    expect(procs[0].kill).toHaveBeenCalled();

    // Processo antigo (0) fecha agora de forma assíncrona
    procs[0].emit("close", null);

    // Terceiro generate ainda deve cancelar o proc 1 (o atual)
    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send); // proc 2
    expect(procs[1].kill).toHaveBeenCalled();

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});

// ─── AC-010: processo morre no meio do stream → não grava cache truncado ─────

describe("makeSpecSummaryHandler — AC-010 (partial-failure)", () => {
  it("processo morre após chunks mas antes do done → emite error, não grava cache", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac010.md");
    writeFileSync(specFile, "spec content");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);

    // Alguns chunks chegam
    proc.stdout.emit("data", Buffer.from(CHUNK_LINE + "\n"));
    proc.stdout.emit("data", Buffer.from(CHUNK_LINE + "\n"));

    // Processo morre com código não-zero (sem emitir done)
    proc.emit("close", 1);

    const msgs = send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.some((m) => m.type === "spec-summary:error")).toBe(true);
    expect(msgs.some((m) => m.type === "spec-summary:done")).toBe(false);

    // Cache não deve ter sido gravado
    const send2 = vi.fn();
    handle({ type: "spec-summary:fetch", projectId: "p1", specId: "FEAT-006" }, send2);
    expect(send2).not.toHaveBeenCalled();

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });

  it("processo morre com código 0 mas sem done → emite error, não grava cache", () => {
    const root = mkdtempSync(join(tmpdir(), "sh-"));
    const specFile = join(tmpdir(), "spec-ac010b.md");
    writeFileSync(specFile, "spec");
    const store = { getSnapshot: () => [specProj(specFile)] } as any;

    const proc = fakeProc();
    const send = vi.fn();
    const handle = makeSpecSummaryHandler(store, { cacheRoot: root, spawnFn: (() => proc) as any, now: () => "T0" });

    handle({ type: "spec-summary:generate", projectId: "p1", specId: "FEAT-006", model: "haiku" }, send);
    proc.stdout.emit("data", Buffer.from(CHUNK_LINE + "\n"));
    proc.emit("close", 0); // código 0 mas sem resultado

    const msgs = send.mock.calls.map((c) => JSON.parse(c[0]));
    expect(msgs.some((m) => m.type === "spec-summary:error")).toBe(true);

    const send2 = vi.fn();
    handle({ type: "spec-summary:fetch", projectId: "p1", specId: "FEAT-006" }, send2);
    expect(send2).not.toHaveBeenCalled();

    rmSync(root, { recursive: true, force: true });
    rmSync(specFile, { force: true });
  });
});
