import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { makeDeliveryReport } from "../test-utils";

describe("DeliveryReportBlock", () => {
  it("sem report mostra placeholder", () => {
    render(<DeliveryReportBlock report={null} />);
    expect(screen.getByText("sem parecer de entrega ainda")).toBeInTheDocument();
  });

  it("veredicto, respostas em accordion com confidence, e markdown renderizado", () => {
    const report = makeDeliveryReport({
      answers: [
        { key: "what_was_done", answer: "entregou **o módulo** novo", confidence: "recorded", evidenceRefs: ["d#f"] },
        { key: "risks_and_pending", answer: "risco Y", confidence: "inferred", evidenceRefs: [] },
      ],
    });
    render(<DeliveryReportBlock report={report} />);
    expect(screen.getByText("Aprovado com ressalvas")).toBeInTheDocument();
    expect(screen.getByText("O que foi entregue")).toBeInTheDocument();
    expect(screen.getByText("registrado")).toBeInTheDocument();
    expect(screen.getByText("inferido")).toBeInTheDocument();
    expect(screen.getByText("o módulo").tagName).toBe("STRONG");
    expect(screen.getByText("d#f")).toBeInTheDocument();
  });

  it("a primeira resposta abre por padrão; as demais ficam fechadas", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    const items = document.querySelectorAll("details.delivery-answer");
    expect(items[0]).toHaveProperty("open", true);
    expect(items[1]).toHaveProperty("open", false);
  });

  it("ACs em seção colapsável com resumo de contagem", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    expect(screen.getByText(/Critérios de aceite/)).toBeInTheDocument();
    expect(screen.getByText(/1 atendido · 1 parcialmente atendido/)).toBeInTheDocument();
    expect(screen.getByText("AC-001")).toBeInTheDocument();
  });

  it("'ver narrativa completa' é botão e chama onOpenFile com o path do .md", () => {
    const onOpenFile = vi.fn();
    render(<DeliveryReportBlock report={makeDeliveryReport()} onOpenFile={onOpenFile} />);
    const btn = screen.getByRole("button", { name: /ver narrativa completa/ });
    btn.click();
    expect(onOpenFile).toHaveBeenCalledWith("/x/delivery-report.md", "delivery-report.md");
  });

  it("sem mdPath não mostra o botão de narrativa", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport({ mdPath: null })} onOpenFile={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /ver narrativa completa/ })).not.toBeInTheDocument();
  });
});
