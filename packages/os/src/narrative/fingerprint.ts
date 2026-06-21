import { createHash } from "node:crypto";
import type { ObservedMeta } from "../store/types.js";

/** SHA-1 do que define a narrativa: status + closedAt + forma dos markers (kind/note/decisão/edição). */
export function observedFingerprint(observed: ObservedMeta, status: string): string {
  const shape = observed.markers.map((m) => [
    m.kind,
    m.note,
    m.decision ? [m.decision.what, m.decision.why, m.decision.rejected] : null,
    m.editFiles ? m.editFiles.map((f) => [f.path, f.added, f.removed]) : null,
    m.evidence ? [m.evidence.cmd, m.evidence.result] : null,
  ]);
  return createHash("sha1")
    .update(JSON.stringify({ status, closedAt: observed.closedAt, markers: shape }))
    .digest("hex");
}
