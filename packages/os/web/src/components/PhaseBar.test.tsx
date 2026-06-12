import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseBar } from "./PhaseBar";
import { makeSpec } from "../test-utils";

describe("PhaseBar", () => {
  it("marca feita/atual/futura conforme a posição de phase", () => {
    render(
      <PhaseBar
        spec={makeSpec({
          status: "running",
          phase: "tasks",
          plannedPhases: ["specify", "plan", "tasks", "implementation"],
        })}
      />,
    );
    expect(screen.getByText("specify")).toHaveClass("phase-done");
    expect(screen.getByText("plan")).toHaveClass("phase-done");
    expect(screen.getByText("tasks")).toHaveClass("phase-current");
    expect(screen.getByText("implementation")).toHaveClass("phase-future");
  });

  it("status done marca todas as fases como feitas", () => {
    render(
      <PhaseBar
        spec={makeSpec({ status: "done", phase: "done", plannedPhases: ["specify", "implementation"] })}
      />,
    );
    expect(screen.getByText("specify")).toHaveClass("phase-done");
    expect(screen.getByText("implementation")).toHaveClass("phase-done");
  });

  it("usa os rótulos de plannedPhases (serve Discovery também)", () => {
    render(
      <PhaseBar
        spec={makeSpec({
          squad: "discovery",
          phase: "investigate",
          plannedPhases: ["frame", "investigate", "decide"],
        })}
      />,
    );
    expect(screen.getByText("frame")).toBeInTheDocument();
    expect(screen.getByText("investigate")).toHaveClass("phase-current");
    expect(screen.getByText("decide")).toHaveClass("phase-future");
  });
});
