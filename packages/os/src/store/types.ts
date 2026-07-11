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
export type ObservedDriftFlag =
  | "closed_with_open_status" | "unknown_status" | "unreadable_yaml"
  | "invalid_feature_block";

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

// Um arquivo dentro de um marco de edição; counts/patch vêm do diff.json (Stop).
export interface ObservedEditFile {
  path: string;
  added: number | null;   // null até o diff.json existir (pré-Stop)
  removed: number | null;
  patch: string | null;   // unified diff desde base_sha; null se não materializado
}

export type ObservedMarkerKind = "open" | "decision" | "edit" | "verify" | "block" | "close" | "run";

// Um marco da timeline de execução. Campos por kind são opcionais (discriminados por `kind`).
export interface ObservedMarker {
  kind: ObservedMarkerKind;
  at: string | null;       // ISO-8601; null quando best-effort sem hora
  exact: boolean;          // true = timestamp mecânico (edit/block/open/close); false = ordem
  note: string | null;     // rótulo curto (open/close/block)
  decision: ObservedDecision | null;   // kind === "decision"
  evidence: ObservedEvidence | null;   // kind === "verify"
  editFiles: ObservedEditFile[] | null; // kind === "edit"
  blockMs: number | null;  // duração da espera (kind === "block"); null nos demais ou bloqueio em aberto
}

// Referência de feature declarada no session.yml (bloco feature:), já normalizada.
export interface ObservedFeatureRef {
  id: string;                 // estável; com key == key, sem key == ft-<slug>
  key: string | null;         // issue-key do Jira
  name: string;
  jira: { status: string | null; fetchedAt: string | null; url: string | null } | null;
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
  baseSha: string | null;        // git base_sha lido do session.yml (âncora do diff)
  outputLocale: string | null;   // output_locale da sessão (BCP-47); idioma dos labels da timeline
  workType?: string | null;      // work_type da sessão (dev|product); ausente/null ⇒ tratado como dev. Aditivo (protocolo do schema: opcional na leitura). Roteia o resumo de produto no aiOS.
  feature: ObservedFeatureRef | null; // bloco feature: do session.yml; null = órfã (sem drift) ou bloco inválido (com drift)
  markers: ObservedMarker[];     // a timeline curada (preenchida na Task 8)
  report: string | null;        // conteúdo de report.md (parecer determinístico); null se ausente
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
  features: Feature[];
  hidden: boolean;
}

// ── Camada de feature (agrupador derivado; ver design 2026-07-06) ────────────

export type FeatureStatus = "needs_attention" | "running" | "idle" | "awaiting_deploy" | "done";

export interface FeatureAttentionItem {
  sessionId: string;
  kind: string;              // attentionKind da sessão (fallback "input") ou status attention-like
  blockedForMs: number | null; // now - lastActivityAt; null sem lastActivityAt
}

// Subset honesto de custo agregável entre sessões (byPhase/reportPath não somam).
export interface FeatureCost {
  totalCostUsd: number | null;  // soma dos não-nulos; null se nenhum membro tem $
  totalTokens: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  incomplete: boolean;          // algum membro com source partial/empty/unreliable ou partial=true
}

export interface Feature {
  id: string;
  key: string | null;
  name: string;                 // canônico: overlay.names > jira.title(snapshot) > name declarado
  orphan: boolean;              // sessão sem bloco feature (agrupada como feature-de-uma)
  projectId: string;
  sessionIds: string[];         // ordenadas por createdAt asc; front faz o join com Project.specs
  status: FeatureStatus;        // atenção vence; done nunca derivado das sessões
  doneSource: "jira" | "manual" | null;
  attention: { count: number; items: FeatureAttentionItem[] };
  delivery: { sessionsClosed: number; sessionsTotal: number; deliverables: string[] };
  cost: FeatureCost;
  time: {
    firstOpenedAt: string | null;
    lastClosedAt: string | null;
    spanMs: number | null;      // 1ª abertura → último fechamento (ou now se alguma aberta)
    engagedMs: number | null;   // soma das durações por sessão (aberta conta até now)
  };
  lastActivityAt: string | null;
  jira: { status: string | null; title: string | null; url: string | null } | null; // snapshot mais novo
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
