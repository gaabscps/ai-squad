import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { discoverProjects } from "../src/collector/discovery.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

describe("discoverProjects", () => {
  it("acha só subpastas com .agent-session/", () => {
    const projects = discoverProjects({ roots: [workspace] });
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["projeto-a", "projeto-b"]); // nao-projeto fica de fora
  });

  it("projetos com apenas sessions SDD legadas têm specs: [] (OBS-only board)", () => {
    // workspace/projeto-a tem FEAT-099 (SDD), workspace/projeto-b tem DISC-001 (SDD)
    // Após o dispatcher OBS-only, nenhum aparece no board — mas os projetos ainda existem.
    const projects = discoverProjects({ roots: [workspace] });
    const a = projects.find((p) => p.name === "projeto-a")!;
    expect(a.specs).toHaveLength(0); // FEAT-099 é SDD legado, filtrado
    const b = projects.find((p) => p.name === "projeto-b")!;
    expect(b.specs).toHaveLength(0); // DISC-001 é SDD legado, filtrado
  });

  it("marca hidden os projetos em hide[]", () => {
    const projects = discoverProjects({ roots: [workspace], hide: ["projeto-b"] });
    const b = projects.find((p) => p.name === "projeto-b")!;
    expect(b.hidden).toBe(true);
  });

  it("um session.yml ruim não derruba o scan dos outros", () => {
    const ws = join(here, "fixtures", "workspace-resiliente");
    const projects = discoverProjects({ roots: [ws] });
    const names = projects.map((p) => p.name).sort();
    expect(names).toEqual(["projeto-ok", "projeto-ruim"]); // ambos descobertos
    const ok = projects.find((p) => p.name === "projeto-ok")!;
    // FEAT-OK é SDD legado: filtrado do board OBS-only; projeto ainda aparece
    expect(ok.specs).toHaveLength(0);
    const ruim = projects.find((p) => p.name === "projeto-ruim")!;
    // FEAT-RUIM tem YAML inválido mas dir não é OBS-*, portanto null (comportamento legado)
    expect(ruim.specs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// workspace-observado: comportamento OBS-only do dispatcher
// ---------------------------------------------------------------------------

const workspaceObs = join(here, "fixtures", "workspace-observado");

describe("discoverProjects — workspace-observado (OBS-only dispatcher)", () => {
  it("projeto-obs aparece na lista de projetos descobertos", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const names = projects.map((p) => p.name).sort();
    expect(names).toContain("projeto-obs");
  });

  it("projeto-obs tem exatamente 2 specs (OBS-030 running + OBS-031 unreadable)", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const proj = projects.find((p) => p.name === "projeto-obs")!;
    expect(proj.specs).toHaveLength(2);
  });

  it("OBS-030 aparece com status running e title igual ao intent", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const proj = projects.find((p) => p.name === "projeto-obs")!;
    const obs030 = proj.specs.find((s) => s.id === "OBS-030");
    expect(obs030).toBeDefined();
    expect(obs030!.status).toBe("running");
    expect(obs030!.title).toBe("Implementar autenticação por OAuth");
  });

  it("OBS-031 aparece como card degradado com status unreadable (YAML inválido)", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const proj = projects.find((p) => p.name === "projeto-obs")!;
    const obs031 = proj.specs.find((s) => s.id === "OBS-031");
    expect(obs031).toBeDefined();
    expect(obs031!.status).toBe("unreadable");
  });

  it("FEAT-legacy é filtrado do board (dir SDD, sem mode: observed)", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const proj = projects.find((p) => p.name === "projeto-obs")!;
    const featLegacy = proj.specs.find((s) => s.id === "FEAT-legacy");
    expect(featLegacy).toBeUndefined();
  });

  it("projeto-so-legado ainda aparece na lista mesmo com specs: []", () => {
    const projects = discoverProjects({ roots: [workspaceObs] });
    const proj = projects.find((p) => p.name === "projeto-so-legado");
    expect(proj).toBeDefined();
    expect(proj!.specs).toHaveLength(0); // apenas FEAT-SOLEGADO, filtrado do board
  });
});
