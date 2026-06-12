import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { makeDeliveryReport } from "../test-utils";

// Todas as 11 keys canônicas com respostas distintas.
const ALL_KEYS = [
  "what_was_done",
  "how_it_was_done",
  "why_this_way",
  "deviations_from_plan",
  "acceptance_criteria",
  "evidence",
  "impacts",
  "out_of_scope",
  "risks_and_pending",
  "how_to_validate",
  "final_verdict",
] as const;

const fullReport = makeDeliveryReport({
  answers: ALL_KEYS.map((key) => ({
    key,
    answer: `resposta de ${key}`,
    confidence: "recorded" as const,
    evidenceRefs: [],
  })),
});

// Report com evidenceRefs mistos: um .md absoluto (clicável) e um texto inerte.
const reportWithRefs = makeDeliveryReport({
  answers: [
    {
      key: "what_was_done",
      answer: "entregou módulo",
      confidence: "recorded" as const,
      evidenceRefs: ["/abs/delivery-facts.md", "src/x.ts:42"],
    },
    {
      key: "risks_and_pending",
      answer: "risco Z",
      confidence: "inferred" as const,
      evidenceRefs: [],
    },
  ],
});

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

  it("a primeira vital abre por padrão; as demais ficam fechadas", () => {
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

  it("respostas vitais aparecem primeiro, com teaser; demais atrás de 'ler parecer completo'", () => {
    render(<DeliveryReportBlock report={fullReport} onOpenFile={() => {}} />);
    const vitals = screen.getAllByTestId("delivery-vital");
    expect(vitals.map((v) => v.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("O que foi entregue")]),
    );
    expect(screen.getByText(/ler parecer completo/)).toBeTruthy();
  });

  it("evidenceRef .md absoluto vira botão; ref texto continua inerte", () => {
    const onOpenFile = vi.fn();
    render(<DeliveryReportBlock report={reportWithRefs} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole("button", { name: /delivery-facts\.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith("/abs/delivery-facts.md", "delivery-facts.md");
    expect(screen.getByText("src/x.ts:42")).toBeTruthy();
  });
});
