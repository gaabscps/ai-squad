#!/bin/bash
# Smoke walkthrough — validates the example artifact sets parse and
# cross-references resolve. Catches structural contract drift between
# Skills/Subagents/templates without requiring actual Claude Code dispatch.
#
# Covers both squads:
#   examples/sdd-FEAT-001-fake/         — SDD squad (4 Phases)
#   examples/discovery-DISC-001-fake/   — Discovery squad (3 Phases)
#
# Usage: ./scripts/smoke-walkthrough.sh
# Exit 0 if all checks pass; non-zero otherwise.

set +e  # don't exit on individual check failure — we tally and report

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDD_EXAMPLE="$REPO_ROOT/examples/sdd-FEAT-001-fake"
DISC_EXAMPLE="$REPO_ROOT/examples/discovery-DISC-001-fake"
SCHEMA="$REPO_ROOT/shared/schemas/output-packet.schema.json"

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

echo "=== ai-squad smoke walkthrough ==="
echo ""

# ============================================================
# SDD squad — sdd-FEAT-001-fake
# ============================================================
echo "### SDD squad — sdd-FEAT-001-fake ###"
echo ""

echo "[Phase 1] Spec exists and parses"
check "spec.md exists" "[ -f '$SDD_EXAMPLE/spec.md' ]"
check "spec.md has approved status" "grep -q 'status: approved' '$SDD_EXAMPLE/spec.md'"
check "spec.md has at least one US-XXX" "grep -qE 'US-[0-9]{3}' '$SDD_EXAMPLE/spec.md'"
check "spec.md has at least one AC-XXX" "grep -qE 'AC-[0-9]{3}' '$SDD_EXAMPLE/spec.md'"

echo ""
echo "[Phase 2] Plan exists and parses"
check "plan.md exists" "[ -f '$SDD_EXAMPLE/plan.md' ]"
check "plan.md has approved status" "grep -q 'status: approved' '$SDD_EXAMPLE/plan.md'"
check "plan.md has 5 risk categories" "[ \$(grep -cE '^### (Security|Performance|Migration|Backwards|Regulatory)' '$SDD_EXAMPLE/plan.md') -eq 5 ]"
check "plan.md has AC Coverage Map" "grep -q '## AC Coverage Map' '$SDD_EXAMPLE/plan.md'"

echo ""
echo "[Phase 3] Tasks exist and parse"
check "tasks.md exists" "[ -f '$SDD_EXAMPLE/tasks.md' ]"
check "tasks.md has approved status" "grep -q 'status: approved' '$SDD_EXAMPLE/tasks.md'"
check "tasks.md has at least one T-XXX" "grep -qE '## T-[0-9]{3}' '$SDD_EXAMPLE/tasks.md'"
check "tasks.md has Files: field" "grep -q 'Files:' '$SDD_EXAMPLE/tasks.md'"
check "tasks.md has AC covered: field" "grep -q 'AC covered:' '$SDD_EXAMPLE/tasks.md'"

echo ""
echo "[Phase 4] Session + Inputs + Outputs + Handoff"
check "session.yml exists" "[ -f '$SDD_EXAMPLE/session.yml' ]"
check "session.yml is valid YAML" "python3 -c \"import yaml; yaml.safe_load(open('$SDD_EXAMPLE/session.yml'))\""
check "session.yml has task_states populated" "python3 -c \"import yaml; assert yaml.safe_load(open('$SDD_EXAMPLE/session.yml')).get('task_states')\""
check "inputs/ has at least one dispatch" "ls '$SDD_EXAMPLE'/inputs/*.json"
check "outputs/ has at least one dispatch" "ls '$SDD_EXAMPLE'/outputs/*.json"
check "handoff.md exists" "[ -f '$SDD_EXAMPLE/handoff.md' ]"

echo ""
echo "[Cross-ref] Spec ACs are covered by Tasks"
spec_acs=$(grep -oE 'AC-[0-9]{3}' "$SDD_EXAMPLE/spec.md" | sort -u)
for ac in $spec_acs; do
  check "Spec $ac appears in tasks.md" "grep -q '$ac' '$SDD_EXAMPLE/tasks.md'"
done

# ============================================================
# Discovery squad — discovery-DISC-001-fake
# ============================================================
echo ""
echo "### Discovery squad — discovery-DISC-001-fake ###"
echo ""

echo "[Phase 1] Frame (Cagan Opportunity Assessment Q1-Q9)"
check "memo.md exists" "[ -f '$DISC_EXAMPLE/memo.md' ]"
check "memo.md has approved status" "grep -q 'status: \"approved\"' '$DISC_EXAMPLE/memo.md'"
check "memo.md has squad: discovery" "grep -q 'squad: \"discovery\"' '$DISC_EXAMPLE/memo.md'"
check "memo.md has phase_completed: decide" "grep -q 'phase_completed: \"decide\"' '$DISC_EXAMPLE/memo.md'"
check "memo.md has all 9 Frame sections (Q1-Q9)" "[ \$(grep -cE '^## [1-9]\\. ' '$DISC_EXAMPLE/memo.md') -eq 9 ]"

echo ""
echo "[Phase 2] Investigate populated"
check "memo.md has ## Investigate Findings" "grep -q '^## Investigate Findings' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Codebase Map" "grep -q '^### Codebase Map' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Risk Analysis" "grep -q '^### Risk Analysis' '$DISC_EXAMPLE/memo.md'"
check "memo.md references all 4 Cagan risks" "[ \$(grep -cE '^- \\*\\*(Value|Usability|Feasibility|Viability)\\*\\*' '$DISC_EXAMPLE/memo.md') -eq 4 ]"

echo ""
echo "[Phase 3] Decide populated"
check "memo.md has ## Decide" "grep -q '^## Decide' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Options table" "grep -q '^### Options' '$DISC_EXAMPLE/memo.md'"
check "memo.md has Kill as option row 1" "grep -qE '\\| 1 \\| Kill' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Recommendation" "grep -q '^### Recommendation' '$DISC_EXAMPLE/memo.md'"
check "memo.md has Rule matched" "grep -qE 'Rule matched.*R[1-5]' '$DISC_EXAMPLE/memo.md'"
check "memo.md has Confidence" "grep -qE 'Confidence.*(high|medium|low)' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Decision" "grep -q '^### Decision' '$DISC_EXAMPLE/memo.md'"
check "memo.md has ### Open Questions for Delivery" "grep -q '^### Open Questions for Delivery' '$DISC_EXAMPLE/memo.md'"

echo ""
echo "[Phase 2/3] Session + Inputs + Outputs"
check "session.yml exists" "[ -f '$DISC_EXAMPLE/session.yml' ]"
check "session.yml is valid YAML" "python3 -c \"import yaml; yaml.safe_load(open('$DISC_EXAMPLE/session.yml'))\""
check "session.yml has squad: discovery" "python3 -c \"import yaml; assert yaml.safe_load(open('$DISC_EXAMPLE/session.yml')).get('squad') == 'discovery'\""
check "session.yml has current_phase: done" "python3 -c \"import yaml; assert yaml.safe_load(open('$DISC_EXAMPLE/session.yml')).get('current_phase') == 'done'\""
check "inputs/ has codebase-mapper dispatch" "ls '$DISC_EXAMPLE'/inputs/codebase-mapper-*.json"
check "inputs/ has 4 risk-analyst dispatches (one per Cagan risk)" "[ \$(ls '$DISC_EXAMPLE'/inputs/risk-analyst-*.json 2>/dev/null | wc -l) -eq 4 ]"
check "outputs/ has codebase-mapper output" "ls '$DISC_EXAMPLE'/outputs/codebase-mapper-*.json"
check "outputs/ has 4 risk-analyst outputs" "[ \$(ls '$DISC_EXAMPLE'/outputs/risk-analyst-*.json 2>/dev/null | wc -l) -eq 4 ]"

# ============================================================
# Schema validation — both squads' Output Packets
# ============================================================
echo ""
echo "### Schema validation — Output Packets parse and validate (cross-squad) ###"
echo ""
for op in "$SDD_EXAMPLE"/outputs/*.json "$DISC_EXAMPLE"/outputs/*.json; do
  name=$(basename "$op")
  check "$name parses as JSON" "python3 -m json.tool '$op'"
done
if command -v npx >/dev/null 2>&1; then
  for op in "$SDD_EXAMPLE"/outputs/*.json "$DISC_EXAMPLE"/outputs/*.json; do
    name=$(basename "$op")
    check "$name validates against canonical schema (ajv)" "npx -y -p ajv-cli ajv validate -s '$SCHEMA' -d '$op'"
  done
fi

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="

[ $FAIL -eq 0 ]
