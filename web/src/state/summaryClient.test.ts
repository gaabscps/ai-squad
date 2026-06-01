import { describe, it, expect, vi } from "vitest";
import { createSummaryClient } from "./summaryClient";

function fakeSocket() {
  const s: any = { readyState: 1, sent: [] as string[], onopen: null as any, onmessage: null as any, onclose: null as any };
  s.send = (d: string) => s.sent.push(d);
  s.close = vi.fn();
  return s;
}

describe("createSummaryClient", () => {
  it("manda summary:fetch com specId/taskId", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.fetch("FEAT-001", "T-001");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:fetch", specId: "FEAT-001", taskId: "T-001" });
  });

  it("generate manda type generate + force", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    client.generate("FEAT-001", "T-001", true);
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "summary:generate", force: true });
  });

  it("entrega mensagens só ao subscriber da chave certa", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("FEAT-001|T-001", (m) => got.push(m));
    const other: any[] = [];
    client.subscribe("FEAT-001|T-999", (m) => other.push(m));
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", specId: "FEAT-001", taskId: "T-001", delta: "oi" }) });
    expect(got).toHaveLength(1);
    expect(got[0].delta).toBe("oi");
    expect(other).toHaveLength(0);
  });

  it("unsubscribe para de receber", () => {
    const sock = fakeSocket();
    const client = createSummaryClient(() => sock);
    const got: any[] = [];
    const off = client.subscribe("K|1", (m) => got.push(m));
    off();
    sock.onmessage?.({ data: JSON.stringify({ type: "summary:chunk", specId: "K", taskId: "1", delta: "x" }) });
    expect(got).toHaveLength(0);
  });
});
