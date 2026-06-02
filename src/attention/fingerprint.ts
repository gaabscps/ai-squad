import { createHash } from "node:crypto";
import type { AttentionContext } from "./context.js";

/**
 * Hash determinístico do que define o diagnóstico (status, fase, notes, findings).
 * Se o fingerprint atual difere do gravado no cache, o diagnóstico está velho.
 */
export function contextFingerprint(ctx: AttentionContext): string {
  const shape = {
    specId: ctx.specId,
    status: ctx.status,
    auditException: ctx.auditException,
    phase: ctx.phase,
    notes: ctx.notes.map((n) => [n.kind, n.timestamp, n.note]),
    findings: ctx.findings.map((f) => [f.severity, f.loc, f.text]),
  };
  return createHash("sha1").update(JSON.stringify(shape)).digest("hex");
}
