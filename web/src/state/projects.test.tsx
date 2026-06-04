import { describe, it, expect } from "vitest";
import { projectsReducer, type ProjectsState } from "./projects";
import { makeProject } from "../test-utils";

describe("projectsReducer", () => {
  it("snapshot substitui o array de projects por inteiro", () => {
    const s0: ProjectsState = { projects: [makeProject({ id: "antigo" })], connected: true, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, {
      type: "snapshot",
      projects: [makeProject({ id: "novo-1" }), makeProject({ id: "novo-2" })],
    });
    expect(s1.projects.map((p) => p.id)).toEqual(["novo-1", "novo-2"]);
    expect(s1.connected).toBe(true); // snapshot não mexe na flag de conexão
  });

  it("connected atualiza só a flag de conexão", () => {
    const s0: ProjectsState = { projects: [makeProject()], connected: false, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, { type: "connected", connected: true });
    expect(s1.connected).toBe(true);
    expect(s1.projects).toBe(s0.projects); // não recria os projects à toa
  });

  it("snapshot atualiza archiveAfterDays quando vem no frame", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [], archiveAfterDays: 14 });
    expect(s1.archiveAfterDays).toBe(14);
  });

  it("snapshot sem archiveAfterDays preserva o valor atual", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 14, include: [] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [] });
    expect(s1.archiveAfterDays).toBe(14);
  });

  it("snapshot com include atualiza a lista no estado", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [], include: ["/some/path"] });
    expect(s1.include).toEqual(["/some/path"]);
  });

  it("snapshot sem include (backwards compat) preserva include como array vazio", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [] });
    expect(s1.include).toEqual([]);
  });

  it("snapshot sem include preserva include já existente no estado", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7, include: ["/existing/path"] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [] });
    expect(s1.include).toEqual(["/existing/path"]);
  });

  it("snapshot não mexe na flag connected", () => {
    const s0: ProjectsState = { projects: [], connected: true, archiveAfterDays: 7, include: [] };
    const s1 = projectsReducer(s0, { type: "snapshot", projects: [], include: ["/p"] });
    expect(s1.connected).toBe(true);
  });
});
