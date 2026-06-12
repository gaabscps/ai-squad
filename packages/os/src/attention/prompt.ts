import type { AttentionContext } from "./context.js";

const TONE = [
  "Você explica para um dev front-end (~3 anos) que estuda nestas explicações.",
  "Seja técnico, mas didático: diga o QUE, o PORQUÊ e o MECANISMO por baixo.",
  "Defina todo termo fora do domínio front na primeira aparição, com uma analogia curta.",
  "Comece pelo concreto. Português claro e conectado, sem estilo telegráfico.",
  "Use SÓ os dados abaixo. Se não houver dados suficientes para algum bloco, diga isso — NÃO invente.",
].join(" ");

function renderNotes(ctx: AttentionContext): string {
  if (ctx.notes.length === 0) return "(sem anotações na linha do tempo)";
  return ctx.notes.map((n) => `- [${n.timestamp}] (${n.kind}) ${n.note}`).join("\n");
}

function renderFindings(ctx: AttentionContext): string {
  if (ctx.findings.length === 0) return "(sem findings de review)";
  return ctx.findings.map((f) => `- [${f.severity}] ${f.loc ?? ""} ${f.text}`).join("\n");
}

/** Monta o prompt one-shot de diagnóstico: tom didático + contexto + pedido em 3 blocos. */
export function buildDiagnosisPrompt(ctx: AttentionContext): string {
  return [
    TONE,
    "",
    `Feature: ${ctx.title} (${ctx.specId})`,
    `Status: ${ctx.status}${ctx.auditException ? " + exceção de auditoria" : ""}`,
    `Fase atual: ${ctx.phase}`,
    "",
    "Linha do tempo:",
    renderNotes(ctx),
    "",
    "Findings de review:",
    renderFindings(ctx),
    "",
    "Explique, para esse dev, em 3 blocos curtos:",
    "(1) POR QUE parou; (2) O QUE estão te pedindo; (3) PRÓXIMO PASSO concreto.",
    "Se faltar dado para algum bloco, diga explicitamente que não há informação suficiente.",
  ].join("\n");
}
