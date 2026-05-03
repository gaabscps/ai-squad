# Concept — `Work Packet`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), [`spec.md`](spec.md), [`evidence.md`](evidence.md). Mirrored by [`output-packet.md`](output-packet.md) (concept #6).

## Definition

The **Work Packet** is the only structured channel from the orchestrator to a Subagent. It is a JSON file with a fixed schema, written by the orchestrator to `.agent-session/<task_id>/inputs/<dispatch_id>.json`, and passed to the Subagent via the convention `WorkPacket: <path>` in the prompt of the `Agent` tool.

It is the **yang to the Output Packet's yin**: same FS layout (`.agent-session/<task_id>/{inputs,outputs}/`), same `dispatch_id` shared between paired packets, same validation-gate discipline, same minimal-handoff principle.

> *Terms used in this doc:*
> - **scope (in fan-out context):** the subset of files or acceptance criteria a specific instance of a Role must operate on. In fan-out, each instance receives a Work Packet with a different scope, guaranteeing write-disjoint work (no overlapping writes).
> - **stateless dispatch:** a property derived from the platform constraint — Subagents do not preserve context between invocations. Every dispatch is a fresh execution; all "memory" must arrive explicitly in the Work Packet.
> - **defense in depth:** safety pattern applied here — the orchestrator validates the Work Packet before dispatching (sanity check on what it just generated); the Subagent validates upon receipt (protection against a corrupted packet). Trivial cost, robustness gain.
> - **minimal handoff:** the rule that Work Packets carry pointers (paths, IDs) and never inline content. The Spec is referenced by `spec_ref`; ACs are referenced by `ac_scope` IDs; previous outputs are referenced by `input_refs` paths. Anti-context-pollution at the input boundary, mirroring the same rule for Output Packets.

## Why Work Packet is the framework's input lever

1. **It is the only structured channel into a Subagent.** Subagents are stateless and isolated (platform constraint); everything they know about what to do, why, and within what scope must arrive here. Without a structured contract, the orchestrator would compose prose prompts — fragile and inconsistent.

2. **It is where runtime decisions of the orchestrator materialize.** Override of `model`/`effort` (concept #3), `scope_files` for fan-out (concept #1), `previous_findings` for loop memory (concept #6) — all live here.

3. **It is where the symmetry with Output Packets pays off.** Same `dispatch_id`, same FS structure, same validation discipline. This symmetry is what makes the Pipeline auditable (open `inputs/<id>.json` and `outputs/<id>.json` side by side; you have the full dispatch).

4. **It is what makes `fan_out` (first-class capability per concept #1) actually work.** Without `scope_files` and `ac_scope`, the orchestrator cannot decompose a Spec into write-disjoint sub-dispatches.

## Top-level schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `spec_id` | string | yes | The Spec ID (`FEAT-XXX`). |
| `dispatch_id` | string | yes | Unique within the Session. The corresponding Output Packet uses the same `dispatch_id`. |
| `spec_ref` | string | yes | Path to the Spec file: `.agent-session/<task_id>/spec.md`. |
| `to_role` | string | yes | One of the 8 canonical Roles. |
| `pipeline_stage` | string | no | Human-readable Pipeline stage tag (`dev`, `review`, `qa`, `escalation`). Informational, not enforced. **Note:** this is a Phase 4 *Pipeline stage*, not one of the 4 framework `Phase`s (Specify / Plan / Tasks / Implementation). Naming is deliberately distinct to avoid confusion. |
| `objective` | string | yes | One paragraph stating what this dispatch must accomplish. Read once by the Subagent at start. |
| `ac_scope` | array | no | List of `AC-ref`s the dispatch covers (`["FEAT-042/AC-001", "FEAT-042/AC-003"]`). Empty/absent = all ACs in the Spec. |
| `scope_files` | array | no | Paths or globs the dispatch may modify (`["src/auth/**", "tests/auth/**"]`). Absent = no restriction. |
| `input_refs` | array | no | Pointers to prior Output Packets, design files, or other artifacts this dispatch depends on. |
| `constraints` | array | no | Extra constraints beyond the Spec (e.g. `"do not refactor src/legacy/"`). Each item is one sentence. |
| `project_context` | object | no | Host project's local context: `stack`, `standards_ref` (path to project's `CLAUDE.md` or rules), `other`. |
| `model` | string | no | `sonnet | opus | haiku`. Overrides the Role's frontmatter default for this dispatch only. |
| `effort` | string | no | `low | medium | high | xhigh | max`. Overrides default. |
| `max_loops` | integer | no | Loop cap for this Role within the current Pipeline phase. Default 3 from Session config. |
| `previous_findings` | array | no | Findings from the immediately prior loop iteration. Populated by the orchestrator on re-runs. |

Full template at [`shared/templates/work-packet.json`](../templates/work-packet.json).

## Symmetry with Output Packet

The two packets are deliberately symmetric. Pairing them by `dispatch_id` and FS layout is what makes the Pipeline fully auditable.

| Concern | Work Packet | Output Packet |
|---------|-------------|---------------|
| Direction | orchestrator → Subagent | Subagent → orchestrator |
| FS path | `.agent-session/<task_id>/inputs/<dispatch_id>.json` | `.agent-session/<task_id>/outputs/<dispatch_id>.json` |
| `dispatch_id` | Generated by orchestrator | Inherited from the paired Work Packet |
| `to_role` field | Required (who this is for) | n/a — Output Packet uses `role` (who emitted) |
| `objective` | Required (what to do) | n/a |
| `status` | n/a | Required (`done | needs_review | blocked | escalate`) |
| `evidence[]` | n/a | Required (0–50 items, pointers only) |
| `findings[]` | n/a (but `previous_findings` carries findings *from prior iterations*) | Optional |
| Override mechanism | `model`, `effort` (override Role default for this dispatch) | n/a |
| Scope mechanism | `ac_scope`, `scope_files` (slice for fan-out) | n/a — Output reflects work done within the granted scope |
| Validation gate | Orchestrator validates on write; Subagent validates on read | Orchestrator validates on receipt |
| Immutability | Once written, never modified. Re-run = new `dispatch_id`. | Once written, never modified. Re-run = new `dispatch_id`. |
| Carry method | `WorkPacket: <path>` line in `Agent` tool prompt | `OutputPacket: <path>` string returned by Subagent |

## Minimal handoff principle

Work Packets carry pointers, never content. This is the same rule that protects Output Packets from context pollution, applied to the input direction.

- **Spec text** is referenced by `spec_ref` (a path). The Subagent opens it once via `Read`. The Work Packet does not inline AC text or Constraints sections.
- **ACs in scope** are referenced by ID list (`ac_scope`). The Subagent reads the Spec and filters by these IDs.
- **Prior outputs** (when this dispatch depends on a previous Subagent's work) are referenced by `input_refs` — each item is a `{ path, reason }` pair pointing to a prior Output Packet or artifact.
- **Project rules** are referenced by `project_context.standards_ref` (typically a path to the host project's `CLAUDE.md`).

The only field that may carry short prose is `objective` (one paragraph stating what to do) and items in `constraints` (one sentence each). Everything else is structured or pointer-based.

## `ac_scope` and `scope_files` — separated concerns

Acceptance criteria (which behaviors to deliver) and file scope (which files to modify) are orthogonal axes. They are kept in separate fields because Roles use them differently.

| Role | Typical `ac_scope` use | Typical `scope_files` use |
|------|------------------------|---------------------------|
| `designer` | All ACs (designer reads the whole Spec) | Absent (designer writes only its own design output, not project files) |
| `dev` | Implicit (dev addresses ACs implied by the file scope) | **Critical for fan-out** — each parallel `dev` instance gets a disjoint set |
| `code-reviewer` | n/a (reviews the diff, not specific ACs) | Optional — when fan-out splits review by module |
| `logic-reviewer` | Often present — focuses review on specific ACs' implementation | Optional |
| `qa` | **Critical for fan-out** — splits AC validation across instances | Absent (qa is read-only) |
| `blocker-specialist` | Subset relevant to the blocker | Absent |

When omitted, both fields are permissive (the dispatch can touch all ACs / all files). Restriction is opt-in by the orchestrator.

### How `scope_files` enforces write-disjoint fan-out

When the orchestrator decides to fan out `dev` into N parallel instances, it generates N Work Packets with non-overlapping `scope_files`. The Subagent should not modify files outside its `scope_files`. The orchestrator's validation gate on the resulting Output Packet cross-checks `evidence[]` of `kind: file` against the Work Packet's `scope_files` — any file path outside scope marks the packet as malformed.

This is not a security boundary (the Subagent has the same `Edit` tool either way); it is a **discipline boundary** caught at validation. A Subagent that violates `scope_files` will have its Output Packet rejected — the equivalent of the malformed-packet auto-blocker (concept #6).

## Override path — `model` and `effort`

Recap from concept #3 (Effort): every Subagent has a default `model` and `effort` in its frontmatter. The Work Packet may override either or both for a single dispatch.

```json
"model": "opus",
"effort": "xhigh"
```

Use cases:

- A normally-Sonnet `dev` upgraded to Opus for an architecturally complex feature (one-off; the next dispatch reverts to default).
- A second loop after a reviewer flagged subtle gaps — bump `effort` from `high` to `xhigh` once before escalating to `blocker-specialist`.
- A `qa` dispatch on critical-path features upgraded to deeper validation.

**Validation rule:** if `effort: xhigh` is set, `model: opus` must also be set explicitly (since `xhigh` is Opus-only). Validation gate enforces.

When both fields are absent, the Subagent uses its frontmatter defaults. The override is a knob, not the default.

## `previous_findings` for loop iterations

Subagents are stateless. In a loop (e.g. `dev` → `logic-reviewer` flags issues → orchestrator re-dispatches `dev`), the second `dev` dispatch has no memory of the first. The orchestrator must explicitly carry the prior loop's findings into the new Work Packet.

```json
"previous_findings": [
  {
    "id": "FIND-001",
    "severity": "error",
    "message": "Off-by-one at exact expiry instant — uses < instead of <=.",
    "ac_ref": "FEAT-042/AC-003",
    "evidence_ref": "EV-005",
    "from_dispatch": "logic-reviewer-3a8c1d"
  }
]
```

Each item is the original finding (same schema as in the source Output Packet) plus `from_dispatch` — a pointer back to the dispatch that produced it. The Subagent reads `previous_findings`, opens `from_dispatch`'s Output Packet for context if needed, and focuses on resolving each finding.

**Limit:** carry only findings from the immediately prior iteration, not the full loop history. Full history lives in the Session state file (`.agent-session/<task_id>.yml`, concept #12); putting it all in every Work Packet would defeat minimal handoff.

## The dispatch convention

The orchestrator passes the Work Packet to the Subagent via the `Agent` tool's prompt. The convention:

```
WorkPacket: .agent-session/FEAT-042/inputs/dev-7b3c1a.json

[optional one-line orchestrator note, e.g. "loop iteration 2; previous findings included"]
```

First line is the pointer (literal prefix `WorkPacket:` followed by space and the path). The Subagent's first action is to `Read` that file. The optional second part is a short orchestrator note (orienting the Subagent to runtime context the Work Packet alone might not convey, like loop iteration number).

**Anti-pattern:** putting the full Work Packet content inline in the `Agent` prompt. Pollutes the Subagent's initial context with the structure before any work begins. The pointer convention keeps the prompt minimal.

## Validation gate (defense in depth)

Two validation points: orchestrator on write (catches its own bugs), Subagent on read (catches packets corrupted in transit or misrouted).

### Orchestrator side (before dispatching)

The orchestrator validates that:

- `dispatch_id` is unique within the current Session
- `to_role` is one of the 8 canonical Roles
- `spec_ref` resolves to an existing file with `status: approved`
- `ac_scope` (if present) references AC IDs that exist in the Spec
- `scope_files` (if present) is an array of valid path/glob strings
- `model` (if present) is `sonnet | opus | haiku`
- `effort` (if present) is `low | medium | high | xhigh | max`
- If `effort: xhigh`, `model: opus` is also set
- `max_loops` (if present) is a positive integer
- `previous_findings` items have valid `severity` and `from_dispatch` referencing an existing dispatch in the Session

Failure to validate is a bug in the orchestrator — abort the dispatch, log, and surface to the human.

### Subagent side (on receipt)

The Subagent validates that:

- The path in `WorkPacket: <path>` exists and is readable JSON
- All required fields are present
- `to_role` matches the Subagent's own Role (defense against misrouted dispatch)
- `spec_ref` resolves to a readable file

If any validation fails, the Subagent immediately returns an Output Packet with `status: blocked` and a blocker explaining the validation failure (`malformed Work Packet: <reason>`). The orchestrator's Output Packet validation gate catches this and routes to `blocker-specialist` or surfaces to the human, depending on persistence.

## Anti-patterns

1. **Inline AC text in the Work Packet.** Violates minimal handoff. Use `ac_scope` (IDs) and let the Subagent read from `spec_ref`.
2. **Inline prior Output Packet content in `input_refs`.** Same violation. `input_refs` items are `{ path, reason }`, never `{ path, content }`.
3. **`previous_findings` carrying the entire loop history.** Limit to the immediately prior iteration. Full history lives in Session state.
4. **`from_role` field.** Was in the original schema. Removed — orchestrator is always the sender; field is redundant.
5. **`done_when` field.** Was in the original schema. Removed — done conditions live in the Spec's ACs, referenced via `ac_scope`.
6. **`escalate_if` field.** Was in the original schema. Removed — escalation is the orchestrator's responsibility, not the Subagent's; lives in Pipeline rules (concept #10).
7. **Reusing `dispatch_id` across re-runs.** Forbidden by validation. Re-runs generate new `dispatch_id`s; pairing input/output by ID stays unique.
8. **Setting `effort: xhigh` without `model: opus`.** Validation rejects. `xhigh` is Opus-only.
9. **`scope_files` violation by the Subagent.** The Subagent's resulting Output Packet contains `evidence` of `kind: file` with paths outside `scope_files`. Validation gate marks the Output Packet malformed.
10. **`Agent` tool prompt with the Work Packet inlined as JSON string.** Defeats the pointer convention and pollutes the Subagent's initial context.

## Why this design and not alternatives

- **JSON over Markdown:** same reason as Output Packet — machine-parsing reliability for both orchestrator (writes) and Subagent (reads).
- **Pointer convention vs. inline JSON:** inline JSON in the `Agent` prompt would pollute the Subagent's initial context with the full structure before any work begins; the pointer keeps the entry point minimal and forces the Subagent to read the file (one targeted `Read` call) only when needed.
- **`ac_scope` + `scope_files` as separate fields vs. unified scope object:** ACs and files are orthogonal axes; keeping them separate makes fan-out logic in the orchestrator readable and lets each Role use only what it needs.
- **`previous_findings` in Work Packet vs. shared memory the Subagent reads:** shared memory is the failure mode the framework explicitly avoids (anti-context-pollution; concept #5). Explicit carry in the Work Packet keeps minimal handoff intact.
- **`model` / `effort` override at the Work Packet level vs. session-level config:** Work Packet is the right granularity — overrides apply per dispatch, are auditable in the input file, and revert automatically on the next dispatch. Session-level overrides would silently affect every dispatch.
- **Schema additions (dispatch_id, scope_files, model, previous_findings) vs. fewer fields:** each addition resolves a concrete failure mode documented in earlier concepts. The schema is the minimum that supports all the decisions taken in concepts #1–#6.
