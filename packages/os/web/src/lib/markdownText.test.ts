import { describe, it, expect } from "vitest";
import { firstSentence } from "./markdownText";

describe("firstSentence", () => {
  it("extrai a primeira frase de prosa simples", () => {
    expect(firstSentence("Foi entregue X. Depois Y.")).toBe("Foi entregue X.");
  });
  it("remove marcação markdown", () => {
    expect(firstSentence("**Foi** `entregue` [X](http://a). Resto.")).toBe("Foi entregue X.");
  });
  it("trunca em max chars com reticências", () => {
    const long = "a".repeat(300) + ".";
    expect(firstSentence(long, 50)).toHaveLength(50);
    expect(firstSentence(long, 50).endsWith("…")).toBe(true);
  });
  it("texto sem pontuação final: devolve o que há", () => {
    expect(firstSentence("sem ponto final")).toBe("sem ponto final");
  });
  it("lista numerada: teaser é o conteúdo do primeiro item, não '1.'", () => {
    expect(firstSentence("1. Implementou o coletor.\n2. Outra coisa.")).toBe("Implementou o coletor.");
  });
});
