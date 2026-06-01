import { describe, it, expect } from "vitest";
import { projectsReducer, type ProjectsState } from "./projects";
import { makeProject } from "../test-utils";

describe("projectsReducer", () => {
  it("snapshot substitui o array de projects por inteiro", () => {
    const s0: ProjectsState = { projects: [makeProject({ id: "antigo" })], connected: true };
    const s1 = projectsReducer(s0, {
      type: "snapshot",
      projects: [makeProject({ id: "novo-1" }), makeProject({ id: "novo-2" })],
    });
    expect(s1.projects.map((p) => p.id)).toEqual(["novo-1", "novo-2"]);
    expect(s1.connected).toBe(true); // snapshot não mexe na flag de conexão
  });

  it("connected atualiza só a flag de conexão", () => {
    const s0: ProjectsState = { projects: [makeProject()], connected: false };
    const s1 = projectsReducer(s0, { type: "connected", connected: true });
    expect(s1.connected).toBe(true);
    expect(s1.projects).toBe(s0.projects); // não recria os projects à toa
  });
});
