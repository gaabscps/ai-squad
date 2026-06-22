import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProductSummary } from "./useProductSummary";
import type { ProductClient, ProductServerMsg } from "./productClient";

function fakeClient(): ProductClient & { emit: (m: ProductServerMsg) => void } {
  let handler: ((m: ProductServerMsg) => void) | null = null;
  return {
    subscribe: (_k, fn) => { handler = fn; return () => { handler = null; }; },
    fetch: () => {}, generate: () => {},
    emit: (m) => handler?.(m),
  };
}
const S = { tldr: "x", decided: [], open: [], next: [], deliverable: "d" };

describe("useProductSummary source", () => {
  it("propaga source=sealed do product:cached", () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProductSummary("p", "OBS-1", client));
    act(() => client.emit({ type: "product:cached", projectId: "p", specId: "OBS-1", summary: S, stale: false, source: "sealed" }));
    expect(result.current.state).toBe("ready");
    expect(result.current.source).toBe("sealed");
  });
  it("source ausente vira null", () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProductSummary("p", "OBS-1", client));
    act(() => client.emit({ type: "product:cached", projectId: "p", specId: "OBS-1", summary: S, stale: false }));
    expect(result.current.source).toBeNull();
  });
});
