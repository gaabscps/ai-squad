import { describe, it, expect } from "vitest";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel, acClassificationSummary } from "./deliveryLabels";

describe("deliveryLabels", () => {
  it("traduz as 11 chaves e o veredicto", () => {
    expect(answerTitle("what_was_done")).toBe("O que foi entregue");
    expect(answerTitle("final_verdict")).toBe("Veredicto final");
    expect(verdictLabel("approved_with_caveats")).toEqual({ label: "Aprovado com ressalvas", cls: "caveats" });
  });

  it("confidence e classification com cor", () => {
    expect(confidenceLabel("not_recorded")).toEqual({ label: "não registrado", cls: "not-recorded" });
    expect(classificationLabel("partially_met")).toEqual({ label: "parcialmente atendido", cls: "partial" });
  });

  it("fallback: enum/chave desconhecidos mostram o valor cru, cls 'unknown'", () => {
    expect(answerTitle("nova_chave")).toBe("nova_chave");
    expect(verdictLabel("shipped_to_mars")).toEqual({ label: "shipped_to_mars", cls: "unknown" });
    expect(confidenceLabel("")).toEqual({ label: "—", cls: "unknown" });
    expect(classificationLabel("kinda_met")).toEqual({ label: "kinda_met", cls: "unknown" });
  });
});

describe("acClassificationSummary", () => {
  it("resume contagens por classificação, na ordem canônica, pluralizando", () => {
    const acs = [
      { classification: "met" }, { classification: "met" },
      { classification: "partially_met" }, { classification: "not_met" },
    ];
    expect(acClassificationSummary(acs)).toBe("2 atendidos · 1 parcialmente atendido · 1 não atendido");
  });

  it("vazio → string vazia", () => {
    expect(acClassificationSummary([])).toBe("");
  });

  it("classificação desconhecida entra após as canônicas", () => {
    const acs = [{ classification: "new_enum" }, { classification: "met" }];
    expect(acClassificationSummary(acs)).toBe("1 atendido · 1 new_enum");
  });
});
