/**
 * Agrupador de sessões observadas em Features (derivado na leitura; design 2026-07-06).
 * Precedências: overlay.assign > bloco feature: do YAML > órfã.
 * Nome canônico: overlay.names > name declarado (snapshot Jira mais novo dá o campo jira).
 * Status: atenção vence; entrega (aguardando_deploy/done) vem do overlay (manual) ou do
 * snapshot Jira (done), nunca das sessões.
 */
import type {
  Spec, Feature, FeatureStatus, FeatureAttentionItem, FeatureCost,
} from "../store/types.js";

export interface FeaturesOverlay {
  assign?: Record<string, string | null>; // "<projectId>/<sessionId>" → featureId (null = volta a órfã)
  done?: Record<string, boolean>;         // legado: "<projectId>/<featureId>" → entregue; fallback quando deliveryState não tem a chave
  deliveryState?: Record<string, "awaiting_deploy" | "done">; // "<projectId>/<featureId>" → estado de entrega manual
  names?: Record<string, string>;         // "<projectId>/<featureId>" → renome manual
}

// Mesmo conjunto de status que a coluna "Precisa de você" do board usa.
const ATTENTION = new Set<string>(["needs_attention", "unreadable", "blocked", "escalated", "paused"]);
// Status textuais de Jira aceitos como "entregue" no snapshot (comparação lowercase).
const JIRA_DONE = new Set(["done", "closed", "resolved", "concluído", "concluido"]);

/** Estado de entrega efetivo: deliveryState (novo) vence; done:true (legado) é fallback; ausência = aberto. */
function resolveDeliveryState(
  overlay: FeaturesOverlay | undefined,
  key: string,
): "open" | "awaiting_deploy" | "done" {
  const explicit = overlay?.deliveryState?.[key];
  if (explicit !== undefined) return explicit;
  if (overlay?.done?.[key] === true) return "done";
  return "open";
}

/** Slug estável de nome de feature: sem acentos, kebab, prefixo ft-. */
export function slugifyFeatureName(name: string): string {
  const base = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `ft-${base || "sem-nome"}`;
}

function orphanId(sessionId: string): string {
  return `ft-orfa-${sessionId.toLowerCase()}`;
}

export function buildFeatures(
  projectId: string,
  specs: Spec[],
  overlay: FeaturesOverlay | undefined,
  now: number,
): Feature[] {
  // 1) resolve o id efetivo de cada sessão observada e agrupa
  const groups = new Map<string, Spec[]>();
  const orphanIds = new Set<string>();
  for (const spec of specs) {
    if (!spec.observed) continue; // SDD legado fora da camada
    const assigned = overlay?.assign?.[`${projectId}/${spec.id}`];
    let fid: string;
    if (assigned !== undefined) {
      fid = assigned ?? orphanId(spec.id);
      if (assigned === null) orphanIds.add(fid);
    } else if (spec.observed.feature) {
      fid = spec.observed.feature.id;
    } else {
      fid = orphanId(spec.id);
      orphanIds.add(fid);
    }
    const arr = groups.get(fid) ?? [];
    arr.push(spec);
    groups.set(fid, arr);
  }

  // 2) materializa cada grupo com rollups
  const out: Feature[] = [];
  for (const [fid, members] of groups) {
    members.sort((a, b) =>
      (a.observed?.createdAt ?? "").localeCompare(b.observed?.createdAt ?? ""));

    // declaração mais rica: prefere membro com key; snapshot Jira mais novo vence
    const declared = members.map((m) => m.observed!.feature).filter((f) => f !== null);
    const withKey = declared.find((f) => f!.key !== null) ?? declared[0] ?? null;
    const newestJira = declared
      .map((f) => f!.jira)
      .filter((j) => j !== null)
      .sort((a, b) => (b!.fetchedAt ?? "").localeCompare(a!.fetchedAt ?? ""))[0] ?? null;

    const orphan = orphanIds.has(fid);
    const declaredName = withKey?.name ?? members[0].title;
    const name = overlay?.names?.[`${projectId}/${fid}`] ?? declaredName;

    // entrega: deliveryState (overlay) vence sobre done legado; jira é fallback só do terminal; nunca derivado das sessões
    const deliveryState = resolveDeliveryState(overlay, `${projectId}/${fid}`);
    const manualDone = deliveryState === "done";
    const jiraDone = newestJira?.status != null && JIRA_DONE.has(newestJira.status.toLowerCase());
    const doneSource = manualDone ? "manual" : jiraDone ? "jira" : null;

    const attentionItems: FeatureAttentionItem[] = members
      .filter((m) => ATTENTION.has(m.status))
      .map((m) => ({
        sessionId: m.id,
        kind: m.observed?.attentionKind ?? m.status,
        blockedForMs: m.lastActivityAt ? now - Date.parse(m.lastActivityAt) : null,
      }));

    const status: FeatureStatus =
      attentionItems.length > 0 ? "needs_attention"
      : doneSource !== null ? "done"
      : deliveryState === "awaiting_deploy" ? "awaiting_deploy"
      : members.some((m) => m.status === "running") ? "running"
      : "idle";

    // custo: soma honesta (Global Constraints — nunca $0 falso)
    const cost: FeatureCost = {
      totalCostUsd: null, totalTokens: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      incomplete: false,
    };
    for (const m of members) {
      if (m.cost.totalCostUsd !== null) cost.totalCostUsd = (cost.totalCostUsd ?? 0) + m.cost.totalCostUsd;
      cost.totalTokens += m.cost.totalTokens;
      cost.tokens.input += m.cost.tokens.input;
      cost.tokens.output += m.cost.tokens.output;
      cost.tokens.cacheRead += m.cost.tokens.cacheRead;
      cost.tokens.cacheCreation += m.cost.tokens.cacheCreation;
      if (m.cost.partial || m.cost.source === "partial" || m.cost.source === "empty" || m.cost.source === "unreliable") {
        cost.incomplete = true;
      }
    }

    // tempo: span calendário + engaged somado (aberta conta até now)
    const opens = members.map((m) => m.observed!.createdAt).filter((d): d is string => d !== null);
    const firstOpenedAt = opens.length ? opens.reduce((a, b) => (a < b ? a : b)) : null;
    const closes = members.map((m) => m.observed!.closedAt).filter((d): d is string => d !== null);
    const anyOpen = members.some((m) => m.observed!.closedAt === null);
    const lastClosedAt = closes.length ? closes.reduce((a, b) => (a > b ? a : b)) : null;
    const spanEnd = anyOpen ? now : lastClosedAt ? Date.parse(lastClosedAt) : null;
    const spanMs = firstOpenedAt !== null && spanEnd !== null ? spanEnd - Date.parse(firstOpenedAt) : null;
    let engagedMs: number | null = null;
    for (const m of members) {
      const start = m.observed!.createdAt;
      if (start === null) continue;
      const end = m.observed!.closedAt !== null ? Date.parse(m.observed!.closedAt) : now;
      engagedMs = (engagedMs ?? 0) + (end - Date.parse(start));
    }

    const lastActivityAt = members
      .map((m) => m.lastActivityAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;

    out.push({
      id: fid,
      key: withKey?.key ?? null,
      name,
      orphan,
      projectId,
      sessionIds: members.map((m) => m.id),
      status,
      doneSource,
      attention: { count: attentionItems.length, items: attentionItems },
      delivery: {
        sessionsClosed: members.filter((m) => m.status === "done").length,
        sessionsTotal: members.length,
        deliverables: [], // preenchido quando o Spec carregar o entregável selado (fase 2 da camada)
      },
      cost,
      time: { firstOpenedAt, lastClosedAt, spanMs, engagedMs },
      lastActivityAt,
      jira: newestJira ? { status: newestJira.status, title: withKey?.name ?? null, url: newestJira.url } : null,
    });
  }

  // ordena por última atividade desc (mesma lente do board)
  out.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  return out;
}
