import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { pruneLegacyRegistrations } from '../lib/deploy.js';

test('removes a legacy agentops Stop registration and keeps siblings', () => {
  const hooks = {
    Stop: [
      {
        matcher: '',
        hooks: [
          { type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-pm-handoff-clean.py"' },
          { type: 'command', command: 'npx @ai-squad/agentops capture' },
          { type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/capture-session-cost.py"' },
        ],
      },
    ],
  };
  const removed = pruneLegacyRegistrations(hooks);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].event, 'Stop');
  assert.equal(removed[0].command, 'npx @ai-squad/agentops capture');
  assert.match(removed[0].reason, /agentops/);
  assert.match(removed[0].reason, /commit/);
  assert.equal(hooks.Stop[0].hooks.length, 2);
  assert.equal(hooks.Stop[0].hooks[0].command.includes('verify-pm-handoff-clean'), true);
  assert.equal(hooks.Stop[0].hooks[1].command.includes('capture-session-cost'), true);
});

test('drops the matcher bucket and event key when the only hook was legacy', () => {
  const hooks = {
    Stop: [{ matcher: '', hooks: [{ command: 'npx @ai-squad/agentops capture' }] }],
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/block-git-write.py"' }] },
    ],
  };
  const removed = pruneLegacyRegistrations(hooks);
  assert.equal(removed.length, 1);
  assert.equal('Stop' in hooks, false);
  assert.equal(hooks.PreToolUse.length, 1);
});

test('no-op when there are no legacy registrations', () => {
  const hooks = {
    Stop: [{ matcher: '', hooks: [{ command: 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-audit-dispatch.py"' }] }],
  };
  const before = JSON.stringify(hooks);
  const removed = pruneLegacyRegistrations(hooks);
  assert.equal(removed.length, 0);
  assert.equal(JSON.stringify(hooks), before);
});

test('safe against null / non-object input', () => {
  assert.deepEqual(pruneLegacyRegistrations(null), []);
  assert.deepEqual(pruneLegacyRegistrations(undefined), []);
  assert.deepEqual(pruneLegacyRegistrations('hooks'), []);
});

test('removes legacy registration regardless of which event it lives under', () => {
  const hooks = {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'npx @ai-squad/agentops legacy-prehook' }] }],
    SubagentStop: [{ matcher: '', hooks: [{ command: 'npx @ai-squad/agentops capture' }] }],
  };
  const removed = pruneLegacyRegistrations(hooks);
  assert.equal(removed.length, 2);
  const events = removed.map((r) => r.event).sort();
  assert.deepEqual(events, ['PreToolUse', 'SubagentStop']);
});
