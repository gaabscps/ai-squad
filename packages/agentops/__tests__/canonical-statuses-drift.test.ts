/**
 * Drift test: Python vs TS canonical status/role lists (AC-004).
 *
 * Guards against re-introducing hardcoded status/role lists in either runtime.
 * Both Python (shared.lib.canonical_statuses) and TS (src/canonical-statuses)
 * must derive their values from the same schema JSON. This test verifies they
 * produce identical sorted lists — and that both match the raw schema.
 *
 * Secondary safety net: T-003 import is the primary barrier (compile-time);
 * this test catches regressions if someone hardcodes values again post-merge.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

import { VALID_STATUSES, VALID_ROLES } from "../src/canonical-statuses";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute path to the repo root (two levels up from packages/agentops). */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Sorted copy of a readonly string array. */
const sorted = (arr: readonly string[]): string[] => [...arr].sort();

// ---------------------------------------------------------------------------
// Python shell-out: read canonical lists from shared.lib.canonical_statuses
// ---------------------------------------------------------------------------

interface PythonCanonical {
  statuses: string[];
  roles: string[];
}

function getPythonCanonical(): PythonCanonical {
  // Use spawnSync with explicit argv to avoid all shell quoting issues.
  // PYTHONPATH is set to repo root so `shared.lib.canonical_statuses` resolves.
  const script = [
    "import json",
    "from shared.lib.canonical_statuses import VALID_STATUSES, VALID_ROLES",
    "print(json.dumps({'statuses': sorted(list(VALID_STATUSES)), 'roles': sorted(list(VALID_ROLES))}))",
  ].join("; ");

  const result = spawnSync("python3", ["-c", script], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // Prepend repo root to PYTHONPATH so `shared.lib` package is importable.
      PYTHONPATH:
        REPO_ROOT +
        (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""),
    },
  });

  if (result.error) {
    throw new Error(`Failed to spawn python3: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `python3 exited with code ${result.status}:\n${result.stderr}`
    );
  }

  return JSON.parse(result.stdout.trim()) as PythonCanonical;
}

// ---------------------------------------------------------------------------
// Schema raw read: extract ground-truth lists directly from the JSON file
// ---------------------------------------------------------------------------

interface SchemaCanonical {
  statuses: string[];
  roles: string[];
}

function getSchemaCanonical(): SchemaCanonical {
  const schemaPath = path.join(
    REPO_ROOT,
    "shared",
    "schemas",
    "dispatch-manifest.schema.json"
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as {
    properties: {
      actual_dispatches: {
        items: {
          properties: {
            status: {
              anyOf: Array<{ enum?: string[]; const?: string; deprecated?: boolean }>;
            };
            role: { enum: string[] };
          };
        };
      };
    };
  };

  const statusProp =
    schema.properties.actual_dispatches.items.properties.status;

  // Extract only non-deprecated status values from anyOf[0].enum
  const anyOfArr = statusProp.anyOf;
  const activeStatuses: string[] = anyOfArr
    .filter((branch) => !branch.deprecated && Array.isArray(branch.enum))
    .flatMap((branch) => branch.enum as string[]);

  const roles: string[] =
    schema.properties.actual_dispatches.items.properties.role.enum;

  return {
    statuses: [...activeStatuses].sort(),
    roles: [...roles].sort(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("canonical-statuses drift: TS vs Python (AC-004)", () => {
  let python: PythonCanonical;
  let schemaRaw: SchemaCanonical;

  beforeAll(() => {
    python = getPythonCanonical();
    schemaRaw = getSchemaCanonical();
  });

  // --- VALID_STATUSES ---

  it("VALID_STATUSES: TS sorted list equals Python sorted list", () => {
    const sortedTs = sorted(VALID_STATUSES);
    const sortedPy = python.statuses; // already sorted by Python
    expect(sortedTs).toEqual(sortedPy);
  });

  it("VALID_STATUSES: TS sorted list equals schema anyOf[0].enum (non-deprecated)", () => {
    const sortedTs = sorted(VALID_STATUSES);
    expect(sortedTs).toEqual(schemaRaw.statuses);
  });

  it("VALID_STATUSES: Python sorted list equals schema anyOf[0].enum (non-deprecated)", () => {
    expect(python.statuses).toEqual(schemaRaw.statuses);
  });

  // --- VALID_ROLES ---

  it("VALID_ROLES: TS sorted list equals Python sorted list", () => {
    const sortedTs = sorted(VALID_ROLES);
    const sortedPy = python.roles; // already sorted by Python
    expect(sortedTs).toEqual(sortedPy);
  });

  it("VALID_ROLES: TS sorted list equals schema role.enum", () => {
    const sortedTs = sorted(VALID_ROLES);
    expect(sortedTs).toEqual(schemaRaw.roles);
  });

  it("VALID_ROLES: Python sorted list equals schema role.enum", () => {
    expect(python.roles).toEqual(schemaRaw.roles);
  });

  // --- Sanity: expected canonical values present ---

  it("VALID_STATUSES contains the 8 canonical active values", () => {
    const expected = [
      "blocked",
      "done",
      "escalate",
      "failed",
      "needs_changes",
      "needs_review",
      "pending",
      "running",
    ];
    expect(sorted(VALID_STATUSES)).toEqual(expected);
  });

  it("VALID_STATUSES does not contain deprecated 'partial'", () => {
    expect(VALID_STATUSES).not.toContain("partial");
    expect(python.statuses).not.toContain("partial");
    expect(schemaRaw.statuses).not.toContain("partial");
  });
});
