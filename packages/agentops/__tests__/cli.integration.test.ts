/**
 * cli.integration.test.ts — Smoke tests for src/cli.ts
 * Tests command routing via makeProgram() without spawning a subprocess.
 * AC-004: CLI entry wired
 * AC-005: scan empty → exit 1
 * AC-006: doctor prints resolved config
 * AC-007: doctor exits 1 on missing required field
 */

import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Mocks — set up before importing cli
// ---------------------------------------------------------------------------

const mockMain = jest.fn();
const mockDoctor = jest.fn();
const mockInstallHooks = jest.fn();
const mockLoadConfig = jest.fn();
const mockCaptureMain = jest.fn();

jest.mock('../src/index', () => ({
  main: mockMain,
  EmptyScanError: class EmptyScanError extends Error {
    constructor(prefix: string | string[], root: string) {
      super(`No sessions found for prefix ${String(prefix)} in ${root}`);
      this.name = 'EmptyScanError';
    }
  },
}));

jest.mock('../src/doctor', () => ({
  doctor: mockDoctor,
}));

jest.mock('../src/install-hooks', () => ({
  installHooks: mockInstallHooks,
}));

jest.mock('../src/config', () => ({
  loadConfig: mockLoadConfig,
  ConfigError: class ConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ConfigError';
    }
  },
}));

// capture-pm-session mock
jest.mock('../src/hooks/capture-pm-session', () => ({
  findRepoRoot: jest.fn().mockReturnValue('/fake/repo'),
  maybeRegenerateReport: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import cli AFTER mocks are in place
// ---------------------------------------------------------------------------

import { makeProgram } from '../src/cli';
import { ConfigError } from '../src/config';
import { EmptyScanError } from '../src/index';
import * as captureMod from '../src/hooks/capture-pm-session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let exitSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;
let stdoutSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code ?? 'undefined'})`);
  });
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  exitSpy.mockRestore();
  stderrSpy.mockRestore();
  stdoutSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('makeProgram()', () => {
  it('returns a Commander instance', () => {
    const program = makeProgram();
    expect(program).toBeInstanceOf(Command);
  });

  it('program name is "agentops"', () => {
    const program = makeProgram();
    expect(program.name()).toBe('agentops');
  });

  it('has report, capture, doctor, install-hooks subcommands', () => {
    const program = makeProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('report');
    expect(commandNames).toContain('capture');
    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('install-hooks');
  });
});

// AC-004: report subcommand routes to main() via loadConfig
describe('report subcommand', () => {
  it('calls loadConfig and main() on success (AC-004)', async () => {
    const resolvedConfig = {
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      reportCommand: { value: null, source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    };
    mockLoadConfig.mockResolvedValue(resolvedConfig);
    mockMain.mockResolvedValue(undefined);

    const program = makeProgram();
    await program.parseAsync(['node', 'agentops', 'report']);

    expect(mockLoadConfig).toHaveBeenCalledWith(process.cwd());
    expect(mockMain).toHaveBeenCalledWith({
      sessionPrefix: 'FEAT-',
      priorFlows: [],
      bypassFlows: [],
    });
  });

  it('exits 1 on ConfigError (AC-004/AC-005)', async () => {
    mockLoadConfig.mockRejectedValue(
      new ConfigError('agentops: sessionPrefix is required.'),
    );

    const program = makeProgram();
    await expect(program.parseAsync(['node', 'agentops', 'report'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 on EmptyScanError (AC-005)', async () => {
    const resolvedConfig = {
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      reportCommand: { value: null, source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    };
    mockLoadConfig.mockResolvedValue(resolvedConfig);
    mockMain.mockRejectedValue(new EmptyScanError('FEAT-', '/root/.agent-session'));

    const program = makeProgram();
    await expect(program.parseAsync(['node', 'agentops', 'report'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// AC-006, AC-007: doctor subcommand routes to doctor()
describe('doctor subcommand', () => {
  it('calls doctor(cwd) on success (AC-006)', async () => {
    mockDoctor.mockResolvedValue(undefined);

    const program = makeProgram();
    await program.parseAsync(['node', 'agentops', 'doctor']);

    expect(mockDoctor).toHaveBeenCalledWith(process.cwd());
  });

  it('exits 1 when doctor() rejects with ConfigError (AC-007)', async () => {
    mockDoctor.mockRejectedValue(new ConfigError('agentops: sessionPrefix is required.'));

    const program = makeProgram();
    await expect(program.parseAsync(['node', 'agentops', 'doctor'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// install-hooks subcommand
describe('install-hooks subcommand', () => {
  it('logs installed message when hook is new', async () => {
    mockInstallHooks.mockResolvedValue({ installed: true });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = makeProgram();
    await program.parseAsync(['node', 'agentops', 'install-hooks']);

    expect(mockInstallHooks).toHaveBeenCalledWith(process.cwd());
    expect(consoleSpy).toHaveBeenCalledWith('[agentops] Hook installed.');
    consoleSpy.mockRestore();
  });

  it('logs already-present message when hook exists', async () => {
    mockInstallHooks.mockResolvedValue({ installed: false });
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const program = makeProgram();
    await program.parseAsync(['node', 'agentops', 'install-hooks']);

    expect(consoleSpy).toHaveBeenCalledWith('[agentops] Hook already present.');
    consoleSpy.mockRestore();
  });

  it('exits 1 on SyntaxError (malformed settings)', async () => {
    mockInstallHooks.mockRejectedValue(new SyntaxError('Unexpected token'));

    const program = makeProgram();
    await expect(program.parseAsync(['node', 'agentops', 'install-hooks'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// capture subcommand — must exit 0 even on error
describe('capture subcommand', () => {
  it('calls maybeRegenerateReport with repoRoot on success (AC-004)', async () => {
    const program = makeProgram();
    await expect(program.parseAsync(['node', 'agentops', 'capture'])).resolves.toBeDefined();
    expect(captureMod.maybeRegenerateReport).toHaveBeenCalledWith('/fake/repo');
  });
});
