import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownText } from "./markdown";

describe("MarkdownText", () => {
  it("**x** vira <strong>", () => {
    const { container } = render(<MarkdownText source="um **forte** aqui" />);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("forte");
  });

  it("`x` vira <code>", () => {
    const { container } = render(<MarkdownText source="chama `loc.count()` ali" />);
    expect(container.querySelector("code")?.textContent).toBe("loc.count()");
  });

  it("*x* vira <em>", () => {
    const { container } = render(<MarkdownText source="texto *ênfase* fim" />);
    expect(container.querySelector("em")?.textContent).toBe("ênfase");
  });

  it("linhas com - viram ul>li", () => {
    const { container } = render(<MarkdownText source={"- um\n- dois\n- três"} />);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.querySelectorAll("li")).toHaveLength(3);
    expect(ul!.querySelectorAll("li")[1].textContent).toBe("dois");
  });

  it("linhas com 1. 2. viram ol>li", () => {
    const { container } = render(<MarkdownText source={"1. primeiro\n2. segundo"} />);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll("li")).toHaveLength(2);
  });

  it("## título vira elemento de heading com o texto", () => {
    const { container } = render(<MarkdownText source="## Meu título" />);
    const h = container.querySelector(".md-h");
    expect(h?.textContent).toBe("Meu título");
  });

  it("dois parágrafos separados por linha em branco viram dois <p>", () => {
    const { container } = render(<MarkdownText source={"parágrafo um\n\nparágrafo dois"} />);
    const ps = container.querySelectorAll("p.md-p");
    expect(ps).toHaveLength(2);
  });

  it("markdown malformado (** sem fechar) cai como texto literal sem quebrar", () => {
    const { container } = render(<MarkdownText source="isto **não fecha" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("**não fecha");
  });

  it("texto sem markdown vira um <p> com o texto", () => {
    const { container } = render(<MarkdownText source="só texto puro" />);
    const ps = container.querySelectorAll("p.md-p");
    expect(ps).toHaveLength(1);
    expect(ps[0].textContent).toBe("só texto puro");
  });

  it("negrito dentro de item de lista é renderizado", () => {
    const { container } = render(<MarkdownText source={"- item **forte**"} />);
    expect(container.querySelector("li strong")?.textContent).toBe("forte");
  });
});
