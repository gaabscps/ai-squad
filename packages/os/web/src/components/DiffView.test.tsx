import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffView } from "./DiffView";

describe("DiffView — render", () => {
  it("não renderiza nada para patch vazio", () => {
    const { container } = render(<DiffView patch="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pinta linha adicionada e removida com classes distintas", () => {
    const patch = ["@@ -1,2 +1,2 @@", " ctx", "-removida", "+adicionada"].join("\n");
    const { container } = render(<DiffView patch={patch} />);
    const add = container.querySelector(".diff-line.add");
    const del = container.querySelector(".diff-line.del");
    expect(add?.textContent).toContain("adicionada");
    expect(del?.textContent).toContain("removida");
  });

  it("mostra o número de linha na gutter", () => {
    const patch = ["@@ -41,1 +41,1 @@", "-a", "+b"].join("\n");
    const { container } = render(<DiffView patch={patch} />);
    const gutters = [...container.querySelectorAll(".diff-gutter")].map((g) => g.textContent);
    expect(gutters).toContain("41");
  });

  it("exibe o cabeçalho @@ com o contexto da função", () => {
    const patch = ["@@ -1,1 +1,1 @@ function foo()", "-a", "+b"].join("\n");
    render(<DiffView patch={patch} />);
    expect(screen.getByText(/function foo\(\)/)).toBeInTheDocument();
  });

  it("realça intra-linha apenas o token que mudou", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-const b = 2;", "+const b = 3;"].join("\n");
    const { container } = render(<DiffView patch={patch} />);
    const words = [...container.querySelectorAll(".diff-word")].map((w) => w.textContent);
    expect(words).toContain("2");
    expect(words).toContain("3");
  });

  it("aplica cor de sintaxe (foreground) e preserva o word-level no background", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-const a = 2;", "+const a = 3;"].join("\n");
    // highlighter falso: pinta a linha inteira de verde (rgb 80,250,123)
    const fakeHighlight = (text: string) => [{ text, color: "rgb(80, 250, 123)" }];
    const { container } = render(
      <DiffView patch={patch} path="x.ts" highlightLine={fakeHighlight} />,
    );

    const colored = [...container.querySelectorAll(".diff-content span")].some(
      (s) => (s as HTMLElement).style.color === "rgb(80, 250, 123)",
    );
    expect(colored).toBe(true);

    // o token alterado continua com .diff-word (background), compondo com a cor
    const words = [...container.querySelectorAll(".diff-word")].map((w) => w.textContent);
    expect(words).toContain("3");
  });

  it("aplica word-level no par similar de um bloco desbalanceado (2 removidas → 1 adicionada)", () => {
    const patch = [
      "@@ -1,2 +1,1 @@",
      '-  return el.querySelector("pre.tl-patch");',
      "-  const unused = 42;",
      '+  return el.querySelector(".diff-view");',
    ].join("\n");
    const { container } = render(<DiffView patch={patch} />);
    // a 1ª removida é quase igual à adicionada → pareadas → word-level aparece
    expect(container.querySelectorAll(".diff-word").length).toBeGreaterThan(0);
  });

  it("a trava barra o word-level quando as linhas pareadas são dissimilares", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-const x = computeTotal(items);",
      "+return cache.get(key);",
    ].join("\n");
    const { container } = render(<DiffView patch={patch} />);
    // par dissimilar → nenhuma palavra destacada (linha inteira)
    expect(container.querySelectorAll(".diff-word").length).toBe(0);
  });

  it("ativa o painel escuro (.dracula) quando há highlighter", () => {
    const fake = (text: string) => [{ text, color: "#f8f8f2" }];
    const { container } = render(
      <DiffView patch={"@@ -1,1 +1,1 @@\n-a\n+b"} path="x.ts" highlightLine={fake} />,
    );
    expect(container.querySelector(".diff-view.dracula")).not.toBeNull();
  });

  it("colapsa um bloco longo de contexto e expande ao clicar", async () => {
    const patch = [
      "@@ -1,10 +1,10 @@",
      "-old",
      "+new",
      " c1",
      " c2",
      " c3",
      " c4",
      " c5",
      " c6",
      " c7",
      " c8",
    ].join("\n");
    const { container } = render(<DiffView patch={patch} />);

    // c4 e c5 ficam escondidos atrás do fold (8 linhas de contexto, mostra 3+3)
    expect(screen.queryByText("c4")).not.toBeInTheDocument();
    const fold = container.querySelector(".diff-fold");
    expect(fold).not.toBeNull();

    await userEvent.click(fold as Element);
    expect(screen.getByText("c4")).toBeInTheDocument();
  });
});
