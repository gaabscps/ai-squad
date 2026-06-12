import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs");

const mockedFs = vi.mocked(fs);

afterEach(() => {
  vi.resetAllMocks();
});

describe("saveConfigFields", () => {
  it("faz merge dos campos especificados e grava o JSON resultante", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    const existing = JSON.stringify({ roots: ["~/src"], include: [], hide: [], archiveAfterDays: 7 });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(existing);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    const result = await saveConfigFields({ include: ["/home/user/repo"] }, "/fake/aios.config.json");

    expect(result).toEqual({ persisted: true });

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.include).toEqual(["/home/user/repo"]);
    expect(parsed.roots).toEqual(["~/src"]);
    expect(parsed.hide).toEqual([]);
    expect(parsed.archiveAfterDays).toBe(7);
  });

  it("cria o arquivo do zero quando config não existe", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    const result = await saveConfigFields({ include: ["/home/user/newrepo"] }, "/fake/aios.config.json");

    expect(result).toEqual({ persisted: true });
    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.include).toEqual(["/home/user/newrepo"]);
    expect(parsed.roots).toEqual([]);
    expect(parsed.hide).toEqual([]);
    expect(parsed.archiveAfterDays).toBe(7);
  });

  it("retorna { persisted: false } e não relança quando writeFile falha", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await saveConfigFields({ include: ["/home/user/repo"] }, "/fake/aios.config.json");

    expect(result).toEqual({ persisted: false });
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("substitui array pelo valor passado quando campo já existe", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    const existing = JSON.stringify({ roots: [], include: ["/home/user/repo"], hide: [], archiveAfterDays: 7 });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(existing);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    const result = await saveConfigFields({ include: ["/home/user/repo"] }, "/fake/aios.config.json");

    expect(result).toEqual({ persisted: true });
    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.include).toEqual(["/home/user/repo"]);
  });

  it("retorna { persisted: false } e não grava quando arquivo existe mas readFileSync lança", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await saveConfigFields({ include: ["/home/user/repo"] }, "/fake/aios.config.json");

    expect(result).toEqual({ persisted: false });
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("sobrescreve somente os campos especificados, preservando os demais", async () => {
    vi.resetModules();
    const { saveConfigFields } = await import("./config.js");

    const existing = JSON.stringify({
      roots: ["~/projects"],
      include: [],
      hide: ["spec-x"],
      archiveAfterDays: 14,
    });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(existing);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    await saveConfigFields({ hide: ["spec-x", "spec-y"] }, "/fake/aios.config.json");

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.hide).toEqual(["spec-x", "spec-y"]);
    expect(parsed.roots).toEqual(["~/projects"]);
    expect(parsed.include).toEqual([]);
    expect(parsed.archiveAfterDays).toBe(14);
  });
});

describe("saveHidden — regressão via saveConfigFields", () => {
  it("persiste hide[] corretamente mantendo roots e include", async () => {
    vi.resetModules();
    const { saveHidden } = await import("./config.js");

    const existing = JSON.stringify({ roots: ["~/src"], include: ["/home/user/repo"], hide: [], archiveAfterDays: 3 });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(existing);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    await saveHidden("/fake/aios.config.json", ["spec-abc"]);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.hide).toEqual(["spec-abc"]);
    expect(parsed.roots).toEqual(["~/src"]);
    expect(parsed.include).toEqual(["/home/user/repo"]);
    expect(parsed.archiveAfterDays).toBe(3);
  });

  it("persiste hide[] vazio quando chamado com array vazio", async () => {
    vi.resetModules();
    const { saveHidden } = await import("./config.js");

    const existing = JSON.stringify({ roots: [], include: [], hide: ["spec-old"], archiveAfterDays: 7 });
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(existing);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    await saveHidden("/fake/aios.config.json", []);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.hide).toEqual([]);
  });

  it("cria o arquivo com hide[] quando config não existe", async () => {
    vi.resetModules();
    const { saveHidden } = await import("./config.js");

    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockReturnValue(undefined);

    await saveHidden("/fake/aios.config.json", ["spec-new"]);

    const written = mockedFs.writeFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.hide).toEqual(["spec-new"]);
    expect(parsed.roots).toEqual([]);
    expect(parsed.include).toEqual([]);
  });

  it("tolerante a falha de escrita — não relança erro", async () => {
    vi.resetModules();
    const { saveHidden } = await import("./config.js");

    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error("ENOSPC: no space left on device");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(saveHidden("/fake/aios.config.json", ["spec-x"])).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
