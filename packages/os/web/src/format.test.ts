import { describe, it, expect } from "vitest";
import { fmtTokens, fmtUsd, fmtDate, fmtRelativeTime } from "./format";

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

describe("fmtDate", () => {
  it("ISO válido retorna string dd/mm/aaaa em pt-BR", () => {
    expect(fmtDate("2026-06-12T10:00:00Z")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
  it("null vira travessão", () => {
    expect(fmtDate(null)).toBe("—");
  });
  it("string inválida vira travessão", () => {
    expect(fmtDate("nao-e-uma-data")).toBe("—");
  });
});

describe("fmtRelativeTime", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  it("mostra segundos como 'agora'", () => {
    expect(fmtRelativeTime("2026-06-01T11:59:30Z", now)).toBe("agora");
  });
  it("mostra minutos", () => {
    expect(fmtRelativeTime("2026-06-01T11:54:00Z", now)).toBe("há 6 min");
  });
  it("mostra horas", () => {
    expect(fmtRelativeTime("2026-06-01T09:00:00Z", now)).toBe("há 3 h");
  });
  it("mostra dias", () => {
    expect(fmtRelativeTime("2026-05-30T12:00:00Z", now)).toBe("há 2 dias");
  });
  it("1 dia no singular", () => {
    expect(fmtRelativeTime("2026-05-31T12:00:00Z", now)).toBe("há 1 dia");
  });
  it("null vira travessão", () => {
    expect(fmtRelativeTime(null, now)).toBe("—");
  });
  it("data inválida vira travessão", () => {
    expect(fmtRelativeTime("nao-e-data", now)).toBe("—");
  });
});
