import type { Spec } from "../store/types.js";

/**
 * Contexto normalizado de uma spec em atenção. Derivado SÓ de campos que já
 * existem no Store (status, timeline, dispatches). Alimenta tanto o prompt de
 * diagnóstico (IA) quanto o de handoff (texto puro). Robusto a dado escasso.
 */
export interface AttentionContext {
  specId: string;
  title: string;
  status: string;
  phase: string;
  plannedPhases: string[];
  projectPath: string;
  auditException: boolean;
  notes: { kind: string; timestamp: string; note: string }[];
  findings: { severity: string; loc: string | null; text: string }[];
}

export function buildAttentionContext(spec: Spec, projectPath: string): AttentionContext {
  const findings = spec.tasks
    .flatMap((t) => t.dispatches)
    .flatMap((d) => d.findings)
    .map((f) => ({
      severity: f.severity,
      loc: f.file ? `${f.file}${f.line != null ? `:${f.line}` : ""}` : null,
      text: f.text,
    }));
  return {
    specId: spec.id,
    title: spec.title,
    status: spec.status,
    phase: spec.phase,
    plannedPhases: spec.plannedPhases,
    projectPath,
    auditException: spec.health.auditException,
    notes: spec.timeline.map((e) => ({ kind: e.kind, timestamp: e.timestamp, note: e.note })),
    findings,
  };
}
