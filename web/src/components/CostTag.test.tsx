import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostTag } from "./CostTag";
import { makeCost } from "../test-utils";

describe("CostTag", () => {
  it("mostra $ e tokens quando há dados", () => {
    render(<CostTag cost={makeCost({ totalCostUsd: 0.5, totalTokens: 1_400_000 })} />);
    expect(screen.getByText("US$ 0.50")).toBeInTheDocument();
    expect(screen.getByText("1.4M tok")).toBeInTheDocument();
  });

  it("sem dados de custo, mostra — e nenhum link de report", () => {
    render(<CostTag cost={makeCost({ totalCostUsd: null, reportPath: null })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "report" })).toBeNull();
  });

  it("marca '$ parcial' quando partial é true", () => {
    render(<CostTag cost={makeCost({ partial: true })} />);
    expect(screen.getByText("$ parcial")).toBeInTheDocument();
  });

  it("linka o report.html pela rota /file quando há reportPath", () => {
    render(<CostTag cost={makeCost({ reportPath: "/x/proj/.agent-session/FEAT-1/report.html" })} />);
    const link = screen.getByRole("link", { name: "report" });
    expect(link).toHaveAttribute(
      "href",
      "/file?path=" + encodeURIComponent("/x/proj/.agent-session/FEAT-1/report.html"),
    );
  });
});
