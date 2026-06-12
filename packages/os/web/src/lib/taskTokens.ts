import type { Task } from "../../../src/store/types";

/**
 * Soma os tokens de todos os dispatches de uma tarefa, ignorando os null (best-effort).
 * Retorna null se não houver nenhum valor numérico — nunca retorna 0 em lugar de null.
 */
export function taskTotalTokens(task: Task): number | null {
  let total = 0;
  let found = false;

  for (const dispatch of task.dispatches) {
    if (dispatch.tokens !== null) {
      total += dispatch.tokens;
      found = true;
    }
  }

  return found ? total : null;
}
