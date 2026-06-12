import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";
import { makeSpec } from "../test-utils";

describe("StatusBadge", () => {
  it("mostra o rótulo do status e a classe de cor", () => {
    render(<StatusBadge spec={makeSpec({ status: "blocked" })} />);
    const badge = screen.getByText("bloqueado");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("status-blocked");
  });

  it("mostra a flag de audit_exception quando ligada", () => {
    render(
      <StatusBadge
        spec={makeSpec({ health: { pendingHuman: 0, escalationRate: 0, auditException: true } })}
      />,
    );
    expect(screen.getByText("⚠ audit")).toBeInTheDocument();
  });

  it("sem audit_exception, não mostra a flag", () => {
    render(<StatusBadge spec={makeSpec()} />);
    expect(screen.queryByText("⚠ audit")).toBeNull();
  });

  it("needs_attention → badge usa classe status-needs_attention", () => {
    render(<StatusBadge spec={makeSpec({ status: "needs_attention" })} />);
    const badge = screen.getByText("precisa de você");
    expect(badge).toHaveClass("status-needs_attention");
  });

  it("abandoned → badge usa classe status-abandoned", () => {
    render(<StatusBadge spec={makeSpec({ status: "abandoned" })} />);
    const badge = screen.getByText("abandonado");
    expect(badge).toHaveClass("status-abandoned");
  });
});
