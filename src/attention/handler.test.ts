import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { makeDiagnosisHandler } from "./handler.js";
import type { Spec, Project } from "../store/types.js";

const ROOT = join(process.cwd(), ".aios-cache-test-handler");
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

function makeStore(spec: Spec, projectPath = "/proj/login") {
  const project: Project = { id: "proj-abc", path: projectPath, name: "login", specs: [spec], hidden: false };
  return { getSnapshot: () => [project] } as any;
}

const blockedSpec: Spec = {
  id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation", plannedPhases: [],
  status: "blocked", tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
  lastActivityAt: null, timeline: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
  cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null },
};

describe("makeDiagnosisHandler", () => {
  it("no fetch, sempre manda o handoff (mesmo sem cache)", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));
    const handoff = sent.find((m) => m.type === "attention:handoff");
    expect(handoff).toBeTruthy();
    expect(handoff.text).toContain("/proj/login/.agent-session/FEAT-001/");
  });

  it("no generate, streama chunk + done e grava cache", () => {
    const proc = fakeProc();
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT, spawnFn: (() => proc) as any, now: () => "2026-06-01T00:00:00Z" });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "FEAT-001" }, (d) => sent.push(JSON.parse(d)));

    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Parou porque" } } }) + "\n"));
    proc.stdout.emit("data", Buffer.from(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Parou porque o reviewer rejeitou", total_cost_usd: 0.03 }) + "\n"));

    expect(sent.some((m) => m.type === "attention:chunk" && m.delta === "Parou porque")).toBe(true);
    const done = sent.find((m) => m.type === "attention:done");
    expect(done.text).toBe("Parou porque o reviewer rejeitou");
    expect(done.costUsd).toBe(0.03);
  });

  it("generate de spec inexistente → error", () => {
    const handle = makeDiagnosisHandler(makeStore(blockedSpec), { cacheRoot: ROOT });
    const sent: any[] = [];
    handle({ type: "attention:generate", projectId: "proj-abc", specId: "NOPE" }, (d) => sent.push(JSON.parse(d)));
    expect(sent.some((m) => m.type === "attention:error")).toBe(true);
  });
});
