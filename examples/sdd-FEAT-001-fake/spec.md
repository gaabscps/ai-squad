---
id: FEAT-001
status: approved
owner: gabrielandrade
created: 2026-05-03
---

# Spec: Health check endpoint

## Problem

Service operators have no programmatic way to verify the API is up and responding. Manual checks via random endpoints are unreliable and don't return a standard payload that monitoring tools can parse.

## Goal

Provide a dedicated `/health` endpoint that returns service status in a standard JSON format.

## User Scenarios

### US-001 [P1] — Operator queries service health

**As an** operator, **I want** a /health endpoint, **so that** I can verify the service is running and use it as a polling target for monitoring.

**Independent test:** `curl GET /health` returns 200 with valid JSON body containing `status` and `timestamp`.

**Acceptance Criteria (EARS):**

- AC-001: WHEN the operator sends `GET /health` THE SYSTEM SHALL respond with HTTP 200.
- AC-002: WHEN the operator sends `GET /health` THE SYSTEM SHALL return a JSON body containing `{"status": "ok"}`.
- AC-003: WHEN the operator sends `GET /health` THE SYSTEM SHALL include current UTC timestamp in the `timestamp` field of the response body.

## Non-functional Requirements

- NFR-001: /health endpoint responds in under 50ms p99 (verified by load test).

## Success Criteria

- SC-001: Monitoring system polls /health every 30s without timeout for 7 days post-launch.

## Out of Scope

- Authentication for /health (intentionally public for monitoring).
- Detailed dependency health (DB, cache, etc.) — separate /readiness endpoint deferred.

## Constraints

- Stack: Express.js (existing).
- External: (none)
- Other: must not require any new dependencies.

## Assumptions

- Service uses Express's existing routing pattern.
- UTC timestamp via `new Date().toISOString()` is sufficient resolution.

## Open Questions

- (none)

## Notes

- Standard practice across services in this org.
