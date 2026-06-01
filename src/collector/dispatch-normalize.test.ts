/**
 * Testes para as funções puras de normalização de packets (dois formatos).
 * Formato antigo: evidence é objeto { files_changed: [{path,...}], ac_implementations }
 * Formato novo:   evidence é array  [{ id, kind, ref, ... }]; files_changed é string[]
 */

import { describe, it, expect } from "vitest";
import {
  normalizeFilesChanged,
  normalizeFindings,
  deriveTestEvidence,
} from "./dispatch-normalize.js";

// ---------------------------------------------------------------------------
// Fixtures — formato antigo (evidence é objeto)
// ---------------------------------------------------------------------------

const packetAntigoSemFindings = {
  spec_id: "FEAT-003",
  dispatch_id: "dev-T-001-loop1",
  role: "dev",
  status: "done",
  summary: "Implementação inicial.",
  evidence: {
    files_changed: [
      { path: "src/foo.ts", lines_changed: 42, kind: "modified" },
      { path: "src/bar.ts", lines_changed: 10, kind: "created" },
    ],
    ac_implementations: { "AC-001": "src/foo.ts:10" },
  },
  findings: [],
  usage: null,
};

const packetAntigoComFindings = {
  spec_id: "FEAT-003",
  dispatch_id: "code-reviewer-T-001-loop1",
  role: "code-reviewer",
  status: "needs_changes",
  summary: "Revisão com findings.",
  evidence: {
    files_reviewed: ["src/foo.ts"],
    patterns_checked: ["naming"],
  },
  findings: [
    {
      severity: "major",
      file: "src/foo.ts",
      line: 42,
      ac_ref: "AC-001",
      issue: "Problema grave aqui.",
      suggestion: "Corrigir desta forma.",
    },
    {
      severity: "minor",
      file: "src/bar.ts",
      line: 7,
      ac_ref: "AC-002",
      issue: "Problema menor.",
      suggestion: "Ajustar assim.",
    },
    {
      severity: "nit",
      file: null,
      line: null,
      ac_ref: "AC-003",
      issue: "Detalhe sem arquivo.",
      suggestion: "Considerar renomear.",
    },
  ],
  usage: null,
};

const packetAntigoFindingComLineStart = {
  spec_id: "FEAT-003",
  dispatch_id: "code-reviewer-T-001-loop2",
  role: "code-reviewer",
  status: "needs_changes",
  summary: "Revisão loop 2.",
  evidence: { files_reviewed: [] },
  findings: [
    {
      severity: "major",
      file: "src/qux.ts",
      line_start: 15,
      issue: "Outro problema.",
      suggestion: "Outra correção.",
    },
  ],
  usage: null,
};

// ---------------------------------------------------------------------------
// Fixtures — formato novo (evidence é array)
// ---------------------------------------------------------------------------

const packetNovoDevComEvidence = {
  spec_id: "FEAT-004",
  dispatch_id: "d-T-001-dev-l1",
  role: "dev",
  status: "done",
  summary: "Implementou helpers.",
  evidence: [
    { id: "e-001", kind: "file", ref: "squads/sdd/hooks/_pm_shared.py" },
    { id: "e-002", kind: "file", ref: "squads/sdd/hooks/__tests__/test_pm_shared.py" },
    {
      id: "e-003",
      kind: "command",
      ref: "python3 -m unittest squads.sdd.hooks.__tests__.test_pm_shared -v",
      exit: 0,
      detail: "44 tests OK",
    },
    {
      id: "e-004",
      kind: "command",
      ref: "python3 -m unittest discover -s squads/sdd/hooks/__tests__ -p test_*.py",
      exit: 0,
      detail: "104 tests OK",
    },
  ],
  files_changed: [
    "squads/sdd/hooks/_pm_shared.py",
    "squads/sdd/hooks/__tests__/test_pm_shared.py",
  ],
  findings: [],
  usage: null,
};

const packetNovoReviewerComFindings = {
  spec_id: "FEAT-004",
  dispatch_id: "d-T-002-code-reviewer-l1",
  role: "code-reviewer",
  status: "needs_review",
  summary: "Findings no schema.",
  evidence: [
    { id: "e-001", kind: "file", ref: "shared/schemas/dispatch-manifest.schema.json" },
  ],
  findings: [
    {
      id: "f-001",
      file: "shared/schemas/dispatch-manifest.schema.json",
      line: 41,
      severity: "major",
      dimension: "naming",
      rationale: "acScope é camelCase; demais propriedades são snake_case.",
    },
    {
      id: "f-002",
      file: "shared/schemas/dispatch-manifest.schema.json",
      line_start: 47,
      severity: "major",
      dimension: "naming",
      rationale: "tasksCovered é camelCase; mesma violação.",
    },
    {
      id: "f-003",
      file: "shared/schemas/dispatch-manifest.schema.json",
      line_start: 8,
      line_end: 10,
      severity: "minor",
      dimension: "design",
      rationale: "additionalProperties: true sem comentário explicando NFR.",
    },
  ],
  files_changed: [],
  usage: null,
};

const packetNovoComEvidenceTest = {
  spec_id: "FEAT-004",
  dispatch_id: "d-T-003-dev-l1",
  role: "dev",
  status: "done",
  summary: "Com test evidence.",
  evidence: [
    { id: "e-001", kind: "file", ref: "src/main.py" },
    {
      id: "e-002",
      kind: "test",
      ref: "pytest src/test_main.py",
      exit: 0,
      detail: "12 passed",
    },
    {
      id: "e-003",
      kind: "command",
      ref: "mypy src/main.py",
      exit: 1,
      detail: "2 errors",
    },
    {
      id: "e-004",
      kind: "command",
      ref: "black --check src/",
      exit: 0,
      detail: null,
    },
  ],
  files_changed: ["src/main.py"],
  findings: [],
  usage: null,
};

const packetNovoEvidenceVazia = {
  spec_id: "FEAT-004",
  dispatch_id: "d-T-004-dev-l1",
  role: "dev",
  status: "done",
  summary: "Sem evidence items.",
  evidence: [] as unknown[],
  files_changed: ["src/empty.py"],
  findings: [],
  usage: null,
};

const packetSemEvidence = {
  spec_id: "FEAT-XXX",
  dispatch_id: "d-T-001-dev-l1",
  role: "dev",
  status: "done",
  summary: "Sem campo evidence.",
  findings: [],
  usage: null,
} as Record<string, unknown>;

// ---------------------------------------------------------------------------
// normalizeFilesChanged
// ---------------------------------------------------------------------------

describe("normalizeFilesChanged", () => {
  describe("formato antigo (evidence é objeto)", () => {
    it("extrai path de cada item de evidence.files_changed", () => {
      const result = normalizeFilesChanged(packetAntigoSemFindings);
      expect(result).toEqual(["src/foo.ts", "src/bar.ts"]);
    });

    it("retorna [] quando evidence.files_changed está ausente", () => {
      const packet = {
        ...packetAntigoComFindings,
        evidence: { files_reviewed: ["x.ts"] },
      };
      const result = normalizeFilesChanged(packet);
      expect(result).toEqual([]);
    });

    it("retorna [] quando evidence.files_changed é array vazio", () => {
      const packet = {
        ...packetAntigoSemFindings,
        evidence: { files_changed: [] },
      };
      const result = normalizeFilesChanged(packet);
      expect(result).toEqual([]);
    });

    it("ignora itens sem campo path (não inventa string)", () => {
      const packet = {
        ...packetAntigoSemFindings,
        evidence: {
          files_changed: [
            { path: "src/ok.ts", kind: "modified" },
            { kind: "created" },
            { path: "src/also-ok.ts" },
          ],
        },
      };
      const result = normalizeFilesChanged(packet);
      expect(result).toEqual(["src/ok.ts", "src/also-ok.ts"]);
    });
  });

  describe("formato novo (evidence é array, files_changed é string[])", () => {
    it("usa files_changed diretamente como string[]", () => {
      const result = normalizeFilesChanged(packetNovoDevComEvidence);
      expect(result).toEqual([
        "squads/sdd/hooks/_pm_shared.py",
        "squads/sdd/hooks/__tests__/test_pm_shared.py",
      ]);
    });

    it("retorna [] quando files_changed está ausente no formato novo", () => {
      const packet = { ...packetNovoReviewerComFindings, files_changed: undefined };
      const result = normalizeFilesChanged(packet);
      expect(result).toEqual([]);
    });

    it("retorna [] quando files_changed é array vazio", () => {
      const result = normalizeFilesChanged(packetNovoReviewerComFindings);
      expect(result).toEqual([]);
    });
  });

  describe("casos de borda", () => {
    it("retorna [] quando evidence está ausente", () => {
      const result = normalizeFilesChanged(packetSemEvidence);
      expect(result).toEqual([]);
    });

    it("retorna [] quando packet é objeto vazio", () => {
      const result = normalizeFilesChanged({});
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeFindings
// ---------------------------------------------------------------------------

describe("normalizeFindings", () => {
  describe("formato antigo", () => {
    it("mapeia severity + file + line + issue+suggestion como text", () => {
      const result = normalizeFindings(packetAntigoComFindings);
      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        severity: "major",
        file: "src/foo.ts",
        line: 42,
        text: "Problema grave aqui. Corrigir desta forma.",
      });

      expect(result[1]).toEqual({
        severity: "minor",
        file: "src/bar.ts",
        line: 7,
        text: "Problema menor. Ajustar assim.",
      });
    });

    it("aceita file: null e line: null sem quebrar", () => {
      const result = normalizeFindings(packetAntigoComFindings);
      expect(result[2]).toEqual({
        severity: "nit",
        file: null,
        line: null,
        text: "Detalhe sem arquivo. Considerar renomear.",
      });
    });

    it("usa line_start quando line está ausente (D3)", () => {
      const result = normalizeFindings(packetAntigoFindingComLineStart);
      expect(result[0].line).toBe(15);
    });

    it("retorna [] quando findings está ausente", () => {
      const packet = { ...packetAntigoSemFindings };
      const result = normalizeFindings(packet);
      expect(result).toEqual([]);
    });

    it("retorna [] quando findings é array vazio", () => {
      expect(normalizeFindings(packetAntigoSemFindings)).toEqual([]);
    });
  });

  describe("formato novo", () => {
    it("mapeia severity + file + line + rationale como text", () => {
      const result = normalizeFindings(packetNovoReviewerComFindings);
      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        severity: "major",
        file: "shared/schemas/dispatch-manifest.schema.json",
        line: 41,
        text: "acScope é camelCase; demais propriedades são snake_case.",
      });
    });

    it("usa line_start quando line está ausente (formato novo)", () => {
      const result = normalizeFindings(packetNovoReviewerComFindings);
      expect(result[1].line).toBe(47);
    });

    it("usa line_start quando há line_start E line_end mas não line", () => {
      const result = normalizeFindings(packetNovoReviewerComFindings);
      expect(result[2].line).toBe(8);
    });

    it("retorna [] quando findings é array vazio", () => {
      expect(normalizeFindings(packetNovoDevComEvidence)).toEqual([]);
    });
  });

  describe("casos de borda", () => {
    it("retorna [] quando findings está ausente no packet", () => {
      const result = normalizeFindings(packetSemEvidence);
      expect(result).toEqual([]);
    });

    it("retorna [] para packet vazio", () => {
      expect(normalizeFindings({})).toEqual([]);
    });

    it("não inclui finding com issue/suggestion vazios (concatena o que existe)", () => {
      const packet = {
        ...packetAntigoComFindings,
        findings: [
          { severity: "minor", file: "x.ts", line: 1, issue: "Só issue.", suggestion: "" },
          { severity: "minor", file: "y.ts", line: 2, issue: "", suggestion: "Só suggestion." },
        ],
      };
      const result = normalizeFindings(packet);
      expect(result[0].text).toBe("Só issue.");
      expect(result[1].text).toBe("Só suggestion.");
    });
  });
});

// ---------------------------------------------------------------------------
// deriveTestEvidence
// ---------------------------------------------------------------------------

describe("deriveTestEvidence", () => {
  describe("formato novo — filtra command e test", () => {
    it("mapeia command e test para {command, passed, detail}", () => {
      const result = deriveTestEvidence(packetNovoComEvidenceTest);
      expect(result).toHaveLength(3);

      expect(result[0]).toEqual({
        command: "pytest src/test_main.py",
        passed: true,
        detail: "12 passed",
      });

      expect(result[1]).toEqual({
        command: "mypy src/main.py",
        passed: false,
        detail: "2 errors",
      });

      expect(result[2]).toEqual({
        command: "black --check src/",
        passed: true,
        detail: null,
      });
    });

    it("não inclui itens com kind file", () => {
      const result = deriveTestEvidence(packetNovoComEvidenceTest);
      const refs = result.map((e) => e.command);
      expect(refs).not.toContain("src/main.py");
    });

    it("passed=false quando exit !== 0", () => {
      const result = deriveTestEvidence(packetNovoComEvidenceTest);
      const mypy = result.find((e) => e.command.includes("mypy"));
      expect(mypy?.passed).toBe(false);
    });

    it("passed=true quando exit === 0", () => {
      const result = deriveTestEvidence(packetNovoDevComEvidence);
      expect(result.every((e) => e.passed === true)).toBe(true);
    });

    it("retorna [] quando evidence é array vazio", () => {
      const result = deriveTestEvidence(packetNovoEvidenceVazia);
      expect(result).toEqual([]);
    });

    it("retorna [] quando evidence não tem command nem test", () => {
      const packet = {
        ...packetNovoDevComEvidence,
        evidence: [
          { id: "e-001", kind: "file", ref: "src/foo.py" },
          { id: "e-002", kind: "file", ref: "src/bar.py" },
        ],
      };
      const result = deriveTestEvidence(packet);
      expect(result).toEqual([]);
    });
  });

  describe("formato antigo — sempre retorna []", () => {
    it("retorna [] para packet antigo sem campo evidence array", () => {
      const result = deriveTestEvidence(packetAntigoSemFindings);
      expect(result).toEqual([]);
    });

    it("retorna [] para packet antigo com findings", () => {
      const result = deriveTestEvidence(packetAntigoComFindings);
      expect(result).toEqual([]);
    });
  });

  describe("casos de borda", () => {
    it("retorna [] quando evidence está ausente", () => {
      const result = deriveTestEvidence(packetSemEvidence);
      expect(result).toEqual([]);
    });

    it("retorna [] para packet vazio", () => {
      expect(deriveTestEvidence({})).toEqual([]);
    });

    it("passed=null quando exit está ausente (melhor-esforço)", () => {
      const packet = {
        ...packetNovoDevComEvidence,
        evidence: [
          { id: "e-001", kind: "command", ref: "npm test" },
        ],
      };
      const result = deriveTestEvidence(packet);
      expect(result[0].passed).toBeNull();
    });

    it("descarta itens command/test sem ref string válida (ref ausente, nula ou não-string)", () => {
      const packet = {
        ...packetNovoDevComEvidence,
        evidence: [
          { id: "e-001", kind: "command", ref: "npm test", exit: 0 },
          { id: "e-002", kind: "command" },
          { id: "e-003", kind: "command", ref: null },
          { id: "e-004", kind: "command", ref: 42 },
          { id: "e-005", kind: "test", ref: "pytest tests/", exit: 0 },
        ],
      };
      const result = deriveTestEvidence(packet);
      expect(result).toHaveLength(2);
      expect(result[0].command).toBe("npm test");
      expect(result[1].command).toBe("pytest tests/");
    });
  });
});
