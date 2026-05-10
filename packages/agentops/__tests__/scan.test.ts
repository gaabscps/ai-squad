/**
 * Unit tests for scan.ts
 * Covers: string prefix, array prefix, empty results, formatEmptyScanMessage.
 */

import path from 'path';

import { formatEmptyScanMessage, scan } from '../src/scan';

const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');

describe('scan', () => {
  it('returns sorted absolute paths for all valid FEAT-* fixtures (string prefix)', async () => {
    const result = await scan(FIXTURES_ROOT, 'FEAT-');
    expect(result).toHaveLength(3);
    expect(result[0]).toMatch(/FEAT-FIXTURE-A$/);
    expect(result[1]).toMatch(/FEAT-FIXTURE-B$/);
    expect(result[2]).toMatch(/FEAT-FIXTURE-C$/);
    // sorted ascending
    expect(result).toEqual([...result].sort());
    // all paths are absolute
    result.forEach((p) => expect(path.isAbsolute(p)).toBe(true));
  });

  it('returns [] when rootDir does not exist', async () => {
    const result = await scan('/tmp/__does_not_exist_agentops_test__', 'FEAT-');
    expect(result).toEqual([]);
  });

  it('returns [] when rootDir exists but is empty', async () => {
    const os = await import('os');
    const fs = await import('fs/promises');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-scan-'));
    try {
      const result = await scan(tmpDir, 'FEAT-');
      expect(result).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips FEAT-* subdirs that lack session.yml', async () => {
    const os = await import('os');
    const fs = await import('fs/promises');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-scan-'));
    try {
      // Create a FEAT-* dir without session.yml
      await fs.mkdir(path.join(tmpDir, 'FEAT-NO-SESSION'));
      // Create one with session.yml
      const validDir = path.join(tmpDir, 'FEAT-VALID');
      await fs.mkdir(validDir);
      await fs.writeFile(path.join(validDir, 'session.yml'), 'task_id: test\n');

      const result = await scan(tmpDir, 'FEAT-');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/FEAT-VALID$/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns [] when string prefix matches no directories', async () => {
    const os = await import('os');
    const fs = await import('fs/promises');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-scan-'));
    try {
      const validDir = path.join(tmpDir, 'FEAT-VALID');
      await fs.mkdir(validDir);
      await fs.writeFile(path.join(validDir, 'session.yml'), 'task_id: test\n');

      const result = await scan(tmpDir, 'DISC-');
      expect(result).toEqual([]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds dirs matching either prefix when sessionPrefix is an array', async () => {
    const os = await import('os');
    const fs = await import('fs/promises');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-scan-'));
    try {
      const featDir = path.join(tmpDir, 'FEAT-001');
      await fs.mkdir(featDir);
      await fs.writeFile(path.join(featDir, 'session.yml'), 'task_id: feat\n');

      const discDir = path.join(tmpDir, 'DISC-001');
      await fs.mkdir(discDir);
      await fs.writeFile(path.join(discDir, 'session.yml'), 'task_id: disc\n');

      // Should NOT be included (different prefix)
      const otherDir = path.join(tmpDir, 'OTHER-001');
      await fs.mkdir(otherDir);
      await fs.writeFile(path.join(otherDir, 'session.yml'), 'task_id: other\n');

      const result = await scan(tmpDir, ['FEAT-', 'DISC-']);
      expect(result).toHaveLength(2);
      expect(result.some((p) => p.endsWith('DISC-001'))).toBe(true);
      expect(result.some((p) => p.endsWith('FEAT-001'))).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns only DISC-* dirs when array prefix used and only DISC-* dirs exist', async () => {
    const os = await import('os');
    const fs = await import('fs/promises');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-scan-'));
    try {
      const discDir = path.join(tmpDir, 'DISC-002');
      await fs.mkdir(discDir);
      await fs.writeFile(path.join(discDir, 'session.yml'), 'task_id: disc\n');

      const result = await scan(tmpDir, ['FEAT-', 'DISC-']);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/DISC-002$/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws RangeError when sessionPrefix is an empty string', async () => {
    await expect(scan(FIXTURES_ROOT, '')).rejects.toThrow(RangeError);
    await expect(scan(FIXTURES_ROOT, '')).rejects.toThrow(
      'agentops: sessionPrefix cannot be an empty string.',
    );
  });

  it('throws RangeError when sessionPrefix array contains an empty string', async () => {
    await expect(scan(FIXTURES_ROOT, ['FEAT-', ''])).rejects.toThrow(RangeError);
    await expect(scan(FIXTURES_ROOT, ['FEAT-', ''])).rejects.toThrow(
      'agentops: sessionPrefix cannot be an empty string.',
    );
  });

  it('returns [] when sessionPrefix is an empty array (no prefixes → no matches)', async () => {
    const result = await scan(FIXTURES_ROOT, []);
    expect(result).toEqual([]);
  });
});

describe('formatEmptyScanMessage', () => {
  it('formats message for a single string prefix', () => {
    const msg = formatEmptyScanMessage('FEAT-', '.agent-session');
    expect(msg).toBe(
      "agentops: no sessions found matching prefix 'FEAT-' in '.agent-session'. Check your .agentops.json.",
    );
  });

  it('formats message for an array prefix (pipe-separated)', () => {
    const msg = formatEmptyScanMessage(['FEAT-', 'DISC-'], '.agent-session');
    expect(msg).toBe(
      "agentops: no sessions found matching prefix 'FEAT-|DISC-' in '.agent-session'. Check your .agentops.json.",
    );
  });
});
