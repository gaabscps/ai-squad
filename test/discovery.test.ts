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

  it("lê as Sessions de cada projeto", () => {
    const projects = discoverProjects({ roots: [workspace] });
    const a = projects.find((p) => p.name === "projeto-a")!;
    expect(a.specs).toHaveLength(1);
    expect(a.specs[0].id).toBe("FEAT-099");
    expect(a.specs[0].status).toBe("done");
  });

  it("marca hidden os projetos em hide[]", () => {
    const projects = discoverProjects({ roots: [workspace], hide: ["projeto-b"] });
    const b = projects.find((p) => p.name === "projeto-b")!;
    expect(b.hidden).toBe(true);
  });
});
