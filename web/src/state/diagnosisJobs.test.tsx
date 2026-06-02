import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  jobsReducer,
  type JobsState,
  type Job,
  DiagnosisJobsProvider,
  useDiagnosisJobs,
} from "./diagnosisJobs";
import type { AttentionClient, AttentionServerMsg } from "./attentionClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(over: Partial<Job> = {}): Job {
  return {
    projectId: "proj-abc",
    specId: "FEAT-001",
    state: "generating",
    text: "",
    handoff: null,
    error: null,
    generatedAt: null,
    costUsd: null,
    seen: false,
    ...over,
  };
}

function emptyState(): JobsState {
  return { jobs: {} };
}

// Fake AttentionClient injetável
function fakeClient(): AttentionClient & { emit: (msg: AttentionServerMsg) => void } {
  const subs = new Map<string, Set<(msg: AttentionServerMsg) => void>>();
  return {
    emit(msg: AttentionServerMsg) {
      const key = `${msg.projectId}|${msg.specId}`;
      const fns = subs.get(key);
      if (fns) for (const fn of fns) fn(msg);
    },
    subscribe(key, fn) {
      const set = subs.get(key) ?? new Set();
      set.add(fn);
      subs.set(key, set);
      return () => {
        set.delete(fn);
        if (set.size === 0) subs.delete(key);
      };
    },
    fetch: vi.fn(),
    generate: vi.fn(),
    cancel: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// jobsReducer — unit tests (pure function, sem React)
// ---------------------------------------------------------------------------

describe("jobsReducer", () => {
  it("register cria job com estado 'generating' e texto vazio", () => {
    const s = jobsReducer(emptyState(), {
      type: "register",
      projectId: "proj-abc",
      specId: "FEAT-001",
    });
    const job = s.jobs["proj-abc|FEAT-001"];
    expect(job).toBeDefined();
    expect(job.state).toBe("generating");
    expect(job.text).toBe("");
    expect(job.error).toBeNull();
  });

  it("register de spec já existente sobrescreve o job anterior (AC-020 front)", () => {
    const s0: JobsState = {
      jobs: {
        "proj-abc|FEAT-001": makeJob({ state: "streaming", text: "parcial" }),
      },
    };
    const s1 = jobsReducer(s0, { type: "register", projectId: "proj-abc", specId: "FEAT-001" });
    const job = s1.jobs["proj-abc|FEAT-001"];
    expect(job.state).toBe("generating");
    expect(job.text).toBe(""); // texto resetado
  });

  // AC-017: mensagem attention:queued vinda do servidor coloca o job em 'queued'
  it("queued atualiza estado para 'queued'", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "generating" }) },
    };
    const s1 = jobsReducer(s0, { type: "queued", projectId: "proj-abc", specId: "FEAT-001" });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("queued");
  });

  // AC-001 e AC-003: chunks acumulam independentemente de qual componente está montado
  it("chunk concatena o delta ao texto existente", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "streaming", text: "Olá" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "chunk",
      projectId: "proj-abc",
      specId: "FEAT-001",
      delta: ", mundo",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].text).toBe("Olá, mundo");
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("streaming");
  });

  it("chunk com delta undefined não muda o texto", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "streaming", text: "abc" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "chunk",
      projectId: "proj-abc",
      specId: "FEAT-001",
      delta: undefined,
    });
    expect(s1.jobs["proj-abc|FEAT-001"].text).toBe("abc");
  });

  it("chunk ignorado se chave não existe (job não registrado)", () => {
    const s1 = jobsReducer(emptyState(), {
      type: "chunk",
      projectId: "proj-xyz",
      specId: "FEAT-999",
      delta: "oi",
    });
    expect(s1.jobs["proj-xyz|FEAT-999"]).toBeUndefined();
  });

  it("done marca job como 'ready' com texto e custo finais", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "streaming", text: "parcial" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "done",
      projectId: "proj-abc",
      specId: "FEAT-001",
      text: "texto final",
      costUsd: 0.05,
      generatedAt: "2026-06-02T00:00:00Z",
    });
    const job = s1.jobs["proj-abc|FEAT-001"];
    expect(job.state).toBe("ready");
    expect(job.text).toBe("texto final");
    expect(job.costUsd).toBe(0.05);
    expect(job.generatedAt).toBe("2026-06-02T00:00:00Z");
  });

  it("handoff armazena o texto de handoff e mantém estado 'generating'", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "generating" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "handoff",
      projectId: "proj-abc",
      specId: "FEAT-001",
      text: "handoff text",
    });
    const job = s1.jobs["proj-abc|FEAT-001"];
    expect(job.handoff).toBe("handoff text");
    expect(job.state).toBe("generating");
  });

  it("handoff após cancelamento não grava no job cancelado (invariante terminal)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "cancelled", handoff: null }) },
    };
    const s1 = jobsReducer(s0, {
      type: "handoff",
      projectId: "proj-abc",
      specId: "FEAT-001",
      text: "handoff fantasma",
    });
    const job = s1.jobs["proj-abc|FEAT-001"];
    expect(job.state).toBe("cancelled");
    expect(job.handoff).toBeNull(); // não foi gravado
    expect(s1).toBe(s0); // retornou a mesma referência (imutabilidade)
  });

  // AC-001 invariant: queued in-flight após cancelamento não ressuscita o job
  it("queued após cancelamento não ressuscita job (invariante terminal)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "cancelled" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "queued",
      projectId: "proj-abc",
      specId: "FEAT-001",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("cancelled");
    expect(s1).toBe(s0); // retornou a mesma referência (imutabilidade)
  });

  // AC-005: erro de um job não afeta outros jobs
  it("error marca só o job afetado como 'error' e preserva outros jobs intactos", () => {
    const s0: JobsState = {
      jobs: {
        "proj-abc|FEAT-001": makeJob({ projectId: "proj-abc", specId: "FEAT-001", state: "streaming" }),
        "proj-abc|FEAT-002": makeJob({ projectId: "proj-abc", specId: "FEAT-002", state: "streaming", text: "ok" }),
      },
    };
    const s1 = jobsReducer(s0, {
      type: "error",
      projectId: "proj-abc",
      specId: "FEAT-001",
      message: "processo falhou",
    });
    // job afetado virou error
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("error");
    expect(s1.jobs["proj-abc|FEAT-001"].error).toBe("processo falhou");
    // outro job permanece intacto
    expect(s1.jobs["proj-abc|FEAT-002"].state).toBe("streaming");
    expect(s1.jobs["proj-abc|FEAT-002"].text).toBe("ok");
  });

  it("error em job inexistente não cria entrada no store (defensivo)", () => {
    const s1 = jobsReducer(emptyState(), {
      type: "error",
      projectId: "proj-xyz",
      specId: "FEAT-999",
      message: "fail",
    });
    expect(s1.jobs["proj-xyz|FEAT-999"]).toBeUndefined();
  });

  it("cancelled marca job como 'cancelled'", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "generating" }) },
    };
    const s1 = jobsReducer(s0, { type: "cancelled", projectId: "proj-abc", specId: "FEAT-001" });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("cancelled");
  });

  // AC-001 invariant: chunk in-flight após cancelamento NÃO ressuscita o job
  it("chunk após cancelamento não ressuscita job para 'streaming' (invariante terminal)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "cancelled", text: "parcial" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "chunk",
      projectId: "proj-abc",
      specId: "FEAT-001",
      delta: "novo chunk",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("cancelled");
    expect(s1.jobs["proj-abc|FEAT-001"].text).toBe("parcial"); // texto não alterado
  });

  // Por simetria: done in-flight após cancelamento não muda estado
  it("done após cancelamento não muda estado do job (invariante terminal)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "cancelled" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "done",
      projectId: "proj-abc",
      specId: "FEAT-001",
      text: "texto final",
      costUsd: 0.01,
      generatedAt: "2026-06-02T00:00:00Z",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("cancelled");
  });

  // Por simetria: error in-flight após cancelamento não muda estado
  it("error após cancelamento não muda estado do job (invariante terminal)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "cancelled" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "error",
      projectId: "proj-abc",
      specId: "FEAT-001",
      message: "processo falhou",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("cancelled");
  });

  // AC-003: estado persiste por chave — múltiplos jobs coexistem sem interferência
  it("dois jobs em chaves distintas são completamente independentes no estado", () => {
    let s = emptyState();
    s = jobsReducer(s, { type: "register", projectId: "proj-a", specId: "FEAT-001" });
    s = jobsReducer(s, { type: "register", projectId: "proj-b", specId: "FEAT-002" });
    s = jobsReducer(s, { type: "chunk", projectId: "proj-a", specId: "FEAT-001", delta: "A" });
    s = jobsReducer(s, { type: "chunk", projectId: "proj-b", specId: "FEAT-002", delta: "B" });
    expect(s.jobs["proj-a|FEAT-001"].text).toBe("A");
    expect(s.jobs["proj-b|FEAT-002"].text).toBe("B");
    // erro em proj-a não mexe em proj-b (proj-b está streaming após o chunk)
    s = jobsReducer(s, { type: "error", projectId: "proj-a", specId: "FEAT-001", message: "boom" });
    expect(s.jobs["proj-a|FEAT-001"].state).toBe("error");
    expect(s.jobs["proj-b|FEAT-002"].state).toBe("streaming"); // ficou streaming pelo chunk anterior
  });

  it("done preserva jobs de outras chaves inalterados (AC-005 via done)", () => {
    const s0: JobsState = {
      jobs: {
        "proj-a|FEAT-001": makeJob({ projectId: "proj-a", specId: "FEAT-001", state: "streaming" }),
        "proj-b|FEAT-002": makeJob({ projectId: "proj-b", specId: "FEAT-002", state: "generating" }),
      },
    };
    const s1 = jobsReducer(s0, {
      type: "done",
      projectId: "proj-a",
      specId: "FEAT-001",
      text: "final",
      costUsd: null,
      generatedAt: null,
    });
    expect(s1.jobs["proj-a|FEAT-001"].state).toBe("ready");
    expect(s1.jobs["proj-b|FEAT-002"].state).toBe("generating"); // inalterado
  });

  // lr-f001/lr-f002: 'ready' e 'error' são terminais — late messages não revertem o badge
  it("chunk tardio não reverte job 'ready' para 'streaming' (invariante terminal lr-f001)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "ready", text: "texto final" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "chunk",
      projectId: "proj-abc",
      specId: "FEAT-001",
      delta: "chunk tardio",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("ready");
    expect(s1.jobs["proj-abc|FEAT-001"].text).toBe("texto final"); // texto não alterado
    expect(s1).toBe(s0); // referência imutável — nada mudou
  });

  it("queued tardio não reverte job 'ready' para 'queued' (invariante terminal lr-f001)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "ready" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "queued",
      projectId: "proj-abc",
      specId: "FEAT-001",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("ready");
    expect(s1).toBe(s0);
  });

  it("chunk tardio não reverte job 'error' para 'streaming' (invariante terminal lr-f002)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "error", error: "falhou" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "chunk",
      projectId: "proj-abc",
      specId: "FEAT-001",
      delta: "chunk tardio",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("error");
    expect(s1).toBe(s0);
  });

  it("queued tardio não reverte job 'error' para 'queued' (invariante terminal lr-f002)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "error" }) },
    };
    const s1 = jobsReducer(s0, {
      type: "queued",
      projectId: "proj-abc",
      specId: "FEAT-001",
    });
    expect(s1.jobs["proj-abc|FEAT-001"].state).toBe("error");
    expect(s1).toBe(s0);
  });

  // Imutabilidade: reducer não muta o estado original
  it("reducer não muta o objeto de estado original", () => {
    const s0 = emptyState();
    const s1 = jobsReducer(s0, { type: "register", projectId: "proj-abc", specId: "FEAT-001" });
    expect(s1).not.toBe(s0);
    expect(s1.jobs).not.toBe(s0.jobs);
    expect(s0.jobs).toEqual({}); // s0 intocado
  });
});

// ---------------------------------------------------------------------------
// DiagnosisJobsProvider — testes de integração do Context (jsdom)
// ---------------------------------------------------------------------------

describe("DiagnosisJobsProvider", () => {
  let client: ReturnType<typeof fakeClient>;

  beforeEach(() => {
    client = fakeClient();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <DiagnosisJobsProvider client={client}>
        {children}
      </DiagnosisJobsProvider>
    );
  }

  // AC-001: chunks acumulam mesmo sem drawer montado — o Provider está sempre vivo
  it("acumula chunks de attention:chunk sem nenhum drawer montado (AC-001)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => {
      // Registra o job (simula disparo de generate)
      result.current.generate("proj-abc", "FEAT-001");
    });

    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "Olá" });
    });
    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: " mundo" });
    });

    const job = result.current.getJob("proj-abc", "FEAT-001");
    expect(job?.text).toBe("Olá mundo");
    expect(job?.state).toBe("streaming");
  });

  // AC-003: estado persiste por chave projectId|specId
  it("mantém estado de dois jobs em chaves distintas sem interferência (AC-003)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => {
      result.current.generate("proj-abc", "FEAT-001");
      result.current.generate("proj-abc", "FEAT-002");
    });

    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "A" });
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-002", delta: "B" });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.text).toBe("A");
    expect(result.current.getJob("proj-abc", "FEAT-002")?.text).toBe("B");
  });

  // AC-003: estado persiste por chave mesmo após vários chunks
  it("estado do job persiste com múltiplos chunks sucessivos (AC-003)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });

    act(() => {
      for (const delta of ["chunk1 ", "chunk2 ", "chunk3"]) {
        client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta });
      }
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.text).toBe("chunk1 chunk2 chunk3");
  });

  // AC-005: erro de um job não derruba outros jobs
  it("attention:error em um job não afeta outros jobs ativos (AC-005)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => {
      result.current.generate("proj-abc", "FEAT-001");
      result.current.generate("proj-abc", "FEAT-002");
    });

    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-002", delta: "ok" });
    });

    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-abc",
        specId: "FEAT-001",
        message: "processo falhou",
      });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("error");
    expect(result.current.getJob("proj-abc", "FEAT-001")?.error).toBe("processo falhou");
    // FEAT-002 continua streamando sem perturbação
    expect(result.current.getJob("proj-abc", "FEAT-002")?.state).toBe("streaming");
    expect(result.current.getJob("proj-abc", "FEAT-002")?.text).toBe("ok");
  });

  // AC-005: mensagem de erro é preservada corretamente
  it("mensagem de erro é registrada no job (AC-005)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-abc",
        specId: "FEAT-001",
        message: "claude não encontrado no PATH",
      });
    });

    const job = result.current.getJob("proj-abc", "FEAT-001");
    expect(job?.state).toBe("error");
    expect(job?.error).toBe("claude não encontrado no PATH");
  });

  // AC-001: generate chama client.generate
  it("generate despacha registro no store e chama client.generate", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });

    expect(client.generate).toHaveBeenCalledWith("proj-abc", "FEAT-001");
    const job = result.current.getJob("proj-abc", "FEAT-001");
    expect(job?.state).toBe("generating");
  });

  // cancel chama client.cancel e marca job como cancelled
  it("cancel chama client.cancel e marca job como cancelled quando ativo", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => { result.current.cancel("proj-abc", "FEAT-001"); });

    expect(client.cancel).toHaveBeenCalledWith("proj-abc", "FEAT-001");
    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("cancelled");
  });

  // attention:queued atualiza estado para queued
  it("attention:queued do servidor coloca job em estado 'queued'", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({ type: "attention:queued", projectId: "proj-abc", specId: "FEAT-001" });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("queued");
  });

  // attention:done marca job como ready
  it("attention:done marca job como 'ready' com texto e custo", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "parcial" });
    });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "texto final",
        costUsd: 0.02,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    const job = result.current.getJob("proj-abc", "FEAT-001");
    expect(job?.state).toBe("ready");
    expect(job?.text).toBe("texto final");
    expect(job?.costUsd).toBe(0.02);
  });

  // attention:handoff armazena o handoff
  it("attention:handoff armazena texto de handoff", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:handoff",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "handoff content",
      });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.handoff).toBe("handoff content");
  });

  // getJob retorna undefined para chave inexistente (empty case)
  it("getJob retorna undefined para spec sem job registrado", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });
    expect(result.current.getJob("proj-abc", "FEAT-999")).toBeUndefined();
  });

  // AC-001 invariant: chunk after cancel no provider level
  it("chunk emitido após cancel não ressuscita job no provider (AC-001 invariante)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => { result.current.cancel("proj-abc", "FEAT-001"); });

    // Job deve estar cancelado
    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("cancelled");

    // Chunk in-flight chega após o cancelamento
    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "chunk fantasma" });
    });

    // Job permanece cancelado, texto não muda
    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("cancelled");
  });

  // lr-f001: chunk tardio (reordenação de rede) após done não reverte job para 'streaming'
  it("chunk tardio após done não reverte job 'ready' no provider (lr-f001)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "texto final",
        costUsd: null,
        generatedAt: null,
      });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("ready");

    // Simula chunk tardio chegando por reordenação de rede após done
    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "tardio" });
    });

    // Estado deve permanecer 'ready' — badge não pode ser destruído
    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("ready");
    expect(result.current.getJob("proj-abc", "FEAT-001")?.text).toBe("texto final");
  });

  // AC-001 race: subscrição deve existir imediatamente após generate(), antes do useEffect
  it("chunk emitido sincronamente após generate() é capturado sem depender do useEffect (AC-001 race)", () => {
    let capturedGenerate: (() => void) | null = null;
    // Intercepta client.generate para emitir o chunk imediatamente, antes do React committar
    const racyClient: AttentionClient & { emit: (msg: AttentionServerMsg) => void } = {
      ...client,
      generate(projectId: string, specId: string) {
        capturedGenerate = () => {
          client.emit({ type: "attention:chunk", projectId, specId, delta: "imediato" });
        };
        client.generate(projectId, specId);
      },
    };

    function racyWrapper({ children }: { children: ReactNode }) {
      return (
        <DiagnosisJobsProvider client={racyClient}>
          {children}
        </DiagnosisJobsProvider>
      );
    }

    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper: racyWrapper });

    act(() => {
      result.current.generate("proj-abc", "FEAT-001");
      // Emite o chunk no mesmo tick que generate() — simula servidor muito rápido
      capturedGenerate?.();
    });

    // O chunk deve ter sido capturado mesmo sem o useEffect ter rodado antes
    expect(result.current.getJob("proj-abc", "FEAT-001")?.text).toBe("imediato");
  });
});

// ---------------------------------------------------------------------------
// seen / markSeen — testes do reducer (AC-002, AC-004, AC-005)
// ---------------------------------------------------------------------------

describe("jobsReducer — seen / markSeen", () => {
  it("register cria job com seen=false por padrão", () => {
    const s = jobsReducer(emptyState(), {
      type: "register",
      projectId: "proj-abc",
      specId: "FEAT-001",
    });
    expect(s.jobs["proj-abc|FEAT-001"].seen).toBe(false);
  });

  it("markSeen seta seen=true para job existente (AC-002, AC-005)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "ready", seen: false }) },
    };
    const s1 = jobsReducer(s0, { type: "markSeen", projectId: "proj-abc", specId: "FEAT-001" });
    expect(s1.jobs["proj-abc|FEAT-001"].seen).toBe(true);
  });

  it("markSeen é idempotente — segunda chamada retorna mesma referência (AC-002)", () => {
    const s0: JobsState = {
      jobs: { "proj-abc|FEAT-001": makeJob({ state: "ready", seen: true }) },
    };
    const s1 = jobsReducer(s0, { type: "markSeen", projectId: "proj-abc", specId: "FEAT-001" });
    expect(s1).toBe(s0); // mesma referência — estado não mudou
  });

  it("markSeen é no-op para job ausente — não cria entrada (AC-004)", () => {
    const s0 = emptyState();
    const s1 = jobsReducer(s0, { type: "markSeen", projectId: "proj-xyz", specId: "FEAT-999" });
    expect(s1).toBe(s0);
    expect(s1.jobs["proj-xyz|FEAT-999"]).toBeUndefined();
  });

  it("markSeen não afeta outros jobs na mesma store (AC-006)", () => {
    const s0: JobsState = {
      jobs: {
        "proj-a|FEAT-001": makeJob({ projectId: "proj-a", specId: "FEAT-001", state: "ready", seen: false }),
        "proj-b|FEAT-002": makeJob({ projectId: "proj-b", specId: "FEAT-002", state: "error", seen: false }),
      },
    };
    const s1 = jobsReducer(s0, { type: "markSeen", projectId: "proj-a", specId: "FEAT-001" });
    expect(s1.jobs["proj-a|FEAT-001"].seen).toBe(true);
    expect(s1.jobs["proj-b|FEAT-002"].seen).toBe(false); // não afetado
  });
});

describe("DiagnosisJobsProvider — markSeen via hook", () => {
  let client: ReturnType<typeof fakeClient>;

  beforeEach(() => {
    client = fakeClient();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <DiagnosisJobsProvider client={client}>
        {children}
      </DiagnosisJobsProvider>
    );
  }

  it("markSeen exposto no contexto — seta seen=true no job (AC-002)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });

    act(() => { result.current.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "ok",
        costUsd: null,
        generatedAt: null,
      });
    });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.seen).toBe(false);

    act(() => { result.current.markSeen("proj-abc", "FEAT-001"); });

    expect(result.current.getJob("proj-abc", "FEAT-001")?.seen).toBe(true);
    expect(result.current.getJob("proj-abc", "FEAT-001")?.state).toBe("ready");
  });

  it("markSeen no-op para job inexistente — não lança erro (AC-004)", () => {
    const { result } = renderHook(() => useDiagnosisJobs(), { wrapper });
    expect(() => {
      act(() => { result.current.markSeen("proj-xyz", "FEAT-999"); });
    }).not.toThrow();
    expect(result.current.getJob("proj-xyz", "FEAT-999")).toBeUndefined();
  });
});
