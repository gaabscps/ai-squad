import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveHidden } from "../src/config.js";

function tmpConfig(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aios-"));
  const p = join(dir, "aios.config.json");
  if (content !== undefined) writeFileSync(p, content);
  return p;
}

describe("loadConfig", () => {
  it("lê roots/include/hide de um arquivo válido", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["/x"], include: ["/y"], hide: ["z"] }));
    const c = loadConfig(p);
    expect(c.roots).toEqual(["/x"]);
    expect(c.include).toEqual(["/y"]);
    expect(c.hide).toEqual(["z"]);
  });

  it("devolve defaults vazios quando o arquivo não existe", () => {
    const c = loadConfig(join(tmpdir(), "nao-existe-aios-xyz.json"));
    expect(c).toEqual({ roots: [], include: [], hide: [] });
  });

  it("expande ~ nas roots (Node não faz isso sozinho)", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["~/Dev"] }));
    expect(loadConfig(p).roots[0]).toBe(join(homedir(), "Dev"));
  });
});

describe("saveHidden", () => {
  it("persiste o hide preservando roots e relê com loadConfig", () => {
    const p = tmpConfig(JSON.stringify({ roots: ["/x"], include: [], hide: [] }));
    saveHidden(p, ["/x/foo"]);
    const reread = JSON.parse(readFileSync(p, "utf-8"));
    expect(reread.roots).toEqual(["/x"]); // roots preservadas
    expect(reread.hide).toEqual(["/x/foo"]);
    expect(loadConfig(p).hide).toEqual(["/x/foo"]);
  });
});
