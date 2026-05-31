# Concept — `output_locale`

> Status: canonical. Companion to [`work-packet.md`](work-packet.md), [`output-packet.md`](output-packet.md), [`session.md`](session.md). Governs the language of all human-facing prose produced by Roles.

## Definition

`output_locale` is a single per-Session value that determines the **language of
every piece of free prose a Role generates for eventual human reading**. It is a
BCP-47 language tag (e.g. `pt-BR`, `en-US`, `es-ES`), stored once in
`session.yml`, and carried to each stateless Subagent via the Work Packet.

It does NOT translate machine tokens. Enums (`status`, `severity`, `kind`,
`role`, `blocker_kind`) and identifiers (`spec_id`, `task_id`, AC refs,
`dispatch_id`, file paths) stay canonical (English) — the orchestrator routes on
them, and the report keys CSS/lookup on them.

## The rule

> **Every field a Role writes as free prose for eventual human reading follows
> `output_locale`. Machine tokens do not.**

- **Follow the locale:** `summary`, `findings[].rationale`/`message`,
  `blockers[].reason`/`what_was_attempted`/`what_is_needed`, `notes`,
  `evidence[].reason`, and the orchestrator's `handoff.md`.
- **Stay canonical (English):** the enums and identifiers listed above.
- **AC text:** authored by the human in Phase 1 (already in their language); no
  Role translates it. A Role that paraphrases an AC inside a finding does so in
  the locale via the prose rule. The AC ref is an identifier and stays canonical.

## Format

BCP-47 with a hyphen separator: `pt-BR`, `en-US`, `es`. Underscore (`pt_BR`) is
non-canonical — normalize to hyphen at write time (spec-writer). A bare language
subtag (`en`, `pt`) is valid when region is irrelevant.

## Render the tag to an explicit instruction

A Role MUST NOT assume the model parses the raw tag. Each Role's prompt renders
the tag into an explicit language instruction — e.g. `pt-BR` → "Write all
human-facing prose in Brazilian Portuguese (pt-BR)." The tag is the stable stored
key; the rendered sentence is what steers generation.

## Fallback

When `output_locale` is absent or unreadable (legacy Sessions created before this
field; detection failure), the value is **`en`**, deterministically. This is a
documented, overridable neutral default — not a project-language assumption.
English is also already the canonical language of the enum/identifier layer.
Read-compat mirrors the `pipeline_mode` pattern: readers default on absence.

## Where it lives and flows

- **Source of truth:** `session.yml.output_locale`. Acquired by `spec-writer`
  (Phase 1) — detected from the conversation, confirmed with the human, written.
- **To Subagents:** the orchestrator copies it into the **stable block** of every
  Work Packet (cache-friendly prefix). Subagents read it and apply the rule.
- **To `handoff.md`:** the orchestrator (an LLM Skill) reads it from `session.yml`
  and writes the handoff prose directly in the locale.
- **To the HTML report (`session_report.py`):** NOT consumed. The report's fixed
  labels are English (tool chrome); the dynamic agent prose embedded in it already
  arrives localized from the Output Packets — the stdlib generator just passes it
  through (it has no LLM and cannot translate).

## Why this design and not alternatives

- **Single value in `session.yml` vs. per-dispatch detection:** Phase 4 Subagents
  are stateless and have no conversation to detect from; the value must be
  persisted once and carried.
- **Work Packet field vs. `constraints`/`project_context`:** a dedicated field is
  structured and auditable; `constraints` is stringly-typed; `project_context` is
  about the host stack, not output preference.
- **English fallback vs. re-detect:** re-detecting from already-English prose is
  circular; a deterministic floor is the whole point.
- **Fixed-English report chrome vs. a message catalog:** a catalog is a lot of i18n
  machinery for low value right now; English chrome is the neutral canonical. A
  configurable catalog is a registered future evolution.
