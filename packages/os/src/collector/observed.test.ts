/**
 * Testes de integração para src/collector/observed.ts — leitor de sessões observadas.
 *
 * TDD: testes escritos antes da implementação. Cada caso usa fixtures sintéticas
 * em packages/os/test/fixtures/obs-* que cobrem os cenários de ciclo de vida.
 *
 * Cobre:
 *   1. obs-aberto  — card normal em andamento
 *   2. obs-fechado — card done, lastActivityAt = closed_at
 *   3. obs-atencao — needs_attention + attentionKind
 *   4. obs-abandonado — status abandoned
 *   5. obs-drift — closed_at + status não-terminal → driftFlag
 *   6. obs-status-estranho — status fora do enum → driftFlag
 *   7. obs-ilegivel — YAML inválido em dir OBS-* → card degradado
 *   8. obs-legado-feat — session SDD sem mode: observed → null
 *   9. dir sem session.yml → null
 *  10. obs-aberto (sem closed_at) → lastActivityAt não-nulo (mtime de session.yml)
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSessionDir } from "./observed.js";

const here = dirname(fileURLToPath(import.meta.url));
// Caminho até packages/os/test/fixtures/ subindo de src/collector/ → src/ → packages/os/
const fixt = (name: string) => join(here, "..", "..", "test", "fixtures", name);

// ---------------------------------------------------------------------------
// 1. obs-aberto: card em andamento completo
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-aberto (OBS-010, in_progress)", () => {
  it("retorna Spec com id OBS-010", () => {
    const spec = readSessionDir(fixt("obs-aberto"));
    expect(spec).not.toBeNull();
    expect(spec!.id).toBe("OBS-010");
  });

  it("title é o intent da sessão", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.title).toBe("Fixar emails na dashboard");
  });

  it("status é 'running' (in_progress → running)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.status).toBe("running");
  });

  it("observed.decisions tem 2 itens", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.decisions).toHaveLength(2);
  });

  it("primeira decision tem rejected === null (campo ausente → null)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.decisions[0].rejected).toBeNull();
  });

  it("observed.evidence tem 1 item", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.evidence).toHaveLength(1);
  });

  it("timeline é [] (decisions/evidence não viram TimelineEntry)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.timeline).toEqual([]);
  });

  it("tasks é []", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.tasks).toEqual([]);
  });

  it("observed.driftFlags é [] (sem inconsistências)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    expect(spec.observed!.driftFlags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. obs-fechado: card done com closed_at
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-fechado (OBS-011, done)", () => {
  it("status é 'done'", () => {
    const spec = readSessionDir(fixt("obs-fechado"))!;
    expect(spec.status).toBe("done");
  });

  it("lastActivityAt === closed_at da sessão", () => {
    const spec = readSessionDir(fixt("obs-fechado"))!;
    expect(spec.lastActivityAt).toBe("2026-06-10T18:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// 3. obs-atencao: needs_attention com attention.kind
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-atencao (OBS-012, needs_attention)", () => {
  it("status é 'needs_attention'", () => {
    const spec = readSessionDir(fixt("obs-atencao"))!;
    expect(spec.status).toBe("needs_attention");
  });

  it("observed.attentionKind === 'input'", () => {
    const spec = readSessionDir(fixt("obs-atencao"))!;
    expect(spec.observed!.attentionKind).toBe("input");
  });
});

// ---------------------------------------------------------------------------
// 4. obs-abandonado: status abandoned
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-abandonado (OBS-013, abandoned)", () => {
  it("status é 'abandoned'", () => {
    const spec = readSessionDir(fixt("obs-abandonado"))!;
    expect(spec.status).toBe("abandoned");
  });
});

// ---------------------------------------------------------------------------
// 5. obs-drift: closed_at presente com status não-terminal → driftFlag
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-drift (OBS-014, drift closed_with_open_status)", () => {
  it("status é 'done' (closed_at vence o in_progress)", () => {
    const spec = readSessionDir(fixt("obs-drift"))!;
    expect(spec.status).toBe("done");
  });

  it("driftFlags contém 'closed_with_open_status'", () => {
    const spec = readSessionDir(fixt("obs-drift"))!;
    expect(spec.observed!.driftFlags).toContain("closed_with_open_status");
  });
});

// ---------------------------------------------------------------------------
// 6. obs-status-estranho: status fora do enum → driftFlag
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-status-estranho (OBS-015, status desconhecido)", () => {
  it("status é 'running' (sem closed_at, status desconhecido → running)", () => {
    const spec = readSessionDir(fixt("obs-status-estranho"))!;
    expect(spec.status).toBe("running");
  });

  it("driftFlags contém 'unknown_status'", () => {
    const spec = readSessionDir(fixt("obs-status-estranho"))!;
    expect(spec.observed!.driftFlags).toContain("unknown_status");
  });
});

// ---------------------------------------------------------------------------
// 7. OBS-016: YAML inválido em dir OBS-* → card degradado
// ---------------------------------------------------------------------------

describe("readSessionDir — OBS-016 (YAML inválido)", () => {
  it("retorna Spec não-nulo (card nunca some do board)", () => {
    const spec = readSessionDir(fixt("OBS-016"));
    expect(spec).not.toBeNull();
  });

  it("status é 'unreadable'", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.status).toBe("unreadable");
  });

  it("id é o basename do dir 'OBS-016'", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.id).toBe("OBS-016");
  });

  it("driftFlags === ['unreadable_yaml']", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.observed!.driftFlags).toEqual(["unreadable_yaml"]);
  });

  it("observed.decisions é []", () => {
    const spec = readSessionDir(fixt("OBS-016"))!;
    expect(spec.observed!.decisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. obs-legado-feat: session SDD (sem mode: observed) → null
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-legado-feat (FEAT-099, legado SDD)", () => {
  it("retorna null (filtrado do board observado)", () => {
    const spec = readSessionDir(fixt("obs-legado-feat"));
    expect(spec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. dir sem session.yml → null
// ---------------------------------------------------------------------------

describe("readSessionDir — dir sem session.yml", () => {
  it("retorna null quando session.yml não existe", () => {
    // spec-sem-custo existe como fixture e não tem session.yml
    const spec = readSessionDir(fixt("spec-sem-custo"));
    expect(spec).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. obs-aberto (sem closed_at): lastActivityAt derivado do mtime de session.yml
// ---------------------------------------------------------------------------

describe("readSessionDir — obs-aberto sem closed_at → lastActivityAt por mtime", () => {
  it("lastActivityAt é não-nulo (mtime de session.yml)", () => {
    const spec = readSessionDir(fixt("obs-aberto"))!;
    // Sem closed_at, cai para max(mtime de session.yml e costs/*.json)
    expect(spec.lastActivityAt).not.toBeNull();
  });
});
