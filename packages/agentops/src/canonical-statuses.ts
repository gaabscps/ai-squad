/**
 * Canonical status and role constants derived from the dispatch-manifest schema.
 *
 * Single source of truth: shared/schemas/dispatch-manifest.schema.json
 * Consumers: agentops report pipeline (guards.ts, types.ts), drift test.
 *
 * Do NOT hardcode status or role strings anywhere else in this package.
 * If the schema enum changes, this module picks it up automatically at
 * compile time (resolveJsonModule) without manual edits here.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import schema from "../../../shared/schemas/dispatch-manifest.schema.json";

// The status field uses anyOf to mark "partial" as deprecated while keeping
// the canonical active values in anyOf[0].enum. We cast through unknown to
// satisfy TypeScript's structural checker while preserving runtime correctness.
const _statusAnyOf = schema.properties.actual_dispatches.items.properties.status
  .anyOf as unknown as Array<{ enum?: string[]; const?: string }>;

// f-002: assert anyOf[0].enum is present and non-empty at module load.
const _activeEnumRaw = _statusAnyOf[0]?.enum;
if (!Array.isArray(_activeEnumRaw) || _activeEnumRaw.length === 0) {
  throw new Error(
    "canonical-statuses: dispatch-manifest schema anyOf[0].enum is missing or empty. " +
      "Schema integrity violated — cannot derive VALID_STATUSES."
  );
}

// f-001: use explicit literal-string tuple assertion so DispatchStatus resolves
// to a literal union, not `string`. We cast the validated runtime array to the
// compile-time tuple type inferred from the schema import.
const _activeStatuses = _activeEnumRaw as typeof _activeEnumRaw & readonly string[];

// f-003: validate every anyOf branch after index 0 has a `const` key.
const _deprecatedBranches = _statusAnyOf.slice(1);
for (let i = 0; i < _deprecatedBranches.length; i++) {
  const branch = _deprecatedBranches[i];
  if (branch === undefined || !("const" in branch) || typeof branch.const !== "string") {
    throw new Error(
      `canonical-statuses: dispatch-manifest schema anyOf[${i + 1}] is missing a string 'const' key. ` +
        "All deprecated status branches must declare a 'const' value."
    );
  }
}
const _deprecatedStatuses = _deprecatedBranches
  .map((v) => v.const)
  .filter((v): v is string => v !== undefined);

export const VALID_STATUSES: readonly string[] = _activeStatuses;
export const DEPRECATED_STATUSES: readonly string[] = _deprecatedStatuses;

// f-004: guard .role.enum is a non-empty array at module load.
const _roleEnumRaw =
  schema.properties.actual_dispatches.items.properties.role.enum as
    | readonly string[]
    | undefined;
if (!Array.isArray(_roleEnumRaw) || _roleEnumRaw.length === 0) {
  throw new Error(
    "canonical-statuses: dispatch-manifest schema role.enum is missing or empty. " +
      "Schema integrity violated — cannot derive VALID_ROLES."
  );
}

export const VALID_ROLES: readonly string[] = _roleEnumRaw;

// Literal-string union types.
// NOTE: because VALID_STATUSES derives from a JSON import (not an `as const`
// array literal), TypeScript widens the element type to `string`. The types
// below therefore resolve to `string` at compile time while the runtime values
// are the exact canonical strings from the schema. Downstream guards narrow
// values via the runtime sets (isValidStatus / isValidRole) rather than relying
// on TS narrowing from these type aliases.
export type DispatchStatus = (typeof VALID_STATUSES)[number];
export type Role = (typeof VALID_ROLES)[number];
