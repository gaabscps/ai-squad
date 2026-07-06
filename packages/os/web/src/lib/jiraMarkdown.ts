import type { ProductSummary } from "../../../src/product/types";
import type { SessionNarrative } from "../../../src/narrative/types";

// Metadados do cabeçalho do issue, montados pela ExportPage a partir do spec/sessão.
export interface JiraMeta {
  title: string;     // título da sessão (spec.title)
  specId: string;    // id da sessão (spec.id), ex. OBS-011
  labels: string[];  // labels sugeridas, ex. ["work-type:product", "lang:pt-BR"]
}

// Converte o resumo de produto na descrição Markdown de um issue do Jira.
export function productSummaryToJira(s: ProductSummary, meta: JiraMeta): string {
  const lines: string[] = [];
  lines.push(`**Sessão:** ${meta.specId} — ${meta.title}`);
  lines.push("");

  if (s.deliverable) {
    lines.push(`**Entregável:** ${s.deliverable}`);
    lines.push("");
  }

  if (s.decided.length > 0) {
    lines.push("## Decisões");
    for (const d of s.decided) {
      let line = `- **${d.what}**`;
      if (d.why) line += ` — ${d.why}`;
      if (d.rejected) line += ` _(descartado: ${d.rejected})_`;
      lines.push(line);
    }
    lines.push("");
  }

  if (s.open.length > 0) {
    lines.push("## Em aberto");
    for (const q of s.open) lines.push(`- ${q}`);
    lines.push("");
  }

  if (s.next.length > 0) {
    lines.push("## Critérios de aceite");
    for (const a of s.next) lines.push(`- [ ] ${a}`);
    lines.push("");
  }

  if (meta.labels.length > 0) {
    lines.push(`_Labels sugeridas: ${meta.labels.join(", ")}_`);
  }
  lines.push("_Inferido da conversa — confira antes de usar._");

  return lines.join("\n").trim() + "\n";
}

// Converte a narrativa dev na descrição Markdown de um issue do Jira.
export function narrativeToJira(n: SessionNarrative, meta: JiraMeta): string {
  const lines: string[] = [];
  lines.push(`**Sessão:** ${meta.specId} — ${meta.title}`);
  lines.push("");

  if (n.why) {
    lines.push(`**Contexto:** ${n.why}`);
    lines.push("");
  }

  if (n.changes.length > 0) {
    lines.push("## Mudanças");
    for (const c of n.changes) {
      let line = `- **${c.title}** — ${c.prose}`;
      if (c.primaryFile) line += ` (\`${c.primaryFile}\`)`;
      lines.push(line);
    }
    lines.push("");
  }

  if (n.decisions.length > 0) {
    lines.push("## Decisões técnicas");
    for (const d of n.decisions) {
      let line = `- **${d.what}**`;
      if (d.why) line += ` — ${d.why}`;
      if (d.tradeoff) line += ` _(trade-off: ${d.tradeoff})_`;
      lines.push(line);
    }
    lines.push("");
  }

  if (n.verifications.length > 0) {
    lines.push("## Verificações");
    lines.push("```");
    for (const v of n.verifications) {
      const mark = v.passed === true ? "PASS" : v.passed === false ? "FAIL" : "—";
      lines.push(`${mark}  ${v.cmd}`);
    }
    lines.push("```");
    lines.push("");
  }

  if (n.prReview.groups.length > 0 || n.prReview.risk) {
    lines.push("## Ao revisar a PR");
    for (const g of n.prReview.groups) {
      const first = g.lookFirst ? " (olhe primeiro)" : "";
      lines.push(`- **${g.label}**${first}: ${g.files.join(", ")}`);
    }
    if (n.prReview.risk) lines.push(`> Risco: ${n.prReview.risk}`);
    lines.push("");
  }

  if (meta.labels.length > 0) {
    lines.push(`_Labels sugeridas: ${meta.labels.join(", ")}_`);
  }

  return lines.join("\n").trim() + "\n";
}
