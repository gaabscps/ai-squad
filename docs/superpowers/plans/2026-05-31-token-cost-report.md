# Token Usage in Session Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. (This run: inline manual execution, autonomous.)

**Goal:** Expor o custo em tokens junto do `$` no report da sessão — total + matriz fase × tipo, cada célula com `tokens ($)`, reconciliando com o `total_cost_usd`.

**Architecture:** `cost_for_usage` passa a devolver `cost_by_type` (componentes já calculados); `transcript_cost` grava isso em `by_model`; `build_cost_report` agrega tokens + `$` por (fase, tipo) com fallback de re-precificação para arquivos legados; `session_report` renderiza um total no KPI de Custo + uma seção `<details>` com a matriz; `render_markdown` ganha paridade de tokens.

**Tech Stack:** Python stdlib + pytest. Fonte em `squads/sdd/hooks/`; cópias `.claude/hooks/` são geradas por deploy.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `squads/sdd/hooks/pricing.py` | `cost_for_usage` retorna `cost_by_type` | Modificar |
| `squads/sdd/hooks/transcript_cost.py` | grava `cost_by_type` em `by_model` | Modificar |
| `squads/sdd/hooks/cost_report.py` | agrega tokens + `token_cost`; `fmt_tokens`; tokens no markdown | Modificar |
| `squads/sdd/hooks/session_report.py` | KPI token line + seção matriz + CSS | Modificar |
| `__tests__/test_pricing.py` | cost_by_type | Modificar |
| `__tests__/test_cost_report.py` | agregação tokens + reconciliação + fallback | Modificar |
| `__tests__/test_session_report_redesign.py` | matriz no HTML | Modificar |

---

## Task 1: `cost_for_usage` retorna `cost_by_type`

**Files:** `squads/sdd/hooks/pricing.py`, test `__tests__/test_pricing.py`

- [ ] **Step 1: Teste falhando** — em `test_pricing.py`, adicionar:

```python
def test_cost_by_type_components_sum_to_total():
    usage = {"input_tokens": 10, "output_tokens": 5,
             "cache_read_input_tokens": 100,
             "cache_creation": {"ephemeral_5m_input_tokens": 100,
                                "ephemeral_1h_input_tokens": 100}}
    r = pricing.cost_for_usage(usage, "m", PRICES)
    cbt = r["cost_by_type"]
    assert cbt["input"] == 10.0          # 10 * $1
    assert cbt["output"] == 10.0         # 5 * $2
    assert cbt["cache_read"] == 10.0     # 100 * 0.10 * $1
    assert cbt["cache_creation"] == 325.0  # (100*1.25 + 100*2.0) * $1
    assert round(sum(cbt.values()), 6) == r["cost_usd"]


def test_cost_by_type_none_for_unknown_model():
    r = pricing.cost_for_usage({"input_tokens": 10}, "unknown", PRICES)
    assert r["cost_by_type"] is None
```

- [ ] **Step 2: Rodar — falha** — `python3 -m pytest squads/sdd/hooks/__tests__/test_pricing.py -q` → FAIL (KeyError `cost_by_type`).

- [ ] **Step 3: Implementar** — em `pricing.py`, no `cost_for_usage`, substituir o bloco de cálculo + return:

Bloco unpriced (return quando `rates is None`) — adicionar `"cost_by_type": None`:
```python
    if rates is None:
        return {"cost_usd": None, "priced": False, "model": model,
                "billable_input_tokens": inp, "output_tokens": output,
                "cost_by_type": None}
```
Bloco priced — decompor e retornar componentes:
```python
    in_rate = rates["input_per_mtok"] / 1_000_000
    out_rate = rates["output_per_mtok"] / 1_000_000
    input_cost = inp * in_rate
    output_cost = output * out_rate
    cache_read_cost = read * CACHE_READ_MULT * in_rate
    cache_creation_cost = (w5 * CACHE_WRITE_5M_MULT + w1 * CACHE_WRITE_1H_MULT) * in_rate
    cost = input_cost + output_cost + cache_read_cost + cache_creation_cost
    return {"cost_usd": round(cost, 6), "priced": True, "model": model,
            "billable_input_tokens": inp, "output_tokens": output,
            "cost_by_type": {
                "input": round(input_cost, 6),
                "output": round(output_cost, 6),
                "cache_read": round(cache_read_cost, 6),
                "cache_creation": round(cache_creation_cost, 6),
            }}
```

- [ ] **Step 4: Rodar — passa** — `pytest …/test_pricing.py -q` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(cost): cost_for_usage returns per-type cost breakdown"`

## Task 2: `transcript_cost` grava `cost_by_type` em `by_model`

**Files:** `squads/sdd/hooks/transcript_cost.py`, test `__tests__/test_transcript_cost.py`

- [ ] **Step 1: Teste falhando** — adicionar em `test_transcript_cost.py`:

```python
def test_by_model_carries_cost_by_type(tmp_path):
    tr = tmp_path / "t.jsonl"
    tr.write_text('{"type":"assistant","message":{"id":"x","model":"m",'
                  '"usage":{"input_tokens":10,"output_tokens":5}}}\n')
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}
    r = transcript_cost.extract_transcript_cost(str(tr), prices)
    cbt = r["by_model"]["m"]["cost_by_type"]
    assert cbt["input"] == 10.0 and cbt["output"] == 10.0
```
(Usar o mesmo loader `importlib` do topo do arquivo de teste se já existir; senão espelhar `test_cost_report.py`.)

- [ ] **Step 2: Rodar — falha** — `pytest …/test_transcript_cost.py -q` → FAIL.

- [ ] **Step 3: Implementar** — em `transcript_cost.py`, no laço `for model, buckets in per_model.items()`, ao montar `entry`:
```python
        entry = dict(buckets)
        entry["messages"] = counts[model]
        entry["cost_usd"] = priced["cost_usd"]
        entry["cost_by_type"] = priced.get("cost_by_type")
```

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Commit** — `git commit -m "feat(cost): persist per-type cost in by_model"`

## Task 3: `build_cost_report` agrega tokens + `token_cost` + markdown

**Files:** `squads/sdd/hooks/cost_report.py`, test `__tests__/test_cost_report.py`

- [ ] **Step 1: Testes falhando** — adicionar em `test_cost_report.py`:

```python
def _bm(inp, out, cr_, cc):
    return {"m": {"input_tokens": inp, "output_tokens": out,
                  "cache_read_input_tokens": cr_, "cache_creation_input_tokens": cc,
                  "cost_by_type": {"input": float(inp), "output": float(out)*2,
                                   "cache_read": float(cr_)*0.10, "cache_creation": float(cc)*1.25},
                  "cost_usd": inp + out*2 + cr_*0.10 + cc*1.25, "messages": 1}}

def test_tokens_aggregated_by_phase_and_type(tmp_path):
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 0.0, "unpriced_models": [], "by_model": _bm(100, 50, 1000, 80)},
        "orchestration": {"total_cost_usd": 0.0, "unpriced_models": [], "by_model": _bm(200, 60, 2000, 90)},
    }))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 0.0, "unpriced_models": [],
        "by_model": _bm(300, 70, 3000, 100)}))
    rep = cr.build_cost_report(tmp_path)
    tok = rep["tokens"]
    assert tok["by_phase"]["planning"]["input"] == 100
    assert tok["by_type"]["input"] == 600        # 100+200+300
    assert tok["by_type"]["output"] == 180        # 50+60+70
    assert tok["total"] == 600 + 180 + 6000 + 270  # all types summed
    # reconciliation: sum of per-type cost == total_cost_usd
    tc = rep["token_cost"]
    assert round(sum(tc["by_type"].values()), 6) == rep["total_cost_usd"]

def test_tokens_fallback_reprice_when_cost_by_type_absent(tmp_path, monkeypatch):
    costs = tmp_path / "costs"; costs.mkdir()
    bm = {"m": {"input_tokens": 10, "output_tokens": 5,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                "cost_usd": 20.0, "messages": 1}}  # NOTE: no cost_by_type
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 20.0, "unpriced_models": [], "by_model": bm}))
    monkeypatch.setattr(cr, "_load_prices_safe",
                        lambda: {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}})
    rep = cr.build_cost_report(tmp_path)
    assert rep["token_cost"]["by_type"]["input"] == 10.0   # repriced from buckets
    assert rep["token_cost"]["by_type"]["output"] == 10.0

def test_tokens_absent_when_no_by_model(tmp_path):
    # existing-shape files (no by_model) → tokens total 0, no crash
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "unpriced_models": []}))
    rep = cr.build_cost_report(tmp_path)
    assert rep["tokens"]["total"] == 0
```

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar** — em `cost_report.py`:

Topo (após imports):
```python
_TOKEN_TYPES = ("input", "output", "cache_read", "cache_creation")
_BUCKET_FOR_TYPE = {
    "input": "input_tokens", "output": "output_tokens",
    "cache_read": "cache_read_input_tokens", "cache_creation": "cache_creation_input_tokens",
}


def fmt_tokens(n):
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def _load_prices_safe():
    """Prices for the legacy reprice fallback; None if unavailable (degrade to tokens-only)."""
    try:
        from pricing import load_prices
        return load_prices()
    except Exception:
        return None


def _empty_typemap():
    return {t: 0 for t in _TOKEN_TYPES}
```

Dentro de `build_cost_report`, antes do laço de arquivos, inicializar acumuladores:
```python
    tok_phase = {p: _empty_typemap() for p in ("planning", "orchestration", "implementation")}
    cost_phase = {p: {t: 0.0 for t in _TOKEN_TYPES} for p in ("planning", "orchestration", "implementation")}
    _prices = {"v": None, "loaded": False}  # lazy holder for reprice fallback
```

Helper interno (definir dentro de `build_cost_report`, antes do laço):
```python
    def _absorb(by_model, phase):
        if not isinstance(by_model, dict):
            return
        for model, entry in by_model.items():
            if not isinstance(entry, dict):
                continue
            for t, bkey in _BUCKET_FOR_TYPE.items():
                tok_phase[phase][t] += entry.get(bkey, 0) or 0
            cbt = entry.get("cost_by_type")
            if cbt is None:
                if not _prices["loaded"]:
                    _prices["v"] = _load_prices_safe()
                    _prices["loaded"] = True
                if _prices["v"] is not None:
                    from pricing import cost_for_usage
                    cbt = cost_for_usage(entry, model, _prices["v"]).get("cost_by_type")
            if cbt:
                for t in _TOKEN_TYPES:
                    cost_phase[phase][t] += cbt.get(t, 0) or 0
```

No laço de arquivos, dentro de `if scope == "session"`: após somar os `$`, absorver tokens das duas sub-fases:
```python
                _absorb((d.get("planning") or {}).get("by_model"), "planning")
                _absorb((d.get("orchestration") or {}).get("by_model"), "orchestration")
```
Dentro de `elif scope == "implementation"`: após `subagents += 1`:
```python
                _absorb(d.get("by_model"), "implementation")
```

Antes do `return`, montar os blocos e adicioná-los ao dict retornado:
```python
    tokens_by_type = _empty_typemap()
    cost_by_type = {t: 0.0 for t in _TOKEN_TYPES}
    for p in tok_phase:
        for t in _TOKEN_TYPES:
            tokens_by_type[t] += tok_phase[p][t]
            cost_by_type[t] += cost_phase[p][t]
        tok_phase[p]["total"] = sum(tok_phase[p][t] for t in _TOKEN_TYPES)
    tokens_total = sum(tokens_by_type[t] for t in _TOKEN_TYPES)
```
E no dict de retorno acrescentar:
```python
        "tokens": {"by_phase": tok_phase, "by_type": tokens_by_type, "total": tokens_total},
        "token_cost": {
            "by_phase": {p: {**{t: round(cost_phase[p][t], 6) for t in _TOKEN_TYPES},
                             "total": round(sum(cost_phase[p].values()), 6)} for p in cost_phase},
            "by_type": {t: round(cost_by_type[t], 6) for t in _TOKEN_TYPES},
        },
```

Markdown — em `render_markdown`, acrescentar uma coluna Tokens à tabela de fases. Substituir as linhas de fase por (usando `rep["tokens"]["by_phase"]`):
```python
        "| Phase | Cost (USD) | Tokens |",
        "|---|---|---|",
        f"| Planning (spec/design/tasks) | ${rep['planning_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['planning']['total'])} |",
        f"| Orchestration (Phase 4 driver) | ${rep['orchestration_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['orchestration']['total'])} |",
        f"| Implementation ({rep['subagent_count']} subagents) | ${rep['implementation_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['implementation']['total'])} |",
        f"| **Total** | **${rep['total_cost_usd']:.4f}** | **{fmt_tokens(rep['tokens']['total'])}** |",
```
(Guard: `render_markdown` é chamado após `build_cost_report`, então `rep["tokens"]` sempre existe.)

- [ ] **Step 4: Rodar — passa** (incluindo os testes existentes que não têm `by_model` → tokens 0, sem quebrar).

- [ ] **Step 5: Commit** — `git commit -m "feat(cost): aggregate token usage and per-type cost by phase"`

## Task 4: render tokens no `session_report.py`

**Files:** `squads/sdd/hooks/session_report.py`, test `__tests__/test_session_report_redesign.py`

- [ ] **Step 1: Testes falhando** — em `test_session_report_redesign.py`, enriquecer `_seed_costs` para incluir `by_model` e adicionar um teste:

Substituir `_seed_costs` por (mantém o shape de sessão real, com `by_model`):
```python
def _seed_costs(sd):
    (sd / "costs").mkdir(parents=True, exist_ok=True)
    bm = lambda i, o, r, c: {"claude-x": {
        "input_tokens": i, "output_tokens": o, "cache_read_input_tokens": r,
        "cache_creation_input_tokens": c,
        "cost_by_type": {"input": i * 1e-6, "output": o * 1e-6,
                         "cache_read": r * 1e-7, "cache_creation": c * 1.25e-6},
        "cost_usd": 0.0, "messages": 1}}
    (sd / "costs" / "session.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 1.20, "unpriced_models": [], "by_model": bm(100000, 40000, 1000000, 60000)},
        "orchestration": {"total_cost_usd": 27.25, "unpriced_models": [], "by_model": bm(300000, 120000, 4000000, 130000)},
    }))
    (sd / "costs" / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 10.12, "agent_id": "a",
        "unpriced_models": [], "by_model": bm(800000, 500000, 4500000, 200000)}))
```
Novo teste:
```python
def test_token_usage_section_rendered(tmp_path):
    html = _build(tmp_path)
    assert "Token usage" in html
    for col in ("Input", "Output", "Cache read", "Cache creation"):
        assert col in html
    assert "M tokens" in html or "K tokens" in html   # compact total in the cost KPI


def test_fmt_tokens_compact():
    assert session_report.cost_report.fmt_tokens(1_350_000) == "1.4M"
    assert session_report.cost_report.fmt_tokens(775_000) == "775K"
    assert session_report.cost_report.fmt_tokens(500) == "500"
```

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar** — em `session_report.py`:

(a) No KPI de Custo dentro de `_dashboard`, na linha do label `Cost · $...`, acrescentar o total de tokens. Trocar:
```python
        f"<div class='kpi'><div class='lbl'>Cost · ${rep['total_cost_usd']:.2f}</div>"
        f"{_cost_bar(rep)}"
```
por:
```python
        f"<div class='kpi'><div class='lbl'>Cost · ${rep['total_cost_usd']:.2f} · "
        f"{cost_report.fmt_tokens((rep.get('tokens') or {}).get('total', 0))} tokens</div>"
        f"{_cost_bar(rep)}"
```

(b) Nova função (após `_integrity_section`):
```python
_TOK_COLS = [("input", "Input"), ("output", "Output"),
             ("cache_read", "Cache read"), ("cache_creation", "Cache creation")]
_TOK_PHASES = [("planning", "Planning"), ("orchestration", "Orchestration"),
               ("implementation", "Implementation")]


def _token_section(rep):
    tok = rep.get("tokens") or {}
    cost = rep.get("token_cost") or {}
    if tok.get("total", 0) <= 0:
        return ""
    ft = cost_report.fmt_tokens
    types = [k for k, _ in _TOK_COLS]

    def _cell(tokens, dollars):
        return f"<td>{ft(tokens)} <span class='tc'>(${dollars:.2f})</span></td>"

    head = "".join(f"<th>{lbl}</th>" for _, lbl in _TOK_COLS)
    rows = []
    for pk, plbl in _TOK_PHASES:
        tph = (tok.get("by_phase") or {}).get(pk, {})
        cph = (cost.get("by_phase") or {}).get(pk, {})
        cells = "".join(_cell(tph.get(t, 0), cph.get(t, 0.0)) for t in types)
        rows.append(f"<tr><th>{plbl}</th>{cells}"
                    f"{_cell(tph.get('total', 0), cph.get('total', 0.0))}</tr>")
    tcells = "".join(_cell((tok.get('by_type') or {}).get(t, 0),
                           (cost.get('by_type') or {}).get(t, 0.0)) for t in types)
    grand = sum((cost.get('by_type') or {}).get(t, 0.0) for t in types)
    total_row = (f"<tr class='ttl'><th>Total</th>{tcells}"
                 f"{_cell(tok.get('total', 0), grand)}</tr>")
    return ("<section><details class='tokens'>"
            f"<summary>Token usage — {ft(tok.get('total', 0))} tokens · ${grand:.2f}</summary>"
            f"<table class='toktab'><tr><th></th>{head}<th>Total</th></tr>"
            f"{''.join(rows)}{total_row}</table></details></section>")
```

(c) Inserir a seção em `build_html_report`, no `parts`, logo após `_integrity_section(pipeline),`:
```python
        _token_section(rep),
```

(d) CSS — acrescentar ao final do `_CSS`:
```css
details.tokens summary{cursor:pointer;font-weight:600;font-size:.82rem;margin-top:6px}
.toktab{border-collapse:collapse;font-size:.74rem;margin-top:8px;width:100%}
.toktab th,.toktab td{border:1px solid #eee;padding:4px 8px;text-align:right}
.toktab th:first-child{text-align:left}
.toktab tr.ttl th,.toktab tr.ttl td{font-weight:700;background:#fafafa}
.toktab .tc{color:#888}
```

- [ ] **Step 4: Rodar — passa** — `pytest squads/sdd/hooks/__tests__/test_session_report_redesign.py -q`.

- [ ] **Step 5: Suíte completa** — `pytest squads/sdd/hooks/__tests__/ -q` → tudo verde.

- [ ] **Step 6: Commit** — `git commit -m "feat(report): render token usage matrix in session report"`

## Task 5: deploy + smoke test

- [ ] **Step 1: Sync** — `cd packages/cli && npm run sync` (refresca `components/` da fonte).
- [ ] **Step 2: Deploy** — `cd <repo root> && ai-squad deploy --hooks-only`.
- [ ] **Step 3: Smoke test** — gerar o HTML de `FEAT-003` via `session_report.build_html_report` e conferir: seção "Token usage" presente, total no KPI de Custo, e reconciliação (canto da matriz ≈ `$` do dashboard).

---

## Self-Review

**1. Cobertura da spec:** cost_by_type (T1), persist (T2), agregação + reconciliação + fallback + markdown (T3), KPI line + matriz + CSS (T4), deploy/smoke (T5). Fora de escopo (B temporal, por-modelo, ephemeral) não implementado, conforme spec.

**2. Placeholder scan:** sem TBD/TODO; todo passo de código mostra conteúdo exato.

**3. Type consistency:** `fmt_tokens` em `cost_report` (público), usado em `session_report` via `cost_report.fmt_tokens`. Chaves `tokens.{by_phase,by_type,total}` e `token_cost.{by_phase,by_type}` consistentes entre T3 (produtor) e T4 (consumidor). `_TOKEN_TYPES`/`_BUCKET_FOR_TYPE` em cost_report; `_TOK_COLS`/`_TOK_PHASES` em session_report. `cost_by_type` em pricing→transcript_cost→cost_report consistente.
