import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeliveryReport } from "./delivery-report.js";

const dirs: string[] = [];
function specDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-delivery-"));
  dirs.push(d);
  return d;
}
function write(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Report mínimo, parametrizado pelo nome do container (answers|questions).
function report(container: "answers" | "questions") {
  return JSON.stringify({
    spec_id: "FEAT-X",
    output_locale: "pt-BR",
    generated_at: "2026-06-07T12:00:00Z",
    schema_version: 1,
    verdict: { value: "approved_with_caveats", rationale: "ok", evidence_refs: ["outputs/a.json"] },
    [container]: {
      what_was_done: { answer: "fez X", confidence: "recorded", evidence_refs: ["d#f"] },
      acceptance_criteria: { answer: "prosa sobre ACs", confidence: "inferred", evidence_refs: [] },
      final_verdict: { answer: "veredicto", confidence: "recorded", evidence_refs: [] },
    },
    acceptance_criteria: [
      { id: "AC-001", description: "faz isso", classification: "met", evidence_refs: ["o#1"] },
    ],
  });
}

describe("readDeliveryReport — normalização answers|questions", () => {
  it("lê o container 'answers'", () => {
    const d = specDir();
    write(d, "delivery-report.json", report("answers"));
    const r = readDeliveryReport(d);
    expect(r).not.toBeNull();
    expect(r!.container).toBe("answers");
    expect(r!.verdict?.value).toBe("approved_with_caveats");
    expect(r!.answers.map((a) => a.key)).toEqual(["what_was_done", "acceptance_criteria", "final_verdict"]);
  });
});

describe("readDeliveryReport — robustez", () => {
  it("container 'questions' normaliza IGUAL a 'answers'", () => {
    const a = specDir();
    write(a, "delivery-report.json", report("answers"));
    const q = specDir();
    write(q, "delivery-report.json", report("questions"));
    const ra = readDeliveryReport(a)!;
    const rq = readDeliveryReport(q)!;
    // Os DADOS normalizam idêntico; só `container` (marcador da chave de origem)
    // e `jsonPath` (tmp dir de cada um) diferem de propósito — excluí-los da
    // comparação é o ponto do teste: answers e questions viram a mesma forma.
    const data = (r: typeof ra) => ({ ...r, jsonPath: "", container: "answers" as const });
    expect(data(rq)).toEqual(data(ra));
    expect(rq.container).toBe("questions");
    expect(ra.container).toBe("answers");
  });

  it("sem delivery-report.json → null", () => {
    expect(readDeliveryReport(specDir())).toBeNull();
  });

  it("JSON malformado → null", () => {
    const d = specDir();
    write(d, "delivery-report.json", "{ não é json");
    expect(readDeliveryReport(d)).toBeNull();
  });

  it("sem delivery-report.md → mdPath null; com .md → mdPath setado", () => {
    const semMd = specDir();
    write(semMd, "delivery-report.json", report("answers"));
    expect(readDeliveryReport(semMd)!.mdPath).toBeNull();

    const comMd = specDir();
    write(comMd, "delivery-report.json", report("answers"));
    write(comMd, "delivery-report.md", "# narrativa");
    expect(readDeliveryReport(comMd)!.mdPath).toContain("delivery-report.md");
  });

  it("enum desconhecido passa adiante intacto (sem whitelist)", () => {
    const d = specDir();
    write(d, "delivery-report.json", JSON.stringify({
      verdict: { value: "shipped_to_mars", rationale: "", evidence_refs: [] },
      answers: { what_was_done: { answer: "x", confidence: "guessed", evidence_refs: [] } },
      acceptance_criteria: [{ id: "AC-1", description: "d", classification: "kinda_met", evidence_refs: [] }],
    }));
    const r = readDeliveryReport(d)!;
    expect(r.verdict?.value).toBe("shipped_to_mars");
    expect(r.answers[0].confidence).toBe("guessed");
    expect(r.acceptanceCriteria[0].classification).toBe("kinda_met");
  });

  it("colisão acceptance_criteria: array top-level vira tabela; chave homônima vira resposta", () => {
    const d = specDir();
    write(d, "delivery-report.json", report("answers"));
    const r = readDeliveryReport(d)!;
    // a tabela (top-level)
    expect(r.acceptanceCriteria).toHaveLength(1);
    expect(r.acceptanceCriteria[0].id).toBe("AC-001");
    // a resposta homônima (dentro do container)
    expect(r.answers.find((a) => a.key === "acceptance_criteria")?.answer).toBe("prosa sobre ACs");
  });
});
