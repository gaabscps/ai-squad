/**
 * Ponte entre o collector e os contratos canônicos de shared/schemas/.
 *
 * Importa os JSON Schemas por caminho intra-repo (monorepo) e deriva deles o
 * vocabulário que os leitores usam em runtime: chaves canônicas, patterns e
 * kinds. Os schemas crus também são re-exportados para os contract tests
 * (contracts.test.ts), que verificam campo a campo que tudo que o collector
 * lê continua declarado no contrato — uma mudança de schema que quebre a
 * leitura falha nos testes deste package, no mesmo PR.
 *
 * Read-only: este módulo só lê os schemas; nunca escreve em artefatos.
 */

import sessionSchema from "../../../../shared/schemas/session.schema.json";
import costReportSchema from "../../../../shared/schemas/cost-report.schema.json";
import deliveryReportSchema from "../../../../shared/schemas/delivery-report.schema.json";
import dispatchManifestSchema from "../../../../shared/schemas/dispatch-manifest.schema.json";
import outputPacketSchema from "../../../../shared/schemas/output-packet.schema.json";

export {
  sessionSchema,
  costReportSchema,
  deliveryReportSchema,
  dispatchManifestSchema,
  outputPacketSchema,
};

/**
 * As 11 chaves canônicas do delivery-report, na ordem de exibição —
 * derivadas do `required` do mapa `answers` no schema (ordem do contrato).
 */
export const DELIVERY_ANSWER_KEYS: readonly string[] =
  deliveryReportSchema.properties.answers.required;

/**
 * Pattern canônico de task_id (T-XXX, 3+ dígitos), derivado do
 * output-packet.schema.json. Filtra tarefas reais nos manifests
 * (exclui AUDIT, FEAT-XXX, T-001abc, T-1).
 */
export const TASK_ID_RE = new RegExp(outputPacketSchema.properties.task_id.pattern);

/**
 * Kinds da união discriminada de notes[] no session.yml
 * (pm_decision | pm_escalation | audit_override), derivados dos branches
 * oneOf do schema.
 */
export const SESSION_NOTE_KINDS: readonly string[] =
  sessionSchema.properties.notes.items.oneOf.map((b) => b.properties.kind.const);
