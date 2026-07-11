import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfigFields } from "../src/config.js";

describe("overlay features no aios.config.json", () => {
  it("loadConfig devolve features vazio quando ausente", () => {
    const dir = mkdtempSync(join(tmpdir(), "aios-cfg-"));
    const p = join(dir, "aios.config.json");
    writeFileSync(p, JSON.stringify({ roots: [] }));
    expect(loadConfig(p).features).toEqual({});
  });

  it("saveConfigFields persiste features preservando o resto", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aios-cfg-"));
    const p = join(dir, "aios.config.json");
    writeFileSync(p, JSON.stringify({ roots: ["/x"], hide: ["/y"] }));
    await saveConfigFields({ features: { assign: { "P/OBS-001": "PAY-1" } } }, p);
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    expect(raw.roots).toEqual(["/x"]);
    expect(raw.hide).toEqual(["/y"]);
    expect(raw.features.assign["P/OBS-001"]).toBe("PAY-1");
  });

  it("saveConfigFields persiste deliveryState preservando o resto", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aios-cfg-"));
    const p = join(dir, "aios.config.json");
    writeFileSync(p, JSON.stringify({ roots: ["/x"], hide: ["/y"] }));
    await saveConfigFields({ features: { deliveryState: { "P/PAY-1": "awaiting_deploy" } } }, p);
    const raw = JSON.parse(readFileSync(p, "utf-8"));
    expect(raw.roots).toEqual(["/x"]);
    expect(raw.features.deliveryState["P/PAY-1"]).toBe("awaiting_deploy");
  });
});
