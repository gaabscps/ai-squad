import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpecCard } from "./SpecCard";
import { makeSpec } from "../test-utils";

describe("SpecCard", () => {
  it("mostra id, título, status, fases e custo de uma spec SDD", () => {
    const spec = makeSpec({
      id: "FEAT-020",
      title: "feature legal",
      status: "running",
      phase: "plan",
      plannedPhases: ["specify", "plan", "tasks", "implementation"],
    });
    render(<SpecCard spec={spec} projectPath="/x/proj" />);
    expect(screen.getByText("FEAT-020")).toBeInTheDocument();
    expect(screen.getByText("feature legal")).toBeInTheDocument();
    expect(screen.getByText("rodando")).toBeInTheDocument();
    expect(screen.getByText("plan")).toHaveClass("phase-current");
    expect(screen.getByText("US$ 0.50")).toBeInTheDocument();
  });

  it("marca o squad no card (SDD vs Discovery)", () => {
    const { container } = render(
      <SpecCard spec={makeSpec({ squad: "discovery" })} projectPath="/x/proj" />,
    );
    expect(container.querySelector(".spec-card")).toHaveAttribute("data-squad", "discovery");
  });
});
