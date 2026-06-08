// Mapas de apresentação pro delivery-report. SEMPRE chaveados pelo valor inglês
// canônico (a UI nunca roteia sobre rótulo traduzido). Fallback mostra o valor
// cru com cls "unknown" — assim um enum novo do chronicler ainda aparece.

export interface LabelStyle {
  label: string;
  cls: string;
}

const ANSWER_TITLES: Record<string, string> = {
  what_was_done: "O que foi entregue",
  how_it_was_done: "Como foi feito",
  why_this_way: "Por que assim",
  deviations_from_plan: "Desvios do plano",
  acceptance_criteria: "Critérios de aceite",
  evidence: "Evidências",
  impacts: "Impactos",
  out_of_scope: "Fora de escopo",
  risks_and_pending: "Riscos e pendências",
  how_to_validate: "Como validar",
  final_verdict: "Veredicto final",
};

export function answerTitle(key: string): string {
  return ANSWER_TITLES[key] ?? key;
}

function lookup(map: Record<string, LabelStyle>, value: string): LabelStyle {
  return map[value] ?? { label: value || "—", cls: "unknown" };
}

const VERDICTS: Record<string, LabelStyle> = {
  approved: { label: "Aprovado", cls: "approved" },
  approved_with_caveats: { label: "Aprovado com ressalvas", cls: "caveats" },
  needs_changes: { label: "Precisa de mudanças", cls: "changes" },
  blocked: { label: "Bloqueado", cls: "blocked" },
  needs_human_review: { label: "Requer revisão humana", cls: "human" },
};
export function verdictLabel(value: string): LabelStyle {
  return lookup(VERDICTS, value);
}

const CONFIDENCES: Record<string, LabelStyle> = {
  recorded: { label: "registrado", cls: "recorded" },
  inferred: { label: "inferido", cls: "inferred" },
  not_recorded: { label: "não registrado", cls: "not-recorded" },
};
export function confidenceLabel(value: string): LabelStyle {
  return lookup(CONFIDENCES, value);
}

const CLASSIFICATIONS: Record<string, LabelStyle> = {
  met: { label: "atendido", cls: "met" },
  partially_met: { label: "parcialmente atendido", cls: "partial" },
  not_met: { label: "não atendido", cls: "not-met" },
  not_validated: { label: "não validado", cls: "not-validated" },
};
export function classificationLabel(value: string): LabelStyle {
  return lookup(CLASSIFICATIONS, value);
}

// Resume a tabela de ACs por classificação, ex.: "25 atendidos · 6 parcialmente atendidos".
// Ordem canônica met→partial→not_met→not_validated, depois quaisquer valores desconhecidos.
// Plural simples: +"s" quando a contagem > 1 (vale pros 4 rótulos canônicos).
export function acClassificationSummary(acs: { classification: string }[]): string {
  const order = ["met", "partially_met", "not_met", "not_validated"];
  const counts = new Map<string, number>();
  for (const ac of acs) counts.set(ac.classification, (counts.get(ac.classification) ?? 0) + 1);
  const keys = [
    ...order.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !order.includes(k)),
  ];
  return keys
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${classificationLabel(k).label}${n > 1 ? "s" : ""}`;
    })
    .join(" · ");
}
