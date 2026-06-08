import { describe, it, expect, afterEach } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listDirs, resolveAddablePath } from "./browse.js";

let tmpRoot: string;

async function setup(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), "browse-test-"));
  return tmpRoot;
}

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// listDirs
// ────────────────────────────────────────────────────────────────────────────

describe("listDirs", () => {
  it("retorna DirEntry[] com hasAgentSession correto (AC-001)", async () => {
    const home = await setup();
    const withSession = join(home, "repo-com-session");
    const withoutSession = join(home, "repo-sem-session");
    await mkdir(withSession);
    await mkdir(withoutSession);
    await mkdir(join(withSession, ".agent-session"));

    const entries = await listDirs(home, home);

    expect(entries).toHaveLength(2);
    const com = entries.find((e) => e.name === "repo-com-session");
    const sem = entries.find((e) => e.name === "repo-sem-session");
    expect(com).toBeDefined();
    expect(com!.hasAgentSession).toBe(true);
    // path retornado é o realpath (symlinks resolvidos); compara com realpath do esperado
    expect(com!.path).toBe(await realpath(withSession));
    expect(sem).toBeDefined();
    expect(sem!.hasAgentSession).toBe(false);
    expect(sem!.path).toBe(await realpath(withoutSession));
  });

  it("retorna [] quando não há subdiretórios (AC-005)", async () => {
    const home = await setup();
    const emptyDir = join(home, "vazio");
    await mkdir(emptyDir);

    const entries = await listDirs(emptyDir, home);

    expect(entries).toEqual([]);
  });

  it("ignora arquivos (só retorna diretórios)", async () => {
    const home = await setup();
    await writeFile(join(home, "arquivo.txt"), "conteudo");
    const subdir = join(home, "subpasta");
    await mkdir(subdir);

    const entries = await listDirs(home, home);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("subpasta");
  });

  it("lança NOT_A_DIR (não OUTSIDE_HOME) para path inexistente (AC-006)", async () => {
    const home = await setup();
    const naoExiste = join(home, "nao-existe");

    await expect(listDirs(naoExiste, home)).rejects.toMatchObject({
      code: "NOT_A_DIR",
    });
  });

  it("lança OUTSIDE_HOME quando path está fora do home (AC-006, NFR-001)", async () => {
    const home = await setup();
    const outside = tmpdir();

    await expect(listDirs(outside, home)).rejects.toMatchObject({
      code: "OUTSIDE_HOME",
    });
  });

  it("rejeita symlink que resolve fora do home (NFR-001 — symlink escape)", async () => {
    const home = await setup();
    const outside = await mkdtemp(join(tmpdir(), "outside-"));
    const link = join(home, "link-fora");
    await symlink(outside, link);

    try {
      await expect(listDirs(link, home)).rejects.toMatchObject({
        code: "OUTSIDE_HOME",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("aceita path = home (raiz do home navegável)", async () => {
    const home = await setup();
    const sub = join(home, "sub");
    await mkdir(sub);

    const entries = await listDirs(home, home);
    expect(entries).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveAddablePath
// ────────────────────────────────────────────────────────────────────────────

describe("resolveAddablePath", () => {
  it("retorna o caminho canônico (realpath) para repo válido (tem .agent-session, dentro do home)", async () => {
    const home = await setup();
    const repo = join(home, "meu-repo");
    await mkdir(repo);
    await mkdir(join(repo, ".agent-session"));

    const result = await resolveAddablePath(repo, home);
    expect(result).toBe(await realpath(repo));
  });

  it("normaliza path com segmento '.' para o mesmo realpath (dedup por canonical)", async () => {
    const home = await setup();
    const repo = join(home, "meu-repo");
    await mkdir(repo);
    await mkdir(join(repo, ".agent-session"));

    const canonical = await resolveAddablePath(repo, home);
    const withDot = await resolveAddablePath(`${home}/./meu-repo`, home);
    expect(withDot).toBe(canonical);
  });

  it("lança NO_AGENT_SESSION quando .agent-session está ausente (AC-006)", async () => {
    const home = await setup();
    const repo = join(home, "repo-sem-session");
    await mkdir(repo);

    await expect(resolveAddablePath(repo, home)).rejects.toMatchObject({
      code: "NO_AGENT_SESSION",
    });
  });

  it("lança NOT_A_DIR para path inexistente (AC-006)", async () => {
    const home = await setup();
    const naoExiste = join(home, "nao-existe");

    await expect(resolveAddablePath(naoExiste, home)).rejects.toMatchObject({
      code: "NOT_A_DIR",
    });
  });

  it("lança NOT_A_DIR para path que é arquivo, não diretório (AC-006)", async () => {
    const home = await setup();
    const arquivo = join(home, "arquivo.txt");
    await writeFile(arquivo, "conteudo");

    await expect(resolveAddablePath(arquivo, home)).rejects.toMatchObject({
      code: "NOT_A_DIR",
    });
  });

  it("lança OUTSIDE_HOME para path fora do home (AC-006, NFR-001)", async () => {
    const home = await setup();
    const outside = tmpdir();

    await expect(resolveAddablePath(outside, home)).rejects.toMatchObject({
      code: "OUTSIDE_HOME",
    });
  });

  it("rejeita symlink que resolve fora do home (NFR-001 — symlink escape)", async () => {
    const home = await setup();
    const outside = await mkdtemp(join(tmpdir(), "outside2-"));
    await mkdir(join(outside, ".agent-session"));
    const link = join(home, "link-escape");
    await symlink(outside, link);

    try {
      await expect(resolveAddablePath(link, home)).rejects.toMatchObject({
        code: "OUTSIDE_HOME",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
