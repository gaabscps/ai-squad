import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTypewriter } from "./useTypewriter";

// O reveal usa setTimeout; fake timers deixam a gente avançar os ticks de propósito.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const drain = () => act(() => { vi.advanceTimersByTime(5000); });

describe("useTypewriter", () => {
  it("animate=false: devolve o texto inteiro na hora", () => {
    const { result } = renderHook(() => useTypewriter("olá mundo", false));
    expect(result.current).toBe("olá mundo");
  });

  it("animate=true: começa vazio e revela até o fim ao avançar os timers", () => {
    const { result } = renderHook(() => useTypewriter("abcdefghij", true));
    expect(result.current).toBe(""); // nada revelado antes do primeiro tick
    drain();
    expect(result.current).toBe("abcdefghij");
  });

  it("revela progressivamente (estado intermediário menor que o total)", () => {
    const { result } = renderHook(() => useTypewriter("a".repeat(100), true));
    act(() => { vi.advanceTimersByTime(20); }); // só 1 tick
    expect(result.current.length).toBeGreaterThan(0);
    expect(result.current.length).toBeLessThan(100);
  });

  it("continua de onde parou quando o target cresce (novo chunk)", () => {
    const { result, rerender } = renderHook(({ t, a }) => useTypewriter(t, a), { initialProps: { t: "abc", a: true } });
    drain();
    expect(result.current).toBe("abc");
    rerender({ t: "abcdefghijklmnop", a: true });
    drain();
    expect(result.current).toBe("abcdefghijklmnop");
  });
});
