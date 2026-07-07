import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionNarrative } from "./SessionNarrative";
import type { NarrativeClient, NarrativeServerMsg } from "../state/narrativeClient";
import type { ObservedMeta } from "../../../src/store/types";

function clientThatEmitsOnFetch(msg: NarrativeServerMsg): NarrativeClient {
  return {
    subscribe: (_k, fn) => { setTimeout(() => fn(msg), 0); return () => {}; },
    fetch: () => {}, generate: () => {},
  };
}
function observed(): ObservedMeta {
  return {
    intent: "x", createdAt: null, closedAt: null, attentionKind: null, decisions: [], evidence: [],
    driftFlags: [], baseSha: null, outputLocale: "pt-BR", feature: null, report: null,
    markers: [{ kind: "edit", at: "t", exact: true, note: null, decision: null, evidence: null, blockMs: null,
      editFiles: [{ path: "a.ts", added: 1, removed: 0, patch: "@@ -0 +1 @@\n+linha" }] }],
  };
}
const N = {
  tldr: "fiz X", why: "porque Y",
  changes: [{ title: "Frente 1", prose: "mudei a.ts", files: ["a.ts"], primaryFile: "a.ts" }],
  decisions: [], verifications: [{ cmd: "vitest", passed: true }],
  prReview: { groups: [{ label: "Núcleo", files: ["a.ts"], lookFirst: true }], risk: "cuidado" },
};

describe("SessionNarrative", () => {
  it("mostra botão quando não há cache", () => {
    const client: NarrativeClient = { subscribe: () => () => {}, fetch: () => {}, generate: () => {} };
    render(<SessionNarrative projectId="p" specId="OBS-1" observed={observed()} client={client} />);
    expect(screen.getByRole("button", { name: /gerar apresenta/i })).toBeTruthy();
  });

  it("renderiza tldr, frente e anexa o diff real do marker", async () => {
    const client = clientThatEmitsOnFetch({ type: "narrative:cached", projectId: "p", specId: "OBS-1", narrative: N, stale: false });
    const { container } = render(<SessionNarrative projectId="p" specId="OBS-1" observed={observed()} client={client} />);
    expect(await screen.findByText("fiz X")).toBeTruthy();
    expect(screen.getByText("Frente 1")).toBeTruthy();
    expect(container.textContent).toContain("linha"); // diff real veio do marker, não do LLM
  });
});
