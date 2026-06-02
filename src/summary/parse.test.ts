import { describe, it, expect } from "vitest";
import { parseStreamLine } from "./parse.js";

describe("parseStreamLine", () => {
  it("extrai o delta de texto de um content_block_delta", () => {
    const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } } });
    expect(parseStreamLine(line)).toEqual({ kind: "chunk", text: "ok" });
  });

  it("extrai o texto completo do result de sucesso", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "resumo final" });
    expect(parseStreamLine(line)).toEqual({ kind: "done", text: "resumo final" });
  });

  it("trata result com erro", () => {
    const line = JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "" });
    const out = parseStreamLine(line);
    expect(out?.kind).toBe("error");
  });

  it("ignora linhas de ruído (system, assistant, rate_limit)", () => {
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "assistant", message: {} }))).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "rate_limit_event" }))).toBeNull();
  });

  it("ignora stream_event que não é text_delta", () => {
    expect(parseStreamLine(JSON.stringify({ type: "stream_event", event: { type: "message_start" } }))).toBeNull();
  });

  it("ignora linha vazia ou JSON inválido sem lançar", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
    expect(parseStreamLine("{nao é json")).toBeNull();
  });
});
