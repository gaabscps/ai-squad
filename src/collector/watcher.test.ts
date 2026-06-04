import { describe, it, expect, vi, afterEach } from "vitest";
import chokidar from "chokidar";

// Intercepta chokidar.watch para capturar os patterns sem abrir handles reais
vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

const watchMock = vi.mocked(chokidar.watch);

afterEach(() => {
  watchMock.mockClear();
});

describe("watchProjects — patterns observados", () => {
  it("inclui o glob outputs/*.json para cada root informado", async () => {
    const { watchProjects } = await import("./watcher.js");

    const handle = watchProjects(["/proj/a", "/proj/b"], [], vi.fn());
    await handle.close();

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];

    const outputPatterns = patterns.filter((p) =>
      p.replace(/\\/g, "/").includes("outputs/*.json"),
    );
    expect(outputPatterns.length).toBeGreaterThanOrEqual(2);

    const roots = ["/proj/a", "/proj/b"];
    for (const root of roots) {
      const normalizedRoot = root.replace(/\\/g, "/");
      const hasPattern = outputPatterns.some((p) => {
        const norm = p.replace(/\\/g, "/");
        return norm.startsWith(normalizedRoot) && norm.includes(".agent-session");
      });
      expect(hasPattern, `root ${root} deve ter pattern com .agent-session/outputs/*.json`).toBe(true);
    }
  });

  it("inclui outputs/*.json junto com os patterns já existentes (session.yml, costs, manifest)", async () => {
    // import dinâmico reusa módulo cacheado; reset garante estado limpo entre testes
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects(["/proj/x"], [], vi.fn());

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    expect(normalized.some((p) => p.includes("session.yml"))).toBe(true);
    expect(normalized.some((p) => p.includes("costs"))).toBe(true);
    expect(normalized.some((p) => p.includes("manifest"))).toBe(true);
    expect(normalized.some((p) => p.includes("outputs/*.json"))).toBe(true);
    expect(normalized.some((p) => p.includes("report.html"))).toBe(true);
    expect(normalized.some((p) => p.includes("cost-report.json"))).toBe(true);
  });

  it("inclui o glob cost-report.json para cada root informado", async () => {
    const { watchProjects } = await import("./watcher.js");
    const handle = watchProjects(["/proj/a", "/proj/b"], [], vi.fn());
    await handle.close();

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const costReportPatterns = patterns.filter((p) =>
      p.replace(/\\/g, "/").includes("cost-report.json"),
    );
    expect(costReportPatterns.length).toBeGreaterThanOrEqual(2);

    for (const root of ["/proj/a", "/proj/b"]) {
      const normalizedRoot = root.replace(/\\/g, "/");
      const has = costReportPatterns.some((p) => {
        const norm = p.replace(/\\/g, "/");
        return norm.startsWith(normalizedRoot) && norm.includes(".agent-session");
      });
      expect(has).toBe(true);
    }
  });

  it("inclui o glob report.html para cada root informado", async () => {
    const { watchProjects } = await import("./watcher.js");
    const handle = watchProjects(["/proj/a", "/proj/b"], [], vi.fn());
    await handle.close();

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const reportPatterns = patterns.filter((p) =>
      p.replace(/\\/g, "/").includes("report.html"),
    );
    expect(reportPatterns.length).toBeGreaterThanOrEqual(2);

    for (const root of ["/proj/a", "/proj/b"]) {
      const normalizedRoot = root.replace(/\\/g, "/");
      const has = reportPatterns.some((p) => {
        const norm = p.replace(/\\/g, "/");
        return norm.startsWith(normalizedRoot) && norm.includes(".agent-session");
      });
      expect(has, `root ${root} deve ter pattern com .agent-session/**/report.html`).toBe(true);
    }
  });

  it("não observa os .md mesmo que existam na sessão (guard defensivo)", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects(["/proj/y"], [], vi.fn());

    const options = watchMock.mock.calls[0][1] as { ignored?: unknown };
    expect(typeof options.ignored).toBe("function");
    const ignored = options.ignored as (p: string) => boolean;
    expect(ignored("/proj/y/.agent-session/FEAT-001/spec.md")).toBe(true);
    expect(ignored("/proj/y/.agent-session/FEAT-001/session.yml")).toBe(false);
  });

  it("ignored rejeita .md mesmo quando o path pertence a um include explícito", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");
    const homeDir = "/home/user";

    watchProjects([], [`${homeDir}/explicit-repo`], vi.fn());

    const options = watchMock.mock.calls[0][1] as { ignored?: unknown };
    expect(typeof options.ignored).toBe("function");
    const ignored = options.ignored as (p: string) => boolean;

    expect(ignored(`${homeDir}/explicit-repo/.agent-session/FEAT-001/spec.md`)).toBe(true);
    expect(ignored(`${homeDir}/explicit-repo/.agent-session/FEAT-001/session.yml`)).toBe(false);
  });
});

describe("watchProjects — includes", () => {
  it("inclui padrões .agent-session diretos para cada include (sem wildcard * no meio)", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    const handle = watchProjects([], ["/proj/explicit/myrepo"], vi.fn());
    await handle.close();

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    const includePatterns = normalized.filter((p) =>
      p.startsWith("/proj/explicit/myrepo/"),
    );
    expect(includePatterns.length).toBeGreaterThan(0);

    for (const p of includePatterns) {
      const segment = p.replace("/proj/explicit/myrepo/", "");
      // não deve haver wildcard * antes de .agent-session (o * ficaria no meio do caminho)
      expect(segment.startsWith("*")).toBe(false);
      expect(p.includes(".agent-session")).toBe(true);
    }
  });

  it("combina padrões de roots (com *) e includes (sem *) na mesma chamada ao chokidar", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects(["/roots/group"], ["/proj/explicit/repo"], vi.fn());

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    const rootPatterns = normalized.filter((p) =>
      p.startsWith("/roots/group/"),
    );
    const includePatterns = normalized.filter((p) =>
      p.startsWith("/proj/explicit/repo/"),
    );

    expect(rootPatterns.length).toBeGreaterThan(0);
    expect(includePatterns.length).toBeGreaterThan(0);

    // roots devem usar o wildcard * para varrer um nível
    expect(rootPatterns.every((p) => p.includes("*"))).toBe(true);
    // includes NÃO devem ter wildcard * no segmento antes de .agent-session
    for (const p of includePatterns) {
      const afterInclude = p.replace("/proj/explicit/repo/", "");
      expect(afterInclude.startsWith("*")).toBe(false);
    }
  });

  it("com includes=[] o comportamento é idêntico ao da chamada antiga (apenas roots)", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects(["/proj/a", "/proj/b"], [], vi.fn());

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    // deve haver exatamente os 6 padrões por root (6 × 2 = 12) e nada além
    expect(normalized.length).toBe(12);
    expect(normalized.every((p) => p.startsWith("/proj/a") || p.startsWith("/proj/b"))).toBe(true);
  });

  it("múltiplos includes geram padrões para cada path", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects([], ["/repos/alpha", "/repos/beta"], vi.fn());

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    const alphaPatterns = normalized.filter((p) => p.startsWith("/repos/alpha/"));
    const betaPatterns = normalized.filter((p) => p.startsWith("/repos/beta/"));

    // cada include deve gerar os mesmos 6 sub-padrões que uma root gera
    expect(alphaPatterns.length).toBe(6);
    expect(betaPatterns.length).toBe(6);
  });
});
