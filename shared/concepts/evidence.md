# Concept — `Evidence`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), [`spec.md`](spec.md). Consumed by [`output-packet.md`](output-packet.md) (concept #6).

## Definition

**Evidence** is a typed pointer to verifiable proof of work, attached to every Output Packet a Subagent emits. Each item is one of 7 canonical `kind`s, follows a fixed schema for that kind, and addresses content that lives outside the packet (in the repo, in `.agent-session/`, or in an external system) — never inline.

Evidence is what separates "the agent says it's done" from "the agent has shown it's done in a way another agent or human can independently verify."

> *Terms used in this doc:*
> - **pointer:** a lightweight reference to something verifiable outside the payload — a file path with line range, a command with exit code, a commit SHA. Carries the address, never the content.
> - **anti-context-pollution:** a design pattern that avoids inflating prompts or output payloads with raw content that can be referenced by pointer. Consensus pattern documented in *Why Do Multi-Agent LLM Systems Fail?* (Cemri et al., 2025) — semantic distance between original intent and current context grows monotonically when agents pile content into payloads.
> - **verifiable proof:** proof another agent or human can check deterministically — open the file, run the command, look up the commit. Not "trust me, I did it."
> - **absence proof / negative evidence:** evidence that something is NOT present where it shouldn't be. Critical for validating EARS criteria of the form `IF <unwanted> THEN <mitigation>` and for confirming reviewers' "X was removed" claims.

## Why Evidence is the framework's fidelity lever

Three properties make Evidence load-bearing:

1. **It is the only mechanism that preserves fidelity across Subagent boundaries.** Subagents return only a final summary to the parent (platform constraint). Without structured evidence, the orchestrator and downstream reviewers must trust prose — which compounds vagueness.
2. **It is the gate the `qa` Subagent runs against the Spec.** Every acceptance criterion (`AC-XXX`) in the Spec must produce at least one matching evidence in `qa`'s Output Packet. No matching evidence = `qa` returns `status: blocked`.
3. **It enables the "subagent bypass" pattern documented by Anthropic Research:** Subagents write evidence directly to the filesystem; the orchestrator receives only ack + pointer. This bypass is what cuts coordination overhead while preserving full fidelity.

## The 7 canonical kinds

Closed enum. Adding a kind is a minor version bump (non-breaking). Removing or changing semantics of a kind is breaking.

| `kind` | Use for |
|--------|---------|
| `file` | A repo file that was created, modified, or read as reference for a finding. |
| `command` | A shell command that was executed (build, test runner, lint, custom script). |
| `commit` | A git commit produced as part of the dispatch. |
| `test` | The result of one named test (passed/failed/skipped). |
| `log` | A captured output stream (command stdout, runtime log). |
| `url` | An external URL visited or created (PR, deploy, dashboard, screenshot host). |
| `absence` | Negative proof — something is NOT present where unwanted. |

### Schema per kind

All evidences share `kind` (string, required, must be one of the 7). All evidences may carry an optional `id` field (string, format `EV-XXX`, monotonic per Output Packet) — generally optional, but **required** when the evidence is referenced by the Output Packet's `ac_coverage` field (see [`output-packet.md`](output-packet.md#ac_coverage-qa-specific)). The other fields are kind-specific.

#### `file`
```json
{ "kind": "file", "path": "src/auth/login.ts", "lines": "12-44", "reason": "added error handling" }
```
- **Required:** `path` (relative to repo root).
- **Optional:** `lines` (range `"12-44"` or list `"12,15,20"`); `reason` (one-line why this file matters to the finding).

#### `command`
```json
{ "kind": "command", "cmd": "yarn test src/auth/login.test.ts", "exit_code": 0, "log_path": ".agent-session/FEAT-042/logs/dev-1740832192.log", "duration_ms": 4210 }
```
- **Required:** `cmd` (the exact command run); `exit_code` (integer).
- **Optional:** `log_path` (where stdout+stderr was captured); `duration_ms`.

#### `commit`
```json
{ "kind": "commit", "sha": "abc1234", "message": "feat: add password reset flow", "files_changed": ["src/auth/reset.ts", "src/auth/reset.test.ts"] }
```
- **Required:** `sha` (full or short SHA — short preferred for readability).
- **Optional:** `message`; `files_changed` (array of paths).

#### `test`
```json
{ "kind": "test", "name": "POST /reset returns 410 when token expired", "status": "passed", "output_path": ".agent-session/FEAT-042/tests/reset-expired.log", "ac_ref": "FEAT-042/AC-003", "duration_ms": 120 }
```
- **Required:** `name` (the test identifier); `status` (`passed | failed | skipped`).
- **Optional:** `output_path`; `ac_ref` (which acceptance criterion this test covers — strongly recommended for `qa`'s output); `duration_ms`.

#### `log`
```json
{ "kind": "log", "path": ".agent-session/FEAT-042/logs/build.log", "pattern_matched": "ERROR.*type mismatch", "line_range": "240-244" }
```
- **Required:** `path` (location of the log file).
- **Optional:** `pattern_matched` (regex or literal that justifies citing this log); `line_range`.

#### `url`
```json
{ "kind": "url", "url": "https://github.com/org/repo/pull/512", "title": "feat: password reset flow", "snapshot_path": ".agent-session/FEAT-042/snapshots/pr-512.html" }
```
- **Required:** `url`.
- **Optional:** `title`; `snapshot_path` (local copy of page or screenshot — useful when the URL might change).

#### `absence`
```json
{ "kind": "absence", "checked": "presence of 'token expired' in /api/login success response", "expected_not_present": "token expired", "method": "grep on response body captured by test 'POST /login returns 200 on valid'", "location": ".agent-session/FEAT-042/tests/login-valid.log" }
```
- **Required:** `checked` (one-sentence statement of what was verified); `expected_not_present` (the literal/pattern that must NOT appear).
- **Optional:** `method` (how absence was verified); `location` (where the check was run).

## The "pointers, never content" rule

Output Packets carry pointers, **never** raw content. No previews, no excerpts, no "first 200 chars."

**Why:** every byte of inline content in an Output Packet is a byte of context the orchestrator (and downstream Subagents) must process. Across N dispatches with M evidence each, inline content compounds quadratically. Inline previews look harmless individually and are catastrophic in aggregate — see *Why Do Multi-Agent LLM Systems Fail?* on monotonic context-distance growth.

If a downstream consumer needs the actual content (the lines of the file, the body of the log), it uses the pointer to read it on demand. The cost of one targeted read > the cost of carrying that content through the entire Pipeline.

The **only** field that may carry short prose is `reason` (on `file` evidence) or `message` (on `commit` evidence) — both capped at one short line by convention.

## FS layout

Evidence pointers map to two locations, by kind:

| Kind | Path target |
|------|-------------|
| `file`, `commit` | Repo files (relative to repo root). The repo is the artifact; evidence references it directly. |
| `command`, `log`, `test` (output_path) | `.agent-session/<task_id>/logs/<role>-<timestamp>.log` — gitignored, ephemeral within the session. |
| `url` (snapshot_path) | `.agent-session/<task_id>/snapshots/<descriptive-name>.<ext>` — when the external URL might change. |
| `absence` (location) | Either repo path or `.agent-session/`, depending on what was checked. |

The `.agent-session/<task_id>/` directory is created by the `spec-writer` Skill at Phase 1 entry, gitignored via the consumer project's root `.gitignore`, and survives until the human runs `/ship FEAT-XXX` after accepting the handoff. Subagents write into it as part of each Phase 4 dispatch.

## Verifiability rule

All evidence must be **programmatically verifiable** — another agent or a human can run the command, open the file, fetch the URL, or grep the log to confirm the claim.

Subjective evidence ("the screenshot looks correct", "the UX feels intuitive") is forbidden. Screenshots themselves are valid evidence (`kind: file` pointing to a `.png` saved under `.agent-session/`), but interpretation of that screenshot is the **human's** job at handoff — not the `qa` Subagent's, and never substitute for an automated check.

If an acceptance criterion in the Spec genuinely requires subjective judgment, that is a **gap in the Spec**, not in `qa`. The blocker-specialist (or the human via escalation) handles it.

## The cap is per Output Packet — orchestrator aggregation is uncapped

Each Output Packet may carry **at most 50 evidences**. This cap applies only to Subagents (the only Roles that emit Output Packets). The orchestrator is exempt by definition: as a Skill, it does not emit Output Packets — it consumes them.

A typical dispatch might produce:

```
dev (fan_out: 3) → 3 Output Packets × ~15 evidences each   = ~45
code-reviewer    → 1 Output Packet × ~12 evidences         = ~12
logic-reviewer   → 1 Output Packet × ~12 evidences         = ~12
qa               → 1 Output Packet × ~25 evidences         = ~25
                                                            ─────
                                            orchestrator    = ~94 aggregated, no ceiling
```

The orchestrator aggregates the full set into the Session state file (`.agent-session/<task_id>.yml`) and into the final handoff message to the human. Both reflect everything; nothing is dropped.

**When a Subagent's Output Packet hits the 50-evidence cap, treat it as architectural diagnosis, not operational error:** the Work Packet for that dispatch was too broad. The fix is to decompose via `fan_out` (split the Work Packet into N write-disjoint sub-packets, each dispatched to a separate instance of the Role), not to remove the cap. The cap is a useful pressure signal.

## Cross-Subagent evidence chain

Reviewers and `qa` cite evidence emitted upstream by `dev` — the chain stays compact and traceable without duplicating content.

Example chain for one acceptance criterion (`FEAT-042/AC-003`):

```
dev's Output Packet:
  evidence:
    - { kind: "file", path: "src/auth/reset.ts", lines: "44-58", reason: "expiry check" }
    - { kind: "commit", sha: "abc1234", message: "feat: add token expiry check" }
    - { kind: "test", name: "POST /reset returns 410 when token expired", status: "passed", ac_ref: "FEAT-042/AC-003" }

logic-reviewer's Output Packet:
  evidence:
    - { kind: "file", path: "src/auth/reset.ts", lines: "52" }       # zooms into a specific line dev introduced
  findings:
    - { ac_ref: "FEAT-042/AC-003", concern: "expiry check uses < instead of <=, off-by-one at exact expiry instant" }

qa's Output Packet:
  evidence:
    - { kind: "test", name: "POST /reset at exact expiry instant", status: "failed", ac_ref: "FEAT-042/AC-003" }
    - { kind: "log", path: ".agent-session/FEAT-042/tests/reset-edge.log", pattern_matched: "expected 410, got 200" }
  status: needs_review
```

The orchestrator routes back to `dev` with the logic-reviewer's finding and the `qa` test as Work Packet input — `dev` knows exactly what to fix, with pointers, without inline content.

## How `qa` consumes Evidence

`qa` is the only Subagent whose work is structured as `evidence-per-acceptance-criterion`. Its Output Packet must contain, for every `AC-XXX` listed in the Spec section the dispatch covers, at least one evidence whose `ac_ref` field matches.

**Pass:** all `AC-XXX` from Spec have ≥1 matching evidence with `status: passed` (for `kind: test`) or equivalent positive evidence for non-test criteria. `qa` returns `status: done`.

**Fail:** at least one `AC-XXX` has matching evidence with `status: failed` or has no matching evidence at all. `qa` returns `status: needs_review` with the failing AC list.

**Block:** an `AC-XXX` cannot be validated programmatically (Spec gap, infrastructure missing, environment unavailable). `qa` returns `status: blocked` and the orchestrator escalates.

## Anti-patterns

1. **Textual evidence without pointers.** `"All tests pass"`, `"Implementation is correct"`, `"No regressions found"` — invalid. Reject the Output Packet.
2. **`kind` outside the 7-element enum.** `"kind": "approval"`, `"kind": "design-decision"` — extend the framework or use an existing kind. Custom kinds break orchestrator and `qa` parsing.
3. **Required fields missing.** A `command` evidence without `exit_code`; a `test` evidence without `status`; an `absence` without `expected_not_present` — invalid.
4. **Subjective evidence.** `"screenshot looks good"`, `"feels fast enough"`. The screenshot itself is fine as `kind: file`; the subjective interpretation is not.
5. **Inline content under a "preview" field.** No such field exists in any kind's schema. Adding it informally is the start of context-pollution drift.
6. **Same content duplicated across kinds.** Don't emit `{kind: file, path: ...}` AND `{kind: log, path: same path}` for the same artifact. One evidence per artifact, picking the most descriptive kind.
7. **Mixing roles' evidence.** A reviewer copying `dev`'s evidence verbatim into its own Output Packet — wasteful. Reviewers cite `dev`'s evidence by reference (the orchestrator already has it from the previous dispatch's packet); reviewers add only their own observations.
8. **Hitting the cap of 50 and expanding the cap.** If a Subagent reliably hits 50, the dispatch was too broad. Decompose with `fan_out`.

## Why this design and not alternatives

- **Closed kind enum vs. open strings:** open strings would let each Role invent its own evidence shapes; `qa` and orchestrator could not parse reliably. Closed enum is the same opinionated pattern as closed Role list.
- **Pointers only vs. preview-allowed:** preview-allowed seduces toward "just a few more chars" until inline becomes the default. Pointers-only is the only defensible hard rule against context pollution.
- **Per-Output-Packet cap vs. per-Role or per-Pipeline cap:** per-Role caps would drift as Roles change responsibilities; per-Pipeline cap penalizes legitimate large features. Per-Output-Packet is the smallest unit that catches the over-scope diagnostic.
- **Programmatic verifiability vs. allow-subjective:** allowing subjective evidence puts `qa` in the position of judging quality, which is not its role and which it cannot do reliably. Subjectivity belongs to the human at handoff.
