#!/bin/bash
# Smoke walkthrough — validates the example FEAT-001-fake artifact set parses
# and cross-references resolve. Catches structural contract drift between
# Skills/Subagents/templates without requiring actual Claude Code dispatch.
#
# Usage: ./scripts/smoke-walkthrough.sh
# Exit 0 if all checks pass; non-zero otherwise.

set +e  # don't exit on individual check failure — we tally and report

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$REPO_ROOT/examples/FEAT-001-fake"

PASS=0
FAIL=0

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== ai-squad smoke walkthrough — FEAT-001-fake ==="
echo ""

echo "[Phase 1] Spec exists and parses"
check "spec.md exists" "[ -f '$EXAMPLE/spec.md' ]"
check "spec.md has approved status" "grep -q 'status: approved' '$EXAMPLE/spec.md'"
check "spec.md has at least one US-XXX" "grep -qE 'US-[0-9]{3}' '$EXAMPLE/spec.md'"
check "spec.md has at least one AC-XXX" "grep -qE 'AC-[0-9]{3}' '$EXAMPLE/spec.md'"

echo ""
echo "[Phase 2] Plan exists and parses"
check "plan.md exists" "[ -f '$EXAMPLE/plan.md' ]"
check "plan.md has approved status" "grep -q 'status: approved' '$EXAMPLE/plan.md'"
check "plan.md has 5 risk categories" "[ \$(grep -cE '^### (Security|Performance|Migration|Backwards|Regulatory)' '$EXAMPLE/plan.md') -eq 5 ]"
check "plan.md has AC Coverage Map" "grep -q '## AC Coverage Map' '$EXAMPLE/plan.md'"

echo ""
echo "[Phase 3] Tasks exist and parse"
check "tasks.md exists" "[ -f '$EXAMPLE/tasks.md' ]"
check "tasks.md has approved status" "grep -q 'status: approved' '$EXAMPLE/tasks.md'"
check "tasks.md has at least one T-XXX" "grep -qE '## T-[0-9]{3}' '$EXAMPLE/tasks.md'"
check "tasks.md has Files: field" "grep -q 'Files:' '$EXAMPLE/tasks.md'"
check "tasks.md has AC covered: field" "grep -q 'AC covered:' '$EXAMPLE/tasks.md'"

echo ""
echo "[Phase 4] Session + Inputs + Outputs + Handoff"
check "session.yml exists" "[ -f '$EXAMPLE/session.yml' ]"
check "session.yml is valid YAML" "python3 -c \"import yaml; yaml.safe_load(open('$EXAMPLE/session.yml'))\""
check "session.yml has task_states populated" "python3 -c \"import yaml; assert yaml.safe_load(open('$EXAMPLE/session.yml')).get('task_states')\""
check "inputs/ has at least one dispatch" "ls '$EXAMPLE'/inputs/*.json"
check "outputs/ has at least one dispatch" "ls '$EXAMPLE'/outputs/*.json"
check "handoff.md exists" "[ -f '$EXAMPLE/handoff.md' ]"

echo ""
echo "[Schema] Output Packets parse as JSON (shape via canonical schema if ajv available)"
for op in "$EXAMPLE"/outputs/*.json; do
  name=$(basename "$op")
  check "$name parses as JSON" "python3 -m json.tool '$op'"
done
if command -v npx >/dev/null 2>&1; then
  for op in "$EXAMPLE"/outputs/*.json; do
    name=$(basename "$op")
    check "$name validates against output-packet.schema.json (ajv)" "npx -y -p ajv-cli ajv validate -s '$REPO_ROOT/templates/output-packet.schema.json' -d '$op'"
  done
fi

echo ""
echo "[Cross-ref] Spec ACs are covered by Tasks"
spec_acs=$(grep -oE 'AC-[0-9]{3}' "$EXAMPLE/spec.md" | sort -u)
tasks_acs=$(grep -oE 'AC-[0-9]{3}' "$EXAMPLE/tasks.md" | sort -u)
for ac in $spec_acs; do
  check "Spec $ac appears in tasks.md" "grep -q '$ac' '$EXAMPLE/tasks.md'"
done

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="

[ $FAIL -eq 0 ]
