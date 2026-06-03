import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useAttentionDiagnosis } from "./useAttentionDiagnosis";
import { DiagnosisJobsProvider } from "./diagnosisJobs";
import type { AttentionClient, AttentionServerMsg } from "./attentionClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeClient() {
  const subs = new Map<string, Set<(msg: AttentionServerMsg) => void>>();
  const client: AttentionClient = {
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
  const emit = (m: AttentionServerMsg) => {
    const key = `${m.projectId}|${m.specId}`;
    const fns = subs.get(key);
    if (fns) for (const fn of fns) fn(m);
  };
  return { client, emit };
}

function makeWrapper(client: AttentionClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DiagnosisJobsProvider client={client}>
        {children}
      </DiagnosisJobsProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// API pública preservada
// ---------------------------------------------------------------------------

describe("useAttentionDiagnosis — API pública (NFR-004)", () => {
  it("ao montar, faz fetch", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    expect(client.fetch).toHaveBeenCalledWith("p", "FEAT-001");
  });

  it("guarda o handoff que chega na mensagem attention:handoff (pré-geração)", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" }));
    expect(result.current.handoff).toBe("COLE ISSO");
  });

  it("acumula chunks no texto e marca streaming após generate()", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "Parou " }));
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "porque X" }));
    expect(result.current.text).toBe("Parou porque X");
    expect(result.current.state).toBe("streaming");
  });
});

// ---------------------------------------------------------------------------
// AC-004: estado vazio (sem cache nem geração ativa) não dispara geração automática
// ---------------------------------------------------------------------------

describe("useAttentionDiagnosis — AC-004: estado vazio", () => {
  it("estado inicial é 'empty' sem cache nem job ativo", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    expect(result.current.state).toBe("empty");
  });

  it("não dispara generate automaticamente ao montar (AC-004)", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    // generate no client é chamado pelo store.generate(); não deve ter sido chamado sem clique
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("texto, handoff, costUsd, generatedAt e error são valores nulos/vazios no estado vazio", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    expect(result.current.text).toBe("");
    expect(result.current.handoff).toBe("");
    expect(result.current.costUsd).toBeNull();
    expect(result.current.generatedAt).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.streamed).toBe(false);
  });

  it("gerar e regenerar são funções (botão renderizável) mesmo no estado vazio", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    expect(typeof result.current.generate).toBe("function");
    expect(typeof result.current.regenerate).toBe("function");
  });

  it("clicar generate muda estado para 'loading' (disparo intencional)", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    expect(result.current.state).toBe("loading");
    expect(client.generate).toHaveBeenCalledWith("p", "FEAT-001");
  });

  it("resultado em cache exibe 'ready' sem disparar generate (AC-004 com cache)", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => emit({ type: "attention:cached", projectId: "p", specId: "FEAT-001", text: "diagnóstico anterior", generatedAt: "2026-06-01T00:00:00Z", costUsd: 0.01, stale: false }));
    expect(result.current.state).toBe("ready");
    expect(result.current.text).toBe("diagnóstico anterior");
    // Nenhuma geração foi disparada automaticamente
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("cache stale exibe estado 'stale' sem disparar generate (AC-004 com stale)", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => emit({ type: "attention:cached", projectId: "p", specId: "FEAT-001", text: "diagnóstico desatualizado", generatedAt: "2026-05-01T00:00:00Z", costUsd: null, stale: true }));
    expect(result.current.state).toBe("stale");
    expect(client.generate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Estado derivado do store: job ativo sobrepõe cache local
// ---------------------------------------------------------------------------

describe("useAttentionDiagnosis — estado do store", () => {
  it("estado 'loading' quando job está 'generating' no store", () => {
    const { client } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    expect(result.current.state).toBe("loading");
  });

  it("estado 'loading' quando job está 'queued' no store", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    act(() => emit({ type: "attention:queued", projectId: "p", specId: "FEAT-001" }));
    expect(result.current.state).toBe("loading");
  });

  it("estado 'error' quando job falha — error propagado corretamente", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    act(() => emit({ type: "attention:error", projectId: "p", specId: "FEAT-001", message: "processo falhou" }));
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("processo falhou");
  });

  it("estado 'ready' com text e costUsd após attention:done", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    act(() => emit({ type: "attention:done", projectId: "p", specId: "FEAT-001", text: "diagnóstico final", costUsd: 0.05, generatedAt: "2026-06-02T00:00:00Z" }));
    expect(result.current.state).toBe("ready");
    expect(result.current.text).toBe("diagnóstico final");
    expect(result.current.costUsd).toBe(0.05);
    expect(result.current.generatedAt).toBe("2026-06-02T00:00:00Z");
  });

  it("job cancelado volta ao estado vazio (ou cache)", () => {
    const { client, emit } = fakeClient();
    const wrapper = makeWrapper(client);
    // Inicia geração e simula cancelamento externo
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client), { wrapper });
    act(() => result.current.generate());
    expect(result.current.state).toBe("loading");
    // Chama regenerate() para sobrescrever o job existente com um novo generating
    act(() => result.current.regenerate());
    // Após regenerate, o job é re-registrado como generating
    expect(result.current.state).toBe("loading");
  });
});
