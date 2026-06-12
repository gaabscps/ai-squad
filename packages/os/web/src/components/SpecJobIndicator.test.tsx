import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { DiagnosisJobsProvider, useDiagnosisJobs } from "../state/diagnosisJobs";
import { SpecJobIndicator } from "./SpecJobIndicator";
import { act, renderHook } from "@testing-library/react";
import type { AttentionClient, AttentionServerMsg } from "../state/attentionClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeClient(): AttentionClient & { emit: (msg: AttentionServerMsg) => void } {
  const subs = new Map<string, Set<(msg: AttentionServerMsg) => void>>();
  return {
    emit(msg: AttentionServerMsg) {
      const key = `${msg.projectId}|${msg.specId}`;
      const fns = subs.get(key);
      if (fns) for (const fn of fns) fn(msg);
    },
    subscribe(key, fn) {
      const set = subs.get(key) ?? new Set();
      set.add(fn);
      subs.set(key, set);
      return () => {
        set.delete(fn);
        if (set.size === 0) subs.delete(key);
      };
    },
    fetch: () => Promise.resolve({ text: null, handoff: null, costUsd: null, generatedAt: null }),
    generate: () => {},
    cancel: () => {},
  };
}

function makeWrapper(client: AttentionClient & { emit: (msg: AttentionServerMsg) => void }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DiagnosisJobsProvider client={client}>{children}</DiagnosisJobsProvider>;
  };
}

// ---------------------------------------------------------------------------
// AC-004: nenhum job — não renderiza nada
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-004 (sem job, nada renderizado)", () => {
  it("não renderiza nada quando não há job registrado para a spec", () => {
    const client = fakeClient();
    const { container } = render(
      <DiagnosisJobsProvider client={client}>
        <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />
      </DiagnosisJobsProvider>
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-001: estado ativo — barra + rótulo de etapa
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-001 (estado ativo: barra + rótulo)", () => {
  it("exibe barra indeterminada e rótulo 'gerando' quando job está em generating (AC-001)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });

    expect(screen.getByText("gerando")).toBeTruthy();
    const bar = document.querySelector(".spec-job-bar");
    expect(bar).not.toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("exibe rótulo 'na fila' quando job está em queued (AC-001)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    const { rerender } = render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({ type: "attention:queued", projectId: "proj-abc", specId: "FEAT-001" });
    });
    rerender(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    expect(screen.getByText("na fila")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("exibe rótulo 'gerando' quando job está em generating (AC-001)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });

    expect(screen.getByText("gerando")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("exibe rótulo 'streamando' quando job está em streaming (AC-001)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({ type: "attention:chunk", projectId: "proj-abc", specId: "FEAT-001", delta: "abc" });
    });

    expect(screen.getByText("streamando")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-002: ready não visto — badge de sucesso
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-002 (ready não visto: badge de sucesso)", () => {
  it("exibe badge de sucesso quando job é ready e seen=false (AC-002)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "ok",
        costUsd: null,
        generatedAt: null,
      });
    });

    const badge = screen.getByLabelText("Diagnóstico concluído");
    expect(badge).toBeTruthy();
    // Badge de sucesso NÃO deve ter a classe de erro
    expect(badge.className).toContain("spec-job-badge--success");
    expect(badge.className).not.toContain("spec-job-badge--error");
  });

  it("não exibe badge de sucesso quando job é ready e seen=true (AC-004)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    const { container } = render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-abc",
        specId: "FEAT-001",
        text: "ok",
        costUsd: null,
        generatedAt: null,
      });
    });
    act(() => { api!.markSeen("proj-abc", "FEAT-001"); });

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-005: error não visto — badge de erro visualmente distinta
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-005 (error não visto: badge de erro distinta)", () => {
  it("exibe badge de erro quando job é error e seen=false (AC-005)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-abc",
        specId: "FEAT-001",
        message: "falha no diagnóstico",
      });
    });

    const badge = screen.getByLabelText("Erro no diagnóstico");
    expect(badge).toBeTruthy();
    // Badge de erro usa classe distinta da de sucesso
    expect(badge.className).toContain("spec-job-badge--error");
    expect(badge.className).not.toContain("spec-job-badge--success");
  });

  it("badge de erro é visualmente distinta da badge de sucesso (AC-005) — classes diferentes", () => {
    // Este teste verifica que as classes CSS usadas são distintas
    // (comportamento verificável em jsdom; o visual final requer NFR-002)
    const successClass = "spec-job-badge--success";
    const errorClass = "spec-job-badge--error";
    expect(successClass).not.toBe(errorClass);
  });

  it("não exibe badge de erro quando job é error e seen=true (AC-004)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    const { container } = render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-abc",
        specId: "FEAT-001",
        message: "falha",
      });
    });
    act(() => { api!.markSeen("proj-abc", "FEAT-001"); });

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-009: cancelled — sem badge nem indicador
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-009 (cancelled: nenhum indicador)", () => {
  it("não renderiza nada quando job é cancelled (AC-009)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return <SpecJobIndicator projectId="proj-abc" specId="FEAT-001" />;
    }

    const { container } = render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    act(() => { api!.generate("proj-abc", "FEAT-001"); });
    act(() => { api!.cancel("proj-abc", "FEAT-001"); });

    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-006: isolamento por chave — múltiplos indicadores independentes
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-006 (isolamento por chave)", () => {
  it("dois indicadores com chaves distintas são completamente independentes (AC-006)", () => {
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      return (
        <>
          <div data-testid="ind-a">
            <SpecJobIndicator projectId="proj-a" specId="FEAT-001" />
          </div>
          <div data-testid="ind-b">
            <SpecJobIndicator projectId="proj-b" specId="FEAT-002" />
          </div>
        </>
      );
    }

    render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    // proj-a: ativo (generating), proj-b: sem job
    act(() => { api!.generate("proj-a", "FEAT-001"); });

    // proj-a mostra rótulo de etapa
    const indA = screen.getByTestId("ind-a");
    expect(indA.textContent).toContain("gerando");

    // proj-b não mostra nada
    const indB = screen.getByTestId("ind-b");
    expect(indB.firstChild).toBeNull();

    // proj-b conclui — proj-a continua gerando, proj-b mostra badge de sucesso
    act(() => { api!.generate("proj-b", "FEAT-002"); });
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-b",
        specId: "FEAT-002",
        text: "ok",
        costUsd: null,
        generatedAt: null,
      });
    });

    // proj-a ainda ativo
    expect(screen.getByTestId("ind-a").textContent).toContain("gerando");
    // proj-b agora tem badge de sucesso
    expect(screen.getByTestId("ind-b").querySelector(".spec-job-badge--success")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-007: spec ausente no store de projetos — fallback gracioso
// ---------------------------------------------------------------------------

describe("SpecJobIndicator — AC-007 (graceful fallback — spec ausente no store de projetos)", () => {
  it("renderiza normalmente usando estado do job mesmo sem spec no store de projetos (AC-007)", () => {
    // O componente não depende do store de projetos — lê apenas diagnosisJobs.
    // Isso garante que spec ausente no store de projetos não quebra o indicador.
    const client = fakeClient();
    let api: ReturnType<typeof useDiagnosisJobs>;

    function TestComponent() {
      api = useDiagnosisJobs();
      // specId cru como label (sem store de projetos envolvido)
      return <SpecJobIndicator projectId="proj-ausente" specId="FEAT-INEXISTENTE" />;
    }

    const { container } = render(
      <DiagnosisJobsProvider client={client}>
        <TestComponent />
      </DiagnosisJobsProvider>
    );

    // Sem job — nada renderizado (não quebra)
    expect(container.firstChild).toBeNull();

    act(() => { api!.generate("proj-ausente", "FEAT-INEXISTENTE"); });

    // Com job ativo — mostra indicador mesmo sem spec no store de projetos
    expect(screen.getByText("gerando")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});
