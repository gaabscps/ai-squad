import { describe, it, expect, vi } from "vitest";
import { debounce } from "../src/collector/watcher.js";

describe("debounce", () => {
  it("colapsa uma rajada numa única chamada após o silêncio", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);

    d();
    d();
    d(); // rajada de 3
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled(); // ainda dentro da janela

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1); // 3 chamadas → 1 reação

    vi.useRealTimers();
  });

  it("dispara de novo após uma nova rajada", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 200);

    d();
    vi.advanceTimersByTime(200);
    d();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
