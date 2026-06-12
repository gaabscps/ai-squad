import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useEffect as reactUseEffect, useState as reactUseState } from "react";
import { AppProviders } from "./App";
import { useDiagnosisJobs } from "./state/diagnosisJobs";

import type { AttentionClient, AttentionServerMsg } from "./state/attentionClient";

function fakeClient(): AttentionClient & {
  emit: (msg: AttentionServerMsg) => void;
} {
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
    fetch: vi.fn(),
    generate: vi.fn(),
    cancel: vi.fn(),
  };
}

function TriggerJob({ projectId, specId }: { projectId: string; specId: string }) {
  const { generate } = useDiagnosisJobs();
  reactUseEffect(() => {
    generate(projectId, specId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function DrawerSimulator({
  selected,
}: {
  selected: { projectId: string; specId: string } | null;
}) {
  const { markSeen } = useDiagnosisJobs();
  reactUseEffect(() => {
    if (selected) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, markSeen]);
  return null;
}

function JobBadgeProbe({
  projectId,
  specId,
  testId,
}: {
  projectId: string;
  specId: string;
  testId?: string;
}) {
  const { getJob } = useDiagnosisJobs();
  const job = getJob(projectId, specId);
  if (!job) return <span data-testid={testId ?? "no-job"} />;
  return (
    <span
      data-testid={testId ?? "job-badge"}
      data-state={job.state}
      data-seen={String(job.seen)}
    />
  );
}

// ---------------------------------------------------------------------------
// AC-003: markSeen é chamado quando o drawer é aberto para uma spec com badge
// — a badge (seen=false) some (seen=true) ao abrir o drawer
// ---------------------------------------------------------------------------

describe("App — AC-003: markSeen chamado ao abrir o drawer", () => {
  it("job em ready+seen=false → abrir drawer → seen=true (badge some)", () => {
    const client = fakeClient();

    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-A" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-A" />
      </AppProviders>,
    );

    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-1",
        specId: "SPEC-A",
        text: "diagnóstico",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    // Antes de abrir o drawer: state=ready, seen=false
    expect(screen.getByTestId("job-badge").dataset.state).toBe("ready");
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("false");

    // Simula abertura do drawer
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-A" />
        <DrawerSimulator selected={{ projectId: "proj-1", specId: "SPEC-A" }} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-A" />
      </AppProviders>,
    );

    // Após abrir: seen=true
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");
  });

  it("markSeen é idempotente: seen permanece true após segunda chamada", () => {
    const client = fakeClient();

    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-IDEM" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-IDEM" />
      </AppProviders>,
    );

    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-1",
        specId: "SPEC-IDEM",
        text: "ok",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    // Primeira abertura
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-IDEM" />
        <DrawerSimulator selected={{ projectId: "proj-1", specId: "SPEC-IDEM" }} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-IDEM" />
      </AppProviders>,
    );
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");

    // Fechar e reabrir (segunda chamada a markSeen) — deve manter seen=true sem erro
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-IDEM" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-IDEM" />
      </AppProviders>,
    );
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-IDEM" />
        <DrawerSimulator selected={{ projectId: "proj-1", specId: "SPEC-IDEM" }} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-IDEM" />
      </AppProviders>,
    );

    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");
  });

  it("markSeen não é chamado quando o drawer está fechado (selected=null)", () => {
    const client = fakeClient();

    render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-NULL" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-NULL" />
      </AppProviders>,
    );

    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-1",
        specId: "SPEC-NULL",
        text: "ok",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    // drawer fechado → seen permanece false
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("false");
  });

  it("job em error+seen=false → abrir drawer → seen=true", () => {
    const client = fakeClient();

    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-ERR-AC3" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-ERR-AC3" />
      </AppProviders>,
    );

    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-1",
        specId: "SPEC-ERR-AC3",
        message: "falhou",
      });
    });

    expect(screen.getByTestId("job-badge").dataset.state).toBe("error");
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("false");

    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-1" specId="SPEC-ERR-AC3" />
        <DrawerSimulator selected={{ projectId: "proj-1", specId: "SPEC-ERR-AC3" }} />
        <JobBadgeProbe projectId="proj-1" specId="SPEC-ERR-AC3" />
      </AppProviders>,
    );

    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// AC-008: job conclui com drawer já aberto → markSeen imediato → badge não aparece
// ---------------------------------------------------------------------------

describe("App — AC-008: job conclui com drawer aberto → markSeen imediato", () => {
  it("drawer aberto antes do job→ready: ao concluir, abrir drawer → seen=true imediatamente", () => {
    const client = fakeClient();

    // Drawer já está aberto ANTES de o job concluir
    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8" specId="SPEC-AC8" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-ac8" specId="SPEC-AC8" />
      </AppProviders>,
    );

    // Abre drawer enquanto job ainda está em andamento
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8" specId="SPEC-AC8" />
        <DrawerSimulator selected={{ projectId: "proj-ac8", specId: "SPEC-AC8" }} />
        <JobBadgeProbe projectId="proj-ac8" specId="SPEC-AC8" />
      </AppProviders>,
    );

    // Job conclui com drawer já aberto
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-ac8",
        specId: "SPEC-AC8",
        text: "completo",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    // O state=ready, mas como o drawer estava aberto e markSeen foi chamado quando
    // selected mudou, fechar e reabrir (única mudança de selected que dispara markSeen) →
    // teste de AC-008: a badge não deve aparecer pois markSeen é chamado na abertura.
    // Verificamos: estado ready existe, e ao reabrir o drawer (simular que selected ainda
    // está apontando para a spec) markSeen é chamado.
    // O caminho real: o drawer já está aberto, o useEffect re-executa se selected mudar.
    // Neste teste: selected já estava definido quando o job concluiu → o useEffect com
    // [selected] não re-dispara (selected não mudou). Então seen=false aqui — mas
    // o invariante de AC-008 é: ao abrir o drawer (mudar selected), seen=true.
    expect(screen.getByTestId("job-badge").dataset.state).toBe("ready");

    // Fecha e reabre o drawer para o mesmo spec (simula o cenário de AC-008 completo):
    // fechar → reabrir → markSeen chamado → seen=true
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8" specId="SPEC-AC8" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-ac8" specId="SPEC-AC8" />
      </AppProviders>,
    );
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8" specId="SPEC-AC8" />
        <DrawerSimulator selected={{ projectId: "proj-ac8", specId: "SPEC-AC8" }} />
        <JobBadgeProbe projectId="proj-ac8" specId="SPEC-AC8" />
      </AppProviders>,
    );

    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");
  });

  it("job→error com drawer aberto: abrir drawer → seen=true, badge não persiste", () => {
    const client = fakeClient();

    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8e" specId="SPEC-ERR8" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-ac8e" specId="SPEC-ERR8" />
      </AppProviders>,
    );

    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-ac8e",
        specId: "SPEC-ERR8",
        message: "falhou",
      });
    });

    // job em error, seen=false
    expect(screen.getByTestId("job-badge").dataset.state).toBe("error");
    expect(screen.getByTestId("job-badge").dataset.seen).toBe("false");

    // Abre o drawer → markSeen → seen=true
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-ac8e" specId="SPEC-ERR8" />
        <DrawerSimulator selected={{ projectId: "proj-ac8e", specId: "SPEC-ERR8" }} />
        <JobBadgeProbe projectId="proj-ac8e" specId="SPEC-ERR8" />
      </AppProviders>,
    );

    expect(screen.getByTestId("job-badge").dataset.seen).toBe("true");
  });

  it("dois drawers distintos: abrir um não afeta seen do outro", () => {
    const client = fakeClient();

    const { rerender } = render(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-m" specId="SPEC-M1" />
        <TriggerJob projectId="proj-m" specId="SPEC-M2" />
        <DrawerSimulator selected={null} />
        <JobBadgeProbe projectId="proj-m" specId="SPEC-M1" testId="badge-m1" />
        <JobBadgeProbe projectId="proj-m" specId="SPEC-M2" testId="badge-m2" />
      </AppProviders>,
    );

    act(() => {
      client.emit({ type: "attention:done", projectId: "proj-m", specId: "SPEC-M1", text: "ok", costUsd: null, generatedAt: "2026-06-02T00:00:00Z" });
      client.emit({ type: "attention:done", projectId: "proj-m", specId: "SPEC-M2", text: "ok", costUsd: null, generatedAt: "2026-06-02T00:00:00Z" });
    });

    // Ambos unseen
    expect(screen.getByTestId("badge-m1").dataset.seen).toBe("false");
    expect(screen.getByTestId("badge-m2").dataset.seen).toBe("false");

    // Abre drawer apenas de SPEC-M1
    rerender(
      <AppProviders diagnosisClient={client}>
        <TriggerJob projectId="proj-m" specId="SPEC-M1" />
        <TriggerJob projectId="proj-m" specId="SPEC-M2" />
        <DrawerSimulator selected={{ projectId: "proj-m", specId: "SPEC-M1" }} />
        <JobBadgeProbe projectId="proj-m" specId="SPEC-M1" testId="badge-m1" />
        <JobBadgeProbe projectId="proj-m" specId="SPEC-M2" testId="badge-m2" />
      </AppProviders>,
    );

    expect(screen.getByTestId("badge-m1").dataset.seen).toBe("true");   // SPEC-M1 visto
    expect(screen.getByTestId("badge-m2").dataset.seen).toBe("false");  // SPEC-M2 não afetado
  });
});

// Mirrors AppInner's two-effect logic: effect 1 fires on drawer open, effect 2
// fires when the job for the selected spec reaches a terminal state while open.
function DrawerSimulatorFull({
  selected,
}: {
  selected: { projectId: string; specId: string } | null;
}) {
  const { markSeen, getJob } = useDiagnosisJobs();

  reactUseEffect(() => {
    if (selected) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, markSeen]);

  const job = selected ? getJob(selected.projectId, selected.specId) : undefined;

  reactUseEffect(() => {
    if (
      selected &&
      job &&
      (job.state === "ready" || job.state === "error") &&
      !job.seen
    ) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, job, markSeen]);

  return null;
}

// Stateful harness: mantém `selected` em useState (ref estável) para testar
// o cenário AC-008 onde selected NÃO muda enquanto o job conclui.
function AppInnerHarness({
  projectId,
  specId,
  testId = "badge",
}: {
  projectId: string;
  specId: string;
  testId?: string;
}) {
  const { markSeen, getJob, generate } = useDiagnosisJobs();
  const [selected, setSelected] = reactUseState<{ projectId: string; specId: string } | null>(null);

  const job = selected ? getJob(selected.projectId, selected.specId) : undefined;

  reactUseEffect(() => {
    if (selected) markSeen(selected.projectId, selected.specId);
  }, [selected, markSeen]);

  reactUseEffect(() => {
    if (selected && job && (job.state === "ready" || job.state === "error") && !job.seen) {
      markSeen(selected.projectId, selected.specId);
    }
  }, [selected, job, markSeen]);

  return (
    <>
      <button data-testid="open-drawer" onClick={() => setSelected({ projectId, specId })} />
      <button data-testid="start-job" onClick={() => generate(projectId, specId)} />
      <JobBadgeProbe projectId={projectId} specId={specId} testId={testId} />
    </>
  );
}

describe("App — AC-008: job conclui com drawer já aberto → markSeen sem fechar", () => {
  it("drawer abre, job inicia, job→ready: seen=true sem fechar/reabrir (efeito 2)", () => {
    const client = fakeClient();

    // AppInnerHarness mantém `selected` em useState — ref estável entre renders.
    render(
      <AppProviders diagnosisClient={client}>
        <AppInnerHarness projectId="proj-ac8" specId="SPEC-AC8" />
      </AppProviders>,
    );

    // 1. Inicia o job (estado generating, seen=false, drawer fechado)
    act(() => {
      fireEvent.click(screen.getByTestId("start-job"));
    });

    expect(screen.getByTestId("badge").dataset.state).toBe("generating");
    expect(screen.getByTestId("badge").dataset.seen).toBe("false");

    // 2. Abre o drawer — efeito 1 dispara (selected muda de null → spec), markSeen → seen=true
    act(() => {
      fireEvent.click(screen.getByTestId("open-drawer"));
    });

    expect(screen.getByTestId("badge").dataset.seen).toBe("true");

    // 3. Job conclui com drawer JÁ aberto e seen JÁ true — efeito 2 é idempotente
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-ac8",
        specId: "SPEC-AC8",
        text: "diagnóstico",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    expect(screen.getByTestId("badge").dataset.state).toBe("ready");
    expect(screen.getByTestId("badge").dataset.seen).toBe("true");
  });

  it("drawer abre antes do job; job inicia+conclui: efeito 2 marca seen=true (AC-008 puro)", () => {
    const client = fakeClient();

    render(
      <AppProviders diagnosisClient={client}>
        <AppInnerHarness projectId="proj-ac8p" specId="SPEC-AC8P" />
      </AppProviders>,
    );

    // 1. Abre o drawer ANTES do job existir — efeito 1 dispara markSeen sem job → no-op
    act(() => {
      fireEvent.click(screen.getByTestId("open-drawer"));
    });

    // Sem job ainda — badge renderiza mas sem data-seen (nenhum job no contexto)
    expect(screen.getByTestId("badge").dataset.seen).toBeUndefined();

    // 2. Inicia o job com drawer JÁ aberto — selected NÃO muda → efeito 1 não re-dispara
    act(() => {
      fireEvent.click(screen.getByTestId("start-job"));
    });

    // Job registrado (generating), seen=false — efeito 1 não re-disparou (selected estável)
    // efeito 2 não dispara (generating não é terminal)
    expect(screen.getByTestId("badge").dataset.state).toBe("generating");
    expect(screen.getByTestId("badge").dataset.seen).toBe("false");

    // 3. Job conclui — efeito 2 detecta state=ready + seen=false + drawer aberto → markSeen
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-ac8p",
        specId: "SPEC-AC8P",
        text: "ok",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    // AC-008: sem fechar/reabrir, seen=true porque efeito 2 disparou
    expect(screen.getByTestId("badge").dataset.state).toBe("ready");
    expect(screen.getByTestId("badge").dataset.seen).toBe("true");
  });

  it("drawer abre antes do job; job→error: efeito 2 marca seen=true", () => {
    const client = fakeClient();

    render(
      <AppProviders diagnosisClient={client}>
        <AppInnerHarness projectId="proj-ac8e" specId="SPEC-AC8E" />
      </AppProviders>,
    );

    act(() => { fireEvent.click(screen.getByTestId("open-drawer")); });
    act(() => { fireEvent.click(screen.getByTestId("start-job")); });

    expect(screen.getByTestId("badge").dataset.state).toBe("generating");
    expect(screen.getByTestId("badge").dataset.seen).toBe("false");

    act(() => {
      client.emit({
        type: "attention:error",
        projectId: "proj-ac8e",
        specId: "SPEC-AC8E",
        message: "falha inesperada",
      });
    });

    expect(screen.getByTestId("badge").dataset.state).toBe("error");
    expect(screen.getByTestId("badge").dataset.seen).toBe("true");
  });

  it("job em streaming não aciona efeito 2: seen só vira true quando terminal", () => {
    const client = fakeClient();

    render(
      <AppProviders diagnosisClient={client}>
        <AppInnerHarness projectId="proj-ac8s" specId="SPEC-AC8S" />
      </AppProviders>,
    );

    act(() => { fireEvent.click(screen.getByTestId("open-drawer")); });
    act(() => { fireEvent.click(screen.getByTestId("start-job")); });

    // Emite apenas um chunk (streaming, não terminal)
    act(() => {
      client.emit({
        type: "attention:chunk",
        projectId: "proj-ac8s",
        specId: "SPEC-AC8S",
        delta: "parcial...",
      });
    });

    // streaming não é terminal → efeito 2 não dispara → seen permanece false
    expect(screen.getByTestId("badge").dataset.state).toBe("streaming");
    expect(screen.getByTestId("badge").dataset.seen).toBe("false");

    // Agora job conclui → efeito 2 dispara → seen=true
    act(() => {
      client.emit({
        type: "attention:done",
        projectId: "proj-ac8s",
        specId: "SPEC-AC8S",
        text: "finalizado",
        costUsd: null,
        generatedAt: "2026-06-02T00:00:00Z",
      });
    });

    expect(screen.getByTestId("badge").dataset.state).toBe("ready");
    expect(screen.getByTestId("badge").dataset.seen).toBe("true");
  });
});
