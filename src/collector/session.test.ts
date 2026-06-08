/**
 * Testes de integração para src/collector/session.ts — injeção de dispatches (T-005)
 * e exposição de specPath (T-002 / AC-007).
 *
 * Cobre:
 *   - AC-001: cada Task ganha dispatches do collectDispatches casados por id
 *   - AC-007: specPath expõe path absoluto quando spec_ref existe em disco, null caso contrário
 *   - AC-009: tarefas sem match em dispatches recebem []
 *   - AC-010: dispatches em cada Task ficam ordenados por loop (garantido pelo collectDispatches)
 *   - NFR-001: conteúdo do spec.md não entra no Spec (campo ausente)
 *   - NFR-003: parseSession em FEAT-004 (136 dispatches / ~140 arquivos) completa sem erro
 *
 * Usa as sessões REAIS do ai-squad — não cria fixtures artificiais para os casos de
 * integração final. Os testes de unidade do formato antigo/novo ficam em dispatches.test.ts.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession } from "./session.js";

const FEAT_003 = `${process.env.HOME}/Developer/ai-squad/.agent-session/FEAT-003`;
const FEAT_004 = `${process.env.HOME}/Developer/ai-squad/.agent-session/FEAT-004`;

// ---------------------------------------------------------------------------
// AC-001 + NFR-003: parseSession contra FEAT-003 (formato antigo, 10 dispatches)
// ---------------------------------------------------------------------------

describe("parseSession — FEAT-003 (formato antigo)", () => {
  it("completa sem erro e retorna Spec válido (NFR-003)", () => {
    expect(() => parseSession(FEAT_003)).not.toThrow();
    const spec = parseSession(FEAT_003);
    expect(spec).not.toBeNull();
    expect(spec!.id).toBeTruthy();
  });

  it("AC-001: T-001 recebe dispatches não-vazios (manifest tem 10 dispatches de T-001)", () => {
    // FEAT-003 tem 10 dispatches todos de T-001 (mais AUDIT que é filtrado)
    const spec = parseSession(FEAT_003)!;
    const t001 = spec.tasks.find((t) => t.id === "T-001");
    expect(t001).toBeDefined();
    expect(t001!.dispatches.length).toBeGreaterThan(0);
  });

  it("AC-001: dispatches de T-001 têm role e loop populados (não são shells vazios)", () => {
    const spec = parseSession(FEAT_003)!;
    const t001 = spec.tasks.find((t) => t.id === "T-001")!;
    // Cada dispatch deve ter role não-vazio
    for (const d of t001.dispatches) {
      expect(typeof d.role).toBe("string");
      expect(d.role.length).toBeGreaterThan(0);
      expect(typeof d.loop).toBe("number");
    }
  });

  it("AC-009: tarefas sem dispatches no manifest recebem [] (não undefined)", () => {
    // FEAT-003 só tem T-001 no task_states mas pode ter só essa tarefa;
    // o importante é que TODAS as tasks tenham dispatches como array (nunca undefined)
    const spec = parseSession(FEAT_003)!;
    for (const task of spec.tasks) {
      expect(Array.isArray(task.dispatches)).toBe(true);
    }
  });

  it("AC-010: dispatches de T-001 estão ordenados por loop ascendente", () => {
    const spec = parseSession(FEAT_003)!;
    const t001 = spec.tasks.find((t) => t.id === "T-001")!;
    const loops = t001.dispatches.map((d) => d.loop);
    const sorted = [...loops].sort((a, b) => a - b);
    expect(loops).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// AC-001 + NFR-003: parseSession contra FEAT-004 (formato novo, 136 dispatches)
// ---------------------------------------------------------------------------

describe("parseSession — FEAT-004 (formato novo, 136 dispatches)", () => {
  it("completa sem erro mesmo com 136 dispatches / ~140 arquivos (NFR-003)", () => {
    expect(() => parseSession(FEAT_004)).not.toThrow();
    const spec = parseSession(FEAT_004);
    expect(spec).not.toBeNull();
  });

  it("AC-001: ao menos uma Task recebeu dispatches não-vazios", () => {
    const spec = parseSession(FEAT_004)!;
    const comDispatches = spec.tasks.filter((t) => t.dispatches.length > 0);
    expect(comDispatches.length).toBeGreaterThan(0);
  });

  it("AC-001: T-001 tem múltiplos dispatches (loops de dev+reviewer+qa)", () => {
    const spec = parseSession(FEAT_004)!;
    const t001 = spec.tasks.find((t) => t.id === "T-001");
    expect(t001).toBeDefined();
    // FEAT-004 T-001 tem loops: 2, então há pelo menos dev-l1 + review-l1 + qa-l1
    expect(t001!.dispatches.length).toBeGreaterThanOrEqual(3);
  });

  it("AC-009: dispatches com task_id 'FEAT-004' são ignorados (não viram tarefas-fantasma)", () => {
    // O manifest de FEAT-004 tem itens com task_id='FEAT-004' que devem ser descartados
    const spec = parseSession(FEAT_004)!;
    const ids = spec.tasks.map((t) => t.id);
    expect(ids).not.toContain("FEAT-004");
  });

  it("AC-009: todas as tasks têm dispatches como array (tarefas sem match recebem [])", () => {
    const spec = parseSession(FEAT_004)!;
    for (const task of spec.tasks) {
      expect(Array.isArray(task.dispatches)).toBe(true);
    }
  });

  it("AC-010: dispatches de cada Task estão ordenados por loop ascendente", () => {
    const spec = parseSession(FEAT_004)!;
    for (const task of spec.tasks) {
      if (task.dispatches.length < 2) continue;
      const loops = task.dispatches.map((d) => d.loop);
      const sorted = [...loops].sort((a, b) => a - b);
      expect(loops).toEqual(sorted);
    }
  });

  it("campos obrigatórios do Spec permanecem íntegros (id, tasks, status, cost)", () => {
    // Garante que a injeção de dispatches não corrompe os campos pré-existentes
    const spec = parseSession(FEAT_004)!;
    expect(spec.id).toBeTruthy();
    expect(Array.isArray(spec.tasks)).toBe(true);
    expect(spec.status).toBeTruthy();
    expect(spec.cost).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC-007 / NFR-001: specPath exposto no Spec
// Usa sessões temporárias (fixtures mínimas) para controlar a existência do spec.md
// ---------------------------------------------------------------------------

/**
 * Monta a estrutura REAL que o ai-squad produz: <projectRoot>/.agent-session/<id>/session.yml.
 * O spec_ref no session.yml é relativo à RAIZ DO PROJETO (ex.: "./.agent-session/FEAT-TEST/spec.md"),
 * e o spec.md mora em <projectRoot>/<specRealPath>. Reproduzir essa geometria é o que pega o bug
 * de duplicação de caminho — fixtures planas (session.yml e spec.md no mesmo dir) o mascaravam.
 */
function makeProject(opts: {
  specRef?: string;
  specRealPath?: string; // path do spec.md relativo à raiz do projeto; cria o arquivo se presente
}): { projectRoot: string; specDir: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), "aios-proj-test-"));
  const specDir = join(projectRoot, ".agent-session", "FEAT-TEST");
  mkdirSync(specDir, { recursive: true });
  const specRefLine = opts.specRef !== undefined ? `spec_ref: "${opts.specRef}"` : "";
  const yaml = [
    `task_id: "FEAT-TEST"`,
    `squad: "sdd"`,
    `feature_name: "Fixture de teste"`,
    `current_phase: "running"`,
    specRefLine,
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(join(specDir, "session.yml"), yaml, "utf-8");
  if (opts.specRealPath) {
    const abs = join(projectRoot, opts.specRealPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "# spec content", "utf-8");
  }
  return { projectRoot, specDir };
}

describe("parseSession — AC-007: specPath no Spec", () => {
  it("spec_ref relativo à raiz + arquivo existe → specPath aponta pro spec.md real (regressão: sem duplicar caminho)", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: "./.agent-session/FEAT-TEST/spec.md",
      specRealPath: ".agent-session/FEAT-TEST/spec.md",
    });
    const spec = parseSession(specDir, projectRoot)!;
    expect(spec).not.toBeNull();
    expect(spec.specPath).toBe(join(projectRoot, ".agent-session/FEAT-TEST/spec.md"));
    // o segmento .agent-session/FEAT-TEST aparece UMA vez, não duplicado
    expect(spec.specPath).not.toContain(".agent-session/FEAT-TEST/.agent-session");
  });

  it("projectRoot omitido → deriva a raiz do specDir (<raiz>/.agent-session/<id>) e resolve igual", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: "./.agent-session/FEAT-TEST/spec.md",
      specRealPath: ".agent-session/FEAT-TEST/spec.md",
    });
    const spec = parseSession(specDir)!;
    expect(spec.specPath).toBe(join(projectRoot, ".agent-session/FEAT-TEST/spec.md"));
  });

  it("spec_ref presente mas arquivo não existe em disco → specPath é null", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: "./.agent-session/FEAT-TEST/spec.md",
      specRealPath: undefined,
    });
    const spec = parseSession(specDir, projectRoot)!;
    expect(spec).not.toBeNull();
    expect(spec.specPath).toBeNull();
  });

  it("spec_ref AUSENTE mas spec.md existe no specDir (convenção ai-squad, sessions antigas) → resolve via convenção", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: undefined,
      specRealPath: ".agent-session/FEAT-TEST/spec.md",
    });
    const spec = parseSession(specDir, projectRoot)!;
    expect(spec.specPath).toBe(join(specDir, "spec.md"));
  });

  it("spec_ref ausente E sem spec.md no specDir → specPath é null", () => {
    const { projectRoot, specDir } = makeProject({ specRef: undefined });
    const spec = parseSession(specDir, projectRoot)!;
    expect(spec).not.toBeNull();
    expect(spec.specPath).toBeNull();
  });

  it("NFR-001: o Spec não expõe campo de conteúdo do spec.md (apenas specPath)", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: "./.agent-session/FEAT-TEST/spec.md",
      specRealPath: ".agent-session/FEAT-TEST/spec.md",
    });
    const spec = parseSession(specDir, projectRoot)!;
    // O objeto Spec não deve ter nenhum campo carregando o conteúdo do arquivo
    expect((spec as any).specContent).toBeUndefined();
    expect((spec as any).specText).toBeUndefined();
    expect((spec as any).specMarkdown).toBeUndefined();
  });

  it("specPath é sempre absoluto", () => {
    const { projectRoot, specDir } = makeProject({
      specRef: "./.agent-session/FEAT-TEST/spec.md",
      specRealPath: ".agent-session/FEAT-TEST/spec.md",
    });
    const spec = parseSession(specDir, projectRoot)!;
    expect(spec.specPath!.startsWith("/")).toBe(true);
  });
});
