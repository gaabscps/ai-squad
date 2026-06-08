// Status derivado da Session inteira (não lido cru do YAML).
export type SpecStatus = "running" | "paused" | "blocked" | "done" | "escalated";

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
// Hierarquia de fonte: "report" = report.html parseado (fonte canônica);
// "unreliable" = report.html presente mas ilegível/não-parseável;
// "partial" = soma crua dos costs/*.json (sem report.html); "empty" = sem dados.
// cost-report.json não é consultado.
export type CostSource = "empty" | "partial" | "unreliable" | "report";

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
  specPath?: string | null; // caminho absoluto do spec.md resolvido de spec_ref, ou null se ausente/inexistente
}

export interface Project {
  id: string; // estável e único: `${name}-${hash12(path)}` (ver collector/project-id.ts)
  path: string;
  name: string;
  specs: Spec[];
  hidden: boolean;
}
