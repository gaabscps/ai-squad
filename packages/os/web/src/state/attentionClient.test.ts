import { describe, it, expect, vi } from "vitest";
import { createAttentionClient } from "./attentionClient";

function fakeSocket() {
  const s: any = { readyState: 1, sent: [] as string[], onopen: null, onmessage: null, onclose: null };
  s.send = (m: string) => s.sent.push(m);
  return s;
}

describe("attentionClient", () => {
  it("fetch envia attention:fetch com projectId/specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    c.fetch("proj-abc", "FEAT-001");
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: "attention:fetch", projectId: "proj-abc", specId: "FEAT-001" });
  });

  it("roteia a mensagem do servidor ao subscriber da chave projectId|specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    const fn = vi.fn();
    c.subscribe("proj-abc|FEAT-001", fn);
    socket.onmessage({ data: JSON.stringify({ type: "attention:done", projectId: "proj-abc", specId: "FEAT-001", text: "ok" }) });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: "attention:done", text: "ok" }));
  });

  it("cancel envia attention:cancel com projectId/specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    c.cancel("proj-xyz", "FEAT-002");
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: "attention:cancel", projectId: "proj-xyz", specId: "FEAT-002" });
  });

  it("roteia attention:queued ao subscriber da chave projectId|specId", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    const fn = vi.fn();
    c.subscribe("proj-abc|FEAT-002", fn);
    socket.onmessage({ data: JSON.stringify({ type: "attention:queued", projectId: "proj-abc", specId: "FEAT-002" }) });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ type: "attention:queued", projectId: "proj-abc", specId: "FEAT-002" }));
  });

  it("attention:queued não vaza para subscriber de outra chave", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    const fnOutra = vi.fn();
    c.subscribe("proj-abc|FEAT-999", fnOutra);
    socket.onmessage({ data: JSON.stringify({ type: "attention:queued", projectId: "proj-abc", specId: "FEAT-002" }) });
    expect(fnOutra).not.toHaveBeenCalled();
  });

  it("cancel sem subscriber não lança erro", () => {
    const socket = fakeSocket();
    const c = createAttentionClient(() => socket);
    expect(() => c.cancel("proj-abc", "FEAT-001")).not.toThrow();
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: "attention:cancel" });
  });

  it("cancel com socket CONNECTING enfileira e drena ao abrir", () => {
    const s: any = { readyState: 0, sent: [] as string[], onopen: null, onmessage: null, onclose: null };
    s.send = (m: string) => s.sent.push(m);
    const c = createAttentionClient(() => s);
    c.cancel("proj-abc", "FEAT-003");
    expect(s.sent).toHaveLength(0);
    s.readyState = 1;
    s.onopen();
    expect(s.sent).toHaveLength(1);
    expect(JSON.parse(s.sent[0])).toMatchObject({ type: "attention:cancel", projectId: "proj-abc", specId: "FEAT-003" });
  });
});
