import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeNarrativeHandler } from "./handler.js";
import type { Store } from "../store/store.js";
import type { ObservedMeta, Spec } from "../store/types.js";

const NARR = { tldr: "fiz X", why: "pq Y", changes: [], decisions: [], verifications: [], prReview: { groups: [], risk: null } };

// spawn falso: emite uma linha NDJSON de "done" com o JSON da narrativa e fecha.
function fakeSpawn(out: string) {
  return () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { write(): void; end(): void }; kill(): void };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write() {}, end() {} };
    proc.kill = () => {};
    setTimeout(() => {
      proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", result: out, total_cost_usd: 0.01 }) + "\n"));
      proc.emit("close", 0);
    }, 0);
    return proc as never;
  };
}

function observed(): ObservedMeta {
  return { intent: "x", createdAt: "a", closedAt: "b", attentionKind: null, decisions: [], evidence: [], driftFlags: [], baseSha: null, outputLocale: "pt-BR", report: null, markers: [] };
}
function fakeStore(projectPath: string, spec: Spec): Store {
  return { getSnapshot: () => [{ id: "p", name: "proj", path: projectPath, specs: [spec] }] } as unknown as Store;
}

let cacheRoot: string, projectPath: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "nh-cache-"));
  projectPath = mkdtempSync(join(tmpdir(), "nh-proj-"));
  mkdirSync(join(projectPath, ".agent-session", "OBS-1", "costs"), { recursive: true });
});
afterEach(() => { rmSync(cacheRoot, { recursive: true, force: true }); rmSync(projectPath, { recursive: true, force: true }); });

describe("makeNarrativeHandler", () => {
  it("gera, parseia e cacheia; emite narrative:done", async () => {
    const spec = { id: "OBS-1", status: "done", observed: observed() } as unknown as Spec;
    const handler = makeNarrativeHandler(fakeStore(projectPath, spec), { cacheRoot, spawnFn: fakeSpawn(JSON.stringify(NARR)) as never, now: () => "T" });
    const sent: string[] = [];
    handler({ type: "narrative:generate", projectId: "p", specId: "OBS-1" }, (d) => sent.push(d));
    await new Promise((r) => setTimeout(r, 10));
    const done = sent.map((s) => JSON.parse(s)).find((m) => m.type === "narrative:done");
    expect(done.narrative.tldr).toBe("fiz X");
  });

  it("fetch devolve o cache na segunda vez", async () => {
    const spec = { id: "OBS-1", status: "done", observed: observed() } as unknown as Spec;
    const handler = makeNarrativeHandler(fakeStore(projectPath, spec), { cacheRoot, spawnFn: fakeSpawn(JSON.stringify(NARR)) as never, now: () => "T" });
    handler({ type: "narrative:generate", projectId: "p", specId: "OBS-1" }, () => {});
    await new Promise((r) => setTimeout(r, 10));
    const sent: string[] = [];
    handler({ type: "narrative:fetch", projectId: "p", specId: "OBS-1" }, (d) => sent.push(d));
    const cached = JSON.parse(sent[0]);
    expect(cached.type).toBe("narrative:cached");
    expect(cached.narrative.tldr).toBe("fiz X");
    expect(cached.stale).toBe(false);
  });

  it("erro quando a saída não é JSON parseável", async () => {
    const spec = { id: "OBS-1", status: "done", observed: observed() } as unknown as Spec;
    const handler = makeNarrativeHandler(fakeStore(projectPath, spec), { cacheRoot, spawnFn: fakeSpawn("desculpa") as never, now: () => "T" });
    const sent: string[] = [];
    handler({ type: "narrative:generate", projectId: "p", specId: "OBS-1" }, (d) => sent.push(d));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((s) => JSON.parse(s)).some((m) => m.type === "narrative:error")).toBe(true);
  });
});
