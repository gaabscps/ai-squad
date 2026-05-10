/**
 * Unit tests for pipeline-line renderer — FEAT-005 T-008.
 * AC-006.
 */

import type { Role } from '../../../../../types';
import { renderPipelineLine } from '../parts/pipeline-line';

describe('renderPipelineLine', () => {
  it('renders empty span for empty array', () => {
    const html = renderPipelineLine([]);
    expect(html).toBe('<span class="story-card__pipeline"></span>');
  });

  it('AC-006: canonical SDD pipeline dev → code-reviewer ‖ logic-reviewer → qa', () => {
    const roles: Role[] = ['dev', 'code-reviewer', 'logic-reviewer', 'qa'];
    const html = renderPipelineLine(roles);
    expect(html).toContain('story-card__pipeline');
    // → between dev and code-reviewer
    expect(html).toContain('dev → code-reviewer');
    // ‖ between code-reviewer and logic-reviewer (both reviewers)
    expect(html).toContain('code-reviewer ‖ logic-reviewer');
    // → between logic-reviewer and qa
    expect(html).toContain('logic-reviewer → qa');
  });

  it('AC-006: dev → qa (BATCH-B style, no reviewer parallel)', () => {
    const roles: Role[] = ['dev', 'qa'];
    const html = renderPipelineLine(roles);
    expect(html).toContain('dev → qa');
    expect(html).not.toContain('‖');
  });

  it('AC-006: pipeline ending with audit-agent', () => {
    const roles: Role[] = ['dev', 'qa', 'audit-agent'];
    const html = renderPipelineLine(roles);
    expect(html).toContain('dev → qa → audit-agent');
    expect(html).not.toContain('‖');
  });

  it('single role renders without separator', () => {
    const html = renderPipelineLine(['dev']);
    expect(html).toContain('>dev<');
    expect(html).not.toContain('→');
    expect(html).not.toContain('‖');
  });

  it('AC-006: code-reviewer ‖ logic-reviewer in either order uses parallel separator', () => {
    const roles: Role[] = ['dev', 'logic-reviewer', 'code-reviewer', 'qa'];
    const html = renderPipelineLine(roles);
    expect(html).toContain('logic-reviewer ‖ code-reviewer');
  });

  it('non-reviewer consecutive roles use → separator', () => {
    const roles: Role[] = ['dev', 'blocker-specialist', 'qa'];
    const html = renderPipelineLine(roles);
    expect(html).toContain('dev → blocker-specialist');
    expect(html).toContain('blocker-specialist → qa');
    expect(html).not.toContain('‖');
  });
});
