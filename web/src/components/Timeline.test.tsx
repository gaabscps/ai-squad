import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import { makeSpec } from "../test-utils";

describe("Timeline", () => {
  it("lista as notas e abre os .md de SDD via onOpenFile", () => {
    const onOpenFile = vi.fn();
    const spec = makeSpec({
      id: "FEAT-007",
      squad: "sdd",
      timeline: [{ kind: "pm_init", timestamp: "2026-05-20T09:00:00Z", note: "início" }],
    });
    render(<Timeline spec={spec} projectPath="/x/proj" onOpenFile={onOpenFile} />);
    expect(screen.getByText("início")).toBeInTheDocument();

    const specBtn = screen.getByRole("button", { name: "spec.md" });
    specBtn.click();
    expect(onOpenFile).toHaveBeenCalledWith("/x/proj/.agent-session/FEAT-007/spec.md", "spec.md");
    expect(screen.getByRole("button", { name: "plan.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tasks.md" })).toBeInTheDocument();
  });

  it("Discovery abre memo.md (não spec/plan/tasks)", () => {
    const spec = makeSpec({ id: "DISC-001", squad: "discovery", plannedPhases: ["frame"], phase: "frame" });
    render(<Timeline spec={spec} projectPath="/x/proj" onOpenFile={vi.fn()} />);
    expect(screen.getByRole("button", { name: "memo.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "spec.md" })).toBeNull();
  });
});
