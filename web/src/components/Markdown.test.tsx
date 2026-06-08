import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renderiza negrito, código inline e listas como tags (não texto cru)", () => {
    render(<Markdown>{"texto **forte** e `code`\n\n- um\n- dois"}</Markdown>);
    expect(screen.getByText("forte").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renderiza tabela gfm", () => {
    render(<Markdown>{"| a | b |\n|---|---|\n| 1 | 2 |"}</Markdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("a").tagName).toBe("TH");
  });

  it("aceita className extra além de md-body", () => {
    const { container } = render(<Markdown className="x">{"oi"}</Markdown>);
    expect(container.querySelector(".md-body.x")).not.toBeNull();
  });
});
