import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelSelector } from "./ModelSelector";

describe("ModelSelector — opções e aliases (NFR-003)", () => {
  beforeEach(() => localStorage.clear());

  it("renderiza exatamente três opções: Haiku, Sonnet, Opus", () => {
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={vi.fn()} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(["haiku", "sonnet", "opus"]);
  });

  it("os textos das opções são os aliases sem número de versão", () => {
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Haiku" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sonnet" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Opus" })).toBeInTheDocument();
  });

  it("o value do <select> reflete a prop value recebida", () => {
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="sonnet" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("sonnet");
  });
});

describe("ModelSelector — onChange chama callback com novo alias", () => {
  beforeEach(() => localStorage.clear());

  it("chama onChange com 'sonnet' ao selecionar Sonnet", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "sonnet");
    expect(onChange).toHaveBeenCalledWith("sonnet");
  });

  it("chama onChange com 'opus' ao selecionar Opus", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "opus");
    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("chama onChange com 'haiku' ao selecionar Haiku", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="sonnet" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "haiku");
    expect(onChange).toHaveBeenCalledWith("haiku");
  });
});

describe("AC-004: persiste escolha em localStorage sob chave por contexto", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("salva o novo valor no localStorage ao mudar a seleção", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "opus");
    expect(localStorage.getItem("aios-model-spec")).toBe("opus");
  });

  it("usa 'aios-model-spec' como chave para o contexto de spec", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "sonnet");
    expect(localStorage.getItem("aios-model-spec")).toBe("sonnet");
    expect(localStorage.getItem("aios-model-task")).toBeNull();
  });

  it("usa 'aios-model-task' como chave para o contexto de task", async () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-task" defaultValue="sonnet" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "haiku");
    expect(localStorage.getItem("aios-model-task")).toBe("haiku");
    expect(localStorage.getItem("aios-model-spec")).toBeNull();
  });

  it("chaves de spec e task são isoladas — alterar spec não afeta task", async () => {
    localStorage.setItem("aios-model-task", "opus");
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "sonnet");
    expect(localStorage.getItem("aios-model-spec")).toBe("sonnet");
    expect(localStorage.getItem("aios-model-task")).toBe("opus");
  });
});

describe("AC-004: lê valor salvo do localStorage como valor inicial", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("exibe o valor salvo em localStorage como valor selecionado ao montar", () => {
    localStorage.setItem("aios-model-spec", "opus");
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("opus");
  });

  it("usa a prop value como default quando não há nada no localStorage", () => {
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="sonnet" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("sonnet");
  });

  it("chave de task independente da chave de spec para o valor inicial", () => {
    localStorage.setItem("aios-model-task", "haiku");
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="sonnet" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("sonnet");
  });
});

describe("ModelSelector — valor inválido no localStorage é ignorado", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("usa prop value quando o valor salvo não é um alias válido", () => {
    localStorage.setItem("aios-model-spec", "gpt-4");
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("haiku");
  });
});

describe("ModelSelector — sincronização do pai na montagem (AC-004)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("chama onChange na montagem quando localStorage restaura valor diferente do defaultValue", () => {
    localStorage.setItem("aios-model-spec", "opus");
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("não chama onChange na montagem quando localStorage está vazio e defaultValue é usado", () => {
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("não chama onChange na montagem quando localStorage coincide com defaultValue", () => {
    localStorage.setItem("aios-model-spec", "haiku");
    const onChange = vi.fn();
    render(<ModelSelector storageKey="aios-model-spec" defaultValue="haiku" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
