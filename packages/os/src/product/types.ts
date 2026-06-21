// Contrato do resumo de sessão de PRODUTO/DESIGN (caminho work_type: product).
// Distinto da narrativa dev (SessionNarrative em ../narrative/types.ts): SEM
// changes/verifications/prReview — esses são jargão de engenharia. A estrutura aqui
// é a "receita" validada por red-team: decidido / em aberto / próximo passo / entregável.

export interface ProductDecision {
  what: string;
  why: string | null;       // o critério, ou null
  rejected: string | null;  // a alternativa descartada, ou null
}

export interface ProductSummary {
  tldr: string;               // uma frase: o que a sessão produziu ou explorou
  decided: ProductDecision[]; // escolhas fechadas (com porquê e alternativa descartada)
  open: string[];             // perguntas que ficaram sem resposta
  next: string[];             // ações que a pessoa assumiu fazer (verbo de compromisso)
  deliverable: string;        // 1 frase nomeando o artefato; ou "Sessão exploratória — sem decisão/entregável fechado"
}
