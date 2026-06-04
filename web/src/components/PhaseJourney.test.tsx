import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseJourney } from "./PhaseJourney";
import { makeCost } from "../test-utils";

describe("PhaseJourney", () => {
  describe("AC-009 — jornada com todas as fases (source: report)", () => {
    it("exibe todas as três fases com custo quando byPhase está completo", () => {
      const cost = makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: {
          planning: 7.92,
          orchestration: 142.06,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText("planning")).toBeInTheDocument();
      expect(screen.getByText("orchestration")).toBeInTheDocument();
      expect(screen.getByText("implementation")).toBeInTheDocument();
    });

    it("formata os valores $ de cada fase corretamente", () => {
      const cost = makeCost({
        source: "report",
        byPhase: {
          planning: 7.92,
          orchestration: 142.06,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText("US$ 7.92")).toBeInTheDocument();
      expect(screen.getByText("US$ 142.06")).toBeInTheDocument();
      expect(screen.getByText("US$ 29.25")).toBeInTheDocument();
    });

    it("exibe total quando source é report", () => {
      const cost = makeCost({
        source: "report",
        totalCostUsd: 179.23,
        byPhase: {
          planning: 7.92,
          orchestration: 142.06,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText("US$ 179.23")).toBeInTheDocument();
    });

    it("exibe fases em ordem: planning → orchestration → implementation", () => {
      const cost = makeCost({
        source: "report",
        byPhase: {
          planning: 7.92,
          orchestration: 142.06,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("planning");
      expect(items[1]).toHaveTextContent("orchestration");
      expect(items[2]).toHaveTextContent("implementation");
    });
  });

  describe("AC-012 — estado parcial (source: partial, fases ausentes)", () => {
    it("exibe rótulo 'parcial' quando source é partial", () => {
      const cost = makeCost({
        source: "partial",
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText(/parcial/i)).toBeInTheDocument();
    });

    it("marca fases ausentes em byPhase como 'não rodada ainda' quando parcial", () => {
      const cost = makeCost({
        source: "partial",
        byPhase: {
          planning: null,
          orchestration: null,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      const notRunYet = screen.getAllByText(/não rodada ainda/i);
      expect(notRunYet).toHaveLength(2);
    });

    it("exibe custo da fase que já rodou mesmo quando parcial", () => {
      const cost = makeCost({
        source: "partial",
        byPhase: {
          planning: null,
          orchestration: null,
          implementation: 29.25,
        },
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText("US$ 29.25")).toBeInTheDocument();
    });

    it("marca todas as fases como 'não rodada ainda' quando byPhase é null e parcial", () => {
      const cost = makeCost({
        source: "partial",
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      const notRunYet = screen.getAllByText(/não rodada ainda/i);
      expect(notRunYet).toHaveLength(3);
    });

    it("exibe '—' no total quando totalCostUsd é null", () => {
      const cost = makeCost({
        source: "partial",
        totalCostUsd: null,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByTestId("phase-journey-total")).toHaveTextContent("—");
    });
  });

  describe("AC-009 — estado vazio (source: empty)", () => {
    it("exibe estado vazio elegante quando source é empty", () => {
      const cost = makeCost({
        source: "empty",
        totalCostUsd: null,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText(/sem dados de custo/i)).toBeInTheDocument();
    });

    it("não exibe lista de fases quando source é empty", () => {
      const cost = makeCost({
        source: "empty",
        totalCostUsd: null,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    });
  });

  describe("AC-009 — source report com byPhase null", () => {
    it("exibe badge 'dados de fase indisponíveis' quando source é report mas byPhase é null", () => {
      const cost = makeCost({
        source: "report",
        totalCostUsd: 42.0,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText(/dados de fase indisponíveis/i)).toBeInTheDocument();
    });

    it("não exibe o banner 'sem dados de custo' quando source é report com byPhase null", () => {
      const cost = makeCost({
        source: "report",
        totalCostUsd: 42.0,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.queryByText(/sem dados de custo/i)).not.toBeInTheDocument();
    });

    it("ainda exibe a lista de fases e o total quando source é report com byPhase null", () => {
      const cost = makeCost({
        source: "report",
        totalCostUsd: 42.0,
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByRole("list")).toBeInTheDocument();
      expect(screen.getByTestId("phase-journey-total")).toBeInTheDocument();
    });
  });

  describe("AC-012 — source unreliable", () => {
    it("sinaliza baixa confiança quando source é unreliable", () => {
      const cost = makeCost({
        source: "unreliable",
        byPhase: null,
      });
      render(<PhaseJourney cost={cost} />);

      expect(screen.getByText(/não confiável/i)).toBeInTheDocument();
    });
  });
});
