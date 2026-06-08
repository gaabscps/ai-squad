import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { makeDeliveryReport } from "../test-utils";

describe("DeliveryReportBlock", () => {
  it("sem report mostra placeholder", () => {
    render(<DeliveryReportBlock report={null} />);
    expect(screen.getByText("sem parecer de entrega ainda")).toBeInTheDocument();
  });

  it("mostra veredicto, respostas com confidence e tabela de ACs", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    expect(screen.getByText("Aprovado com ressalvas")).toBeInTheDocument();
    expect(screen.getByText("O que foi entregue")).toBeInTheDocument();
    expect(screen.getByText("registrado")).toBeInTheDocument();
    expect(screen.getByText("inferido")).toBeInTheDocument();
    expect(screen.getByText("AC-001")).toBeInTheDocument();
    expect(screen.getByText("parcialmente atendido")).toBeInTheDocument();
  });

  it("link pro .md quando mdPath existe; ausente quando null", () => {
    const { rerender } = render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    const link = screen.getByText("ver narrativa completa →").closest("a")!;
    expect(link.getAttribute("href")).toContain("/file?path=");

    rerender(<DeliveryReportBlock report={makeDeliveryReport({ mdPath: null })} />);
    expect(screen.queryByText("ver narrativa completa →")).not.toBeInTheDocument();
  });
});
