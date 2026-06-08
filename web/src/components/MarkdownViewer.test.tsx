import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MarkdownViewer } from "./MarkdownViewer";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve("# Título\n\ncorpo **forte**") }),
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("MarkdownViewer", () => {
  it("não renderiza nada quando path é null", () => {
    const { container } = render(<MarkdownViewer path={null} title="" onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("busca o path e renderiza o markdown", async () => {
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Título")).toBeInTheDocument());
    expect(screen.getByText("forte").tagName).toBe("STRONG");
    expect(fetch).toHaveBeenCalledWith(
      "/file?path=" + encodeURIComponent("/x/spec.md"),
      expect.anything(),
    );
  });

  it("mostra erro quando o fetch falha", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("boom"))));
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/erro/i)).toBeInTheDocument());
  });

  it("✕ chama onClose", () => {
    const onClose = vi.fn();
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("fechar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
