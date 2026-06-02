import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AttentionPanel } from "./AttentionPanel";
import type { AttentionClient, AttentionServerMsg } from "../state/attentionClient";

function fakeClient(): { client: AttentionClient; emit: (m: AttentionServerMsg) => void } {
  let handler: ((m: AttentionServerMsg) => void) | null = null;
  return {
    client: { subscribe: (_k, fn) => { handler = fn; return () => {}; }, fetch: vi.fn(), generate: vi.fn() },
    emit: (m) => handler && handler(m),
  };
}

describe("AttentionPanel", () => {
  it("mostra o botão de gerar diagnóstico e dispara generate ao clicar", () => {
    const { client } = fakeClient();
    render(<AttentionPanel projectId="p" specId="FEAT-001" client={client} />);
    fireEvent.click(screen.getByRole("button", { name: /o que preciso fazer/i }));
    expect(client.generate).toHaveBeenCalledWith("p", "FEAT-001", false);
  });

  it("habilita 'copiar prompt' quando o handoff chega e copia pro clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { client, emit } = fakeClient();
    render(<AttentionPanel projectId="p" specId="FEAT-001" client={client} />);
    act(() => { emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" }); });
    const btn = screen.getByRole("button", { name: /copiar prompt/i });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("COLE ISSO");
  });
});
