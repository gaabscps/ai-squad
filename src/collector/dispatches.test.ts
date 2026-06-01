/**
 * Testes para src/collector/dispatches.ts
 *
 * Cobre:
 *   - AC-001: campos ricos (filesChanged, findings, testEvidence) populados via normalizadores
 *   - AC-002: usa output_packet_ref do manifest (não monta o caminho)
 *   - AC-007: tokens vêm de manifest.usage.total_tokens (nunca do packet)
 *   - AC-008: tokens null quando usage ausente ou total_tokens não-numérico
 *   - AC-009: filtra task_id que não casa ^T-\d+ (ex.: AUDIT, FEAT-XXX)
 *   - AC-010: dispatches ordenados por loop ascendente
 *   - AC-011: spec sem dispatch-manifest.json → mapa vazio
 *   - AC-012: manifest JSON inválido → mapa vazio (sem derrubar outros)
 *   - AC-013: packet ausente/corrompido → Dispatch manifest-only (campos ricos vazios)
 *   - AC-014: packet parcial/truncado → mesma degradação de AC-013
 *   - NFR-001: módulo não importa APIs de escrita de fs
 *   - NFR-002: resiliência total — qualquer falha degrada para vazio naquele ponto
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest, resolvePacketSafe, loadDispatchMap, collectDispatches } from "./dispatches.js";

// Diretórios de fixture (absolutos, resolvidos a partir deste arquivo)
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");
const DIR_ANTIGO = join(FIXTURES, "dispatches-antigo");
const DIR_NOVO = join(FIXTURES, "dispatches-novo");
const DIR_BORDA = join(FIXTURES, "dispatches-borda");
const DIR_SEM_MANIFEST = join(FIXTURES, "spec-sem-custo"); // diretório que existe mas sem manifest

// ---------------------------------------------------------------------------
// readManifest
// ---------------------------------------------------------------------------

describe("readManifest", () => {
  it("lê e parseia dispatch-manifest.json do formato antigo", () => {
    const manifest = readManifest(DIR_ANTIGO);
    expect(manifest).not.toBeNull();
    expect(Array.isArray(manifest!.actual_dispatches)).toBe(true);
    expect(manifest!.actual_dispatches.length).toBeGreaterThan(0);
  });

  it("lê e parseia dispatch-manifest.json do formato novo", () => {
    const manifest = readManifest(DIR_NOVO);
    expect(manifest).not.toBeNull();
    expect(Array.isArray(manifest!.actual_dispatches)).toBe(true);
    expect(manifest!.actual_dispatches[0].output_packet_ref).toMatch(/^outputs\//);
  });

  it("retorna null quando dispatch-manifest.json não existe (AC-011)", () => {
    const manifest = readManifest(DIR_SEM_MANIFEST);
    expect(manifest).toBeNull();
  });

  it("retorna null quando o diretório não existe (AC-011)", () => {
    const manifest = readManifest("/tmp/__nao_existe_aisos_test__");
    expect(manifest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readManifest — manifest corrompido usa fixture dedicada
// ---------------------------------------------------------------------------

describe("readManifest — manifest corrompido (AC-012)", () => {
  it("retorna null quando dispatch-manifest.json tem JSON inválido (AC-012)", () => {
    const manifest = readManifest(join(DIR_BORDA, "manifest-corrompido"));
    expect(manifest).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolvePacketSafe
// ---------------------------------------------------------------------------

describe("resolvePacketSafe", () => {
  it("lê e retorna o conteúdo do packet quando o arquivo existe (formato antigo)", () => {
    const packet = resolvePacketSafe(DIR_ANTIGO, "outputs/dev-T-001-loop1.json");
    expect(packet).not.toBeNull();
    expect(packet!.role).toBe("dev");
    expect(packet!.summary).toContain("Implementou");
  });

  it("lê e retorna o conteúdo do packet quando o arquivo existe (formato novo)", () => {
    const packet = resolvePacketSafe(DIR_NOVO, "outputs/d-T-001-dev-l1.json");
    expect(packet).not.toBeNull();
    expect(packet!.role).toBe("dev");
    expect(Array.isArray(packet!.evidence)).toBe(true);
  });

  it("retorna null quando o arquivo não existe (AC-013)", () => {
    const packet = resolvePacketSafe(DIR_ANTIGO, "outputs/NAOEXISTE.json");
    expect(packet).toBeNull();
  });

  it("retorna null quando o arquivo está corrompido/JSON inválido (AC-013/AC-014)", () => {
    const packet = resolvePacketSafe(DIR_BORDA, "outputs/packet-corrompido.json");
    expect(packet).toBeNull();
  });

  it("bloqueia path traversal: ref fora de specDir → null", () => {
    const packet = resolvePacketSafe(DIR_BORDA, "../../../etc/passwd");
    expect(packet).toBeNull();
  });

  it("bloqueia path traversal com caminho absoluto externo → null", () => {
    const packet = resolvePacketSafe(DIR_ANTIGO, "/etc/passwd");
    expect(packet).toBeNull();
  });

  it("bloqueia path traversal com sequência ../ que sai do specDir → null", () => {
    const packet = resolvePacketSafe(DIR_ANTIGO, "outputs/../../CLAUDE.md");
    expect(packet).toBeNull();
  });

  it("retorna null para ref vazia", () => {
    const packet = resolvePacketSafe(DIR_ANTIGO, "");
    expect(packet).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadDispatchMap — comportamento principal
// ---------------------------------------------------------------------------

describe("loadDispatchMap", () => {
  describe("formato antigo", () => {
    it("retorna mapa com T-001 e seus dispatches", () => {
      const map = loadDispatchMap(DIR_ANTIGO);
      expect(map.has("T-001")).toBe(true);
      const dispatches = map.get("T-001")!;
      expect(dispatches.length).toBe(4); // dev-l1, code-reviewer-l1, dev-l2, qa-l1
    });

    it("cada dispatch tem role, loop, status e tokens do manifest (AC-002)", () => {
      const map = loadDispatchMap(DIR_ANTIGO);
      const dispatches = map.get("T-001")!;
      const devL1 = dispatches.find((d) => d.role === "dev" && d.loop === 1);
      expect(devL1).toBeDefined();
      expect(devL1!.role).toBe("dev");
      expect(devL1!.loop).toBe(1);
      expect(devL1!.status).toBe("done");
      expect(devL1!.tokens).toBe(111612);
    });

    it("usa output_packet_ref do manifest para abrir o arquivo (AC-002)", () => {
      // O dev-T-001-loop1 existe em outputs/ → summary não é null
      const map = loadDispatchMap(DIR_ANTIGO);
      const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
      expect(devL1!.summary).toBeTruthy();
    });

    it("ignora dispatches com task_id AUDIT (AC-009)", () => {
      const map = loadDispatchMap(DIR_ANTIGO);
      expect(map.has("AUDIT")).toBe(false);
    });

    it("não cria chave para task_id AUDIT — tarefas-fantasma ausentes (AC-009)", () => {
      const map = loadDispatchMap(DIR_ANTIGO);
      for (const key of map.keys()) {
        expect(key).toMatch(/^T-\d+$/);
      }
    });
  });

  describe("formato novo", () => {
    it("retorna mapa com T-001 e T-002", () => {
      const map = loadDispatchMap(DIR_NOVO);
      expect(map.has("T-001")).toBe(true);
      expect(map.has("T-002")).toBe(true);
    });

    it("tokens corretos para dispatches do formato novo", () => {
      const map = loadDispatchMap(DIR_NOVO);
      const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
      expect(devL1!.tokens).toBe(69455);
    });

    it("ignora dispatches com task_id que não casa ^T-\\d+ (AC-009)", () => {
      const map = loadDispatchMap(DIR_NOVO);
      expect(map.has("FEAT-004")).toBe(false);
    });

    it("summary não-nulo quando packet existe", () => {
      const map = loadDispatchMap(DIR_NOVO);
      const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
      expect(devL1!.summary).toBe("Implementou _pm_shared.py com 3 helpers + 44 testes passando.");
    });
  });

  describe("AC-011 — spec sem manifest", () => {
    it("retorna mapa vazio quando dispatch-manifest.json não existe", () => {
      const map = loadDispatchMap(DIR_SEM_MANIFEST);
      expect(map.size).toBe(0);
    });

    it("não lança exceção quando manifest ausente", () => {
      expect(() => loadDispatchMap(DIR_SEM_MANIFEST)).not.toThrow();
    });
  });

  describe("AC-012 — manifest corrompido", () => {
    it("retorna mapa vazio quando manifest tem JSON inválido (AC-012)", () => {
      const map = loadDispatchMap(join(DIR_BORDA, "manifest-corrompido"));
      expect(map.size).toBe(0);
    });

    it("não lança exceção com manifest corrompido (AC-012)", () => {
      expect(() => loadDispatchMap(join(DIR_BORDA, "manifest-corrompido"))).not.toThrow();
    });
  });

  describe("AC-013 — packet ausente via resolvePacketSafe", () => {
    it("packet corrompido → resolvePacketSafe retorna null (preparação para manifest-only)", () => {
      const packet = resolvePacketSafe(DIR_BORDA, "outputs/packet-corrompido.json");
      expect(packet).toBeNull();
    });
  });

  describe("AC-014 — conteúdo parcial tratado como corrompido", () => {
    it("arquivo truncado (JSON inválido) → resolvePacketSafe retorna null", () => {
      const packet = resolvePacketSafe(DIR_BORDA, "outputs/packet-corrompido.json");
      expect(packet).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// loadDispatchMap — sub-dirs de borda (cada cenário tem dispatch-manifest.json)
// ---------------------------------------------------------------------------

describe("loadDispatchMap — fixtures de borda com sub-dirs", () => {
  it("usage:null em todo dispatch da tarefa → tokens = null para todos (AC-008)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "usage-null"));
    expect(map.size).toBeGreaterThan(0);
    const dispatches = map.get("T-001")!;
    expect(dispatches).toBeDefined();
    expect(dispatches.every((d) => d.tokens === null)).toBe(true);
  });

  it("packet ausente → Dispatch com summary:null, filesChanged:[], findings:[], testEvidence:[] (AC-013)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "packet-ausente"));
    expect(map.size).toBeGreaterThan(0);
    const d = map.get("T-001")![0];
    expect(d.summary).toBeNull();
    expect(d.filesChanged).toEqual([]);
    expect(d.findings).toEqual([]);
    expect(d.testEvidence).toEqual([]);
    expect(d.role).toBe("dev");
    expect(d.tokens).toBe(12000);
  });

  it("path traversal → Dispatch manifest-only (AC-002 + security)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "path-traversal"));
    expect(map.size).toBeGreaterThan(0);
    const d = map.get("T-001")![0];
    expect(d.summary).toBeNull();
    expect(d.filesChanged).toEqual([]);
    expect(d.tokens).toBe(5000);
  });

  it("audit-only → mapa vazio (AC-009)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "audit-only"));
    expect(map.size).toBe(0);
  });

  it("task_id com sufixo inválido (T-001abc) é descartado; T-001 válido é mantido (AC-009)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "task-id-invalido"));
    expect(map.has("T-001abc")).toBe(false);
    expect(map.has("T-001")).toBe(true);
    expect(map.get("T-001")!.length).toBe(1);
  });

  it("manifest corrompido → mapa vazio sem lançar exceção (AC-012)", () => {
    expect(() => {
      const map = loadDispatchMap(join(DIR_BORDA, "manifest-corrompido"));
      expect(map.size).toBe(0);
    }).not.toThrow();
  });

  it("packet corrompido → Dispatch manifest-only (AC-013/AC-014)", () => {
    const map = loadDispatchMap(join(DIR_BORDA, "packet-corrompido"));
    expect(map.size).toBeGreaterThan(0);
    const d = map.get("T-001")![0];
    expect(d.summary).toBeNull();
    expect(d.filesChanged).toEqual([]);
    expect(d.tokens).toBe(9999);
  });
});

// ---------------------------------------------------------------------------
// NFR-001 — módulo read-only: sem importação de APIs de escrita
// (verificado por inspeção de código em dispatches.ts + revisão de código)
// O teste abaixo verifica que o módulo carrega sem erro e que as funções
// exportadas existem (proxy de que o módulo foi escrito corretamente).
// ---------------------------------------------------------------------------

describe("NFR-001 — módulo read-only", () => {
  it("readManifest, resolvePacketSafe e loadDispatchMap são funções exportadas", () => {
    expect(typeof readManifest).toBe("function");
    expect(typeof resolvePacketSafe).toBe("function");
    expect(typeof loadDispatchMap).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// AC-001 — campos ricos populados pelos normalizadores (filesChanged, findings, testEvidence)
// ---------------------------------------------------------------------------

describe("AC-001 — campos ricos via normalizadores (formato antigo)", () => {
  it("filesChanged extraído de evidence.files_changed[].path (formato antigo)", () => {
    // Formato antigo: evidence é objeto com files_changed: [{path,...}]
    const map = collectDispatches(DIR_ANTIGO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.filesChanged).toEqual([
      "shared/schemas/output-packet.schema.json",
      "shared/lib/warnings.py",
      "shared/lib/warnings.ts",
    ]);
  });

  it("findings normalizados do formato antigo: text = issue + suggestion, line = line", () => {
    // O code-reviewer-T-001-loop1 tem 2 findings no formato antigo
    const map = collectDispatches(DIR_ANTIGO);
    const reviewer = map.get("T-001")!.find((d) => d.role === "code-reviewer" && d.loop === 1);
    expect(reviewer!.findings).toHaveLength(2);

    const f1 = reviewer!.findings[0];
    expect(f1.severity).toBe("major");
    expect(f1.file).toBe("shared/lib/warnings.ts");
    expect(f1.line).toBe(42);
    expect(f1.text).toBe("Duplicação de lógica em vez de chamar helper. Substituir pelo helper compartilhado.");

    const f2 = reviewer!.findings[1];
    expect(f2.severity).toBe("minor");
    expect(f2.line).toBe(80);
    expect(f2.text).toBe("Entropia inconsistente no sufixo tmp. Usar crypto.randomBytes.");
  });

  it("testEvidence vazio no formato antigo (evidence é objeto, não array)", () => {
    // Formato antigo não tem test evidence estruturado
    const map = collectDispatches(DIR_ANTIGO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.testEvidence).toEqual([]);
  });
});

describe("AC-001 — campos ricos via normalizadores (formato novo)", () => {
  it("filesChanged extraído de files_changed[] direto (formato novo)", () => {
    // Formato novo: files_changed é string[] no topo do packet
    const map = collectDispatches(DIR_NOVO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.filesChanged).toEqual([
      "squads/sdd/hooks/_pm_shared.py",
      "squads/sdd/hooks/__tests__/test_pm_shared.py",
    ]);
  });

  it("findings normalizados do formato novo: text = rationale, line = line_start quando line ausente", () => {
    // O code-reviewer do formato novo tem 1 finding com line_start (sem line)
    const map = collectDispatches(DIR_NOVO);
    const reviewer = map.get("T-001")!.find((d) => d.role === "code-reviewer" && d.loop === 1);
    expect(reviewer!.findings).toHaveLength(1);

    const f = reviewer!.findings[0];
    expect(f.severity).toBe("minor");
    expect(f.file).toBe("squads/sdd/hooks/_pm_shared.py");
    expect(f.line).toBe(223); // deriva de line_start pois line está ausente
    expect(f.text).toBe("encoding= no lock_fh engana o leitor; conteúdo do lock nunca é lido.");
  });

  it("testEvidence derivado de evidence[] filtrando kind=command/test (formato novo)", () => {
    // d-T-001-dev-l1 tem 2 evidence entries com kind=command
    const map = collectDispatches(DIR_NOVO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.testEvidence).toHaveLength(2);

    const ev1 = devL1!.testEvidence[0];
    expect(ev1.command).toBe("python3 -m unittest squads.sdd.hooks.__tests__.test_pm_shared -v");
    expect(ev1.passed).toBe(true);
    expect(ev1.detail).toBe("44 tests OK");

    const ev2 = devL1!.testEvidence[1];
    expect(ev2.command).toBe("python3 -m unittest discover -s squads/sdd/hooks/__tests__ -p test_*.py");
    expect(ev2.passed).toBe(true);
    expect(ev2.detail).toBe("104 tests OK");
  });

  it("testEvidence inclui kind=test além de kind=command", () => {
    // d-T-002-dev-l1 tem 1 evidence entry com kind=test
    const map = collectDispatches(DIR_NOVO);
    const devT2 = map.get("T-002")!.find((d) => d.role === "dev");
    expect(devT2!.testEvidence).toHaveLength(1);
    expect(devT2!.testEvidence[0].command).toBe(
      "npx ajv validate -s shared/schemas/dispatch-manifest.schema.json -d fixture.json"
    );
    expect(devT2!.testEvidence[0].passed).toBe(true);
  });

  it("findings vazio quando packet não tem findings (formato novo, dev)", () => {
    const map = collectDispatches(DIR_NOVO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.findings).toEqual([]);
  });
});

describe("AC-001 — campos ricos vazios quando packet é null (AC-013)", () => {
  it("packet ausente → filesChanged:[], findings:[], testEvidence:[] (manifest-only)", () => {
    const map = collectDispatches(join(DIR_BORDA, "packet-ausente"));
    const d = map.get("T-001")![0];
    expect(d.filesChanged).toEqual([]);
    expect(d.findings).toEqual([]);
    expect(d.testEvidence).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-007 / AC-008 — tokens vêm exclusivamente do manifest.usage.total_tokens
// ---------------------------------------------------------------------------

describe("AC-007 — tokens vêm do manifest, não do packet", () => {
  it("tokens numérico correto no formato antigo (manifest.usage.total_tokens)", () => {
    // O packet do formato antigo tem usage:null, mas o manifest tem o valor correto
    const map = collectDispatches(DIR_ANTIGO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.tokens).toBe(111612);
  });

  it("tokens numérico correto no formato novo (manifest.usage.total_tokens)", () => {
    const map = collectDispatches(DIR_NOVO);
    const devL1 = map.get("T-001")!.find((d) => d.role === "dev" && d.loop === 1);
    expect(devL1!.tokens).toBe(69455);
  });
});

describe("AC-008 — tokens null quando usage ausente ou não-numérico", () => {
  it("usage:null no manifest → tokens = null", () => {
    // Fixture usage-null: todos os dispatches têm usage:null ou sem usage no manifest
    const map = collectDispatches(join(DIR_BORDA, "usage-null"));
    const dispatches = map.get("T-001")!;
    expect(dispatches.every((d) => d.tokens === null)).toBe(true);
  });

  it("campo usage ausente no manifest → tokens = null (AC-008)", () => {
    // O segundo dispatch do fixture usage-null não tem campo usage
    const map = collectDispatches(join(DIR_BORDA, "usage-null"));
    const reviewer = map.get("T-001")!.find((d) => d.role === "code-reviewer");
    expect(reviewer!.tokens).toBeNull();
  });

  it("tokens não contamina com zero quando todos os dispatches da tarefa são null", () => {
    // AC-008: total null, não 0
    const map = collectDispatches(join(DIR_BORDA, "usage-null"));
    const dispatches = map.get("T-001")!;
    const total = dispatches
      .map((d) => d.tokens)
      .reduce<number | null>((acc, t) => (acc === null && t === null ? null : (acc ?? 0) + (t ?? 0)), null);
    expect(total).toBeNull();
  });

  it("total_tokens string (ex.: '123') → tokens = null (ramo não-numérico, AC-008)", () => {
    const map = collectDispatches(join(DIR_BORDA, "usage-nao-numerico"));
    const dev = map.get("T-001")!.find((d) => d.role === "dev");
    expect(dev!.tokens).toBeNull();
  });

  it("total_tokens boolean (true) → tokens = null (ramo não-numérico, AC-008)", () => {
    const map = collectDispatches(join(DIR_BORDA, "usage-nao-numerico"));
    const reviewer = map.get("T-001")!.find((d) => d.role === "code-reviewer");
    expect(reviewer!.tokens).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-010 — dispatches ordenados por loop ascendente
// ---------------------------------------------------------------------------

describe("AC-010 — ordenação por loop ascendente", () => {
  it("dispatches fora de ordem no manifest são retornados em ordem crescente de loop", () => {
    // Fixture fora-de-ordem: manifest lista loop 2, loop 1 (review), loop 1 (dev) nessa ordem
    const DIR_FORA = join(DIR_BORDA, "fora-de-ordem");
    const map = collectDispatches(DIR_FORA);
    const dispatches = map.get("T-001")!;
    expect(dispatches).toHaveLength(3);

    const loops = dispatches.map((d) => d.loop);
    expect(loops).toEqual([1, 1, 2]); // loop 1 (dois dispatches) antes de loop 2
  });

  it("dentro do mesmo loop, a ordem relativa dos dispatches é preservada (estabilidade)", () => {
    // Os dois dispatches de loop 1 devem manter a ordem original do manifest: code-reviewer, dev
    // O manifest lista: loop2-dev, loop1-code-reviewer, loop1-dev
    // Após sort estável por loop: loop1-code-reviewer, loop1-dev, loop2-dev
    const DIR_FORA = join(DIR_BORDA, "fora-de-ordem");
    const map = collectDispatches(DIR_FORA);
    const dispatches = map.get("T-001")!;

    const loop1 = dispatches.filter((d) => d.loop === 1);
    expect(loop1[0].role).toBe("code-reviewer");
    expect(loop1[1].role).toBe("dev");
  });

  it("formato antigo com 4 dispatches em 2 loops fica em ordem: loop1×3, loop2×1", () => {
    // dispatches-antigo: dev-l1(loop1), code-reviewer-l1(loop1), dev-l2(loop2), qa-l1(loop1)
    // Após sort: todos os loop1 primeiro, depois loop2
    const map = collectDispatches(DIR_ANTIGO);
    const dispatches = map.get("T-001")!;
    const loops = dispatches.map((d) => d.loop);
    expect(loops).toEqual([1, 1, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// collectDispatches — nome público da AD-1 (alias de loadDispatchMap)
// ---------------------------------------------------------------------------

describe("collectDispatches — função pública exportada", () => {
  it("collectDispatches é uma função exportada", () => {
    expect(typeof collectDispatches).toBe("function");
  });

  it("collectDispatches contém os mesmos dispatches que loadDispatchMap (mesmos ids, ordenados)", () => {
    // collectDispatches adiciona ordenação por loop, por isso os arrays podem diferir em ordem
    // mas devem ter exatamente os mesmos dispatch_ids (role+loop)
    const mapA = collectDispatches(DIR_ANTIGO);
    const mapB = loadDispatchMap(DIR_ANTIGO);
    expect(mapA.size).toBe(mapB.size);
    for (const [key, valA] of mapA) {
      const valB = mapB.get(key);
      expect(valB).toBeDefined();
      // Mesma quantidade de dispatches
      expect(valA.length).toBe(valB!.length);
      // Mesmos dispatches por role+loop, mas possivelmente em ordem diferente
      const sigA = valA.map((d) => `${d.role}-${d.loop}`).sort();
      const sigB = valB!.map((d) => `${d.role}-${d.loop}`).sort();
      expect(sigA).toEqual(sigB);
    }
  });

  it("collectDispatches(specDir) retorna Map<string, Dispatch[]> com tarefa T-001", () => {
    const map = collectDispatches(DIR_NOVO);
    expect(map instanceof Map).toBe(true);
    expect(map.has("T-001")).toBe(true);
    expect(Array.isArray(map.get("T-001"))).toBe(true);
  });
});
