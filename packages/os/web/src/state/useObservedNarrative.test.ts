import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useObservedNarrative } from "./useObservedNarrative";
import type { NarrativeClient, NarrativeServerMsg } from "./narrativeClient";

function fakeClient(): NarrativeClient & { emit: (m: NarrativeServerMsg) => void } {
  let handler: ((m: NarrativeServerMsg) => void) | null = null;
  return {
    subscribe: (_k, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: () => {},
    generate: () => {},
    emit: (m) => handler?.(m),
  };
}
const N = { tldr: "x", why: "", changes: [], decisions: [], verifications: [], prReview: { groups: [], risk: null } };

describe("useObservedNarrative", () => {
  it("começa empty e vira ready no done", () => {
    const client = fakeClient();
    const { result } = renderHook(() => useObservedNarrative("p", "OBS-1", client));
    expect(result.current.state).toBe("empty");
    act(() => client.emit({ type: "narrative:done", projectId: "p", specId: "OBS-1", narrative: N, generatedAt: "T", costUsd: 0.01 }));
    expect(result.current.state).toBe("ready");
    expect(result.current.narrative?.tldr).toBe("x");
  });
  it("cached com stale=true vira stale", () => {
    const client = fakeClient();
    const { result } = renderHook(() => useObservedNarrative("p", "OBS-1", client));
    act(() => client.emit({ type: "narrative:cached", projectId: "p", specId: "OBS-1", narrative: N, stale: true }));
    expect(result.current.state).toBe("stale");
  });
});
