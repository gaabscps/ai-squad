import { describe, it, expect } from "vitest";
import { exportHref, parseExportTarget } from "./exportUrl";

describe("exportUrl", () => {
  it("round-trip: parse desfaz href", () => {
    const href = exportHref("proj-1", "OBS-11");
    expect(href).toContain("export=1");
    expect(parseExportTarget(href)).toEqual({ projectId: "proj-1", specId: "OBS-11" });
  });

  it("encoda ids com caracteres especiais", () => {
    const href = exportHref("a/b c", "OBS 1");
    expect(parseExportTarget(href)).toEqual({ projectId: "a/b c", specId: "OBS 1" });
  });

  it("retorna null sem export=1 ou sem ids", () => {
    expect(parseExportTarget("")).toBeNull();
    expect(parseExportTarget("?export=1")).toBeNull();
    expect(parseExportTarget("?projectId=p&specId=s")).toBeNull();
  });
});
