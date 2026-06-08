import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpecSummaryBlock } from "./SpecSummaryBlock";
import type { SpecSummaryClient, SpecSummaryServerMsg } from "../state/specSummaryClient";

function makeClient(overrides?: Partial<SpecSummaryClient>): SpecSummaryClient & {
  _trigger: (msg: SpecSummaryServerMsg) => void;
} {
  let handler: ((msg: SpecSummaryServerMsg) => void) | null = null;
  return {
    subscribe: vi.fn((_key: string, fn: (msg: SpecSummaryServerMsg) => void) => {
      handler = fn;
      return () => { handler = null; };
    }),
    fetch: vi.fn(),
    generate: vi.fn(),
    _trigger: (msg: SpecSummaryServerMsg) => handler?.(msg),
    ...overrides,
  } as any;
}

describe("AC-007: estado ready/stale com specPath=null → botão regerar não aparece", () => {
  it("não exibe botão regerar em estado ready quando specPath é null", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={null}
        client={client}
      />
    );
    act(() => {
      client._trigger({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "Resumo antigo.",
        generatedAt: new Date().toISOString(),
        stale: false,
      });
    });
    expect(screen.queryByRole("button", { name: /regerar/i })).not.toBeInTheDocument();
  });

  it("não exibe botão regerar em estado stale quando specPath é null", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={null}
        client={client}
      />
    );
    act(() => {
      client._trigger({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "Resumo antigo.",
        generatedAt: new Date().toISOString(),
        stale: true,
      });
    });
    expect(screen.queryByRole("button", { name: /regerar/i })).not.toBeInTheDocument();
  });
});

describe("AC-007: specPath === null → botão desabilitado e mensagem de indisponibilidade", () => {
  it("exibe mensagem de spec não disponível quando specPath é null", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={null}
        client={client}
      />
    );
    expect(screen.getByText(/sem spec\.md disponível/i)).toBeInTheDocument();
  });

  it("botão de gerar resumo está desabilitado quando specPath é null", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={null}
        client={client}
      />
    );
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeDisabled();
  });

  it("exibe mensagem de spec não disponível quando specPath é undefined", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={undefined}
        client={client}
      />
    );
    expect(screen.getByText(/sem spec\.md disponível/i)).toBeInTheDocument();
  });

  it("botão de gerar resumo está desabilitado quando specPath é undefined", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={undefined}
        client={client}
      />
    );
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeDisabled();
  });
});

describe("AC-001: drawer exibe bloco com botão 'gerar resumo' e seletor de modelo, default haiku", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("exibe botão 'gerar resumo' quando specPath é válido (estado empty)", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeInTheDocument();
  });

  it("botão está habilitado quando specPath é válido", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(screen.getByRole("button", { name: /gerar resumo/i })).not.toBeDisabled();
  });

  it("exibe o ModelSelector (combobox) ao lado do botão", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("o seletor tem Haiku como valor default (sem nada no localStorage)", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(screen.getByRole("combobox")).toHaveValue("haiku");
  });

  it("o seletor usa storageKey 'aios-model-spec'", () => {
    localStorage.setItem("aios-model-spec", "opus");
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(screen.getByRole("combobox")).toHaveValue("opus");
  });
});

describe("AC-001: chama fetch na montagem para carregar do cache", () => {
  it("chama client.fetch ao montar o componente", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    expect(client.fetch).toHaveBeenCalledWith("proj-1", "FEAT-006");
  });

  it("não chama fetch quando specPath é null (sem spec.md, gerar não é possível)", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath={null}
        client={client}
      />
    );
    expect(client.fetch).not.toHaveBeenCalled();
  });
});

describe("AC-001: clique em 'gerar resumo' chama generate com o modelo selecionado", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("chama client.generate com o modelo haiku (default) ao clicar", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    expect(client.generate).toHaveBeenCalledWith("proj-1", "FEAT-006", "haiku");
  });

  it("chama generate com o modelo selecionado pelo usuário", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "sonnet");
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    expect(client.generate).toHaveBeenCalledWith("proj-1", "FEAT-006", "sonnet");
  });
});

describe("estados de carregamento e streaming", () => {
  it("exibe indicador de carregamento após clicar em gerar resumo", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    expect(screen.getByText(/gerando/i)).toBeInTheDocument();
  });

  it("exibe texto em streaming quando recebe spec-summary:chunk", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    act(() => {
      client._trigger({
        type: "spec-summary:chunk",
        projectId: "proj-1",
        specId: "FEAT-006",
        delta: "Esta feature",
      });
    });
    expect(screen.getByText(/Esta feature/)).toBeInTheDocument();
  });

  it("exibe texto final e metadados após spec-summary:done", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    act(() => {
      client._trigger({
        type: "spec-summary:done",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "Resumo completo da feature.",
        generatedAt: new Date().toISOString(),
        costUsd: 0.001,
        modelId: "claude-haiku-4-5-20251001",
      });
    });
    expect(screen.getByText(/Resumo completo da feature\./)).toBeInTheDocument();
    expect(screen.getByText(/Haiku 4\.5/)).toBeInTheDocument();
  });

  it("exibe texto do cache e não exibe erro quando recebe spec-summary:cached", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    act(() => {
      client._trigger({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "Resumo do cache.",
        generatedAt: new Date().toISOString(),
        stale: false,
      });
    });
    expect(screen.getByText(/Resumo do cache\./)).toBeInTheDocument();
    expect(screen.queryByText(/erro/i)).not.toBeInTheDocument();
  });

  it("estado stale exibe aviso de regerar quando cache está desatualizado", () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    act(() => {
      client._trigger({
        type: "spec-summary:cached",
        projectId: "proj-1",
        specId: "FEAT-006",
        text: "Resumo antigo.",
        generatedAt: new Date().toISOString(),
        stale: true,
      });
    });
    expect(screen.getByText(/regerar — spec\.md foi modificado/i)).toBeInTheDocument();
  });

  it("exibe mensagem de erro quando recebe spec-summary:error", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    act(() => {
      client._trigger({
        type: "spec-summary:error",
        projectId: "proj-1",
        specId: "FEAT-006",
        message: "CLI não encontrado no PATH",
      });
    });
    expect(screen.getByText(/CLI não encontrado no PATH/)).toBeInTheDocument();
  });

  it("botão está disponível para nova tentativa após erro", async () => {
    const client = makeClient();
    render(
      <SpecSummaryBlock
        projectId="proj-1"
        specId="FEAT-006"
        specPath="/path/to/spec.md"
        client={client}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /gerar resumo/i }));
    act(() => {
      client._trigger({
        type: "spec-summary:error",
        projectId: "proj-1",
        specId: "FEAT-006",
        message: "falha",
      });
    });
    expect(screen.getByRole("button", { name: /gerar resumo/i })).not.toBeDisabled();
  });
});
