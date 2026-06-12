import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  DeliveryReport,
  DeliveryAnswer,
  DeliveryVerdict,
  DeliveryAcceptanceCriterion,
} from "../store/types.js";

import { DELIVERY_ANSWER_KEYS } from "./contracts.js";

// As 11 chaves canônicas, em ordem de exibição — derivadas do schema
// (delivery-report.schema.json, answers.required). O parser itera ESTA lista
// (não as chaves cruas do JSON) pra garantir ordem estável e tolerar ausências.
const CANONICAL_KEYS = DELIVERY_ANSWER_KEYS;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Lê <specDir>/delivery-report.json e devolve a forma normalizada, ou null se
 * não houver report (sessão antiga/em curso) ou o JSON for ilegível. Read-only.
 * Normaliza o container das 11 respostas: pode vir como `answers` (canônico) ou
 * `questions` (versões antigas do chronicler) — ambos o mesmo map de 11 chaves.
 */
export function readDeliveryReport(specDir: string): DeliveryReport | null {
  const jsonPath = join(specDir, "delivery-report.json");
  if (!existsSync(jsonPath)) return null;

  let raw: Record<string, any>;
  try {
    raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, any>;
  } catch {
    return null; // malformado: trata como ausência, não derruba o scan
  }
  if (!raw || typeof raw !== "object") return null;

  const hasAnswers = raw.answers && typeof raw.answers === "object";
  const hasQuestions = raw.questions && typeof raw.questions === "object";
  const blocks: Record<string, any> =
    hasAnswers ? raw.answers : hasQuestions ? raw.questions : {};
  const container: "answers" | "questions" = hasQuestions && !hasAnswers ? "questions" : "answers";

  const answers: DeliveryAnswer[] = [];
  for (const key of CANONICAL_KEYS) {
    const blk = blocks[key];
    if (!blk || typeof blk !== "object") continue;
    answers.push({
      key,
      answer: asString(blk.answer),
      confidence: asString(blk.confidence),
      evidenceRefs: asStringArray(blk.evidence_refs),
    });
  }

  let verdict: DeliveryVerdict | null = null;
  if (raw.verdict && typeof raw.verdict === "object") {
    verdict = {
      value: asString(raw.verdict.value),
      rationale: asString(raw.verdict.rationale),
      evidenceRefs: asStringArray(raw.verdict.evidence_refs),
    };
  }

  const acceptanceCriteria: DeliveryAcceptanceCriterion[] = Array.isArray(raw.acceptance_criteria)
    ? raw.acceptance_criteria
        .filter((ac: unknown) => ac && typeof ac === "object")
        .map((ac: any) => ({
          id: asString(ac.id),
          description: asString(ac.description),
          classification: asString(ac.classification),
          evidenceRefs: asStringArray(ac.evidence_refs),
        }))
    : [];

  const mdCandidate = join(specDir, "delivery-report.md");
  const mdPath = existsSync(mdCandidate) ? mdCandidate : null;

  return {
    specId: asString(raw.spec_id) || null,
    outputLocale: asString(raw.output_locale) || null,
    generatedAt: asString(raw.generated_at) || null,
    verdict,
    answers,
    acceptanceCriteria,
    container,
    mdPath,
    jsonPath,
  };
}
