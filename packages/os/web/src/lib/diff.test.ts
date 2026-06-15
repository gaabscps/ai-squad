import { describe, it, expect } from "vitest";
import { parsePatch, tokenDiff, langFromPath, similarity } from "./diff";

function joinSide(segs: { text: string }[]): string {
  return segs.map((s) => s.text).join("");
}
function changedText(segs: { text: string; changed: boolean }[]): string[] {
  return segs.filter((s) => s.changed).map((s) => s.text);
}

describe("parsePatch", () => {
  it("retorna [] para patch vazio ou null", () => {
    expect(parsePatch("")).toEqual([]);
    expect(parsePatch(null as unknown as string)).toEqual([]);
  });

  it("classifica add/del/context e numera as linhas a partir do cabeçalho @@", () => {
    const patch = [
      "@@ -1,3 +1,4 @@ function foo()",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " return a;",
    ].join("\n");

    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual([
      { kind: "context", text: "const a = 1;", oldNo: 1, newNo: 1 },
      { kind: "del", text: "const b = 2;", oldNo: 2, newNo: null },
      { kind: "add", text: "const b = 3;", oldNo: null, newNo: 2 },
      { kind: "add", text: "const c = 4;", oldNo: null, newNo: 3 },
      { kind: "context", text: "return a;", oldNo: 3, newNo: 4 },
    ]);
  });

  it("preserva o contexto da função no header do hunk", () => {
    const hunks = parsePatch("@@ -1,1 +1,1 @@ function foo()\n-a\n+b");
    expect(hunks[0].header).toBe("function foo()");
  });

  it("separa múltiplos hunks", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "@@ -10,1 +10,1 @@",
      "-x",
      "+y",
    ].join("\n");

    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines[0]).toMatchObject({ kind: "del", oldNo: 1 });
    expect(hunks[1].lines[0]).toMatchObject({ kind: "del", oldNo: 10 });
    expect(hunks[1].lines[1]).toMatchObject({ kind: "add", newNo: 10 });
  });

  it("trata arquivo novo (sem linhas de remoção)", () => {
    const patch = ["@@ -0,0 +1,2 @@", "+linha 1", "+linha 2"].join("\n");
    const hunks = parsePatch(patch);
    expect(hunks[0].lines).toEqual([
      { kind: "add", text: "linha 1", oldNo: null, newNo: 1 },
      { kind: "add", text: "linha 2", oldNo: null, newNo: 2 },
    ]);
  });

  it("ignora a marca 'No newline at end of file' na contagem", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-a", "+b", "\\ No newline at end of file"].join("\n");
    const hunks = parsePatch(patch);
    expect(hunks[0].lines).toHaveLength(2);
  });

  it("ignora cabeçalhos de arquivo do git diff (diff --git, ---, +++)", () => {
    const patch = [
      "diff --git a/foo.ts b/foo.ts",
      "index 1234567..89abcde 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
    ].join("\n");
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
  });
});

describe("tokenDiff", () => {
  it("linhas iguais não têm segmentos alterados", () => {
    const d = tokenDiff("const a = 1;", "const a = 1;");
    expect(changedText(d.old)).toEqual([]);
    expect(changedText(d.new)).toEqual([]);
  });

  it("realça apenas o token que mudou, preservando o resto", () => {
    const d = tokenDiff("const b = 2;", "const b = 3;");
    expect(changedText(d.old)).toEqual(["2"]);
    expect(changedText(d.new)).toEqual(["3"]);
  });

  it("cada lado reconstrói o texto original ao concatenar os segmentos", () => {
    const oldText = "  return foo(a, b);";
    const newText = "  return foo(a, c, b);";
    const d = tokenDiff(oldText, newText);
    expect(joinSide(d.old)).toBe(oldText);
    expect(joinSide(d.new)).toBe(newText);
  });

  it("inserção pura marca só o lado novo", () => {
    const d = tokenDiff("a b", "a x b");
    expect(changedText(d.old)).toEqual([]);
    expect(changedText(d.new).join("").trim()).toBe("x");
  });
});

describe("langFromPath", () => {
  it("mapeia extensões conhecidas para o id de linguagem do Shiki", () => {
    expect(langFromPath("src/foo.ts")).toBe("typescript");
    expect(langFromPath("a/b/c.tsx")).toBe("tsx");
    expect(langFromPath("x.js")).toBe("javascript");
    expect(langFromPath("comp.jsx")).toBe("jsx");
    expect(langFromPath("data.json")).toBe("json");
    expect(langFromPath("script.py")).toBe("python");
    expect(langFromPath("style.css")).toBe("css");
  });

  it("cai em 'text' para extensão desconhecida ou caminho nulo", () => {
    expect(langFromPath("Makefile")).toBe("text");
    expect(langFromPath("a.xyz")).toBe("text");
    expect(langFromPath(null)).toBe("text");
  });
});

describe("similarity", () => {
  it("linhas idênticas → 1", () => {
    expect(similarity("const a = 1;", "const a = 1;")).toBe(1);
  });

  it("nada em comum → 0", () => {
    expect(similarity("aaa", "bbb")).toBe(0);
  });

  it("edição pequena (troca de um trecho) → alta, passa na trava (≥ 0.5)", () => {
    const a = '  return container.querySelector("pre.tl-patch");';
    const b = '  return container.querySelector(".diff-view");';
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0.5);
  });

  it("linhas sem relação real → baixa, barrada pela trava (< 0.5)", () => {
    const a = "const x = computeTotal(items);";
    const b = "return cache.get(key);";
    expect(similarity(a, b)).toBeLessThan(0.5);
  });

  it("renomeação de identificador em linha curta fica perto de 0.45 (passa a trava de 0.4)", () => {
    // total↔parcial é o grosso da linha; só let/=/0/; ficam em comum → ~0.46
    expect(similarity("let total = 0;", "let parcial = 0;")).toBeGreaterThanOrEqual(0.4);
  });
});
