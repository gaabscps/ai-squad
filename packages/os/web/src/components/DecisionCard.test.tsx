import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCard } from "./DecisionCard";

const full = {
  what: "Direção estética C como base",
  why: "Escolha do humano via visual companion",
  rejected: "A — sem ruptura; B — coral suave demais",
  ref: "docs/escolha.md",
};

describe("DecisionCard", () => {
  it("destaca o escolhido e esmaece o rejeitado", () => {
    render(<ol><DecisionCard decision={full} onOpenRef={() => {}} /></ol>);
    expect(screen.getByText(full.what).closest(".decision-chosen")).toBeTruthy();
    expect(screen.getByText(full.rejected).closest(".decision-rejected")).toBeTruthy();
    expect(screen.getByText(full.why)).toBeTruthy();
  });

  it("ref .md vira botão que chama onOpenRef", () => {
    const onOpenRef = vi.fn();
    render(<ol><DecisionCard decision={full} onOpenRef={onOpenRef} /></ol>);
    fireEvent.click(screen.getByRole("button", { name: /docs\/escolha\.md/ }));
    expect(onOpenRef).toHaveBeenCalledWith("docs/escolha.md");
  });

  it("ref não-.md renderiza como código inerte", () => {
    render(<ol><DecisionCard decision={{ ...full, ref: "conversa OBS-003" }} onOpenRef={() => {}} /></ol>);
    expect(screen.queryByRole("button", { name: /conversa/ })).toBeNull();
    expect(screen.getByText("conversa OBS-003")).toBeTruthy();
  });

  it("ref .md sem onOpenRef: código inerte (sem botão)", () => {
    render(<ol><DecisionCard decision={full} /></ol>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("docs/escolha.md")).toBeTruthy();
  });

  it("sem rejected/why/ref: só o escolhido", () => {
    render(<ol><DecisionCard decision={{ what: "Só what", why: null, rejected: null, ref: null }} /></ol>);
    expect(screen.getByText("Só what")).toBeTruthy();
    expect(document.querySelector(".decision-rejected")).toBeNull();
  });
});
