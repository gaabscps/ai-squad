import type { Spec } from "../../../src/store/types";

/** Rótulos masculinos curtos pt-BR por status — usados no badge e na tabela.
 *  Nota: buildStory mantém um mapa feminino próprio para a prosa narrativa
 *  (e.g. "bloqueada" vs "bloqueado" aqui) — dualidade intencional. */
export const STATUS_LABEL: Record<Spec["status"], string> = {
  running: "rodando",
  paused: "pausado",
  blocked: "bloqueado",
  done: "concluído",
  escalated: "escalado",
  needs_attention: "precisa de você",
  abandoned: "abandonado",
  unreadable: "ilegível",
};
