import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  extractAiSquadHookBasename,
  pruneOrphanHookRegistrations,
} from '../lib/deploy.js';

test('extractAiSquadHookBasename: bare python3 form', () => {
  const cmd = 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stamp-session-id.py"';
  assert.equal(extractAiSquadHookBasename(cmd), 'stamp-session-id.py');
});

test('extractAiSquadHookBasename: fail-open guard form', () => {
  const cmd =
    '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-session-scope.py" ] || exit 0; ' +
    'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-session-scope.py"';
  assert.equal(extractAiSquadHookBasename(cmd), 'guard-session-scope.py');
});

test('extractAiSquadHookBasename: non-ai-squad path returns null', () => {
  assert.equal(extractAiSquadHookBasename('python3 ~/.claude/hooks/user-hook.py'), null);
  assert.equal(extractAiSquadHookBasename('npx some-pkg run'), null);
  assert.equal(extractAiSquadHookBasename(''), null);
  assert.equal(extractAiSquadHookBasename(null), null);
});

test('pruneOrphanHookRegistrations: removes orphan and keeps current', () => {
  const hooks = {
    PreToolUse: [
      {
        matcher: 'Write',
        hooks: [
          {
            type: 'command',
            command:
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stamp-session-id.py"',
          },
          {
            type: 'command',
            command:
              '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-reviewer-write-path.py" ] || exit 0; ' +
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-reviewer-write-path.py"',
          },
        ],
      },
    ],
  };
  const desired = new Set(['verify-reviewer-write-path.py']);

  const removed = pruneOrphanHookRegistrations(hooks, desired);

  assert.equal(removed.length, 1);
  assert.equal(removed[0].event, 'PreToolUse');
  assert.equal(removed[0].matcher, 'Write');
  assert.match(removed[0].command, /stamp-session-id\.py/);

  assert.equal(hooks.PreToolUse[0].hooks.length, 1);
  assert.match(
    hooks.PreToolUse[0].hooks[0].command,
    /verify-reviewer-write-path\.py/,
  );
});

test('pruneOrphanHookRegistrations: drops empty bucket and empty event', () => {
  const hooks = {
    PreToolUse: [
      {
        matcher: 'Write',
        hooks: [
          {
            type: 'command',
            command:
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/stamp-session-id.py"',
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: '',
        hooks: [
          {
            type: 'command',
            command:
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-pm-handoff-clean.py"',
          },
        ],
      },
    ],
  };
  const desired = new Set(['verify-pm-handoff-clean.py']);

  const removed = pruneOrphanHookRegistrations(hooks, desired);

  assert.equal(removed.length, 1);
  assert.equal('PreToolUse' in hooks, false, 'PreToolUse should be deleted when all buckets empty');
  assert.equal(hooks.Stop[0].hooks.length, 1);
});

test('pruneOrphanHookRegistrations: leaves non-ai-squad commands untouched', () => {
  const hooks = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'python3 ~/.claude/hooks/my-personal-hook.py',
          },
          {
            type: 'command',
            command: 'npx some-tool --do-thing',
          },
        ],
      },
    ],
  };
  const desired = new Set();

  const removed = pruneOrphanHookRegistrations(hooks, desired);

  assert.equal(removed.length, 0);
  assert.equal(hooks.PreToolUse[0].hooks.length, 2);
});

test('pruneOrphanHookRegistrations: handles empty / malformed input', () => {
  assert.deepEqual(pruneOrphanHookRegistrations(null, new Set()), []);
  assert.deepEqual(pruneOrphanHookRegistrations({}, new Set()), []);
  assert.deepEqual(
    pruneOrphanHookRegistrations({ PreToolUse: 'not-an-array' }, new Set()),
    [],
  );
});

test('pruneOrphanHookRegistrations: preserves hooks from squads not in current deploy', () => {
  // Simulates partial deploy: user installed sdd + discovery previously, now
  // runs `ai-squad deploy --squad sdd`. The desired set MUST include hooks
  // from every bundled squad (computed by collectBundledHookFiles), so
  // discovery's hook survives even though it's not in the active deploy.
  const hooks = {
    PreToolUse: [
      {
        matcher: 'Write',
        hooks: [
          {
            type: 'command',
            command:
              '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-reviewer-write-path.py" ] || exit 0; ' +
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-reviewer-write-path.py"',
          },
          {
            type: 'command',
            command:
              'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/discovery-frame-guard.py"',
          },
        ],
      },
    ],
  };
  const desired = new Set([
    'verify-reviewer-write-path.py', // from sdd
    'discovery-frame-guard.py', // from discovery (fictitious example)
  ]);

  const removed = pruneOrphanHookRegistrations(hooks, desired);

  assert.equal(removed.length, 0);
  assert.equal(hooks.PreToolUse[0].hooks.length, 2);
});
