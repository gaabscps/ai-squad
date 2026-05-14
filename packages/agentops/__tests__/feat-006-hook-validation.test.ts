/**
 * T-011: End-to-end hook validation tests (AC-011, AC-012, AC-013).
 *
 * Shells out to Python to exercise verify-output-packet.py directly via
 * its --check-only <path> CLI mode. This avoids needing a real Claude Code
 * transcript while still exercising the full hook code path including the
 * canonical_statuses import.
 *
 * AC-013 mechanism — env-override monkeypatch:
 *   The hook resolves `canonical_statuses` via sys.path: it inserts
 *   `.claude/hooks/` at index 0, then PYTHONPATH entries come next, and
 *   finally appends `shared/lib/`. Since `.claude/hooks/` has no
 *   `canonical_statuses.py`, a fake module placed in a tmpdir that is
 *   prepended to PYTHONPATH shadows the real `shared/lib/canonical_statuses`
 *   without any edit to the hook or the real helper. This satisfies AC-013
 *   ("enum extension recognized without hook code edit").
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Absolute path to the repo root (two levels up from packages/agentops). */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Path to the hook under test. */
const HOOK_PATH = path.join(REPO_ROOT, ".claude", "hooks", "verify-output-packet.py");

/**
 * Minimal valid Output Packet that satisfies every REQUIRED_FIELDS check
 * in the hook (spec_id, dispatch_id, role, status, summary, evidence) plus
 * the 'usage' field required by _validate_usage_field for non-pm-orchestrator
 * roles. The `status` field is overridden per test.
 */
function makePacket(status: string): Record<string, unknown> {
  return {
    spec_id: "FEAT-006",
    dispatch_id: "d-T-011-dev-l1",
    role: "dev",
    status,
    summary: "hook validation test packet",
    evidence: [],
    files_changed: [],
    usage: null,
  };
}

/**
 * Write a packet JSON to a temp directory and return the file path.
 * The file is named `<dispatch_id>.json` so the hook's dispatch_id derivation
 * from the stem matches the embedded dispatch_id field.
 */
function writePacket(
  dir: string,
  packet: Record<string, unknown>
): string {
  const dispatchId = packet["dispatch_id"] as string;
  const filePath = path.join(dir, `${dispatchId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(packet, null, 2), "utf-8");
  return filePath;
}

/**
 * Run verify-output-packet.py --check-only <packetPath> and return the result.
 * Extra env vars (if any) are merged on top of the current process env.
 */
function runHookCheckOnly(
  packetPath: string,
  extraEnv: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    "python3",
    [HOOK_PATH, "--check-only", packetPath],
    {
      encoding: "utf-8",
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
    }
  );

  if (result.error) {
    throw new Error(`Failed to spawn python3: ${result.error.message}`);
  }

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Shared temp dir (created/cleaned per describe block)
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feat-006-hook-validation-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC-011: valid status "done" → hook exits 0
// ---------------------------------------------------------------------------

describe('AC-011: Output Packet with status "done" is accepted (exit 0)', () => {
  it("exits 0 for status=done", () => {
    const packet = makePacket("done");
    const packetPath = writePacket(tmpDir, packet);

    const { exitCode, stdout } = runHookCheckOnly(packetPath);

    expect(exitCode).toBe(0);
    // Confirm the hook's JSON output signals validity.
    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.dispatch_id).toBe("d-T-011-dev-l1");
  });

  it("exits 0 for all canonical status values", () => {
    // Every value in the current canonical enum must be accepted without error.
    const canonicalStatuses = [
      "pending",
      "running",
      "done",
      "needs_review",
      "needs_changes",
      "blocked",
      "escalate",
      "failed",
    ];

    for (const status of canonicalStatuses) {
      // Each packet needs a unique dispatch_id so file names don't collide.
      const packet = { ...makePacket(status), dispatch_id: `d-status-${status}` };
      const packetPath = writePacket(tmpDir, packet);

      const { exitCode, stdout } = runHookCheckOnly(packetPath);
      const parsed = JSON.parse(stdout);

      expect({ status, exitCode, valid: parsed.valid }).toEqual({
        status,
        exitCode: 0,
        valid: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-012: invalid status "completed" → exit ≠ 0; error message cites value + list
// ---------------------------------------------------------------------------

describe('AC-012: Output Packet with status "completed" is rejected (exit ≠ 0)', () => {
  it("exits non-zero for status=completed", () => {
    const packet = { ...makePacket("completed"), dispatch_id: "d-status-completed" };
    const packetPath = writePacket(tmpDir, packet);

    const { exitCode } = runHookCheckOnly(packetPath);

    expect(exitCode).not.toBe(0);
  });

  it("error output contains the received invalid status value", () => {
    const packet = { ...makePacket("completed"), dispatch_id: "d-status-completed" };
    const packetPath = writePacket(tmpDir, packet);

    const { stdout } = runHookCheckOnly(packetPath);

    // The hook emits a JSON error to stdout (--check-only mode).
    // The error string must cite the received status value.
    expect(stdout).toContain("completed");
  });

  it("error output contains the canonical valid status list", () => {
    const packet = { ...makePacket("completed"), dispatch_id: "d-status-completed" };
    const packetPath = writePacket(tmpDir, packet);

    const { stdout } = runHookCheckOnly(packetPath);

    // The canonical list is formatted as comma-separated sorted values.
    // Verify several canonical values appear in the error message.
    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("completed"); // received value
    expect(parsed.error).toContain("done");       // sample canonical value
    expect(parsed.error).toContain("blocked");    // sample canonical value
    expect(parsed.error).toContain("escalate");   // sample canonical value
  });

  it("error output marks the packet as invalid", () => {
    const packet = { ...makePacket("completed"), dispatch_id: "d-status-completed" };
    const packetPath = writePacket(tmpDir, packet);

    const { stdout } = runHookCheckOnly(packetPath);

    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(false);
    expect(parsed.dispatch_id).toBe("d-status-completed");
  });
});

// ---------------------------------------------------------------------------
// AC-013: enum extension via monkeypatch — no hook code edit required
//
// Mechanism: PYTHONPATH-override monkeypatch.
//   1. Write a fake `canonical_statuses.py` to a temp dir that extends the
//      real VALID_STATUSES with "timeout".
//   2. Prepend that temp dir to PYTHONPATH when running the hook.
//   3. The hook's sys.path resolution finds the fake module BEFORE shared/lib
//      (because PYTHONPATH entries precede the appended shared/lib path).
//   4. The hook then accepts "timeout" as valid — without any edit to the hook.
// ---------------------------------------------------------------------------

describe("AC-013: enum extension recognized without hook code edit", () => {
  let fakeLibDir: string;

  beforeAll(() => {
    // Create a separate temp dir for the fake canonical_statuses module.
    fakeLibDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "feat-006-fake-canonical-")
    );

    // Write a fake canonical_statuses.py that includes "timeout" in VALID_STATUSES.
    // This simulates a schema enum extension without modifying any hook code.
    // The real canonical set plus "timeout" is the union exposed here.
    const fakeModule = [
      "# AC-013 monkeypatch: fake canonical_statuses with 'timeout' added.",
      "# This module shadows shared/lib/canonical_statuses.py via PYTHONPATH override.",
      "VALID_STATUSES = frozenset({",
      '    "pending", "running", "done", "needs_review",',
      '    "needs_changes", "blocked", "escalate", "failed",',
      '    "timeout",  # extended value under test',
      "})",
      "VALID_ROLES = frozenset({",
      '    "dev", "code-reviewer", "logic-reviewer", "qa",',
      '    "blocker-specialist", "audit-agent", "committer",',
      "})",
      "def format_valid_list(values):",
      '    return ", ".join(sorted(values))',
    ].join("\n");

    fs.writeFileSync(
      path.join(fakeLibDir, "canonical_statuses.py"),
      fakeModule,
      "utf-8"
    );
  });

  afterAll(() => {
    fs.rmSync(fakeLibDir, { recursive: true, force: true });
  });

  it('hook accepts "timeout" when the fake canonical module includes it', () => {
    const packet = { ...makePacket("timeout"), dispatch_id: "d-status-timeout" };
    const packetPath = writePacket(tmpDir, packet);

    // Prepend fakeLibDir to PYTHONPATH so it shadows shared/lib.
    const existingPythonPath = process.env["PYTHONPATH"] ?? "";
    const extendedPythonPath = fakeLibDir + (existingPythonPath ? `:${existingPythonPath}` : "");

    const { exitCode, stdout } = runHookCheckOnly(packetPath, {
      PYTHONPATH: extendedPythonPath,
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(true);
  });

  it('hook still rejects "completed" even with the extended fake canonical module', () => {
    // Sanity: "completed" is not in the extended set either — hook should still reject.
    const packet = { ...makePacket("completed"), dispatch_id: "d-status-completed-v2" };
    const packetPath = writePacket(tmpDir, packet);

    const existingPythonPath = process.env["PYTHONPATH"] ?? "";
    const extendedPythonPath = fakeLibDir + (existingPythonPath ? `:${existingPythonPath}` : "");

    const { exitCode } = runHookCheckOnly(packetPath, {
      PYTHONPATH: extendedPythonPath,
    });

    expect(exitCode).not.toBe(0);
  });

  it('hook rejects "timeout" without the fake module (real canonical does not include it)', () => {
    // Confirm "timeout" is invalid under the real canonical set — baseline for AC-013.
    const packet = { ...makePacket("timeout"), dispatch_id: "d-status-timeout-baseline" };
    const packetPath = writePacket(tmpDir, packet);

    // No PYTHONPATH override — uses real shared/lib/canonical_statuses.py.
    const { exitCode } = runHookCheckOnly(packetPath);

    expect(exitCode).not.toBe(0);
  });
});
