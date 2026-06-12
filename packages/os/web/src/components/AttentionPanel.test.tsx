import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AttentionPanel } from "./AttentionPanel";
import { DiagnosisJobsProvider } from "../state/diagnosisJobs";
import type { AttentionClient, AttentionServerMsg } from "../state/attentionClient";

function fakeClient(): { client: AttentionClient; emit: (m: AttentionServerMsg) => void } {
  const subs = new Map<string, Set<(m: AttentionServerMsg) => void>>();
  const client: AttentionClient = {
    subscribe(key, fn) {
      const set = subs.get(key) ?? new Set();
      set.add(fn);
      subs.set(key, set);
      return () => { set.delete(fn); };
    },
    fetch: vi.fn(),
    generate: vi.fn(),
    cancel: vi.fn(),
  };
  const emit = (m: AttentionServerMsg) => {
    const key = `${m.projectId}|${m.specId}`;
    const fns = subs.get(key);
    if (fns) for (const fn of fns) fn(m);
  };
  return { client, emit };
}

describe("AttentionPanel", () => {
  it("mostra o botão de gerar diagnóstico e dispara generate ao clicar", () => {
    const { client } = fakeClient();
    render(
      <DiagnosisJobsProvider client={client}>
        <AttentionPanel projectId="p" specId="FEAT-001" client={client} />
      </DiagnosisJobsProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /o que preciso fazer/i }));
    expect(client.generate).toHaveBeenCalledWith("p", "FEAT-001");
  });

  it("habilita 'copiar prompt' quando o handoff chega e copia pro clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { client, emit } = fakeClient();
    render(
      <DiagnosisJobsProvider client={client}>
        <AttentionPanel projectId="p" specId="FEAT-001" client={client} />
      </DiagnosisJobsProvider>
    );
    act(() => { emit({ type: "attention:handoff", projectId: "p", specId: "FEAT-001", text: "COLE ISSO" }); });
    const btn = screen.getByRole("button", { name: /copiar prompt/i });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("COLE ISSO");
  });
});
