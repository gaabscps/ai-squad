import { describe, it, expect } from "vitest";
import { fmtTokens, fmtUsd } from "./format";

describe("fmtTokens", () => {
  it("milhões com 1 casa", () => {
    expect(fmtTokens(1_400_000)).toBe("1.4M");
  });
  it("milhares arredondados com K", () => {
    expect(fmtTokens(775_000)).toBe("775K");
  });
  it("abaixo de mil, número cru", () => {
    expect(fmtTokens(350)).toBe("350");
  });
});

describe("fmtUsd", () => {
  it("2 casas com prefixo", () => {
    expect(fmtUsd(0.5)).toBe("US$ 0.50");
  });
  it("null vira travessão", () => {
    expect(fmtUsd(null)).toBe("—");
  });
});
