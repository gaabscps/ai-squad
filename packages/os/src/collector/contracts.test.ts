/**
 * Contract tests: o vocabulário que cada leitor do collector consome existe
 * (com o tipo/enum esperado) nos schemas canônicos de shared/schemas/.
 *
 * Os schemas chegam por import direto intra-repo (contracts.ts), então uma
 * mudança de schema que quebre a leitura — campo renomeado/removido, enum
 * alterado, pattern mudado — falha AQUI, no mesmo PR que mudou o schema.
 *
 * Cada describe cobre um par leitor ↔ schema; as listas de campos enumeram
 * exatamente o que o leitor acessa no artefato bruto.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  sessionSchema,
  costReportSchema,
  deliveryReportSchema,
  dispatchManifestSchema,
  outputPacketSchema,
  observedSessionSchema,
  DELIVERY_ANSWER_KEYS,
  TASK_ID_RE,
  SESSION_NOTE_KINDS,
  OBSERVED_STATUSES,
  OBSERVED_REQUIRED,
  OBSERVED_FIELDS,
} from "./contracts.js";
import type {
  DeliveryConfidence,
  DeliveryVerdictValue,
  DeliveryAcClassification,
} from "../store/types.js";

// ---------------------------------------------------------------------------
// session.schema.json ↔ session.ts
// ---------------------------------------------------------------------------

describe("contrato session.schema ↔ session.ts", () => {
  const props = sessionSchema.properties;

  it("todo campo top-level que parseSession lê está declarado no schema", () => {
    const read = [
      "spec_id",
      "task_id",
      "feature_name",
      "squad",
      "current_phase",
      "planned_phases",
      "spec_ref",
      "last_activity_at",
      "task_states",
      "notes",
      "escalation_metrics",
    ];
    expect(Object.keys(props)).toEqual(expect.arrayContaining(read));
  });

  it("o enum de current_phase contém os valores que deriveStatus compara", () => {
    expect(props.current_phase.enum).toEqual(
      expect.arrayContaining(["done", "escalated", "paused"]),
    );
  });

  it("paused_at e audit_exception NÃO existem no contrato (leitor não deve consultá-los)", () => {
    // paused é detectado via current_phase; auditoria vive em notes[] (audit_override)
    expect(sessionSchema.additionalProperties).toBe(false);
    expect(props).not.toHaveProperty("paused_at");
    expect(props).not.toHaveProperty("audit_exception");
  });

  it("squad tem o valor 'discovery' usado no branch de squad", () => {
    expect(props.squad.enum).toContain("discovery");
  });

  it("task_states declara state com os valores que o collector consome", () => {
    const stateEnum = props.task_states.additionalProperties.properties.state.enum;
    expect(stateEnum).toEqual(expect.arrayContaining(["pending", "running", "done", "blocked"]));
  });

  it("escalation_metrics declara os campos lidos para health", () => {
    expect(Object.keys(props.escalation_metrics.properties)).toEqual(
      expect.arrayContaining(["pending_human_tasks", "escalation_rate"]),
    );
  });

  it("notes é união discriminada com os kinds que o timeline e auditException conhecem", () => {
    expect(SESSION_NOTE_KINDS).toEqual(["pm_decision", "pm_escalation", "audit_override"]);
  });

  it("cada kind de notes exige os campos que deriveNoteText usa", () => {
    const byKind = Object.fromEntries(
      sessionSchema.properties.notes.items.oneOf.map((b) => [b.properties.kind.const, b.required]),
    );
    expect(byKind.pm_decision).toEqual(expect.arrayContaining(["artifact_path", "gate_applied"]));
    expect(byKind.pm_escalation).toEqual(
      expect.arrayContaining(["artifact_path", "open_questions"]),
    );
    expect(byKind.audit_override).toEqual(expect.arrayContaining(["path", "authorized_by"]));
  });
});

// ---------------------------------------------------------------------------
// cost-report.schema.json ↔ cost-report.ts
// ---------------------------------------------------------------------------

describe("contrato cost-report.schema ↔ cost-report.ts", () => {
  const props = costReportSchema.properties;

  it("todo campo que readCostReport lê está declarado no schema", () => {
    const read = [
      "planning_cost_usd",
      "orchestration_cost_usd",
      "implementation_cost_usd",
      "total_cost_usd",
      "excluded_subagents",
      "recovered_subagents",
      "scoping_suspect",
      "unpriced_models",
      "complete",
      "tokens",
    ];
    expect(Object.keys(props)).toEqual(expect.arrayContaining(read));
  });

  it("os campos numéricos/booleanos lidos têm o tipo que a normalização espera", () => {
    expect(props.total_cost_usd.type).toBe("number");
    expect(props.planning_cost_usd.type).toBe("number");
    expect(props.orchestration_cost_usd.type).toBe("number");
    expect(props.implementation_cost_usd.type).toBe("number");
    expect(props.excluded_subagents.type).toBe("integer");
    expect(props.recovered_subagents.type).toBe("integer");
    expect(props.scoping_suspect.type).toBe("boolean");
    expect(props.complete.type).toBe("boolean");
    expect(props.unpriced_models.type).toBe("array");
  });

  it("tokens declara by_type e total (o caminho que readCostReport navega)", () => {
    expect(props.tokens.required).toEqual(expect.arrayContaining(["by_type", "total"]));
    expect(Object.keys(props.tokens.properties)).toEqual(
      expect.arrayContaining(["by_type", "total"]),
    );
    expect(props.tokens.properties.total.type).toBe("integer");
  });
});

// ---------------------------------------------------------------------------
// delivery-report.schema.json ↔ delivery-report.ts (e enums do store)
// ---------------------------------------------------------------------------

describe("contrato delivery-report.schema ↔ delivery-report.ts", () => {
  const props = deliveryReportSchema.properties;

  it("as 11 chaves canônicas derivam do schema, na ordem das properties", () => {
    expect(DELIVERY_ANSWER_KEYS).toHaveLength(11);
    expect([...DELIVERY_ANSWER_KEYS]).toEqual(Object.keys(props.answers.properties));
  });

  it("cada answer exige answer+confidence (campos lidos pelo parser)", () => {
    expect(deliveryReportSchema.$defs.answer.required).toEqual(["answer", "confidence"]);
    expect(Object.keys(deliveryReportSchema.$defs.answer.properties)).toEqual(
      expect.arrayContaining(["answer", "confidence", "evidence_refs"]),
    );
  });

  it("o enum de confidence bate com DeliveryConfidence do store (UI roteia sobre ele)", () => {
    const known: DeliveryConfidence[] = ["recorded", "inferred", "not_recorded"];
    expect(deliveryReportSchema.$defs.answer.properties.confidence.enum).toEqual(known);
  });

  it("verdict exige value+rationale e o enum bate com DeliveryVerdictValue do store", () => {
    expect(props.verdict.required).toEqual(["value", "rationale"]);
    const known: DeliveryVerdictValue[] = [
      "approved",
      "approved_with_caveats",
      "needs_changes",
      "blocked",
      "needs_human_review",
    ];
    expect(props.verdict.properties.value.enum).toEqual(known);
  });

  it("acceptance_criteria exige id+classification e o enum bate com DeliveryAcClassification", () => {
    expect(props.acceptance_criteria.items.required).toEqual(["id", "classification"]);
    const known: DeliveryAcClassification[] = ["met", "partially_met", "not_met", "not_validated"];
    expect(props.acceptance_criteria.items.properties.classification.enum).toEqual(known);
  });

  it("os campos de metadados lidos (spec_id, output_locale, generated_at) existem", () => {
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["spec_id", "output_locale", "generated_at"]),
    );
  });
});

// ---------------------------------------------------------------------------
// dispatch-manifest.schema.json ↔ dispatches.ts
// ---------------------------------------------------------------------------

describe("contrato dispatch-manifest.schema ↔ dispatches.ts", () => {
  it("actual_dispatches é obrigatório no manifest (readManifest exige o array)", () => {
    expect(dispatchManifestSchema.required).toContain("actual_dispatches");
  });

  it("todo campo de item que buildDispatch lê está declarado no schema", () => {
    const itemProps = dispatchManifestSchema.properties.actual_dispatches.items.properties;
    const read = ["dispatch_id", "task_id", "role", "loop", "status", "output_packet_ref", "usage"];
    expect(Object.keys(itemProps)).toEqual(expect.arrayContaining(read));
  });

  it("usage (quando objeto) declara total_tokens inteiro (única fonte de tokens por dispatch)", () => {
    const usage = dispatchManifestSchema.properties.actual_dispatches.items.properties.usage;
    const objectBranch = usage.oneOf.find((b) => b.type === "object")!;
    expect(objectBranch.required).toContain("total_tokens");
    expect(objectBranch.properties!.total_tokens.type).toBe("integer");
  });
});

// ---------------------------------------------------------------------------
// output-packet.schema.json ↔ dispatches.ts / dispatch-normalize.ts
// ---------------------------------------------------------------------------

describe("contrato output-packet.schema ↔ dispatches/dispatch-normalize", () => {
  const props = outputPacketSchema.properties;

  it("TASK_ID_RE é exatamente o pattern canônico de task_id", () => {
    expect(TASK_ID_RE.source).toBe(props.task_id.pattern);
    expect(TASK_ID_RE.test("T-001")).toBe(true);
    expect(TASK_ID_RE.test("T-12")).toBe(false);
    expect(TASK_ID_RE.test("AUDIT")).toBe(false);
    expect(TASK_ID_RE.test("FEAT-004")).toBe(false);
    expect(TASK_ID_RE.test("T-001abc")).toBe(false);
  });

  it("todo campo de packet que o normalizador lê está declarado no schema", () => {
    const read = ["summary", "files_changed", "findings", "evidence", "usage"];
    expect(Object.keys(props)).toEqual(expect.arrayContaining(read));
  });

  it("findings exigem id+severity (campos que normalizeFindings consome)", () => {
    expect(props.findings.items.required).toEqual(["id", "severity"]);
    expect(props.findings.items.properties.severity.enum.length).toBeGreaterThan(0);
  });

  it("evidence exige id+kind e o enum de kind contém command/test (deriveTestEvidence filtra)", () => {
    expect(props.evidence.items.required).toEqual(["id", "kind"]);
    expect(props.evidence.items.properties.kind.enum).toEqual(
      expect.arrayContaining(["command", "test"]),
    );
  });

  it("files_changed é array de string (formato novo lido direto do topo)", () => {
    expect(props.files_changed.type).toBe("array");
    expect(props.files_changed.items.type).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// observed-session.schema.json — contrato do modo observado
// ---------------------------------------------------------------------------

describe("contrato observed-session.schema", () => {
  it("OBSERVED_STATUSES é exatamente o ciclo de vida canônico", () => {
    expect([...OBSERVED_STATUSES]).toEqual([
      "in_progress",
      "needs_attention",
      "done",
      "abandoned",
    ]);
  });

  it("OBSERVED_REQUIRED ⊆ OBSERVED_FIELDS", () => {
    const fields = new Set(OBSERVED_FIELDS);
    for (const r of OBSERVED_REQUIRED) {
      expect(fields.has(r)).toBe(true);
    }
  });

  it("skill.md extraction test (produtor↔contrato)", () => {
    // Localiza skill.md: de packages/os/src/collector/ subimos 4 níveis (repo root),
    // depois descemos para shared/skills/observe/skill.md.
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(here, "..", "..", "..", "..");
    const skillMd = readFileSync(join(repoRoot, "shared/skills/observe/skill.md"), "utf-8");

    // Extrai o PRIMEIRO bloco ```yaml fenced do skill.md
    const match = skillMd.match(/```yaml\n([\s\S]*?)```/);
    expect(match).not.toBeNull();
    const example = parseYaml(match![1]) as Record<string, unknown>;

    const exampleKeys = Object.keys(example);
    const fields = new Set(OBSERVED_FIELDS);
    const requiredSet = new Set(OBSERVED_REQUIRED);

    // (a) todo campo do exemplo está em OBSERVED_FIELDS
    for (const key of exampleKeys) {
      expect(fields.has(key)).toBe(true);
    }

    // (b) todo campo obrigatório está no exemplo (o exemplo abre com todos os required)
    for (const r of requiredSet) {
      expect(exampleKeys).toContain(r);
    }

    // (c) example.status ∈ OBSERVED_STATUSES
    expect([...OBSERVED_STATUSES]).toContain(example.status as string);

    // (d) example.mode === "observed"
    expect(example.mode).toBe("observed");
  });
});
