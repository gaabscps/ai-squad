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
});
