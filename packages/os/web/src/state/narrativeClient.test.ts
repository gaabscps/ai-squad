import { describe, it, expect } from "vitest";
import { createNarrativeClient, type NarrativeServerMsg } from "./narrativeClient";

class FakeSocket {
  readyState = 1; onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null;
  sent: string[] = [];
  send(d: string) { this.sent.push(d); }
  emit(msg: NarrativeServerMsg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

describe("narrativeClient", () => {
  it("roteia mensagem ao subscriber da chave projectId|specId", () => {
    const sock = new FakeSocket();
    const client = createNarrativeClient(() => sock as unknown as WebSocket);
    const got: NarrativeServerMsg[] = [];
    client.subscribe("p|OBS-1", (m) => got.push(m));
    client.fetch("p", "OBS-1");
    sock.emit({ type: "narrative:done", projectId: "p", specId: "OBS-1", narrative: { tldr: "x", why: "", changes: [], decisions: [], verifications: [], prReview: { groups: [], risk: null } } });
    expect(got[0].type).toBe("narrative:done");
    expect(sock.sent[0]).toContain("narrative:fetch");
  });
});
