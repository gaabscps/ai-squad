#!/usr/bin/env python3
"""ai-squad hook — verify-observed-feature (camada de feature).

PostToolUse(Write|Edit|MultiEdit) sobre .agent-session/*/session.yml com
mode: observed: valida a FORMA do bloco feature (id+name presentes; key, se
houver, no padrão ISSUE-123). Bloco ausente ou torto → decision block com
mensagem corretiva pro AGENTE (nunca trava o humano; "Sem feature" é um bloco
válido com id ft-<slug>). Pure stdlib, fail-open.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, tool_input_dict, edit_target_path, read_yaml_scalar,
)

_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]*-\d+$")

_REASON = (
    "session.yml observado sem bloco `feature` válido. Toda sessão observada "
    "declara sua feature na abertura (picker do /observe|/sessao). Grave:\n"
    "feature:\n  id: <KEY ou ft-<slug-do-nome>>\n  key: <ISSUE-123, opcional>\n"
    "  name: \"<nome humano>\"\n"
    "Sem feature escolhida pelo humano: use id ft-<slug-do-intent> e name = intent."
)


def _parse_value(raw: str) -> str:
    """Extrai o valor de um `key: value`, preservando `#` dentro de aspas.

    Se o valor começa com aspas (simples ou duplas), usa o conteúdo até a
    aspa de fechamento correspondente (comentários depois dela são
    ignorados). Caso contrário, corta um comentário ` #...` à direita.
    """
    raw = raw.strip()
    if raw[:1] in ("\"", "'"):
        quote = raw[0]
        end = raw.find(quote, 1)
        if end != -1:
            return raw[1:end]
        return raw[1:]  # aspa sem fechamento: melhor esforço
    return re.sub(r"\s+#.*$", "", raw).strip()


def _feature_block(text: str):
    """Extrai os escalares diretos do bloco top-level `feature:`.

    O indent dos filhos diretos é detectado pela PRIMEIRA linha filha (2
    espaços, 4 espaços, tab — qualquer largura), e comparado literalmente
    (não por contagem de colunas) para tolerar tabs. Linhas mais indentadas
    que esse prefixo (ex.: filhos de `jira_snapshot:`) são sub-blocos e
    ficam de fora. Retorna dict ({} se o bloco existe mas está vazio) ou
    None se ausente. Parser mínimo de indentação — stdlib, sem PyYAML
    (regra dos hooks).
    """
    out, inside = {}, False
    child_prefix = None
    for ln in text.splitlines():
        if not inside:
            if re.match(r"^feature:\s*(#.*)?$", ln):
                inside = True
            continue
        if ln.strip() == "":
            continue
        if not re.match(r"^[ \t]", ln):
            break  # voltou pro nível 0: bloco acabou
        if child_prefix is None:
            m0 = re.match(r"^([ \t]+)", ln)
            child_prefix = m0.group(1)
        if not ln.startswith(child_prefix):
            continue  # indent menor que o dos filhos diretos, mas não nível 0 — ignora
        rest = ln[len(child_prefix):]
        if rest[:1] in (" ", "\t"):
            continue  # mais indentado que os filhos diretos: sub-bloco (ex.: jira_snapshot)
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", rest)
        if m:
            out[m.group(1)] = _parse_value(m.group(2))
    return out if inside else None


def _block(reason: str) -> int:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0

    target = edit_target_path(tool_input_dict(payload))
    if not target:
        return 0
    p = Path(target)
    if not p.is_absolute():
        p = Path(resolve_project_root(payload)) / p
    if p.name != "session.yml" or ".agent-session" not in p.parts:
        return 0
    if not p.exists():
        return 0
    if read_yaml_scalar(p, "mode") != "observed":
        return 0

    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return 0  # fail-open

    fb = _feature_block(text)
    if fb is None:
        return _block(_REASON)
    if not fb.get("id") or not fb.get("name"):
        return _block("bloco `feature` incompleto (id e name são obrigatórios). " + _REASON)
    key = fb.get("key", "")
    if key and not _KEY_RE.match(key):
        return _block(
            f"feature.key '{key}' fora do padrão de issue-key (ex.: PAY-1234). "
            "Corrija a key ou remova-a (name livre + id ft-<slug> bastam)."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
