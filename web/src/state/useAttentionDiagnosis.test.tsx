import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAttentionDiagnosis } from "./useAttentionDiagnosis";
import type { AttentionClient, AttentionServerMsg } from "./attentionClient";

function fakeClient() {
  let handler: ((m: AttentionServerMsg) => void) | null = null;
  const client: AttentionClient = {
    subscribe: (_k, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: vi.fn(),
    generate: vi.fn(),
  };
  return { client, emit: (m: AttentionServerMsg) => handler && handler(m) };
}

describe("useAttentionDiagnosis", () => {
  it("ao montar, faz fetch", () => {
    const { client } = fakeClient();
    renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    expect(client.fetch).toHaveBeenCalledWith("p", "FEAT-001");
  });

  it("guarda o handoff que chega na mensagem attention:handoff", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    act(() => emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" }));
    expect(result.current.handoff).toBe("COLE ISSO");
  });

  it("acumula chunks no texto e marca streaming", () => {
    const { client, emit } = fakeClient();
    const { result } = renderHook(() => useAttentionDiagnosis("p", "FEAT-001", client));
    act(() => result.current.generate());
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "Parou " }));
    act(() => emit({ type: "attention:chunk", projectId: "p", specId: "FEAT-001", delta: "porque X" }));
    expect(result.current.text).toBe("Parou porque X");
    expect(result.current.state).toBe("streaming");
  });
});
