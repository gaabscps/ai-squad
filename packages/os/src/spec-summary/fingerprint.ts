import { createHash } from "node:crypto";

/** SHA-1 do conteúdo do spec.md. Detecta cache desatualizado quando o spec muda. */
export function computeSpecFingerprint(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}
