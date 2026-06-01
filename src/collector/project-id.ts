import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * id estável e único de um projeto, derivado do path ABSOLUTO.
 * O `name` (basename) é só exibição e pode colidir entre roots diferentes;
 * o sufixo de hash desambigua. Determinístico: mesmo path → mesmo id, sempre.
 * sha256 aqui é só desambiguação (não é segurança); 12 hex (48 bits) bastam
 * pra dezenas de projetos sem colisão prática.
 */
export function projectId(absPath: string): string {
  const hash = createHash("sha256").update(absPath).digest("hex").slice(0, 12);
  return `${basename(absPath)}-${hash}`;
}
