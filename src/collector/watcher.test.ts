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

    const handle = watchProjects(["/proj/a", "/proj/b"], vi.fn());
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

    watchProjects(["/proj/x"], vi.fn());

    const patterns: string[] = watchMock.mock.calls[0][0] as string[];
    const normalized = patterns.map((p) => p.replace(/\\/g, "/"));

    expect(normalized.some((p) => p.includes("session.yml"))).toBe(true);
    expect(normalized.some((p) => p.includes("costs"))).toBe(true);
    expect(normalized.some((p) => p.includes("manifest"))).toBe(true);
    expect(normalized.some((p) => p.includes("outputs/*.json"))).toBe(true);
  });

  it("inclui o glob cost-report.json para cada root informado", async () => {
    const { watchProjects } = await import("./watcher.js");
    const handle = watchProjects(["/proj/a", "/proj/b"], vi.fn());
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

  it("não observa os .md mesmo que existam na sessão (guard defensivo)", async () => {
    vi.resetModules();
    const { watchProjects } = await import("./watcher.js");

    watchProjects(["/proj/y"], vi.fn());

    const options = watchMock.mock.calls[0][1] as { ignored?: unknown };
    // ignored deve ser uma função que rejeita .md
    expect(typeof options.ignored).toBe("function");
    const ignored = options.ignored as (p: string) => boolean;
    expect(ignored("/proj/y/.agent-session/FEAT-001/spec.md")).toBe(true);
    expect(ignored("/proj/y/.agent-session/FEAT-001/session.yml")).toBe(false);
  });
});
