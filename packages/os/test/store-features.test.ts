import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store/store.js";

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "store-feat-"));
  const proj = join(root, "meu-app");
  mkdirSync(join(proj, ".agent-session", "OBS-001"), { recursive: true });
  writeFileSync(
    join(proj, ".agent-session", "OBS-001", "session.yml"),
    `schema_version: 1\nsession_id: OBS-001\nmode: observed\nintent: "x"\nstatus: in_progress\ncreated_at: 2026-07-06T00:00:00Z\nfeature:\n  id: PAY-1\n  key: PAY-1\n  name: "Export"\n`,
  );
  return root;
}

describe("Store.rebuild popula features", () => {
  it("agrupa e aplica overlay do config", () => {
    const root = makeProject();
    const store = new Store(() => ({ roots: [root], hide: [], features: {} }));
    const [proj] = store.rebuild();
    expect(proj.features).toHaveLength(1);
    expect(proj.features[0].id).toBe("PAY-1");
    expect(proj.features[0].sessionIds).toEqual(["OBS-001"]);
  });
});
