import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { browseDirs, addInclude, removeInclude } from "./foldersClient";

describe("foldersClient", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("browseDirs", () => {
    it("retorna { dirs, resolvedPath } ao receber 200", async () => {
      const mockResponse = {
        dirs: [
          { name: "proj1", path: "/home/user/proj1", hasAgentSession: true },
          { name: "proj2", path: "/home/user/proj2", hasAgentSession: false },
        ],
        resolvedPath: "/home/user",
      };
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any);

      const result = await browseDirs("/home/user");

      expect(result.dirs).toEqual(mockResponse.dirs);
      expect(result.resolvedPath).toBe("/home/user");
      expect(global.fetch).toHaveBeenCalledWith("/api/browse?path=%2Fhome%2Fuser");
    });

    it("retorna dirs vazio e resolvedPath quando response tem dirs vazio e status 200", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ dirs: [], resolvedPath: "/home/user/empty" }),
      } as any);

      const result = await browseDirs("/home/user/empty");

      expect(result.dirs).toEqual([]);
      expect(result.resolvedPath).toBe("/home/user/empty");
    });

    it("lança erro ao receber 403", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 403,
        json: vi.fn().mockResolvedValue({ error: "fora do home" }),
      } as any);

      await expect(browseDirs("/etc")).rejects.toThrow("fora do home");
    });

    it("lança erro com mensagem do campo error se disponível", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 400,
        json: vi.fn().mockResolvedValue({ error: "path inválido" }),
      } as any);

      await expect(browseDirs("invalid")).rejects.toThrow("path inválido");
    });

    it("lança erro com status HTTP se não houver campo error", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await expect(browseDirs("/home")).rejects.toThrow("500");
    });
  });

  describe("addInclude", () => {
    it("retorna { persisted, alreadyExisted } ao receber 201", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 201,
        json: vi.fn().mockResolvedValue({ persisted: true, alreadyExisted: false }),
      } as any);

      const result = await addInclude("/home/user/repo");

      expect(result).toEqual({ persisted: true, alreadyExisted: false });
      expect(global.fetch).toHaveBeenCalledWith("/api/include", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/home/user/repo" }),
      });
    });

    it("retorna { persisted, alreadyExisted: true } ao receber 200 (idempotente)", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ persisted: true, alreadyExisted: true }),
      } as any);

      const result = await addInclude("/home/user/existing");

      expect(result).toEqual({ persisted: true, alreadyExisted: true });
    });

    it("lança erro ao receber 4xx/5xx com campo error", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 403,
        json: vi.fn().mockResolvedValue({ error: "sem .agent-session" }),
      } as any);

      await expect(addInclude("/home/user/nope")).rejects.toThrow("sem .agent-session");
    });

    it("lança erro ao receber 4xx/5xx sem campo error, usando status HTTP", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await expect(addInclude("/home/user/broken")).rejects.toThrow("500");
    });
  });

  describe("removeInclude", () => {
    it("retorna { persisted } ao receber 200", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ persisted: true }),
      } as any);

      const result = await removeInclude("/home/user/repo");

      expect(result).toEqual({ persisted: true });
      expect(global.fetch).toHaveBeenCalledWith("/api/include", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/home/user/repo" }),
      });
    });

    it("retorna { persisted: false } quando persistência falhou mas comando acionou (200)", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ persisted: false }),
      } as any);

      const result = await removeInclude("/home/user/repo");

      expect(result).toEqual({ persisted: false });
    });

    it("lança erro ao receber 4xx/5xx com campo error", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 500,
        json: vi.fn().mockResolvedValue({ error: "disco cheio" }),
      } as any);

      await expect(removeInclude("/home/user/repo")).rejects.toThrow("disco cheio");
    });

    it("lança erro ao receber 4xx/5xx sem campo error, usando status HTTP", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as any);

      await expect(removeInclude("/home/user/repo")).rejects.toThrow("500");
    });
  });
});
