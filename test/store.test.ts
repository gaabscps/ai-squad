import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store } from "../src/store/store.js";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "fixtures", "workspace");

describe("Store", () => {
  it("getSnapshot é vazio antes do primeiro rebuild", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    expect(store.getSnapshot()).toEqual([]);
  });

  it("rebuild monta o snapshot a partir das DiscoveryOptions", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    const snap = store.rebuild();
    expect(snap.map((p) => p.name).sort()).toEqual(["projeto-a", "projeto-b"]);
    expect(store.getSnapshot()).toBe(snap);
  });

  it("emite 'changed' a cada rebuild", () => {
    const store = new Store(() => ({ roots: [workspace] }));
    let calls = 0;
    store.on("changed", () => calls++);
    store.rebuild();
    store.rebuild();
    expect(calls).toBe(2);
  });

  it("reflete mudança de options (hide) no rebuild seguinte", () => {
    const opts = { roots: [workspace], hide: [] as string[] };
    const store = new Store(() => opts);
    store.rebuild();
    expect(store.getSnapshot().find((p) => p.name === "projeto-b")!.hidden).toBe(false);
    // A closure `() => opts` lê a mesma referência de objeto, então mutar opts.hide
    // faz o próximo rebuild() enxergar o novo valor — simula o config mudando entre dois rebuilds.
    opts.hide = ["projeto-b"];
    store.rebuild();
    expect(store.getSnapshot().find((p) => p.name === "projeto-b")!.hidden).toBe(true);
  });
});
