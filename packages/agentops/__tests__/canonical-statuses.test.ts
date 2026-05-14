/**
 * Tests for canonical-statuses.ts
 * AC-003: VALID_STATUSES derived from schema; types resolve correctly.
 * AC-004: Module throws at load time on schema integrity violations (fail-fast).
 */

import {
  VALID_STATUSES,
  DEPRECATED_STATUSES,
  VALID_ROLES,
} from "../src/canonical-statuses";

// ---------------------------------------------------------------------------
// AC-003 — runtime values match schema
// ---------------------------------------------------------------------------

describe("VALID_STATUSES", () => {
  it("is a non-empty readonly array", () => {
    expect(Array.isArray(VALID_STATUSES)).toBe(true);
    expect(VALID_STATUSES.length).toBeGreaterThan(0);
  });

  it("contains all canonical active status values from schema anyOf[0]", () => {
    const expected = [
      "pending",
      "running",
      "done",
      "needs_review",
      "needs_changes",
      "blocked",
      "escalate",
      "failed",
    ];
    expect([...VALID_STATUSES].sort()).toEqual(expected.sort());
  });

  it("does not include deprecated status 'partial'", () => {
    expect(VALID_STATUSES).not.toContain("partial");
  });
});

describe("DEPRECATED_STATUSES", () => {
  it("is a readonly array", () => {
    expect(Array.isArray(DEPRECATED_STATUSES)).toBe(true);
  });

  it("contains 'partial' as the only deprecated value", () => {
    expect(DEPRECATED_STATUSES).toContain("partial");
    // schema has exactly one deprecated branch currently
    expect(DEPRECATED_STATUSES.length).toBe(1);
  });
});

describe("VALID_ROLES", () => {
  it("is a non-empty readonly array", () => {
    expect(Array.isArray(VALID_ROLES)).toBe(true);
    expect(VALID_ROLES.length).toBeGreaterThan(0);
  });

  it("contains at minimum the core SDD roles", () => {
    const coreRoles = ["dev", "code-reviewer", "logic-reviewer", "qa"];
    for (const r of coreRoles) {
      expect(VALID_ROLES).toContain(r);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-004 — fail-fast guards (jest.isolateModules + mock to simulate bad schema)
// ---------------------------------------------------------------------------

describe("module-load guards (AC-004)", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("f-002: throws if anyOf[0].enum is missing", () => {
    jest.mock("../../../shared/schemas/dispatch-manifest.schema.json", () => ({
      properties: {
        actual_dispatches: {
          items: {
            properties: {
              status: {
                anyOf: [
                  // missing enum key
                  { type: "string" },
                  { type: "string", const: "partial" },
                ],
              },
              role: { enum: ["dev", "code-reviewer"] },
            },
          },
        },
      },
    }));

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../src/canonical-statuses");
      });
    }).toThrow(/anyOf\[0\]\.enum is missing or empty/);
  });

  it("f-002: throws if anyOf[0].enum is empty array", () => {
    jest.mock("../../../shared/schemas/dispatch-manifest.schema.json", () => ({
      properties: {
        actual_dispatches: {
          items: {
            properties: {
              status: {
                anyOf: [
                  { type: "string", enum: [] },
                  { type: "string", const: "partial" },
                ],
              },
              role: { enum: ["dev"] },
            },
          },
        },
      },
    }));

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../src/canonical-statuses");
      });
    }).toThrow(/anyOf\[0\]\.enum is missing or empty/);
  });

  it("f-003: throws if a deprecated branch lacks a const key", () => {
    jest.mock("../../../shared/schemas/dispatch-manifest.schema.json", () => ({
      properties: {
        actual_dispatches: {
          items: {
            properties: {
              status: {
                anyOf: [
                  { type: "string", enum: ["done", "blocked"] },
                  // missing const — has type only
                  { type: "string" },
                ],
              },
              role: { enum: ["dev"] },
            },
          },
        },
      },
    }));

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../src/canonical-statuses");
      });
    }).toThrow(/anyOf\[1\] is missing a string 'const' key/);
  });

  it("f-004: throws if role.enum is missing", () => {
    jest.mock("../../../shared/schemas/dispatch-manifest.schema.json", () => ({
      properties: {
        actual_dispatches: {
          items: {
            properties: {
              status: {
                anyOf: [
                  { type: "string", enum: ["done"] },
                  { type: "string", const: "partial" },
                ],
              },
              role: {
                // no enum key
                type: "string",
              },
            },
          },
        },
      },
    }));

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../src/canonical-statuses");
      });
    }).toThrow(/role\.enum is missing or empty/);
  });

  it("f-004: throws if role.enum is empty", () => {
    jest.mock("../../../shared/schemas/dispatch-manifest.schema.json", () => ({
      properties: {
        actual_dispatches: {
          items: {
            properties: {
              status: {
                anyOf: [
                  { type: "string", enum: ["done"] },
                  { type: "string", const: "partial" },
                ],
              },
              role: { enum: [] },
            },
          },
        },
      },
    }));

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../src/canonical-statuses");
      });
    }).toThrow(/role\.enum is missing or empty/);
  });
});
