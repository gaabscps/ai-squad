# Concept — `Output Packet`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), [`evidence.md`](evidence.md), [`spec.md`](spec.md). Mirrored by [`work-packet.md`](work-packet.md) (concept #7).

## Definition

The **Output Packet** is the only structured channel from a Subagent back to its parent (orchestrator). It is a JSON file with a fixed schema, written by the Subagent to `.agent-session/<task_id>/outputs/<dispatch_id>.json` **before** returning the final summary string. The platform-level return from the Subagent (the single summary string the `Agent` tool produces) is simply the pointer to this file.

> *Terms used in this doc:*
> - **dispatch_id:** unique identifier for one specific dispatch of a Role within a Session. Permits distinguishing the Output Packet of the current dispatch from re-runs of the same Role. Format: `<role>-<short-uuid>` or `<role>-<timestamp>`.
> - **routing:** the orchestrator's act of deciding, based on the received Output Packet, what the next dispatch is — which Role, with which Work Packet, or whether to escalate or hand off to the human.
> - **validation gate:** the orchestrator's check that the received Output Packet is well-formed (required fields present, enums respected, evidence schema valid). Malformed packets are rejected before processing.

## Why Output Packet is the framework's routing lever

1. **It is the only structured channel back from a Subagent.** Subagents return a single string to the parent (platform constraint); without a structured packet behind that string, the orchestrator would parse prose to make routing decisions — fragile and inconsistent.
2. **It is where `status` (the routing enum) lives operationally.** All Pipeline transitions key off this enum. Any logic the orchestrator runs to decide "go forward / loop back / escalate" is a function of `status` + the packet's structured fields.
3. **It is where `evidence[]` gets its operational wrapper.** Evidence on its own is just pointers (concept #5). The Output Packet binds those pointers to a Role, a Spec, a status, and findings — turning raw proof into actionable input for the next dispatch.

## Top-level schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `spec_id` | string | yes | The Spec this dispatch was for (`FEAT-XXX`). |
| `dispatch_id` | string | yes | Unique within Session. Format: `<role>-<short-uuid>` or `<role>-<timestamp>`. |
| `role` | string | yes | The Role that emitted this packet (must match one of the 8 canonical Roles). |
| `status` | enum | yes | `done | needs_review | blocked | escalate`. See [Status enum semantics](#status-enum-semantics) below. |
| `summary` | string | yes | One line, past tense, ≤ 120 chars. See [Summary format rules](#summary-format-rules). |
| `evidence` | array | yes | 0–50 items. Each item follows [`evidence.md`](evidence.md) schema. |
| `findings` | array | no (default `[]`) | 0+ items. See [findings[] schema](#findings-schema). |
| `blockers` | array | required if `status: blocked`, else `[]` | See [blockers[] schema](#blockers-schema). |
| `next_role` | string | no | Suggested next Role for the orchestrator. See [next_role semantics](#next_role-semantics). |
| `ac_coverage` | object | required if `role: qa`, forbidden otherwise | Maps `AC-ref` → array of evidence IDs that validate it. See [ac_coverage](#ac_coverage-qa-specific) below. |

Full template at [`shared/templates/output-packet.example.json`](../templates/output-packet.example.json).

## Status enum semantics

Closed enum of 4 values. The orchestrator routes purely on this field — never on prose, never on findings text.

| `status` | When the Subagent emits it | How the orchestrator routes |
|----------|----------------------------|------------------------------|
| `done` | Work complete, evidence proves it, no reservations. | Advance to next Role in the Pipeline. |
| `needs_review` | Work complete but `findings[]` carry issues that should be addressed before advancing. | Route back to the prior Role (typically reviewer → dev), increment loop counter. If loop cap reached, escalate. |
| `blocked` | Cannot proceed; `blockers[]` populated with the reason. | Dispatch `blocker-specialist` with the failing Output Packet referenced. |
| `escalate` | Even `blocker-specialist` cannot resolve, or loop caps exhausted. Sole emitter in practice: `blocker-specialist`. | Stop the Pipeline; generate human-readable handoff with the escalation context. |

`needs_review` is distinct from `blocked`: the first means "I did the work but flagged issues"; the second means "I can't do the work."

## findings[] schema

Items in `findings[]` represent issues the Subagent identified. Reviewers (`code-reviewer`, `logic-reviewer`) populate this most heavily; `qa` populates when tests fail; `designer` populates when the Spec has visual inconsistencies; `dev` rarely populates (work-in-progress observations rather than self-found issues).

```json
{
  "id": "FIND-001",
  "severity": "error",
  "message": "Off-by-one at exact expiry instant — uses < instead of <=.",
  "evidence_ref": "EV-002",
  "ac_ref": "FEAT-042/AC-003",
  "suggested_fix": "Change < to <= at src/auth/reset.ts:52"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Monotonic per dispatch (`FIND-001`, `FIND-002`, …). |
| `severity` | enum | yes | `info | warning | error | critical`. See severity table below. |
| `message` | string | yes | One sentence stating the issue. |
| `evidence_ref` | string | yes | Pointer to the evidence ID (in this same packet's `evidence[]`) that sustains the finding. |
| `ac_ref` | string | no | `FEAT-XXX/AC-XXX` if the finding violates a specific Spec acceptance criterion. |
| `suggested_fix` | string | no | One line. Does not mandate the fix; the next dispatch decides. |

### Severity enum

| `severity` | Meaning | Effect on orchestrator routing |
|------------|---------|--------------------------------|
| `info` | Informational note (e.g. "consider extracting helper"). | Carried into the next Work Packet as context; does not block. |
| `warning` | Non-blocking issue worth flagging (e.g. "magic number"). | Same as `info`; surfaces in the human handoff. |
| `error` | Issue that must be fixed before advancing. | Forces `status: needs_review` regardless of how the Subagent self-classified; routes back to prior Role. |
| `critical` | Showstopper — even if `status: needs_review`, treat as effectively blocking. | Routes to `blocker-specialist` if it persists across one loop. |

## blockers[] schema

Populated only when `status: blocked`. Empty array otherwise.

```json
{
  "id": "BLK-001",
  "reason": "Spec is silent on behavior when token is malformed (not expired, not valid).",
  "what_was_attempted": "Read FEAT-042 sections AC-003 and Constraints; consulted design/FEAT-042-decisions.md",
  "what_is_needed": "Spec clarification or explicit human decision on malformed-token handling"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Monotonic per dispatch (`BLK-001`, `BLK-002`, …). |
| `reason` | string | yes | One sentence stating what is blocking. |
| `what_was_attempted` | string | yes | One sentence stating what the Subagent already tried. Prevents the next handler from re-trying the same path. |
| `what_is_needed` | string | yes | One sentence stating the unblock condition (Spec change, human decision, infrastructure, etc). |

The orchestrator dispatches `blocker-specialist` with the blocking Output Packet referenced. If `blocker-specialist` cannot unblock (insufficient information, decision belongs to human), it returns `status: escalate` with its own blockers.

## summary format rules

- **One line, ≤ 120 characters.**
- **Past tense, starts with a verb.** `Implemented`, `Validated`, `Found`, `Blocked on`.
- **No duplication of evidence.** Wrong: `summary: "Modified src/auth/reset.ts."` (already captured in evidence). Right: `summary: "Added expiry check; all AC-003 tests pass."`
- **No interpretive prose.** Wrong: `summary: "This was a tricky edge case because..."` Belongs in `findings` with `severity: info` if worth recording at all.
- **Machine-parseable preferred.** The orchestrator concatenates summaries into the human-readable handoff; dense factual one-liners read better than narrative.

## next_role semantics

`next_role` is a **suggestion** from the Subagent, not a command.

The Subagent has local visibility (it just finished its part; it has an opinion about what would naturally come next). The orchestrator has global visibility (Pipeline state, loop counters, fan-out reconciliation, cost budget). In ~95% of cases, the orchestrator obeys; in ~5% (loop cap reached, blocker, fan-out aggregation), it overrides.

Common conventions:

| Emitter Role | Typical `next_role` suggestion |
|--------------|-------------------------------|
| `designer` | `dev` |
| `dev` | `code-reviewer` (orchestrator dispatches both reviewers in parallel anyway) |
| `code-reviewer` | `dev` (if findings exist with `severity: error`+) or absent (if clean) |
| `logic-reviewer` | Same as `code-reviewer` |
| `qa` | absent (qa is the gate before handoff; orchestrator decides handoff vs loop-back) |
| `blocker-specialist` | The Role that should resume after the unblock decision |

When unsure, omit the field — the orchestrator handles routing from `status` alone.

## dispatch_id and FS layout

Every Output Packet lives at:

```
.agent-session/<task_id>/outputs/<dispatch_id>.json
```

Where `<task_id>` is the Spec ID (`FEAT-042`) and `<dispatch_id>` is the unique dispatch identifier (`dev-7b3c1a`, `code-reviewer-1740832455`, etc).

**Immutability:** an Output Packet is immutable once written. A re-run of the same Role generates a new file with a new `dispatch_id`. The orchestrator can compare consecutive Output Packets across loop iterations to detect "no progress" (same evidence and findings in dev's loop 2 as in loop 1 → escalate).

**Retention:** all Output Packets for a Session are preserved until `/ship FEAT-XXX` removes the `.agent-session/<task_id>/` directory. The orchestrator and the human handoff both reference the full history.

## `ac_coverage` (qa-specific)

Top-level field, **required when `role: qa`** and **forbidden on packets from any other Role**. Inverts the AC-to-evidence mapping: instead of relying on `ac_ref` scattered across individual evidences, qa declares explicitly which evidences cover which AC.

```json
"ac_coverage": {
  "FEAT-042/AC-001": ["EV-001", "EV-002"],
  "FEAT-042/AC-002": ["EV-003"],
  "FEAT-042/AC-003": []
}
```

| Case | Meaning | Orchestrator reaction |
|------|---------|------------------------|
| AC present with non-empty array | Covered — qa validated and has proof. | Accept; proceed. |
| AC present with empty array | Coverage attempt failed. | qa returns `status: blocked` (Spec gap, infrastructure missing) or `status: needs_review` (implementation gap). |
| AC absent from the dict | qa was not assigned to validate this AC in this dispatch. | Valid in `fan_out` scenarios (qa#1 covers AC-001/002; qa#2 covers AC-003/004). Orchestrator aggregates across all qa Output Packets before deciding handoff. |
| `ac_coverage` absent (qa packet) | Invalid; qa always populates. | Validation gate rejects. |
| `ac_coverage` present (non-qa packet) | Invalid; only qa populates. | Validation gate rejects. |

**Pre-requisite on `evidence.id`:** every evidence referenced by `ac_coverage` must have an `id` field set. The `id` field on evidences is generally optional (concept #5), but becomes required when referenced. The validation gate enforces this.

## Validation gate

The orchestrator validates every Output Packet before processing. Rejections are treated as `status: blocked` with an auto-generated blocker (`malformed Output Packet from <role>: <reason>`). The orchestrator does not auto-escalate on a single malformed packet — it logs and tries one re-run; second malformed packet from the same dispatch escalates.

Rejection conditions:

- Missing required field (`spec_id`, `dispatch_id`, `role`, `status`, `summary`, `evidence`)
- `status` outside the 4-element enum
- `role` outside the 8 canonical Roles
- Evidence with `kind` outside the 7-element enum
- Evidence schema violation (missing required field for the kind — see [`evidence.md`](evidence.md))
- `evidence[]` exceeding 50 items
- `status: blocked` with empty `blockers[]`
- `status: done` or `status: needs_review` with non-empty `blockers[]` (contradiction)
- `role: qa` without `ac_coverage`
- `role` ≠ qa with `ac_coverage` present
- `ac_coverage` referencing an evidence ID that does not exist in `evidence[]`
- `ac_coverage` referencing an `AC-ref` not present in the Spec (cross-validated against `spec_id`)

## The pointer return convention

The platform forces Subagents to return a single string to the parent. ai-squad's convention for that string:

```
OutputPacket: .agent-session/FEAT-042/outputs/dev-7b3c1a.json
```

Single line, prefix `OutputPacket:`, then the path. The orchestrator parses this prefix, opens the file, runs the validation gate, and proceeds. No prose, no summary in the string itself — the summary lives in the JSON.

If the Subagent fails to write the packet (catastrophic error: disk full, permission denied), it returns:

```
OutputPacket: ERROR: <one-line reason>
```

The orchestrator treats this as a synthetic `status: blocked` with blocker auto-generated from the reason. Same retry/escalate path as a malformed packet.

## Anti-patterns

1. **Prose `summary` over multiple lines.** Hurts the human handoff and signals the Subagent is trying to compensate for missing structure elsewhere.
2. **`findings[]` populated as "considerations" instead of issues.** Findings are for actionable issues. "FYI" notes belong in `severity: info` sparingly, or not at all.
3. **`status: done` with critical findings.** Contradiction. If there are critical findings, status is `needs_review` (or `blocked` if the Subagent cannot proceed past them).
4. **`blockers[]` without `what_was_attempted`.** Skipping this field forces the next handler to re-explore the same dead ends. The field is required for a reason.
5. **`next_role` set with a Role outside the 8 canonical.** Validation gate rejects.
6. **Same evidence ID reused across packets.** IDs are scoped to the dispatch (`EV-001` in dev's packet is unrelated to `EV-001` in qa's packet). Cross-packet references use `dispatch_id` + evidence index/id, not bare `EV-XXX`.
7. **Modifying an Output Packet after writing.** Forbidden by the immutability rule. Re-runs generate new packets with new `dispatch_id`s.
8. **Returning `status: escalate` from a non-`blocker-specialist` Role.** Reserved for `blocker-specialist`. Other Roles use `blocked`, which routes through `blocker-specialist` first.

## Why this design and not alternatives

- **JSON over Markdown:** machine-parsing reliability for the orchestrator's routing logic. Markdown was right for Spec (humans read Specs); JSON is right for packets (orchestrator reads packets).
- **Closed `status` enum vs. richer state machine:** four states cover every routing decision the orchestrator needs to make. A richer state machine would add states without adding routing decisions — pure complexity tax.
- **`next_role` as suggestion, not command:** preserves Subagent's local insight without surrendering orchestrator's global authority. Industry pattern (Anthropic's multi-agent research system, OpenAI Swarm handoffs) trends this way.
- **Validation gate as orchestrator responsibility:** Subagents could in principle self-validate, but a malformed packet from one would silently corrupt the Pipeline. Single point of validation in the orchestrator is more robust.
- **Pointer return convention vs. inline JSON in the string:** inline JSON would inflate the parent's context with the full packet (anti-context-pollution); pointer keeps the parent's view minimal until/unless it needs the file.
