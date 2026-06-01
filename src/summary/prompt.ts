import type { Task } from "../store/types.js";

const TONE = [
  "Você explica para um dev front-end (~3 anos) que estuda nestas explicações.",
  "Seja técnico, mas didático: diga o QUE foi feito, o PORQUÊ e o MECANISMO por baixo.",
  "Defina todo termo fora do domínio front na primeira aparição, com uma analogia curta do cotidiano.",
  "Comece pelo concreto, depois abstraia. Português claro e conectado, sem estilo telegráfico.",
  "Não invente o que não está nos dados. Responda só com o resumo, em 1 a 3 parágrafos curtos.",
].join(" ");

/** Serializa os dispatches da task em texto legível pro modelo (dados do Store, sem ler disco). */
function tasksData(task: Task): string {
  if (task.dispatches.length === 0) return "(sem dispatches registrados)";
  return task.dispatches
    .map((d) => {
      const parts = [`- ${d.role} (loop ${d.loop}, status ${d.status})`];
      if (d.summary) parts.push(`  resumo: ${d.summary}`);
      if (d.filesChanged.length) parts.push(`  arquivos: ${d.filesChanged.join(", ")}`);
      for (const f of d.findings) parts.push(`  finding [${f.severity}] ${f.file ?? ""}${f.line != null ? `:${f.line}` : ""} ${f.text}`);
      for (const t of d.testEvidence) parts.push(`  teste ${t.passed === true ? "ok" : t.passed === false ? "falhou" : "?"}: ${t.command}`);
      return parts.join("\n");
    })
    .join("\n");
}

/** Monta o prompt completo: instrução de tom + contexto da task. */
export function buildSummaryPrompt(specTitle: string, task: Task): string {
  return [
    TONE,
    "",
    `Feature: ${specTitle}`,
    `Tarefa: ${task.id} (estado: ${task.state}, loops: ${task.loops})`,
    "",
    "O que os agentes registraram nesta tarefa:",
    tasksData(task),
    "",
    "Explique, para esse dev, o que foi feito nesta tarefa.",
  ].join("\n");
}
