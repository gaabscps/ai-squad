import { describe, it, expect } from "vitest";
import { modelLabel } from "./modelLabel";

describe("modelLabel — modelos conhecidos", () => {
  it("converte haiku com data de versão: claude-haiku-4-5-20251001 → 'Haiku 4.5'", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("converte sonnet com versão curta: claude-sonnet-4-6 → 'Sonnet 4.6'", () => {
    expect(modelLabel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  it("converte opus com versão curta: claude-opus-4-8 → 'Opus 4.8'", () => {
    expect(modelLabel("claude-opus-4-8")).toBe("Opus 4.8");
  });
});

describe("modelLabel — capitaliza a família corretamente", () => {
  it("capitaliza 'haiku' → 'Haiku'", () => {
    expect(modelLabel("claude-haiku-3-5")).toContain("Haiku");
  });

  it("capitaliza 'sonnet' → 'Sonnet'", () => {
    expect(modelLabel("claude-sonnet-3-7")).toContain("Sonnet");
  });

  it("capitaliza 'opus' → 'Opus'", () => {
    expect(modelLabel("claude-opus-3")).toContain("Opus");
  });
});

describe("modelLabel — junta major.minor corretamente", () => {
  it("junta os dois primeiros segmentos numéricos como major.minor", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("quando há apenas major (sem minor), exibe só o major", () => {
    expect(modelLabel("claude-opus-3")).toBe("Opus 3");
  });
});

describe("modelLabel — valores nulos/vazios retornam string vazia", () => {
  it("retorna '' para null", () => {
    expect(modelLabel(null)).toBe("");
  });

  it("retorna '' para undefined", () => {
    expect(modelLabel(undefined)).toBe("");
  });

  it("retorna '' para string vazia", () => {
    expect(modelLabel("")).toBe("");
  });
});

describe("modelLabel — prefixo claude- é removido", () => {
  it("remove o prefixo 'claude-' antes de capitalizar a família", () => {
    const result = modelLabel("claude-haiku-4-5");
    expect(result).not.toContain("claude");
    expect(result).toBe("Haiku 4.5");
  });
});

describe("modelLabel — edge cases de modelo com sufixo de data", () => {
  it("ignora segmento de data (8 dígitos) e usa apenas major.minor da versão", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  });

  it("id sem prefixo claude- retorna a família capitalizada com versão disponível", () => {
    expect(modelLabel("haiku-4-5")).toBe("Haiku 4.5");
  });
});
