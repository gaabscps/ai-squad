import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'agentops-doctor-test-'));
}

async function writeConfigFile(dir: string, data: unknown): Promise<void> {
  await fsp.writeFile(path.join(dir, '.agentops.json'), JSON.stringify(data), 'utf8');
}

const ENV_KEYS = [
  'AGENTOPS_SESSION_PREFIX',
  'AGENTOPS_REPORT_COMMAND',
  'AGENTOPS_PRIOR_FLOWS',
  'AGENTOPS_BYPASS_FLOWS',
  'AGENTOPS_ROOT_DIR',
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  jest.resetModules(); // isolate module-level config/state between tests
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('doctor', () => {
  // AC-006: full config from env — table printed, no warnings, exit not called
  it('AC-006: prints Field|Value|Source table for all config fields when fully configured via env', async () => {
    const dir = await makeTmpDir();
    process.env['AGENTOPS_SESSION_PREFIX'] = 'FEAT-';
    process.env['AGENTOPS_REPORT_COMMAND'] = 'npm run report';
    process.env['AGENTOPS_PRIOR_FLOWS'] = JSON.stringify(['FEAT-000']);
    process.env['AGENTOPS_BYPASS_FLOWS'] = JSON.stringify(['FEAT-999']);
    process.env['AGENTOPS_ROOT_DIR'] = '.my-sessions';

    const stdoutChunks: string[] = [];
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const output = stdoutChunks.join('');

    // Header row
    expect(output).toMatch(/Field/);
    expect(output).toMatch(/Value/);
    expect(output).toMatch(/Source/);

    // All fields present
    expect(output).toMatch(/sessionPrefix/);
    expect(output).toMatch(/reportCommand/);
    expect(output).toMatch(/priorFlows/);
    expect(output).toMatch(/bypassFlows/);
    expect(output).toMatch(/rootDir/);

    // All sourced from env
    const envOccurrences = (output.match(/\benv\b/g) ?? []).length;
    expect(envOccurrences).toBeGreaterThanOrEqual(5);

    // No warnings for defaults
    expect(output).not.toMatch(/⚠/);

    // exit not called
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  // AC-006 + AC-008: partial config — some fields default, marked with ⚠
  it('AC-006+AC-008: marks fields with default source using ⚠ using default', async () => {
    const dir = await makeTmpDir();
    // sessionPrefix from file; others default
    await writeConfigFile(dir, { sessionPrefix: 'TASK-' });

    const stdoutChunks: string[] = [];
    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const output = stdoutChunks.join('');

    // sessionPrefix sourced from config (no warning)
    expect(output).toMatch(/sessionPrefix.*config/s);

    // Fields with default source carry ⚠ using default marker
    const warnCount = (output.match(/⚠ using default/g) ?? []).length;
    expect(warnCount).toBeGreaterThanOrEqual(3); // at least 3 default fields: reportCommand, priorFlows, bypassFlows, rootDir

    stdoutSpy.mockRestore();
  });

  // AC-008: rootDir default value '.agent-session' shown when not configured
  it('AC-008: shows rootDir value as .agent-session and source as default when not configured', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'X-' });

    const stdoutChunks: string[] = [];
    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const output = stdoutChunks.join('');

    expect(output).toMatch(/rootDir/);
    expect(output).toMatch(/\.agent-session/);
    // rootDir row contains 'default' and the ⚠ marker
    expect(output).toMatch(/rootDir.*default.*⚠/s);

    stdoutSpy.mockRestore();
  });

  // AC-007: missing sessionPrefix → stderr + exit 1
  it('AC-007: emits actionable ConfigError to stderr and calls process.exit(1) when sessionPrefix absent', async () => {
    const dir = await makeTmpDir();
    // No .agentops.json, no env — sessionPrefix absent

    const stderrChunks: string[] = [];
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const stderrOutput = stderrChunks.join('');

    // Actionable message mentioning the field and how to fix
    expect(stderrOutput).toMatch(/sessionPrefix/);
    expect(stderrOutput).toMatch(/AGENTOPS_SESSION_PREFIX/);

    // exit(1) called
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // AC-007: missing sessionPrefix → stderr names which field to set
  it('AC-007: error message names which field to set and which env var to use', async () => {
    const dir = await makeTmpDir();

    const stderrChunks: string[] = [];
    jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const stderrOutput = stderrChunks.join('');
    // Message should name the field and the env var
    expect(stderrOutput).toMatch(/sessionPrefix/);
    expect(stderrOutput).toMatch(/AGENTOPS_SESSION_PREFIX/);
  });

  // AC-006: sessionPrefix as array — rendered as comma-joined string in table
  it('AC-006: renders sessionPrefix array as comma-joined string in the table', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: ['FEAT-', 'DISC-'] });

    const stdoutChunks: string[] = [];
    jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const output = stdoutChunks.join('');
    expect(output).toMatch(/FEAT-, DISC-/);
  });

  // AC-006: reportCommand null from file — shows (none), source=config, no warning
  it('shows (none) for reportCommand null from file (source=config, no warning)', async () => {
    const dir = await makeTmpDir();
    // sessionPrefix required; reportCommand explicitly null → source=config, value=null
    await writeConfigFile(dir, { sessionPrefix: 'FEAT-', reportCommand: null });

    const stdoutChunks: string[] = [];
    jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const { doctor } = await import('../src/doctor');
    await doctor(dir);

    const output = stdoutChunks.join('');

    // reportCommand row should contain (none) and source config
    expect(output).toMatch(/reportCommand/);
    expect(output).toMatch(/\(none\)/);
    // The reportCommand line contains 'config' (single line match)
    expect(output).toMatch(/reportCommand.*config/);
    // The reportCommand line has no ⚠ (single line match, no dotAll)
    expect(output).not.toMatch(/reportCommand.*⚠/);
  });
});
