import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionDir } from "../src/collector/observed.js";

function sessionDir(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "obs-feat-"));
  const spec = join(dir, "OBS-001");
  mkdirSync(spec);
  writeFileSync(join(spec, "session.yml"), yaml);
  return spec;
}

const BASE = `schema_version: 1\nsession_id: OBS-001\nmode: observed\nintent: "teste"\nstatus: in_progress\ncreated_at: 2026-07-06T00:00:00Z\n`;

describe("parse do bloco feature", () => {
  it("bloco completo com key e snapshot", () => {
    const spec = readSessionDir(sessionDir(BASE +
      `feature:\n  id: PAY-1234\n  key: PAY-1234\n  name: "Export de fatura"\n  jira_snapshot:\n    status: "In Progress"\n    fetched_at: 2026-07-06T00:00:00Z\n    url: "https://x/browse/PAY-1234"\n`));
    expect(spec?.observed?.feature).toEqual({
      id: "PAY-1234", key: "PAY-1234", name: "Export de fatura",
      jira: { status: "In Progress", fetchedAt: "2026-07-06T00:00:00Z", url: "https://x/browse/PAY-1234" },
    });
    expect(spec?.observed?.driftFlags).toEqual([]);
  });

  it("bloco só com nome (sem key)", () => {
    const spec = readSessionDir(sessionDir(BASE + `feature:\n  id: ft-export\n  name: "Export"\n`));
    expect(spec?.observed?.feature).toEqual({ id: "ft-export", key: null, name: "Export", jira: null });
  });

  it("bloco ausente → feature null, sem drift (órfã legítima)", () => {
    const spec = readSessionDir(sessionDir(BASE));
    expect(spec?.observed?.feature).toBeNull();
    expect(spec?.observed?.driftFlags).toEqual([]);
  });

  it("bloco torto (sem id/name) → feature null + driftFlag", () => {
    const spec = readSessionDir(sessionDir(BASE + `feature:\n  key: PAY-1\n`));
    expect(spec?.observed?.feature).toBeNull();
    expect(spec?.observed?.driftFlags).toContain("invalid_feature_block");
  });

  it("bloco não-objeto → feature null + driftFlag", () => {
    const spec = readSessionDir(sessionDir(BASE + `feature: "PAY-1234"\n`));
    expect(spec?.observed?.feature).toBeNull();
    expect(spec?.observed?.driftFlags).toContain("invalid_feature_block");
  });
});
