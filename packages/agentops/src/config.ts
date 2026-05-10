import fs from 'fs/promises';
import path from 'path';

import type { AgentOpsConfig, ConfigSource, ResolvedConfig, ResolvedField } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function field<T>(value: T, source: ConfigSource): ResolvedField<T> {
  return { value, source };
}

function parseJsonEnv(envKey: string): string[] | null {
  const raw = process.env[envKey];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed as string[];
    }
  } catch {
    // invalid JSON — treat as absent
  }
  return null;
}

function validateFileConfig(cfg: Partial<AgentOpsConfig>): void {
  if (cfg.sessionPrefix !== undefined) {
    const sp = cfg.sessionPrefix;
    const valid =
      (typeof sp === 'string' && sp.length > 0) ||
      (Array.isArray(sp) && sp.length > 0 && sp.every((v) => typeof v === 'string'));
    if (!valid) {
      throw new ConfigError(
        'agentops: .agentops.json: sessionPrefix must be a non-empty string or string[].',
      );
    }
  }

  if (cfg.priorFlows !== undefined) {
    const pf = cfg.priorFlows;
    if (!Array.isArray(pf) || !pf.every((v) => typeof v === 'string')) {
      throw new ConfigError('agentops: .agentops.json: priorFlows must be a string[].');
    }
  }

  if (cfg.bypassFlows !== undefined) {
    const bf = cfg.bypassFlows;
    if (!Array.isArray(bf) || !bf.every((v) => typeof v === 'string')) {
      throw new ConfigError('agentops: .agentops.json: bypassFlows must be a string[].');
    }
  }

  if (cfg.reportCommand !== undefined) {
    if (typeof cfg.reportCommand !== 'string' && cfg.reportCommand !== null) {
      throw new ConfigError(
        'agentops: .agentops.json: reportCommand must be a string or null.',
      );
    }
  }

  if (cfg.rootDir !== undefined) {
    if (typeof cfg.rootDir !== 'string' || cfg.rootDir.length === 0) {
      throw new ConfigError('agentops: .agentops.json: rootDir must be a non-empty string.');
    }
  }
}

export async function loadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  // 1. Read .agentops.json from cwd (optional)
  let fileConfig: Partial<AgentOpsConfig> = {};
  const filePath = path.join(cwd, '.agentops.json');

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      raw = '';
    } else {
      throw new ConfigError(
        `agentops: could not read .agentops.json: ${(err as Error).message}`,
      );
    }
  }

  if (raw !== '') {
    try {
      fileConfig = JSON.parse(raw) as Partial<AgentOpsConfig>;
    } catch (err) {
      throw new ConfigError(
        `agentops: .agentops.json contains invalid JSON: ${(err as Error).message}. Fix the syntax or delete the file.`,
      );
    }
    validateFileConfig(fileConfig);
  }

  // 2. Resolve sessionPrefix (required)
  let sessionPrefix: ResolvedField<string | string[]>;
  const envPrefix = process.env['AGENTOPS_SESSION_PREFIX'];
  if (envPrefix !== undefined && envPrefix !== '') {
    sessionPrefix = field(envPrefix, 'env');
  } else if (fileConfig.sessionPrefix !== undefined) {
    sessionPrefix = field(fileConfig.sessionPrefix, 'config');
  } else {
    throw new ConfigError(
      'agentops: sessionPrefix is required. Set it in .agentops.json or via AGENTOPS_SESSION_PREFIX env var.',
    );
  }

  // 3. Resolve reportCommand (optional, default: null)
  let reportCommand: ResolvedField<string | null>;
  const envCmd = process.env['AGENTOPS_REPORT_COMMAND'];
  if (envCmd !== undefined) {
    reportCommand = field(envCmd, 'env');
  } else if (fileConfig.reportCommand !== undefined) {
    reportCommand = field(fileConfig.reportCommand ?? null, 'config');
  } else {
    reportCommand = field(null, 'default');
  }

  // 4. Resolve priorFlows (optional, default: [])
  let priorFlows: ResolvedField<string[]>;
  const envPrior = parseJsonEnv('AGENTOPS_PRIOR_FLOWS');
  if (envPrior !== null) {
    priorFlows = field(envPrior, 'env');
  } else if (fileConfig.priorFlows !== undefined) {
    priorFlows = field(fileConfig.priorFlows, 'config');
  } else {
    priorFlows = field([], 'default');
  }

  // 5. Resolve bypassFlows (optional, default: [])
  let bypassFlows: ResolvedField<string[]>;
  const envBypass = parseJsonEnv('AGENTOPS_BYPASS_FLOWS');
  if (envBypass !== null) {
    bypassFlows = field(envBypass, 'env');
  } else if (fileConfig.bypassFlows !== undefined) {
    bypassFlows = field(fileConfig.bypassFlows, 'config');
  } else {
    bypassFlows = field([], 'default');
  }

  // 6. Resolve rootDir (optional, default: '.agent-session')
  let rootDir: ResolvedField<string>;
  const envRoot = process.env['AGENTOPS_ROOT_DIR'];
  if (envRoot !== undefined) {
    rootDir = field(envRoot, 'env');
  } else if (fileConfig.rootDir !== undefined) {
    rootDir = field(fileConfig.rootDir, 'config');
  } else {
    rootDir = field('.agent-session', 'default');
  }

  return { sessionPrefix, reportCommand, priorFlows, bypassFlows, rootDir };
}
