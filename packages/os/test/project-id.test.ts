import { describe, it, expect } from "vitest";
import { projectId } from "../src/collector/project-id.js";

describe("projectId", () => {
  it("é determinístico — mesmo path gera sempre o mesmo id", () => {
    expect(projectId("/a/b/foo")).toBe(projectId("/a/b/foo"));
  });

  it("desambigua basenames iguais em roots diferentes", () => {
    expect(projectId("/work/foo")).not.toBe(projectId("/personal/foo"));
  });

  it("começa com o basename (legível pra debug)", () => {
    expect(projectId("/x/y/ai-squad").startsWith("ai-squad-")).toBe(true);
  });

  it("sufixo é exatamente 12 hex (blinda o formato usado como chave no WS)", () => {
    expect(projectId("/x/y/ai-squad")).toMatch(/^ai-squad-[0-9a-f]{12}$/);
  });
});
