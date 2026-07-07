/**
 * Cálculo da Overview: função pura do snapshot + janela + relógio (design 2026-07-07).
 * Atenção ignora a janela (dívida do agora); entrega/gasto/eficiência são da janela.
 * Custo honesto: soma ignora null, incompletude propaga, nunca $0 falso.
 */
import type { Project, Spec, FeatureStatus } from "../../../src/store/types";
import { flattenSpecs } from "./kanban";
import { attentionReason } from "./kanbanObserved";

export type WindowKey = "today" | "7d" | "30d";
export interface OverviewWindow { key: WindowKey; ms: number; label: string; }
export const WINDOWS: Record<WindowKey, OverviewWindow> = {
  today: { key: "today", ms: 24 * 3600_000, label: "Hoje" },
  "7d":   { key: "7d",    ms: 7 * 24 * 3600_000, label: "7 dias" },
  "30d":  { key: "30d",   ms: 30 * 24 * 3600_000, label: "30 dias" },
};

export interface AttentionItem { projectId: string; projectName: string; sessionId: string; what: string; whyLabel: string; since: string | null; }
export interface DeliveryItem { featureId: string; name: string; projectName: string; status: FeatureStatus; sessionsClosed: number; sessionsTotal: number; costUsd: number | null; costIncomplete: boolean; lastActivityAt: string | null; }
export interface SpendByProject { projectName: string; costUsd: number; }
export interface FeatureRow { projectId: string; featureId: string; name: string; projectName: string; key: string | null; orphan: boolean; status: FeatureStatus; doneSource: "jira" | "manual" | null; sessionsClosed: number; sessionsTotal: number; costUsd: number | null; costIncomplete: boolean; lastActivityAt: string | null; }
export interface SparkPoint { at: string; costUsd: number; }

export interface OverviewData {
  window: WindowKey;
  attention: { count: number; items: AttentionItem[] };
  delivery: { featuresDelivered: number; sessionsClosed: number; featuresTouched: number; items: DeliveryItem[] };
  efficiency: { avgCostPerSession: number | null; sessionsWithCost: number; trendPct: number | null; p50: number | null; p95: number | null; spark: SparkPoint[] };
  spend: { totalUsd: number | null; incomplete: boolean; byProject: SpendByProject[]; activeProjects: number };
  dailyLine: string;
  featureRows: FeatureRow[];
}

const ATTENTION_STATUSES = new Set<string>(["needs_attention", "unreadable", "blocked", "escalated", "paused"]);
const COST_INCOMPLETE = new Set<string>(["partial", "empty", "unreliable"]);

/** Instante de atividade de uma sessão para a janela: fechamento, senão última atividade, senão criação. */
export function activityInstant(spec: Spec): string | null {
  return spec.observed?.closedAt ?? spec.lastActivityAt ?? spec.observed?.createdAt ?? null;
}
function inWindow(iso: string | null, window: OverviewWindow, now: number): boolean {
  if (iso === null) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= now - window.ms && t <= now;
}
function costIncomplete(spec: Spec): boolean {
  return spec.cost.partial || COST_INCOMPLETE.has(spec.cost.source);
}

export function computeOverview(projects: readonly Project[], window: OverviewWindow, now: number): OverviewData {
  const all = flattenSpecs(projects as Project[], false).filter((sp) => sp.spec.observed);

  // Atenção — SEM janela.
  const attnItems: AttentionItem[] = all
    .filter((sp) => ATTENTION_STATUSES.has(sp.spec.status))
    .map((sp) => ({
      projectId: sp.projectId, projectName: sp.projectName, sessionId: sp.spec.id,
      what: sp.spec.title, whyLabel: attentionReason(sp.spec)?.label ?? "aguardando você",
      since: sp.spec.lastActivityAt,
    }));

  // Janela.
  const win = all.filter((sp) => inWindow(activityInstant(sp.spec), window, now));

  // Entrega — sessões fechadas na janela + features tocadas na janela.
  const closedInWin = win.filter((sp) => sp.spec.status === "done");
  const touchedFeatureIds = new Set(win.map((sp) => sp.spec.observed!.feature?.id ?? `orfa-${sp.spec.id}`));

  // Gasto — soma honesta por projeto.
  const byProjectMap = new Map<string, number>();
  let spendTotal: number | null = null;
  let spendIncomplete = false;
  for (const sp of win) {
    if (costIncomplete(sp.spec)) spendIncomplete = true;
    if (sp.spec.cost.totalCostUsd !== null) {
      spendTotal = (spendTotal ?? 0) + sp.spec.cost.totalCostUsd;
      byProjectMap.set(sp.projectName, (byProjectMap.get(sp.projectName) ?? 0) + sp.spec.cost.totalCostUsd);
    }
  }
  const byProject = [...byProjectMap.entries()]
    .map(([projectName, costUsd]) => ({ projectName, costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    window: window.key,
    attention: { count: attnItems.length, items: attnItems },
    delivery: {
      featuresDelivered: 0, // preenchido na Task 3
      sessionsClosed: closedInWin.length,
      featuresTouched: touchedFeatureIds.size,
      items: [], // preenchido na Task 3
    },
    efficiency: { avgCostPerSession: null, sessionsWithCost: 0, trendPct: null, p50: null, p95: null, spark: [] }, // preenchido na Task 2
    spend: { totalUsd: spendTotal, incomplete: spendIncomplete, byProject, activeProjects: byProjectMap.size },
    dailyLine: "", // preenchido na Task 3
    featureRows: [], // preenchido na Task 3
  };
}
