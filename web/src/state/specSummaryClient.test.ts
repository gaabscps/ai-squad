import { describe, it, expect, vi } from "vitest";
import { createSpecSummaryClient } from "./specSummaryClient";

function fakeSocket() {
  const s: any = {
    readyState: 1,
    sent: [] as string[],
    onopen: null as any,
    onmessage: null as any,
    onclose: null as any,
  };
  s.send = (d: string) => s.sent.push(d);
  s.close = vi.fn();
  return s;
}

describe("createSpecSummaryClient — fetch", () => {
  it("manda spec-summary:fetch com projectId e specId", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    client.fetch("proj-1", "FEAT-006");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({
      type: "spec-summary:fetch",
      projectId: "proj-1",
      specId: "FEAT-006",
    });
  });

  it("fetch não inclui taskId na mensagem", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    client.fetch("proj-1", "FEAT-006");
    sock.onopen?.();
    const msg = JSON.parse(sock.sent[0]);
    expect(msg).not.toHaveProperty("taskId");
  });
});

describe("createSpecSummaryClient — generate", () => {
  it("manda spec-summary:generate com projectId, specId e model", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    client.generate("proj-1", "FEAT-006", "haiku");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({
      type: "spec-summary:generate",
      projectId: "proj-1",
      specId: "FEAT-006",
      model: "haiku",
    });
  });

  it("gera com sonnet quando model é sonnet", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    client.generate("proj-1", "FEAT-006", "sonnet");
    sock.onopen?.();
    expect(JSON.parse(sock.sent[0])).toMatchObject({ model: "sonnet" });
  });
});

describe("createSpecSummaryClient — roteamento de mensagens", () => {
  it("entrega spec-summary:cached ao subscriber da chave certa (projectId|specId)", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "resumo",
      }),
    });
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe("resumo");
  });

  it("não entrega mensagem ao subscriber de chave diferente", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-2|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "resumo",
      }),
    });
    expect(got).toHaveLength(0);
  });

  it("entrega spec-summary:chunk ao subscriber certo", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:chunk",
        projectId: "proj-1",
        specId: "FEAT-006",
        delta: "pedaço",
      }),
    });
    expect(got[0].delta).toBe("pedaço");
  });

  it("entrega spec-summary:done com modelId ao subscriber certo", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:done",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "texto final",
        modelId: "claude-haiku-4-5-20251001",
      }),
    });
    expect(got[0].modelId).toBe("claude-haiku-4-5-20251001");
  });

  it("entrega spec-summary:error ao subscriber certo", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:error",
        projectId: "proj-1",
        specId: "FEAT-006",
        message: "CLI não encontrado",
      }),
    });
    expect(got[0].type).toBe("spec-summary:error");
    expect(got[0].message).toBe("CLI não encontrado");
  });

  it("unsubscribe para de receber mensagens", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    const off = client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    off();
    sock.onmessage?.({
      data: JSON.stringify({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "x",
      }),
    });
    expect(got).toHaveLength(0);
  });

  it("ignora mensagem com JSON inválido", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    expect(() => sock.onmessage?.({ data: "não é json{" })).not.toThrow();
    expect(got).toHaveLength(0);
  });

  it("ignora mensagem sem projectId ou specId", () => {
    const sock = fakeSocket();
    const client = createSpecSummaryClient(() => sock);
    const got: any[] = [];
    client.subscribe("proj-1|FEAT-006", (m) => got.push(m));
    sock.onmessage?.({
      data: JSON.stringify({ type: "spec-summary:cached", text: "x" }),
    });
    expect(got).toHaveLength(0);
  });
});

describe("createSpecSummaryClient — fila (queue antes do socket abrir)", () => {
  it("faz fila do fetch e envia assim que o socket abre", () => {
    const sock = fakeSocket();
    sock.readyState = 0;
    const client = createSpecSummaryClient(() => sock);
    client.fetch("proj-1", "FEAT-006");
    expect(sock.sent).toHaveLength(0);
    sock.readyState = 1;
    sock.onopen?.();
    expect(sock.sent).toHaveLength(1);
    expect(JSON.parse(sock.sent[0])).toMatchObject({ type: "spec-summary:fetch" });
  });
});
