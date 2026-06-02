export type ParsedEvent =
  | { kind: "chunk"; text: string }
  | { kind: "done"; text: string; costUsd: number | null }
  | { kind: "error"; message: string };

/**
 * Traduz UMA linha do stream-json do `claude --output-format=stream-json` num evento.
 * O CLI emite muito ruído (system/assistant/rate_limit/init); só nos interessam:
 *  - content_block_delta com text_delta → pedaço de texto (chunk)
 *  - result → texto final (done) ou falha (error)
 * Qualquer outra linha, vazio ou JSON inválido → null (ignora, nunca lança).
 */
export function parseStreamLine(line: string): ParsedEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;

  if (m.type === "stream_event") {
    const event = m.event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return { kind: "chunk", text: delta.text };
      }
    }
    return null;
  }

  if (m.type === "result") {
    if (m.is_error === true || m.subtype !== "success") {
      return { kind: "error", message: typeof m.result === "string" && m.result ? m.result : "geração falhou" };
    }
    const costUsd = typeof m.total_cost_usd === "number" ? m.total_cost_usd : null;
    return { kind: "done", text: typeof m.result === "string" ? m.result : "", costUsd };
  }

  return null;
}
