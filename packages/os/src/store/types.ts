// Status derivado da Session inteira (não lido cru do YAML).
// Valores SDD: running | paused | blocked | done | escalated.
// Valores observados: needs_attention | abandoned | unreadable.
export type SpecStatus =
  | "running" | "paused" | "blocked" | "done" | "escalated"
  | "needs_attention" | "abandoned" | "unreadable";

// Estado de uma task individual (task_states.<T>.state no session.yml).
export type TaskState = "pending" | "running" | "done" | "blocked";

export interface DispatchFinding {
  severity: string;
  file: string | null;
  line: number | null;
  text: string;
}

export interface DispatchTestEvidence {
  command: string;
  passed: boolean | null;
  detail: string | null;
}

export interface Dispatch {
  role: string;
  loop: number;
  status: string;
  summary: string | null;
  filesChanged: string[];
  findings: DispatchFinding[];
  testEvidence: DispatchTestEvidence[];
  tokens: number | null;
}

export interface Task {
  id: string; // "T-008"
  state: TaskState;
  loops: number; // loops>1 = reviewer rejeitou (retrabalho)
  dispatches: Dispatch[];
}

// Custo: SEMPRE somado dos total_cost_usd já gravados; nunca recalculado.
// Hierarquia SDD: "report" = report.html parseado (fonte canônica SDD);
// "unreliable" = report.html presente mas ilegível/não-parseável;
// "partial" = soma crua dos costs/*.json (sem report.html); "empty" = sem dados.
// Hierarquia observada: "cost_report" = cost-report.json (fonte primária do caminho
// observado; lido por readObservedCostRollup em cost-report.ts); fallback a "partial"/"empty"
// quando o report está ausente ou mais velho que costs/*.json (staleness).
export type CostSource = "empty" | "partial" | "unreliable" | "report" | "cost_report";

export interface CostPhaseBreakdown {
  planning: number | null;
  orchestration: number | null;
  implementation: number | null; // null quando scopingSuspect=true (valor não confiável)
}

export interface CostRollup {
  totalCostUsd: number | null; // soma dos total_cost_usd; null se sem dados
  partial: boolean; // true se algum arquivo tinha unpriced_models não-vazio
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  totalTokens: number;
  reportPath: string | null; // caminho do report.html, se existir
  source: CostSource;
  scopingSuspect: boolean; // ausente no arquivo ⇒ false
  // excludedSubagents/recoveredSubagents/complete: extraídos do report.html parseado;
  // ainda NÃO exibidos na UI (completude do modelo; o design só pede breakdown+badge).
  excludedSubagents: number | null;
  recoveredSubagents: number | null;
  byPhase: CostPhaseBreakdown | null; // preenchido quando source="report"; null em unreliable/partial/empty
  complete: boolean | null; // null quando source != "report"
}

// Flags de inconsistência de ciclo de vida detectadas em sessões observadas.
// Exibidas no drawer (badge de drift) — o card nunca some, mas o drawer detalha o problema.
export type ObservedDriftFlag = "closed_with_open_status" | "unknown_status" | "unreadable_yaml";

// Item de decisão registrado pelo modelo durante a sessão (best-effort, sem required).
export interface ObservedDecision {
  what: string;
  why: string | null;
  rejected: string | null;
  ref: string | null;
}

// Item de evidência de verificação (comando + resultado observado).
export interface ObservedEvidence {
  cmd: string | null;
  result: string | null;
  kind: string | null;
}

// Metadados exclusivos do modo observado; presença do campo = card observado.
export interface ObservedMeta {
  intent: string;
  createdAt: string | null;
  closedAt: string | null;
  attentionKind: string | null;
  decisions: ObservedDecision[];
  evidence: ObservedEvidence[];
  driftFlags: ObservedDriftFlag[];
}

export interface TimelineEntry {
  kind: string;
  timestamp: string;
  note: string;
  phase?: string;
}

export interface Spec {
  id: string; // "FEAT-006" / "DISC-001"
  squad: "sdd" | "discovery";
  title: string;
  phase: string; // current_phase cru
  plannedPhases: string[];
  status: SpecStatus; // derivado
  tasks: Task[];
  health: {
    pendingHuman: number;
    escalationRate: number;
    auditException: boolean;
  };
  lastActivityAt: string | null;
  timeline: TimelineEntry[];
  cost: CostRollup;
  deliveryReport: DeliveryReport | null; // null em sessões sem parecer (antigas/em curso)
  specPath?: string | null; // caminho absoluto do spec.md resolvido de spec_ref, ou null se ausente/inexistente
  observed?: ObservedMeta; // presente somente em sessões modo observado; ausência = card SDD legado
}

export interface Project {
  id: string; // estável e único: `${name}-${hash12(path)}` (ver collector/project-id.ts)
  path: string;
  name: string;
  specs: Spec[];
  hidden: boolean;
}

// ── Delivery-report (parecer de entrega do ai-squad) ───────────────────────
// Enums canônicos em INGLÊS: a UI roteia cor/realce sobre estes valores.
// O parser NÃO faz whitelist — passa valores desconhecidos adiante (robustez a
// versões do chronicler), por isso os campos abaixo são `string`, não a union.
export type DeliveryConfidence = "recorded" | "inferred" | "not_recorded";
export type DeliveryVerdictValue =
  | "approved" | "approved_with_caveats" | "needs_changes" | "blocked" | "needs_human_review";
export type DeliveryAcClassification =
  | "met" | "partially_met" | "not_met" | "not_validated";

export interface DeliveryAnswer {
  key: string; // uma das 11 chaves canônicas
  answer: string; // prosa no output_locale
  confidence: string; // canônico = DeliveryConfidence; string crua se desconhecido
  evidenceRefs: string[];
}

export interface DeliveryVerdict {
  value: string; // canônico = DeliveryVerdictValue; string crua se desconhecido
  rationale: string;
  evidenceRefs: string[];
}

export interface DeliveryAcceptanceCriterion {
  id: string;
  description: string;
  classification: string; // canônico = DeliveryAcClassification; string crua se desconhecido
  evidenceRefs: string[];
}

export interface DeliveryReport {
  specId: string | null;
  outputLocale: string | null;
  generatedAt: string | null;
  verdict: DeliveryVerdict | null;
  answers: DeliveryAnswer[]; // ordenadas pelas 11 chaves canônicas
  acceptanceCriteria: DeliveryAcceptanceCriterion[];
  container: "answers" | "questions";
  mdPath: string | null;
  jsonPath: string;
}
