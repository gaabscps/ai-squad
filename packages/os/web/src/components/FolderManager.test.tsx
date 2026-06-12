import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FolderManager } from "./FolderManager";
import * as foldersClient from "../state/foldersClient";
import * as projectsModule from "../state/projects";

vi.mock("../state/foldersClient");
vi.mock("../state/projects", async (importOriginal) => {
  const original = await importOriginal<typeof projectsModule>();
  return { ...original, useProjects: vi.fn() };
});

const mockBrowseDirs = vi.mocked(foldersClient.browseDirs);
const mockAddInclude = vi.mocked(foldersClient.addInclude);
const mockRemoveInclude = vi.mocked(foldersClient.removeInclude);
const mockUseProjects = vi.mocked(projectsModule.useProjects);

const FAKE_HOME = "/fake/home";
const dirWithSDD = { name: "valePay", path: "/fake/home/valePay", hasAgentSession: true };
const dirWithoutSDD = { name: "playground", path: "/fake/home/playground", hasAgentSession: false };

function browseResult(dirs: foldersClient.DirEntry[], resolvedPath = FAKE_HOME) {
  return { dirs, resolvedPath };
}

const BASE_PROJECTS_STATE: projectsModule.ProjectsState = {
  projects: [],
  connected: true,
  archiveAfterDays: 7,
  include: [],
};

function renderOpen(includeList: string[] = []) {
  mockUseProjects.mockReturnValue({ ...BASE_PROJECTS_STATE, include: includeList });
  return render(<FolderManager open={true} onClose={vi.fn()} />);
}

describe("FolderManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowseDirs.mockResolvedValue(browseResult([]));
    mockAddInclude.mockResolvedValue({ persisted: true, alreadyExisted: false });
    mockRemoveInclude.mockResolvedValue({ persisted: true });
    mockUseProjects.mockReturnValue(BASE_PROJECTS_STATE);
  });

  describe("AC-001 — listagem de diretórios com badge SDD", () => {
    it("exibe nome das subpastas listadas pelo browseDirs", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD, dirWithoutSDD]));
      renderOpen();
      await waitFor(() => {
        expect(screen.getByText("valePay")).toBeInTheDocument();
        expect(screen.getByText("playground")).toBeInTheDocument();
      });
    });

    it("exibe badge '✓ tem SDD' apenas para dirs com hasAgentSession: true", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD, dirWithoutSDD]));
      renderOpen();
      await waitFor(() => {
        const badges = screen.getAllByText(/tem SDD/i);
        expect(badges).toHaveLength(1);
        expect(badges[0].closest("li")?.textContent).toContain("valePay");
      });
    });

    it("NÃO exibe badge SDD para dirs com hasAgentSession: false", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithoutSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("playground")).toBeInTheDocument());
      expect(screen.queryByText(/tem SDD/i)).not.toBeInTheDocument();
    });

    it("chama browseDirs ao abrir o modal (quando open passa de false para true)", async () => {
      const { rerender } = render(<FolderManager open={false} onClose={vi.fn()} />);
      expect(mockBrowseDirs).not.toHaveBeenCalled();
      rerender(<FolderManager open={true} onClose={vi.fn()} />);
      await waitFor(() => expect(mockBrowseDirs).toHaveBeenCalledTimes(1));
    });
  });

  describe("AC-002 — navegação entre diretórios", () => {
    it("clicar numa subpasta chama browseDirs com o path desta subpasta", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());
      fireEvent.click(screen.getByText("valePay"));
      expect(mockBrowseDirs).toHaveBeenCalledWith(dirWithSDD.path);
    });

    it("botão 'Subir' navega ao diretório-pai", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));
      await waitFor(() => expect(mockBrowseDirs).toHaveBeenCalledWith(dirWithSDD.path));

      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      fireEvent.click(screen.getByRole("button", { name: /subir/i }));

      await waitFor(() =>
        expect(mockBrowseDirs).toHaveBeenCalledWith(FAKE_HOME)
      );
    });

    it("botão 'Subir' fica desabilitado quando se está no diretório inicial (home)", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([]));
      renderOpen();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /subir/i })).toBeDisabled()
      );
    });

    it("botão 'Subir' fica habilitado após navegar para subpasta", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /subir/i })).not.toBeDisabled()
      );
    });

    it("botão 'Subir' fica desabilitado ao retornar ao diretório home após navegação", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD], FAKE_HOME));
      renderOpen();
      await waitFor(() => expect(screen.getByRole("button", { name: /subir/i })).toBeDisabled());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /subir/i })).not.toBeDisabled()
      );

      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD], FAKE_HOME));
      fireEvent.click(screen.getByRole("button", { name: /subir/i }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /subir/i })).toBeDisabled()
      );
    });
  });

  describe("AC-003 — botão Adicionar este repo", () => {
    it("botão 'Adicionar este repo' está DESABILITADO quando o diretório atual não tem .agent-session", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithoutSDD]));
      renderOpen();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /adicionar este repo/i })
        ).toBeDisabled()
      );
    });

    it("botão 'Adicionar este repo' está HABILITADO quando a pasta atual tem .agent-session", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /adicionar este repo/i })
        ).not.toBeDisabled()
      );
    });

    it("botão 'Adicionar este repo' fica DESABILITADO ao subir de dir com SDD para dir intermediário sem SDD", async () => {
      const intermediate = { name: "projects", path: "/fake/home/projects", hasAgentSession: false };
      const sddDir = { name: "myrepo", path: "/fake/home/projects/myrepo", hasAgentSession: true };

      mockBrowseDirs.mockResolvedValue(browseResult([intermediate]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("projects")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([sddDir], intermediate.path));
      fireEvent.click(screen.getByText("projects"));
      await waitFor(() => expect(screen.getByText("myrepo")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], sddDir.path));
      fireEvent.click(screen.getByText("myrepo"));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /adicionar este repo/i })).not.toBeDisabled()
      );

      mockBrowseDirs.mockResolvedValue(browseResult([sddDir], intermediate.path));
      fireEvent.click(screen.getByRole("button", { name: /subir/i }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /adicionar este repo/i })).toBeDisabled()
      );
    });

    it("clicar 'Adicionar este repo' chama addInclude com o currentPath", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /adicionar este repo/i })
        ).not.toBeDisabled()
      );

      fireEvent.click(screen.getByRole("button", { name: /adicionar este repo/i }));
      expect(mockAddInclude).toHaveBeenCalledWith(dirWithSDD.path);
    });
  });

  describe("AC-005 — estado vazio de navegação", () => {
    it("exibe 'nenhuma subpasta aqui' quando browseDirs retorna lista vazia", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([]));
      renderOpen();
      await waitFor(() =>
        expect(screen.getByText(/nenhuma subpasta aqui/i)).toBeInTheDocument()
      );
    });

    it("NÃO exibe 'nenhuma subpasta aqui' quando há dirs", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithoutSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("playground")).toBeInTheDocument());
      expect(screen.queryByText(/nenhuma subpasta aqui/i)).not.toBeInTheDocument();
    });
  });

  describe("AC-006 — erro inline", () => {
    it("exibe mensagem de erro inline quando browseDirs rejeita com 403", async () => {
      mockBrowseDirs.mockRejectedValue(new Error("fora do home"));
      renderOpen();
      await waitFor(() =>
        expect(screen.getByText("fora do home")).toBeInTheDocument()
      );
    });

    it("exibe mensagem de erro inline quando browseDirs rejeita com 400", async () => {
      mockBrowseDirs.mockRejectedValue(new Error("path inválido"));
      renderOpen();
      await waitFor(() =>
        expect(screen.getByText("path inválido")).toBeInTheDocument()
      );
    });

    it("não usa alert() — nenhuma chamada a window.alert ao erro", async () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      mockBrowseDirs.mockRejectedValue(new Error("fora do home"));
      renderOpen();
      await waitFor(() =>
        expect(screen.getByText("fora do home")).toBeInTheDocument()
      );
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it("exibe erro inline quando addInclude rejeita", async () => {
      mockBrowseDirs.mockResolvedValue(browseResult([dirWithSDD]));
      renderOpen();
      await waitFor(() => expect(screen.getByText("valePay")).toBeInTheDocument());

      mockBrowseDirs.mockResolvedValue(browseResult([], dirWithSDD.path));
      fireEvent.click(screen.getByText("valePay"));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /adicionar este repo/i })
        ).not.toBeDisabled()
      );

      mockAddInclude.mockRejectedValue(new Error("sem .agent-session"));
      fireEvent.click(screen.getByRole("button", { name: /adicionar este repo/i }));

      await waitFor(() =>
        expect(screen.getByText("sem .agent-session")).toBeInTheDocument()
      );
    });

    it("limpa o erro quando o modal é fechado e reaberto com sucesso", async () => {
      mockBrowseDirs.mockRejectedValue(new Error("fora do home"));
      const onClose = vi.fn();
      const { rerender } = render(<FolderManager open={true} onClose={onClose} />);
      await waitFor(() =>
        expect(screen.getByText("fora do home")).toBeInTheDocument()
      );

      mockBrowseDirs.mockResolvedValue(browseResult([dirWithoutSDD]));
      rerender(<FolderManager open={false} onClose={onClose} />);
      rerender(<FolderManager open={true} onClose={onClose} />);

      await waitFor(() =>
        expect(screen.queryByText("fora do home")).not.toBeInTheDocument()
      );
      expect(screen.getByText("playground")).toBeInTheDocument();
    });
  });

  describe("AC-009 — lista de repos adicionados vem do snapshot WS (include[] no estado)", () => {
    it("exibe cada path de include[] na seção Repos adicionados", async () => {
      renderOpen(["/fake/home/valePay", "/fake/home/outro"]);
      await waitFor(() => {
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument();
        expect(screen.getByText("/fake/home/outro")).toBeInTheDocument();
      });
    });

    it("não chama removeInclude ao montar para exibir a lista", async () => {
      renderOpen(["/fake/home/valePay"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      expect(mockRemoveInclude).not.toHaveBeenCalled();
    });
  });

  describe("AC-011 — estado vazio de repos adicionados", () => {
    it("exibe 'nenhum repo adicionado ainda' quando include está vazio", async () => {
      renderOpen([]);
      await waitFor(() =>
        expect(screen.getByText(/nenhum repo adicionado ainda/i)).toBeInTheDocument()
      );
    });

    it("NÃO exibe 'nenhum repo adicionado ainda' quando include tem itens", async () => {
      renderOpen(["/fake/home/valePay"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      expect(screen.queryByText(/nenhum repo adicionado ainda/i)).not.toBeInTheDocument();
    });
  });

  describe("AC-010 — clicar remover chama removeInclude e remove o item", () => {
    it("cada item da lista tem um botão remover", async () => {
      renderOpen(["/fake/home/valePay"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      expect(screen.getByRole("button", { name: /remover \/fake\/home\/valePay/i })).toBeInTheDocument();
    });

    it("clicar remover chama removeInclude com o path correto", async () => {
      renderOpen(["/fake/home/valePay", "/fake/home/outro"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      fireEvent.click(screen.getByRole("button", { name: /remover \/fake\/home\/valePay/i }));
      expect(mockRemoveInclude).toHaveBeenCalledWith("/fake/home/valePay");
      expect(mockRemoveInclude).not.toHaveBeenCalledWith("/fake/home/outro");
    });

    it("botão remover fica desabilitado enquanto DELETE está em andamento", async () => {
      let resolveRemove!: (v: { persisted: boolean }) => void;
      mockRemoveInclude.mockReturnValue(
        new Promise<{ persisted: boolean }>((res) => { resolveRemove = res; })
      );
      renderOpen(["/fake/home/valePay"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      const btn = screen.getByRole("button", { name: /remover \/fake\/home\/valePay/i });
      fireEvent.click(btn);
      expect(btn).toBeDisabled();
      resolveRemove({ persisted: true });
      await waitFor(() => expect(btn).not.toBeDisabled());
    });

    it("exibe erro inline quando removeInclude rejeita", async () => {
      mockRemoveInclude.mockRejectedValue(new Error("falha ao remover"));
      renderOpen(["/fake/home/valePay"]);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );
      fireEvent.click(screen.getByRole("button", { name: /remover \/fake\/home\/valePay/i }));
      await waitFor(() =>
        expect(screen.getByText("falha ao remover")).toBeInTheDocument()
      );
    });
  });

  describe("AC-013 — snapshot WS atualizado reflete na lista do modal", () => {
    it("quando useProjects retorna include atualizado, a lista exibe o novo valor", async () => {
      const { rerender } = render(<FolderManager open={true} onClose={vi.fn()} />);
      await waitFor(() =>
        expect(screen.queryByText(/\/fake\/home\/novo/i)).not.toBeInTheDocument()
      );

      mockUseProjects.mockReturnValue({ ...BASE_PROJECTS_STATE, include: ["/fake/home/novo"] });
      rerender(<FolderManager open={true} onClose={vi.fn()} />);

      // O componente abrevia o home para `~` via displayPath; após o homePath
      // já estar resolvido (homePath="/fake/home"), o path entra como "~/novo".
      await waitFor(() =>
        expect(screen.getByText("~/novo")).toBeInTheDocument()
      );
    });

    it("quando include passa de 1 item para vazio via snapshot, exibe estado vazio", async () => {
      mockUseProjects.mockReturnValue({ ...BASE_PROJECTS_STATE, include: ["/fake/home/valePay"] });
      const { rerender } = render(<FolderManager open={true} onClose={vi.fn()} />);
      await waitFor(() =>
        expect(screen.getByText("/fake/home/valePay")).toBeInTheDocument()
      );

      mockUseProjects.mockReturnValue({ ...BASE_PROJECTS_STATE, include: [] });
      rerender(<FolderManager open={true} onClose={vi.fn()} />);

      await waitFor(() =>
        expect(screen.getByText(/nenhum repo adicionado ainda/i)).toBeInTheDocument()
      );
    });
  });

  it("não renderiza conteúdo quando open=false", () => {
    render(<FolderManager open={false} onClose={vi.fn()} />);
    expect(screen.queryByText(/gerenciar repositórios/i)).not.toBeInTheDocument();
  });

  it("botão fechar chama onClose", async () => {
    const onClose = vi.fn();
    mockBrowseDirs.mockResolvedValue(browseResult([]));
    render(<FolderManager open={true} onClose={onClose} />);
    await waitFor(() => expect(mockBrowseDirs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicar no overlay chama onClose", async () => {
    const onClose = vi.fn();
    mockBrowseDirs.mockResolvedValue(browseResult([]));
    render(<FolderManager open={true} onClose={onClose} />);
    await waitFor(() => expect(mockBrowseDirs).toHaveBeenCalled());
    const overlay = document.querySelector(".fm-overlay");
    if (overlay) fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
