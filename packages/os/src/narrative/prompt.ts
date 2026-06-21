import type { NarrativeSource } from "./source.js";

const MAX_PATCH_LINES = 40;

function langName(locale: string | null): string {
  return locale && locale.toLowerCase().startsWith("pt") ? "português (pt-BR)" : "english (en)";
}

function truncatePatch(patch: string | null): string {
  if (!patch) return "(sem diff materializado)";
  const lines = patch.split("\n");
  return lines.length <= MAX_PATCH_LINES ? patch : lines.slice(0, MAX_PATCH_LINES).join("\n") + "\n… (diff truncado)";
}

const CONTRACT = `{
  "tldr": "uma frase: o que esta sessão entregou",
  "why": "um parágrafo curto: o problema/intenção por trás",
  "changes": [{ "title": "frente lógica (não um arquivo)", "prose": "o que e como, curto", "files": ["arquivos tocados"], "primaryFile": "o arquivo cujo diff abre por padrão (ou null)" }],
  "decisions": [{ "what": "a escolha", "why": "o critério ou null", "tradeoff": "a perda assumida ou null" }],
  "verifications": [{ "cmd": "comando de teste/build", "passed": true }],
  "prReview": { "groups": [{ "label": "grupo de arquivos", "files": ["..."], "lookFirst": true }], "risk": "onde está o maior risco, ou null" }
}`;

/** Monta o prompt: persona dev→tech lead + dados híbridos + contrato JSON estrito. */
export function buildNarrativePrompt(source: NarrativeSource, outputLocale: string | null): string {
  const editsBlock = source.edits.length
    ? source.edits.map((e) => `### ${e.path} (+${e.added ?? "?"} −${e.removed ?? "?"})\n${truncatePatch(e.patch)}`).join("\n\n")
    : "(nenhuma edição registrada)";
  const verifsBlock = source.verifications.length ? source.verifications.map((v) => `- ${v}`).join("\n") : "(nenhuma)";
  const decisionsBlock = source.decisions.length
    ? source.decisions.map((d) => `- ${d.what}${d.why ? ` | porquê: ${d.why}` : ""}${d.rejected ? ` | rejeitado: ${d.rejected}` : ""}`).join("\n")
    : "(nenhuma registrada)";

  return [
    "Você é o desenvolvedor que fez este trabalho, apresentando ao seu tech lead o que foi feito nesta sessão.",
    "Objetivo: o líder entende a sessão SEM ler código linha a linha, e chega na revisão da PR sabendo o que esperar.",
    "Seja CONCISO e REAL. Não invente nada que não esteja nos dados. Não escreva código nas respostas — referencie arquivos.",
    "Agrupe por mudança lógica (frente), não por arquivo. Em 'verifications', inclua só verificação de verdade (teste/build/typecheck).",
    `Escreva toda a prosa em ${langName(outputLocale)}.`,
    "",
    `## Intenção da sessão\n${source.intent || "(não declarada)"}`,
    "",
    `## Diffs reais (o que/como)\n${editsBlock}`,
    "",
    `## Comandos de verificação detectados\n${verifsBlock}`,
    "",
    `## Decisões registradas\n${decisionsBlock}`,
    "",
    `## Raciocínio do desenvolvedor durante a sessão (use para o 'porquê')\n${source.reasoning || "(não disponível)"}`,
    "",
    "## Responda APENAS com um objeto JSON exatamente neste formato (sem texto ao redor):",
    CONTRACT,
  ].join("\n");
}
