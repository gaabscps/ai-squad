const TONE = [
  "Você resume uma feature de software para um dev front-end (~3 anos) em pt-BR.",
  "Cubra o problema (Problem) e o objetivo (Goal) da feature de forma clara e conectada.",
  "Seja didático: explique o PORQUÊ e o mecanismo, não só o QUÊ.",
  "Comece pelo concreto, depois abstraia. Português claro, sem estilo telegráfico.",
  "Não invente o que não está no spec. Responda só com o resumo, em 1 a 3 parágrafos curtos.",
].join(" ");

/** Monta o prompt completo: instrução de tom + conteúdo do spec.md. */
export function buildSpecSummaryPrompt(specContent: string): string {
  return [
    TONE,
    "",
    "Conteúdo do spec.md:",
    specContent,
    "",
    "Escreva o resumo em prosa da feature acima.",
  ].join("\n");
}
