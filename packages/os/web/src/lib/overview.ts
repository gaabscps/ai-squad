/**
 * Cálculo da Overview: função pura do snapshot + janela + relógio (design 2026-07-07).
 * Atenção ignora a janela (dívida do agora); entrega/gasto/eficiência são da janela.
 * Custo honesto: soma ignora null, incompletude propaga, nunca $0 falso.
 */
import type { Project, Spec, FeatureStatus } from "../../../src/store/types";
import { flattenSpecs } from "./kanban";
import { attentionReason } from "./kanbanObserved";
import { flattenFeatures } from "./kanbanFeatures";
import { fmtUsd } from "../format";

export type WindowKey = "today" | "7d" | "30d";
export interface OverviewWindow { key: WindowKey; ms: number; label: string; }
export const WINDOWS: Record<WindowKey, OverviewWindow> = {
  today: { key: "today", ms: 24 * 3600_000, label: "Hoje" },
  "7d":   { key: "7d",    ms: 7 * 24 * 3600_000, label: "7 dias" },
  "30d":  { key: "30d",   ms: 30 * 24 * 3600_000, label: "30 dias" },
};

export interface AttentionItem { projectId: string; projectName: string; sessionId: string; what: string; whyLabel: string; since: string | null; }
export interface DeliveryItem { projectId: string; featureId: string; name: string; projectName: string; status: FeatureStatus; sessionsClosed: number; sessionsTotal: number; costUsd: number | null; costIncomplete: boolean; lastActivityAt: string | null; }
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

/** Percentil linear sobre lista já ordenada asc; null se vazia. p ∈ [0,100]. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

function dayBucket(iso: string, hourly: boolean): string {
  return hourly ? iso.slice(0, 13) + ":00:00Z" : iso.slice(0, 10);
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
  // Chave por projeto+id: OBS-NNN reinicia em cada projeto, então "OBS-001" sozinho
  // colide entre projetos e vaza a atividade de um para as features homônimas de outro.
  const closedInWin = win.filter((sp) => sp.spec.status === "done");
  const touchedFeatureIds = new Set(win.map((sp) => `${sp.projectId}/${sp.spec.observed!.feature?.id ?? `orfa-${sp.spec.id}`}`));

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

  // Eficiência — média/percentis só sobre custo conhecido; tendência vs janela anterior de mesmo tamanho.
  const withCost = win.filter((sp) => sp.spec.cost.totalCostUsd !== null);
  const costs = withCost.map((sp) => sp.spec.cost.totalCostUsd!).sort((a, b) => a - b);
  const avg = costs.length ? costs.reduce((s, x) => s + x, 0) / costs.length : null;

  const prevWin = all.filter((sp) => {
    const t = activityInstant(sp.spec); if (t === null) return false;
    const ms = Date.parse(t);
    return ms >= now - 2 * window.ms && ms < now - window.ms && sp.spec.cost.totalCostUsd !== null;
  });
  const prevCosts = prevWin.map((sp) => sp.spec.cost.totalCostUsd!);
  const prevAvg = prevCosts.length ? prevCosts.reduce((s, x) => s + x, 0) / prevCosts.length : null;
  const trendPct = avg !== null && prevAvg !== null && prevAvg !== 0 ? (avg - prevAvg) / prevAvg : null;

  const hourly = window.key === "today";
  const sparkMap = new Map<string, number>();
  for (const sp of withCost) {
    const t = activityInstant(sp.spec)!;
    const b = dayBucket(t, hourly);
    sparkMap.set(b, (sparkMap.get(b) ?? 0) + sp.spec.cost.totalCostUsd!);
  }
  const spark = [...sparkMap.entries()].map(([at, costUsd]) => ({ at, costUsd })).sort((a, b) => a.at.localeCompare(b.at));

  const efficiency = { avgCostPerSession: avg, sessionsWithCost: costs.length, trendPct, p50: percentile(costs, 50), p95: percentile(costs, 95), spark };

  // featureRows — features com ≥1 sessão-membro na janela; mais recentes primeiro.
  const winSessionKeys = new Set(win.map((sp) => `${sp.projectId}/${sp.spec.id}`));
  const featureRows: FeatureRow[] = flattenFeatures(projects as Project[], false)
    .filter((fi) => fi.feature.sessionIds.some((id) => winSessionKeys.has(`${fi.projectId}/${id}`)))
    .map((fi) => ({
      projectId: fi.projectId, featureId: fi.feature.id, name: fi.feature.name, projectName: fi.projectName,
      key: fi.feature.key, orphan: fi.feature.orphan, status: fi.feature.status, doneSource: fi.feature.doneSource,
      sessionsClosed: fi.feature.delivery.sessionsClosed, sessionsTotal: fi.feature.delivery.sessionsTotal,
      costUsd: fi.feature.cost.totalCostUsd, costIncomplete: fi.feature.cost.incomplete,
      lastActivityAt: fi.feature.lastActivityAt,
    }))
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));

  // delivery.items — features entregues (done) ou em andamento (idle/running) na janela.
  const deliveredRows = featureRows.filter((r) => r.status === "done");
  const deliveryItems: DeliveryItem[] = featureRows
    .filter((r) => r.status === "done" || r.status === "idle" || r.status === "running")
    .map((r) => ({
      projectId: r.projectId, featureId: r.featureId, name: r.name, projectName: r.projectName, status: r.status,
      sessionsClosed: r.sessionsClosed, sessionsTotal: r.sessionsTotal, costUsd: r.costUsd,
      costIncomplete: r.costIncomplete, lastActivityAt: r.lastActivityAt,
    }));

  // dailyLine — template determinístico (sem LLM): cada trecho some quando a contagem é 0;
  // sem nada pra contar e sem atenção pendente → frase honesta de "nada aconteceu".
  const projectsClosed = [...new Set(closedInWin.map((sp) => sp.projectName))];
  const parts: string[] = [];
  if (deliveredRows.length) {
    const names = deliveredRows.slice(0, 2).map((r) => r.name).join(", ");
    parts.push(`entregou ${deliveredRows.length} feature${deliveredRows.length > 1 ? "s" : ""} (${names})`);
  }
  if (closedInWin.length) parts.push(`fechou ${closedInWin.length} ${closedInWin.length > 1 ? "sessões" : "sessão"}${projectsClosed.length ? " em " + projectsClosed.slice(0, 2).join(", ") : ""}`);
  if (spendTotal !== null) parts.push(`gastou ${fmtUsd(spendTotal)}`);
  let dailyLine: string;
  const attnCount = attnItems.length;
  if (parts.length === 0 && attnCount === 0) {
    dailyLine = "Nada fechou nem travou nesta janela.";
  } else {
    const head = parts.length ? `Na janela: ${parts.join(", ")}.` : "";
    const tail = attnCount ? `Agora ${attnCount} ${attnCount > 1 ? "sessões esperam" : "sessão espera"} você.` : "";
    dailyLine = [head, tail].filter(Boolean).join(" ");
  }

  return {
    window: window.key,
    attention: { count: attnItems.length, items: attnItems },
    delivery: {
      featuresDelivered: deliveredRows.length,
      sessionsClosed: closedInWin.length,
      featuresTouched: touchedFeatureIds.size,
      items: deliveryItems,
    },
    efficiency,
    spend: { totalUsd: spendTotal, incomplete: spendIncomplete, byProject, activeProjects: byProjectMap.size },
    dailyLine,
    featureRows,
  };
}
