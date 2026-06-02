import type { AttentionContext } from "./context.js";

function renderNotes(ctx: AttentionContext): string {
  if (ctx.notes.length === 0) return "(sem anotações)";
  return ctx.notes.map((n) => `- [${n.timestamp}] (${n.kind}) ${n.note}`).join("\n");
}

function renderFindings(ctx: AttentionContext): string {
  if (ctx.findings.length === 0) return "(sem findings)";
  return ctx.findings.map((f) => `- [${f.severity}] ${f.loc ?? ""} ${f.text}`).join("\n");
}

/**
 * Bloco copiável pro Claude Code retomar a feature. Texto puro, SEM IA: junta o
 * contexto que o app já tem e aponta pros artefatos no disco. O usuário cola
 * numa sessão do Claude Code e abre na mão.
 */
export function buildHandoffPrompt(ctx: AttentionContext): string {
  return [
    "Estou retomando uma feature travada no meu pipeline ai-squad.",
    `Projeto: ${ctx.projectPath}`,
    `Spec: ${ctx.specId} — ${ctx.title}`,
    `Status: ${ctx.status}${ctx.auditException ? " (exceção de auditoria)" : ""} · fase ${ctx.phase}`,
    "",
    "Linha do tempo:",
    renderNotes(ctx),
    "",
    "Findings de review:",
    renderFindings(ctx),
    "",
    `Me ajude a entender por que parou e a retomar. Os artefatos estão em ${ctx.projectPath}/.agent-session/${ctx.specId}/.`,
  ].join("\n");
}
