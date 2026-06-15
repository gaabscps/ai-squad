import { describe, it, expect } from "vitest";
import { mergeSyntaxAndDiff } from "./syntax";

describe("mergeSyntaxAndDiff", () => {
  it("funde cor de sintaxe (foreground) com marca de diff (background) sobre a mesma linha", () => {
    const syntax = [
      { text: "const", color: "#FF79C6" },
      { text: " x = ", color: "#F8F8F2" },
      { text: "2", color: "#BD93F9" },
    ];
    const diff = [
      { text: "const x = ", changed: false },
      { text: "2", changed: true },
    ];

    expect(mergeSyntaxAndDiff(syntax, diff)).toEqual([
      { text: "const", color: "#FF79C6", changed: false },
      { text: " x = ", color: "#F8F8F2", changed: false },
      { text: "2", color: "#BD93F9", changed: true },
    ]);
  });

  it("quebra um token de sintaxe quando a fronteira do diff cai no meio dele", () => {
    const syntax = [{ text: "abcd", color: "#FF79C6" }];
    const diff = [
      { text: "ab", changed: false },
      { text: "cd", changed: true },
    ];

    expect(mergeSyntaxAndDiff(syntax, diff)).toEqual([
      { text: "ab", color: "#FF79C6", changed: false },
      { text: "cd", color: "#FF79C6", changed: true },
    ]);
  });

  it("sem diff (null): todos os segmentos ficam changed=false, cor preservada", () => {
    const syntax = [{ text: "const x", color: "#FF79C6" }];
    expect(mergeSyntaxAndDiff(syntax, null)).toEqual([
      { text: "const x", color: "#FF79C6", changed: false },
    ]);
  });

  it("o texto concatenado dos segmentos reconstrói a linha original", () => {
    const syntax = [
      { text: "foo(", color: "#50FA7B" },
      { text: "a, b", color: "#F8F8F2" },
      { text: ")", color: "#F8F8F2" },
    ];
    const diff = [
      { text: "foo(a, ", changed: false },
      { text: "b)", changed: true },
    ];
    const merged = mergeSyntaxAndDiff(syntax, diff);
    expect(merged.map((s) => s.text).join("")).toBe("foo(a, b)");
  });
});
