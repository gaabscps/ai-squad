import type { NarrativeSource } from "../narrative/source.js";

function langName(locale: string | null): string {
  return locale && locale.toLowerCase().startsWith("pt") ? "português (pt-BR)" : "english (en)";
}

const CONTRACT = `{
  "tldr": "uma frase: o que esta sessão produziu ou explorou",
  "decided": [{ "what": "a decisão", "why": "o porquê ou null", "rejected": "a alternativa descartada ou null" }],
  "open": ["pergunta que ficou sem resposta"],
  "next": ["ação que a pessoa assumiu fazer"],
  "deliverable": "1 frase nomeando o artefato concreto; OU 'Sessão exploratória — sem decisão/entregável fechado'"
}`;

/**
 * Monta o prompt do resumo de PRODUTO: persona de produto + a "receita" validada por
 * red-team (regras anti-invenção, fallback honesto, separação decidido/aberto/próximo).
 * Reusa a NarrativeSource do OBS — usa intent + reasoning (transcript destilado) como
 * fonte principal; edits/verifications dev são ignorados de propósito.
 */
export function buildProductPrompt(source: NarrativeSource, outputLocale: string | null): string {
  const decisionsBlock = source.decisions.length
    ? source.decisions.map((d) => `- ${d.what}${d.why ? ` | porquê: ${d.why}` : ""}${d.rejected ? ` | rejeitado: ${d.rejected}` : ""}`).join("\n")
    : "(nenhuma registrada)";

  return [
    "Você está resumindo uma sessão de trabalho de produto/design feita com IA, para a PRÓPRIA pessoa se organizar (e, se ela quiser, levar adiante). NÃO é relatório para chefe; é a memória dela.",
    "",
    "Regras invioláveis:",
    "1. Linguagem de produto e de negócio. Nunca jargão de engenharia (PR, diff, commit, deploy, teste, pipeline). E nunca descreva o trabalho pela ótica de quem constrói (técnico, requisito técnico, integração como categoria) — descreva pela necessidade de produto.",
    "2. Use SOMENTE o que está na conversa. Não invente, não complete, não suponha.",
    "3. A linha entre real e não-real: a IA sugeriu e a pessoa aceitou explicitamente = conteúdo legítimo; a IA sugeriu e a pessoa NÃO se comprometeu = não entra; possibilidade em condicional ('se eu decidir', 'talvez') = não é decisão nem próximo passo (se virou dúvida, vai para 'open').",
    "4. Lista sem conteúdo real fica vazia ([]). É legítimo uma sessão não ter decisão, nem pergunta aberta, nem próximo passo. Preencher uma lista vazia com algo cogitado-mas-não-assumido é o PIOR erro.",
    "5. Não repita um item em duas listas. Uma pergunta sem resposta fica só em 'open'; a ação de respondê-la NÃO vira 'next' automaticamente.",
    "6. 'next' só existe quando a pessoa usou verbo de compromisso ('vou fazer X', 'preciso de Y'). Sem isso, [].",
    "7. Em 'deliverable', se a sessão foi exploratória sem nada fechado, escreva exatamente: Sessão exploratória — sem decisão/entregável fechado.",
    "8. Descritivo, nunca avaliativo. Não diga se a sessão foi boa ou ruim, não dê conselhos, não corrija a pessoa.",
    "9. Conciso: cada item é uma frase curta (~20 palavras). No máximo 5 itens por lista; havendo mais decisões REAIS, mantenha todas — o teto é contra redundância, jamais para descartar conteúdo verdadeiro.",
    `10. Escreva toda a prosa em ${langName(outputLocale)}.`,
    "",
    `## Intenção da sessão\n${source.intent || "(não declarada)"}`,
    "",
    `## Decisões já registradas pela pessoa (apoio; podem estar vazias)\n${decisionsBlock}`,
    "",
    `## Conversa da sessão (usuário + assistente) — a fonte principal\n${source.reasoning || "(não disponível)"}`,
    "",
    "## Responda APENAS com um objeto JSON exatamente neste formato (sem texto ao redor):",
    CONTRACT,
  ].join("\n");
}
