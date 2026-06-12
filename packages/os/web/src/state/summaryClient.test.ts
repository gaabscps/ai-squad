import { describe, it, expect, vi } from "vitest";
import { createSummaryClient } from "./summaryClient";

function fakeSocket() {
  const s: any = { readyState: 1, sent: [] as string[], onopen: null as any, onmessage: null as any, onclose: null as any };
  s.send = (d: string) => s.sent.push(d);
  s.close = vi.fn();
  return s;
}

describe("createSummaryClient", () => {
  it("manda summary:fetch com projectId/specId/taskId", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.fetch("proj-1", "FEAT-001", "T-001");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:fetch", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001" });
  });

  it("generate manda type generate + force", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.generate("proj-1", "FEAT-001", "T-001", true);
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:generate", projectId: "proj-1", force: true });
  });

  it("AC-005: generate manda model quando fornecido", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.generate("proj-1", "FEAT-001", "T-001", false, "haiku");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:generate", model: "haiku" });
  });

  it("AC-005: generate não manda model quando não fornecido", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.generate("proj-1", "FEAT-001", "T-001");
    sock.onopen?.();
    const msg = JSON.parse(sock.sent[0]);
    expect(msg).not.toHaveProperty("model");
  });

  it("entrega mensagens só ao subscriber da chave certa (projectId|specId|taskId)", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-001|T-001", (m) => got.push(m));
    const other: any[] = [];
    // mesmo spec/task, OUTRO projeto → não deve receber (o bug que isso previne)
    client.subscribe("proj-2|FEAT-001|T-001", (m) => other.push(m));
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", projectId: "proj-1", specId: "FEAT-001", taskId: "T-001", delta: "oi" }) });
    expect(got).toHaveLength(1);
    expect(got[0].delta).toBe("oi");
    expect(other).toHaveLength(0);
  });

  it("unsubscribe para de receber", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    const off = client.subscribe("P|K|1", (m) => got.push(m));
    off();
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", projectId: "P", specId: "K", taskId: "1", delta: "x" }) });
    expect(got).toHaveLength(0);
  });
});
