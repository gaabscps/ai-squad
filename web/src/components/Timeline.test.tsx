import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import { makeSpec } from "../test-utils";

describe("Timeline", () => {
  it("lista as notas e linka os .md de SDD pela rota /file", () => {
    const spec = makeSpec({
      id: "FEAT-007",
      squad: "sdd",
      timeline: [{ kind: "pm_init", timestamp: "2026-05-20T09:00:00Z", note: "início" }],
    });
    render(<Timeline spec={spec} projectPath="/x/proj" />);
    expect(screen.getByText("início")).toBeInTheDocument();
    const specLink = screen.getByRole("link", { name: "spec.md" });
    expect(specLink).toHaveAttribute(
      "href",
      "/file?path=" + encodeURIComponent("/x/proj/.agent-session/FEAT-007/spec.md"),
    );
    expect(screen.getByRole("link", { name: "plan.md" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tasks.md" })).toBeInTheDocument();
  });

  it("Discovery linka memo.md (não spec/plan/tasks)", () => {
    const spec = makeSpec({ id: "DISC-001", squad: "discovery", plannedPhases: ["frame"], phase: "frame" });
    render(<Timeline spec={spec} projectPath="/x/proj" />);
    expect(screen.getByRole("link", { name: "memo.md" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "spec.md" })).toBeNull();
  });
});
