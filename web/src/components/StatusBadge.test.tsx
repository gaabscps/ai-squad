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
});
