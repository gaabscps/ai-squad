# Failure modes and design rationale

Referenced from `skill.md`. How spec-writer behaves under abandonment, timeout, partial writes, and schema mismatch, and why it is a Skill (not a Subagent).

## Failure modes
- **Human abandons mid-Session:** state on disk reflects last atomic write (per-section). Next `/spec-writer FEAT-NNN` resumes from there.
- **AskUserQuestion timeout / human answers nothing:** session paused; no state change. Next `/spec-writer FEAT-NNN` re-prompts the same question.
- **Partial `spec.md` write:** atomic write (tmp + rename) makes this impossible — either the previous version or the new version is on disk, never a half-written file.
- **`schema_version` mismatch on resume:** refuse per refusal matrix; human upgrades ai-squad or manually edits `session.yml`.
- **More than 3 `[NEEDS CLARIFICATION]` would emerge during drafting:** spec-writer asks the human to pick the 3 most important via `AskUserQuestion`; remaining items become `## Open Questions` entries (post-approval refinement, not Spec-blocking).
- **Human tries to approve while open `[NEEDS CLARIFICATION]` exist:** refuse the approval gate; list the open items; return to step 5.
- (TODO Phase 2 if needed: concurrent-edit lockfile — only add if real conflict observed in practice.)

## Why a Skill (not a Subagent)
Phase 1 has the human in-the-loop refining the Spec. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see [`shared/concepts/skill-vs-subagent.md`](../../../shared/concepts/skill-vs-subagent.md)).
