/**
 * Funções puras que normalizam os dois formatos de Output Packet do ai-squad.
 *
 * Formato antigo: `evidence` é objeto  { files_changed: [{path,...}], ac_implementations }
 * Formato novo:   `evidence` é array   [{ id, kind, ref, exit?, detail? }]
 *                 `files_changed` é string[] no topo do packet
 *
 * A detecção de formato é feita por Array.isArray(packet.evidence).
 * Nenhuma função lança exceção — entradas malformadas retornam vazio (best-effort).
 */

import type { DispatchFinding, DispatchTestEvidence } from "../store/types.js";

type RawPacket = Record<string, unknown>;

/** Retorna true quando o packet está no formato novo (evidence é array). */
function isNewFormat(packet: RawPacket): boolean {
  return Array.isArray(packet["evidence"]);
}

// ---------------------------------------------------------------------------
// normalizeFilesChanged
// ---------------------------------------------------------------------------

/**
 * Extrai a lista de arquivos alterados em uma string[] normalizada.
 *
 * - Formato antigo: evidence.files_changed[].path → string[]
 * - Formato novo:   files_changed: string[] direto no packet
 */
export function normalizeFilesChanged(packet: RawPacket): string[] {
  if (isNewFormat(packet)) {
    const fc = packet["files_changed"];
    if (!Array.isArray(fc)) return [];
    return fc.filter((v): v is string => typeof v === "string");
  }

  // Formato antigo: evidence.files_changed é array de objetos com .path
  const evidence = packet["evidence"];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const fc = (evidence as RawPacket)["files_changed"];
  if (!Array.isArray(fc)) return [];
  return fc
    .filter((item): item is RawPacket => item !== null && typeof item === "object")
    .map((item) => item["path"])
    .filter((p): p is string => typeof p === "string");
}

// ---------------------------------------------------------------------------
// normalizeFindings
// ---------------------------------------------------------------------------

/**
 * Normaliza findings dos dois formatos para DispatchFinding[].
 *
 * - Formato antigo: { severity, file, line?, line_start?, issue, suggestion }
 *   → text = issue + " " + suggestion (concatenados, sem trailing space se um vazio)
 * - Formato novo:   { id, severity, file, line?, line_start?, rationale }
 *   → text = rationale
 *
 * Em ambos os formatos: line = line ?? line_start ?? null
 */
export function normalizeFindings(packet: RawPacket): DispatchFinding[] {
  const raw = packet["findings"];
  if (!Array.isArray(raw)) return [];

  const novoFormato = isNewFormat(packet);

  return raw
    .filter((f): f is RawPacket => f !== null && typeof f === "object")
    .map((f) => {
      const severity = typeof f["severity"] === "string" ? f["severity"] : "unknown";
      const file = typeof f["file"] === "string" ? f["file"] : null;

      // line = line ?? line_start ?? null
      const lineRaw = f["line"];
      const lineStartRaw = f["line_start"];
      const line =
        typeof lineRaw === "number"
          ? lineRaw
          : typeof lineStartRaw === "number"
            ? lineStartRaw
            : null;

      let text: string;
      if (novoFormato) {
        text = typeof f["rationale"] === "string" ? f["rationale"] : "";
      } else {
        const issue = typeof f["issue"] === "string" ? f["issue"] : "";
        const suggestion = typeof f["suggestion"] === "string" ? f["suggestion"] : "";
        text = [issue, suggestion].filter(Boolean).join(" ");
      }

      return { severity, file, line, text };
    });
}

// ---------------------------------------------------------------------------
// deriveTestEvidence
// ---------------------------------------------------------------------------

/**
 * Deriva evidências de teste filtrando os itens de evidence[] por kind.
 *
 * Só se aplica ao formato novo (evidence é array).
 * Retorna [] para o formato antigo, que não tem test evidence estruturado.
 *
 * Filtra kind "command" e "test"; mapeia para { command: ref, passed, detail }.
 * passed = (exit === 0); null quando exit está ausente.
 */
export function deriveTestEvidence(packet: RawPacket): DispatchTestEvidence[] {
  if (!isNewFormat(packet)) return [];

  const evidence = packet["evidence"];
  if (!Array.isArray(evidence)) return [];

  return evidence
    .filter((e): e is RawPacket => e !== null && typeof e === "object")
    .filter((e) => e["kind"] === "command" || e["kind"] === "test")
    .filter((e) => typeof e["ref"] === "string" && e["ref"] !== "")
    .map((e) => {
      const command = e["ref"] as string;
      const exitCode = e["exit"];
      const passed =
        typeof exitCode === "number" ? exitCode === 0 : null;
      const detail =
        typeof e["detail"] === "string" ? e["detail"] : null;
      return { command, passed, detail };
    });
}
