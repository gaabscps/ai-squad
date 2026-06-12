import { createHash } from "node:crypto";
import type { Task } from "../store/types.js";

/**
 * Hash determinístico dos dispatches da task. Serializa só os campos que
 * definem "o que foi feito" (role, loop, status, summary, arquivos, findings,
 * testes) numa ordem fixa, e tira o SHA-1. Usado para detectar resumo velho:
 * se o fingerprint atual difere do gravado, o cache está desatualizado.
 */
export function taskFingerprint(task: Task): string {
  const shape = task.dispatches.map((d) => ({
    role: d.role,
    loop: d.loop,
    status: d.status,
    summary: d.summary,
    files: d.filesChanged,
    findings: d.findings.map((f) => [f.severity, f.file, f.line, f.text]),
    tests: d.testEvidence.map((t) => [t.command, t.passed, t.detail]),
  }));
  return createHash("sha1").update(JSON.stringify({ id: task.id, dispatches: shape })).digest("hex");
}
