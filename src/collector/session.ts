import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Spec, SpecStatus, Task, TimelineEntry } from "../store/types.js";
import { readCostRollup } from "./cost.js";

// View parcial do session.yml: só os campos que deriveStatus consulta.
// O objeto bruto tem mais chaves; isto declara apenas o que esta função lê.
interface RawSession {
  current_phase?: string;
  paused_at?: string;
}

/**
 * Deriva o status da Session inteira a partir de campos REAIS do session.yml.
 * Ordem importa: done/escalated (do current_phase) > paused (paused_at) >
 * blocked (alguma task) > running (default).
 */
export function deriveStatus(raw: RawSession, tasks: Task[]): SpecStatus {
  if (raw.current_phase === "done") return "done";
  if (raw.current_phase === "escalated") return "escalated";
  if (raw.paused_at) return "paused";
  if (tasks.some((t) => t.state === "blocked")) return "blocked";
  return "running";
}

/** Lê <specDir>/session.yml num Spec. Retorna null se não houver session.yml. */
export function parseSession(specDir: string): Spec | null {
  const file = join(specDir, "session.yml");
  if (!existsSync(file)) return null;

  const raw = parseYaml(readFileSync(file, "utf-8")) as Record<string, any>;

  const tasks: Task[] = Object.entries(raw.task_states ?? {}).map(
    ([id, v]: [string, unknown]) => {
      const tv = (v ?? {}) as { state?: string; loops?: number };
      return { id, state: (tv.state ?? "pending") as Task["state"], loops: tv.loops ?? 0 };
    }
  );

  const timeline: TimelineEntry[] = (raw.notes ?? []).map((n: unknown) => {
    const nn = (n ?? {}) as { kind?: string; timestamp?: string; note?: string; phase?: string };
    return { kind: nn.kind ?? "", timestamp: nn.timestamp ?? "", note: nn.note ?? "", phase: nn.phase };
  });

  const em = raw.escalation_metrics ?? {};

  return {
    id: raw.task_id ?? specDir,
    squad: raw.squad === "discovery" ? "discovery" : "sdd",
    title: raw.feature_name ?? raw.task_id ?? "(sem título)",
    phase: raw.current_phase ?? "",
    plannedPhases: raw.planned_phases ?? [],
    status: deriveStatus(raw, tasks),
    tasks,
    health: {
      pendingHuman: em.pending_human_tasks ?? 0,
      escalationRate: em.escalation_rate ?? 0,
      auditException: raw.audit_exception === true,
    },
    lastActivityAt: raw.last_activity_at ?? null,
    timeline,
    cost: readCostRollup(specDir),
  };
}
