import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskSummary } from "./useTaskSummary";
import type { SummaryClient, SummaryServerMsg } from "./summaryClient";

function fakeClient() {
  let handler: ((m: SummaryServerMsg) => void) | null = null;
  const client: SummaryClient = {
    subscribe: (_key, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: vi.fn(),
    generate: vi.fn(),
  };
  return { client, emit: (m: SummaryServerMsg) => handler?.(m) };
}

describe("useTaskSummary", () => {
  it("começa em empty e faz fetch ao montar", () => {
    const { client } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("proj-1", "FEAT-001", "T-001", client));
    expect(result.current.state).toBe("empty");
    expect(client.fetch).toHaveBeenCalledWith("proj-1", "FEAT-001", "T-001");
  });

  it("cached não-stale → ready com texto", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("proj-1", "FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:cached", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", text: "oi", generatedAt: "T0", stale: false }));
    expect(result.current.state).toBe("ready");
    expect(result.current.text).toBe("oi");
  });

  it("cached stale → state stale", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("proj-1", "FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:cached", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", text: "velho", generatedAt: "T0", stale: true }));
    expect(result.current.state).toBe("stale");
  });

  it("generate() → loading, chunks acumulam → streaming, done → ready", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("proj-1", "FEAT-001", "T-001", client));
    act(() => result.current.generate());
    expect(result.current.state).toBe("loading");
    expect(client.generate).toHaveBeenCalledWith("proj-1", "FEAT-001", "T-001", false);
    act(() => emit({ type: "summary:chunk", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", delta: "Re" }));
    act(() => emit({ type: "summary:chunk", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", delta: "sumo" }));
    expect(result.current.state).toBe("streaming");
    expect(result.current.text).toBe("Resumo");
    act(() => emit({ type: "summary:done", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", text: "Resumo", generatedAt: "T1" }));
    expect(result.current.state).toBe("ready");
  });

  it("error → state error com mensagem", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useTaskSummary("proj-1", "FEAT-001", "T-001", client));
    act(() => emit({ type: "summary:error", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", message: "falhou" }));
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("falhou");
  });
});
