import { describe, it, expect } from "vitest";
import { buildNarrativeSource, isVerificationCmd } from "./source.js";
import type { ObservedMeta } from "../store/types.js";

function obs(partial: Partial<ObservedMeta>): ObservedMeta {
  return {
    intent: "fazer X", createdAt: "2026-06-20T14:00:00Z", closedAt: "2026-06-20T16:00:00Z",
    attentionKind: null, decisions: [], evidence: [], driftFlags: [], baseSha: "abc",
    outputLocale: "pt-BR", report: null, markers: [], ...partial,
  };
}

describe("isVerificationCmd", () => {
  it("aceita testes/build, recusa exploração", () => {
    expect(isVerificationCmd("npx vitest run x.test.ts")).toBe(true);
    expect(isVerificationCmd("npx tsc --noEmit")).toBe(true);
    expect(isVerificationCmd('echo "=== fixture ===" && grep -n foo')).toBe(false);
    expect(isVerificationCmd("ls -la")).toBe(false);
  });
});

describe("buildNarrativeSource", () => {
  it("extrai edits, runs, verificações e decisões dos markers", () => {
    const o = obs({
      markers: [
        { kind: "edit", at: "t1", exact: true, note: null, decision: null, evidence: null, blockMs: null,
          editFiles: [{ path: "/p/a.ts", added: 5, removed: 1, patch: "@@ -1 +1 @@\n+a" }] },
        { kind: "run", at: "t2", exact: true, note: "npx vitest run a.test.ts", decision: null, evidence: null, editFiles: null, blockMs: null },
        { kind: "run", at: "t3", exact: true, note: "grep -n foo src", decision: null, evidence: null, editFiles: null, blockMs: null },
        { kind: "decision", at: "t4", exact: false, note: null, evidence: null, editFiles: null, blockMs: null,
          decision: { what: "usar Shiki", why: "temas", rejected: "highlight.js", ref: null } },
      ],
    });
    const src = buildNarrativeSource(o, "/no/such/dir");
    expect(src.edits).toEqual([{ path: "/p/a.ts", added: 5, removed: 1, patch: "@@ -1 +1 @@\n+a" }]);
    expect(src.verifications).toEqual(["npx vitest run a.test.ts"]);
    expect(src.runs).toContain("grep -n foo src");
    expect(src.decisions[0].what).toBe("usar Shiki");
    expect(src.reasoning).toBe(""); // dir inexistente → sem transcript
  });

  it("inclui texto do assistente e turnos humanos, mas descarta tool_result e tool_use", () => {
    const readDirFn = () => ["session-1.json"];
    const files: Record<string, string> = {
      "/s/costs/session-1.json": JSON.stringify({ transcript_path: "/s/t.jsonl" }),
      "/s/t.jsonl": [
        JSON.stringify({ type: "user", message: { content: "ajusta o espaçamento do step 1" } }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "feito, agora bate com o Figma" }, { type: "tool_use", name: "Edit", input: {} }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "saída de comando" }] } }),
        JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "agora o step 2" }] } }),
      ].join("\n"),
    };
    const readFileFn = (p: string) => { if (files[p] === undefined) throw new Error("nope"); return files[p]; };
    const src = buildNarrativeSource(obs({}), "/s", { readDirFn, readFileFn });
    expect(src.reasoning).toContain("ajusta o espaçamento do step 1"); // turno humano (string)
    expect(src.reasoning).toContain("feito, agora bate com o Figma");  // texto do assistente
    expect(src.reasoning).toContain("agora o step 2");                 // turno humano (bloco text)
    expect(src.reasoning).not.toContain("saída de comando");           // tool_result descartado
  });

  it("lê o transcript de TODAS as sessões observadas, não só a primeira", () => {
    const readDirFn = () => ["session-1.json", "session-2.json"];
    const files: Record<string, string> = {
      "/s/costs/session-1.json": JSON.stringify({ transcript_path: "/s/t1.jsonl" }),
      "/s/costs/session-2.json": JSON.stringify({ transcript_path: "/s/t2.jsonl" }),
      "/s/t1.jsonl": JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "trabalho da sessão um" }] } }),
      "/s/t2.jsonl": JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "trabalho da sessão dois" }] } }),
    };
    const readFileFn = (p: string) => { if (files[p] === undefined) throw new Error("nope"); return files[p]; };
    const src = buildNarrativeSource(obs({}), "/s", { readDirFn, readFileFn });
    expect(src.reasoning).toContain("trabalho da sessão um");
    expect(src.reasoning).toContain("trabalho da sessão dois");
  });

  it("aplica o teto generoso de caracteres", () => {
    const big = "x".repeat(200000);
    const readDirFn = () => ["session-1.json"];
    const files: Record<string, string> = {
      "/s/costs/session-1.json": JSON.stringify({ transcript_path: "/s/t.jsonl" }),
      "/s/t.jsonl": JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: big }] } }),
    };
    const readFileFn = (p: string) => { if (files[p] === undefined) throw new Error("nope"); return files[p]; };
    const src = buildNarrativeSource(obs({}), "/s", { readDirFn, readFileFn });
    expect(src.reasoning.length).toBeLessThanOrEqual(100000);
    expect(src.reasoning.length).toBeGreaterThan(12000); // teto subiu além do antigo 12k
  });
});
