# Redesign de UX do cockpit (packages/os) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar as 4 frentes do design `docs/superpowers/specs/2026-06-12-os-ux-redesign-design.md`: fix do grid blowout, storytelling de decisões, dormência/honestidade e estética Anthropic Studio.

**Architecture:** Tudo em `packages/os` (frontend React em `web/src`, sem framework CSS — tokens em `:root` do `app.css`). Dados já existem no store (`ObservedMeta`, `DeliveryReport`); as mudanças são de apresentação + 1 derivação nova (`isDormant`). Zero mudança no framework ai-squad.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library, CSS puro com variáveis.

**Convenções deste repo:** testes colocados ao lado do arquivo (`X.test.tsx`); commits SEM trailer `Co-Authored-By`; comentários descrevem O QUE (porquê vai no PR/chat). Rodar testes com `npx vitest run <arquivo>` a partir de `packages/os/`.

**Nota de desvio do design (aprovar com o usuário no checkpoint):** o design escreveu a manchete como `Você pediu: "<intent>" · …`, mas na versão viva o `<h2>` do drawer JÁ é o intent — repetir seria duplicação. A manchete implementada carrega janela + contagens + custo (`rodando · aberto há 2h · 3 decisões · 2 verificações · US$ 5.11`).

---

### Task 1: WS1 — Fix do grid blowout

**Files:**
- Modify: `packages/os/web/src/app.css` (regra `.kcol`, ~linha 84)

- [ ] **Step 1: Aplicar o fix com comentário-guarda**

Na regra `.kcol`, adicionar `min-width: 0`:

```css
.kcol {
  background: var(--surface-soft); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px;
  /* min-width: 0 — sem isto a trilha 1fr (= minmax(auto,1fr)) não encolhe abaixo
     do conteúdo mínimo; .kcard-title é nowrap, então a coluna estica até o título
     inteiro e o board ganha scroll horizontal (blowout). NÃO remover. */
  min-width: 0;
}
```

- [ ] **Step 2: Verificar no browser**

Com o dev server rodando (`npm run dev` na raiz do monorepo), abrir `http://localhost:5173` e medir no console:

```js
getComputedStyle(document.querySelector('.kboard')).gridTemplateColumns
```

Esperado: 3 valores ~iguais (antes: `103px 737px 1053px`) e `document.documentElement.scrollWidth <= document.body.clientWidth`.

- [ ] **Step 3: Commit**

```bash
git add packages/os/web/src/app.css
git commit -m "fix(os/web): kanban grid blowout — min-width:0 nas colunas"
```

---

### Task 2: WS2a — Helper de trilha visível + manchete narrada no buildStory

A contagem de decisões/verificações da manchete deve usar o MESMO filtro de higiene que o drawer usa (itens 100% vazios não contam). Hoje esse filtro vive inline no `DetailDrawer.tsx:103-104` — extraí-lo evita divergência.

**Files:**
- Create: `packages/os/web/src/lib/observedTrail.ts`
- Create: `packages/os/web/src/lib/observedTrail.test.ts`
- Modify: `packages/os/web/src/lib/buildStory.ts` (ramo observado, linhas 49-62)
- Modify: `packages/os/web/src/lib/buildStory.test.ts` (estender)
- Modify: `packages/os/web/src/components/DetailDrawer.tsx:102-104` (usar o helper)

- [ ] **Step 1: Teste do helper (falhando)**

`packages/os/web/src/lib/observedTrail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { visibleDecisions, visibleEvidence } from "./observedTrail";
import type { ObservedMeta } from "../../../src/store/types";

const base: ObservedMeta = {
  intent: "x", createdAt: null, closedAt: null, attentionKind: null,
  decisions: [], evidence: [], driftFlags: [],
};

describe("visibleDecisions", () => {
  it("filtra decisões totalmente vazias", () => {
    const obs = { ...base, decisions: [
      { what: "A", why: null, rejected: null, ref: null },
      { what: "", why: null, rejected: null, ref: null },
    ]};
    expect(visibleDecisions(obs)).toHaveLength(1);
  });
});

describe("visibleEvidence", () => {
  it("filtra evidências totalmente vazias", () => {
    const obs = { ...base, evidence: [
      { cmd: "ls", result: null, kind: null },
      { cmd: null, result: null, kind: null },
    ]};
    expect(visibleEvidence(obs)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/lib/observedTrail.test.ts` (em `packages/os/`)
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o helper**

`packages/os/web/src/lib/observedTrail.ts`:

```ts
import type { ObservedMeta, ObservedDecision, ObservedEvidence } from "../../../src/store/types";

// Higiene de trilha: item 100% vazio (todos os campos falsy) não é exibido nem contado.
export function visibleDecisions(obs: ObservedMeta): ObservedDecision[] {
  return obs.decisions.filter((d) => d.what || d.why || d.rejected || d.ref);
}

export function visibleEvidence(obs: ObservedMeta): ObservedEvidence[] {
  return obs.evidence.filter((e) => e.cmd || e.result || e.kind);
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS.

- [ ] **Step 5: Testes da manchete (falhando)**

Adicionar em `packages/os/web/src/lib/buildStory.test.ts` (seguir o estilo dos testes existentes do arquivo; `makeSpec`/fixtures locais já existem lá — reusar):

```ts
// Fixture observado mínimo para os casos novos (ajustar ao helper local do arquivo):
const obsBase = {
  intent: "melhorar UI", createdAt: "2026-06-12T20:00:00Z", closedAt: null,
  attentionKind: null, decisions: [], evidence: [], driftFlags: [],
};
const NOW = Date.parse("2026-06-12T22:00:00Z");

it("observado aberto: janela + contagens + custo", () => {
  const spec = makeSpec({
    status: "running",
    observed: {
      ...obsBase,
      decisions: [
        { what: "A", why: null, rejected: null, ref: null },
        { what: "B", why: null, rejected: null, ref: null },
      ],
      evidence: [{ cmd: "ls", result: "ok", kind: null }],
    },
    cost: { ...emptyCost, source: "partial", totalCostUsd: 5.11, totalTokens: 2_700_000 },
  });
  expect(buildStory(spec, NOW)).toBe("rodando · aberto há 2 h · 2 decisões · 1 verificação · US$ 5.11");
});

it("observado fechado: sem 'aberto há', com contagens", () => {
  const spec = makeSpec({
    status: "done",
    observed: { ...obsBase, closedAt: "2026-06-12T21:00:00Z",
      decisions: [{ what: "A", why: null, rejected: null, ref: null }], evidence: [] },
    cost: { ...emptyCost, source: "cost_report", totalCostUsd: 110.75, totalTokens: 83_500_000 },
  });
  expect(buildStory(spec, NOW)).toBe("concluído · 1 decisão · US$ 110.75");
});

it("observado sem decisões: omite contagens (não mostra '0 decisões')", () => {
  const spec = makeSpec({ status: "running", observed: obsBase,
    cost: { ...emptyCost, source: "empty", totalTokens: 0 } });
  expect(buildStory(spec, NOW)).toBe("rodando · aberto há 2 h · sem custo ainda");
});
```

Atenção: o formato exato de `fmtRelativeTime` ("há 2 h" vs "há 2h") deve ser conferido em `web/src/format.ts:40` antes de fixar a string esperada — usar o que a função realmente emite.

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run web/src/lib/buildStory.test.ts`
Expected: FAIL — assinatura sem `now` e ramo observado antigo.

- [ ] **Step 7: Implementar a manchete**

Em `buildStory.ts`: adicionar imports e trocar o ramo observado (linhas 48-62) por:

```ts
import { fmtRelativeTime } from "../format";
import { visibleDecisions, visibleEvidence } from "./observedTrail";

export function buildStory(spec: Spec, now: number = Date.now()): string {
  const { cost, tasks, status } = spec;
  const statusLabel = STATUS_LABEL[status];

  // Sessão observada: manchete narrada — janela + contagens da trilha + custo.
  // O intent NÃO entra (o título do drawer/card já é o intent).
  if (spec.observed) {
    const obs = spec.observed;
    const terminal = status === "done" || status === "abandoned";
    const parts: string[] = [BADGE_LABEL[status]];

    if (!terminal && obs.createdAt) {
      parts.push(`aberto ${fmtRelativeTime(obs.createdAt, now)}`);
    }
    const nd = visibleDecisions(obs).length;
    if (nd > 0) parts.push(nd === 1 ? "1 decisão" : `${nd} decisões`);
    const ne = visibleEvidence(obs).length;
    if (ne > 0) parts.push(ne === 1 ? "1 verificação" : `${ne} verificações`);

    if (cost.totalCostUsd !== null) {
      parts.push(fmtUsd(cost.totalCostUsd));
    } else if (cost.source === "cost_report") {
      parts.push(`${fmtTokens(cost.totalTokens)} tokens`);
    } else if (cost.totalTokens > 0) {
      parts.push(`${fmtTokens(cost.totalTokens)} tokens (em coleta)`);
    } else {
      parts.push("sem custo ainda");
    }
    return parts.join(" · ");
  }
  // ... ramo SDD inalterado nesta task ...
}
```

- [ ] **Step 8: Trocar o filtro inline do drawer pelo helper**

Em `DetailDrawer.tsx:102-104`, substituir as duas linhas de filtro por:

```ts
const shownDecisions = visibleDecisions(obs);
const shownEvidence = visibleEvidence(obs);
```

com `import { visibleDecisions, visibleEvidence } from "../lib/observedTrail";` (e remover o import de `ObservedDecision`/`ObservedEvidence` se ficar sem uso).

- [ ] **Step 9: Rodar a suíte dos arquivos tocados**

Run: `npx vitest run web/src/lib/buildStory.test.ts web/src/lib/observedTrail.test.ts web/src/components/DetailDrawer.test.tsx`
Expected: PASS (se algum teste antigo do DetailDrawer asserta a story antiga, atualizar a string esperada).

- [ ] **Step 10: Commit**

```bash
git add packages/os/web/src/lib/observedTrail.ts packages/os/web/src/lib/observedTrail.test.ts \
        packages/os/web/src/lib/buildStory.ts packages/os/web/src/lib/buildStory.test.ts \
        packages/os/web/src/components/DetailDrawer.tsx
git commit -m "feat(os/web): manchete narrada do drawer observado + helper de trilha visível"
```

---

### Task 3: WS2b — DecisionCard (forquilha) + evidências acopladas

**Files:**
- Create: `packages/os/web/src/components/DecisionCard.tsx`
- Create: `packages/os/web/src/components/DecisionCard.test.tsx`
- Modify: `packages/os/web/src/components/DetailDrawer.tsx:107-142` (substituir a lista de parágrafos; fundir Evidências na mesma seção)
- Modify: `packages/os/web/src/components/DetailDrawer.test.tsx`
- Modify: `packages/os/web/src/app.css` (estilos novos)

- [ ] **Step 1: Teste do componente (falhando)**

`packages/os/web/src/components/DecisionCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecisionCard } from "./DecisionCard";

const full = {
  what: "Direção estética C como base",
  why: "Escolha do humano via visual companion",
  rejected: "A — sem ruptura; B — coral suave demais",
  ref: "docs/escolha.md",
};

describe("DecisionCard", () => {
  it("destaca o escolhido e esmaece o rejeitado", () => {
    render(<ol><DecisionCard decision={full} onOpenRef={() => {}} /></ol>);
    expect(screen.getByText(full.what).closest(".decision-chosen")).toBeTruthy();
    expect(screen.getByText(full.rejected).closest(".decision-rejected")).toBeTruthy();
    expect(screen.getByText(full.why)).toBeTruthy();
  });

  it("ref .md vira botão que chama onOpenRef", () => {
    const onOpenRef = vi.fn();
    render(<ol><DecisionCard decision={full} onOpenRef={onOpenRef} /></ol>);
    fireEvent.click(screen.getByRole("button", { name: /docs\/escolha\.md/ }));
    expect(onOpenRef).toHaveBeenCalledWith("docs/escolha.md");
  });

  it("ref não-.md renderiza como código inerte", () => {
    render(<ol><DecisionCard decision={{ ...full, ref: "conversa OBS-003" }} onOpenRef={() => {}} /></ol>);
    expect(screen.queryByRole("button", { name: /conversa/ })).toBeNull();
    expect(screen.getByText("conversa OBS-003")).toBeTruthy();
  });

  it("sem rejected/why/ref: só o escolhido", () => {
    render(<ol><DecisionCard decision={{ what: "Só what", why: null, rejected: null, ref: null }} /></ol>);
    expect(screen.getByText("Só what")).toBeTruthy();
    expect(document.querySelector(".decision-rejected")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run web/src/components/DecisionCard.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o componente**

`packages/os/web/src/components/DecisionCard.tsx`:

```tsx
import type { ObservedDecision } from "../../../src/store/types";

/**
 * Card de forquilha de uma decisão observada: o caminho escolhido em destaque,
 * o rejeitado esmaecido ao lado, o porquê como legenda da bifurcação e o ref
 * clicável quando aponta para um .md (abre no MarkdownViewer via onOpenRef).
 */
export function DecisionCard({
  decision,
  onOpenRef,
}: {
  decision: ObservedDecision;
  onOpenRef?: (ref: string) => void;
}) {
  const { what, why, rejected, ref } = decision;
  const refOpens = ref !== null && ref.endsWith(".md") && onOpenRef !== undefined;
  return (
    <li className="decision-fork">
      <div className="decision-chosen">
        <span className="decision-mark" aria-hidden="true">✓</span>
        <p className="decision-what">{what}</p>
      </div>
      {rejected && (
        <div className="decision-rejected">
          <span className="decision-mark" aria-hidden="true">✕</span>
          <p className="decision-rejected-text">{rejected}</p>
        </div>
      )}
      {why && <p className="decision-why">{why}</p>}
      {ref && (
        refOpens ? (
          <button type="button" className="decision-ref mono" onClick={() => onOpenRef!(ref)}>
            {ref} →
          </button>
        ) : (
          <code className="decision-ref mono">{ref}</code>
        )
      )}
    </li>
  );
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS.

- [ ] **Step 5: Integrar no drawer (decisões + evidências numa seção só)**

Em `DetailDrawer.tsx`, substituir o bloco IIFE (linhas 102-142) por:

```tsx
{(() => {
  const shownDecisions = visibleDecisions(obs);
  const shownEvidence = visibleEvidence(obs);
  const openRef = (ref: string) =>
    openFile(`${projectPath}/${ref}`, ref);
  return (
    <>
      <h4 className="drawer-section">Decisões</h4>
      {shownDecisions.length === 0 ? (
        <p className="drawer-empty">nenhuma decisão registrada</p>
      ) : (
        <ol className="obs-decisions">
          {shownDecisions.map((d, i) => (
            <DecisionCard key={i} decision={d} onOpenRef={openRef} />
          ))}
        </ol>
      )}

      {/* Evidências acopladas à trilha (mesma seção, sub-rótulo — não h4 irmã) */}
      {shownEvidence.length > 0 && (
        <>
          <p className="obs-trail-sub">verificações</p>
          <ol className="obs-evidence">
            {shownEvidence.map((e, i) => (
              <li key={i} className="obs-evidence-item">
                <span className="evidence-mark" aria-hidden="true">✓</span>
                {e.cmd && <code className="obs-evidence-cmd">{e.cmd}</code>}
                {e.result && <span className="obs-evidence-result">→ {e.result}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
})()}
```

Notas: o `h4 "Evidências"` e o empty-state "nenhuma evidência registrada" SAEM (evidência vazia simplesmente não renderiza — sub-trilha é opcional, não seção prometida). `projectPath` já está desestruturado na linha 33. Importar `DecisionCard`.

- [ ] **Step 6: Estilos**

Em `app.css`, junto dos estilos `obs-*` existentes:

```css
/* Forquilha de decisão: escolhido em destaque, rejeitado esmaecido */
.decision-fork { margin: 0 0 12px; padding: 10px 12px; background: var(--surface-soft); border: 1px solid var(--border-soft); border-radius: 8px; }
.decision-chosen { display: flex; gap: 8px; align-items: baseline; }
.decision-chosen .decision-what { margin: 0; font-weight: 600; }
.decision-rejected { display: flex; gap: 8px; align-items: baseline; opacity: 0.55; margin-top: 4px; }
.decision-rejected-text { margin: 0; font-size: 12.5px; }
.decision-mark { flex: none; font-size: 11px; }
.decision-why { margin: 6px 0 0 19px; font-size: 12.5px; color: var(--text-dim); }
.decision-ref { display: inline-block; margin: 6px 0 0 19px; font-size: 11px; }
button.decision-ref { border: 1px solid var(--border); background: var(--surface); border-radius: 6px; padding: 2px 8px; cursor: pointer; color: var(--accent); }
.obs-trail-sub { margin: 14px 0 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-mute); }
.obs-evidence-item { display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; }
.evidence-mark { flex: none; color: var(--done); font-size: 11px; }
.obs-evidence-result { color: var(--text-dim); }
```

(Remover regras `obs-decision-*` antigas que ficarem órfãs — conferir com grep antes.)

- [ ] **Step 7: Atualizar testes do drawer e rodar**

Em `DetailDrawer.test.tsx`: asserts que esperavam `h4 "Evidências"`/empty-state de evidência mudam para a nova estrutura (sub-rótulo "verificações" presente só quando há evidência).

Run: `npx vitest run web/src/components/DetailDrawer.test.tsx web/src/components/DecisionCard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/os/web/src/components/DecisionCard.tsx packages/os/web/src/components/DecisionCard.test.tsx \
        packages/os/web/src/components/DetailDrawer.tsx packages/os/web/src/components/DetailDrawer.test.tsx \
        packages/os/web/src/app.css
git commit -m "feat(os/web): decisão como card de forquilha + evidências acopladas à trilha"
```

---

### Task 4: WS2c — Parecer não renderiza em observado sem parecer

**Files:**
- Modify: `packages/os/web/src/components/DetailDrawer.tsx:245-262`
- Modify: `packages/os/web/src/components/DetailDrawer.test.tsx`

- [ ] **Step 1: Teste (falhando)**

Em `DetailDrawer.test.tsx`:

```tsx
it("observado sem parecer: seção 'Parecer de entrega' não renderiza", () => {
  // usar a fixture observada existente do arquivo, com deliveryReport: null
  render(<DetailDrawer item={observedItemWithoutReport} onClose={() => {}} />);
  expect(screen.queryByText("Parecer de entrega")).toBeNull();
  expect(screen.queryByText("sem parecer de entrega ainda")).toBeNull();
});

it("observado COM parecer: seção renderiza", () => {
  render(<DetailDrawer item={observedItemWithReport} onClose={() => {}} />);
  expect(screen.getByText("Parecer de entrega")).toBeTruthy();
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run web/src/components/DetailDrawer.test.tsx` → FAIL.

- [ ] **Step 3: Implementar**

No bloco observado do fim do drawer (linha 246), trocar `{obs && (` por `{obs && spec.deliveryReport && (` no trecho do parecer — o link `report.html` continua incondicional dentro do bloco `obs`:

```tsx
{obs && (
  <>
    {spec.deliveryReport && (
      <>
        <h4 className="drawer-section">Parecer de entrega</h4>
        <DeliveryReportBlock report={spec.deliveryReport} onOpenFile={openFile} />
      </>
    )}
    {spec.cost.reportPath && (
      /* ...link report.html inalterado... */
    )}
  </>
)}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/os/web/src/components/DetailDrawer.tsx packages/os/web/src/components/DetailDrawer.test.tsx
git commit -m "fix(os/web): drawer observado não renderiza seção de parecer inexistente"
```

---

### Task 5: WS2d — Pirâmide invertida no parecer SDD

**Files:**
- Create: `packages/os/web/src/lib/markdownText.ts`
- Create: `packages/os/web/src/lib/markdownText.test.ts`
- Modify: `packages/os/web/src/components/DeliveryReportBlock.tsx:30-50`
- Modify: `packages/os/web/src/components/DeliveryReportBlock.test.tsx`
- Modify: `packages/os/web/src/app.css`

- [ ] **Step 1: Teste do extrator de primeira frase (falhando)**

`packages/os/web/src/lib/markdownText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { firstSentence } from "./markdownText";

describe("firstSentence", () => {
  it("extrai a primeira frase de prosa simples", () => {
    expect(firstSentence("Foi entregue X. Depois Y.")).toBe("Foi entregue X.");
  });
  it("remove marcação markdown", () => {
    expect(firstSentence("**Foi** `entregue` [X](http://a). Resto.")).toBe("Foi entregue X.");
  });
  it("trunca em max chars com reticências", () => {
    const long = "a".repeat(300) + ".";
    expect(firstSentence(long, 50)).toHaveLength(50);
    expect(firstSentence(long, 50).endsWith("…")).toBe(true);
  });
  it("texto sem pontuação final: devolve o que há", () => {
    expect(firstSentence("sem ponto final")).toBe("sem ponto final");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run web/src/lib/markdownText.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`packages/os/web/src/lib/markdownText.ts`:

```ts
// Primeira frase de um markdown, em texto plano — teaser de one-liner na UI.
export function firstSentence(md: string, max = 140): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : plain).trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS.

- [ ] **Step 5: Testes da pirâmide (falhando)**

Em `DeliveryReportBlock.test.tsx` (reusar as fixtures de report existentes do arquivo):

```tsx
it("respostas vitais aparecem primeiro, com teaser; demais atrás de 'ler parecer completo'", () => {
  render(<DeliveryReportBlock report={fullReport} onOpenFile={() => {}} />);
  const vitals = screen.getAllByTestId("delivery-vital");
  expect(vitals.map((v) => v.textContent)).toEqual(
    expect.arrayContaining([expect.stringContaining("O que foi entregue")]),
  );
  expect(screen.getByText(/ler parecer completo/)).toBeTruthy();
});

it("evidenceRef .md absoluto vira botão; ref texto continua inerte", () => {
  const onOpenFile = vi.fn();
  // fixture: answer com evidenceRefs ["/abs/delivery-facts.md", "src/x.ts:42"]
  render(<DeliveryReportBlock report={reportWithRefs} onOpenFile={onOpenFile} />);
  fireEvent.click(screen.getByRole("button", { name: /delivery-facts\.md/ }));
  expect(onOpenFile).toHaveBeenCalledWith("/abs/delivery-facts.md", "delivery-facts.md");
  expect(screen.getByText("src/x.ts:42")).toBeTruthy();
});
```

- [ ] **Step 6: Rodar e ver falhar** — `npx vitest run web/src/components/DeliveryReportBlock.test.tsx` → FAIL.

- [ ] **Step 7: Implementar a pirâmide**

Em `DeliveryReportBlock.tsx`, substituir o map único (linhas 30-50) por vitais + resto:

```tsx
import { firstSentence } from "../lib/markdownText";

const VITAL_KEYS = ["what_was_done", "why_this_way", "risks_and_pending"];

// ...dentro do componente:
const vitals = VITAL_KEYS
  .map((k) => report.answers.find((a) => a.key === k))
  .filter((a): a is NonNullable<typeof a> => a != null);
const rest = report.answers.filter((a) => !VITAL_KEYS.includes(a.key));

const renderAnswer = (a: (typeof report.answers)[number], open: boolean, vital: boolean) => {
  const c = confidenceLabel(a.confidence);
  return (
    <details key={a.key} className="delivery-answer" open={open}
             data-testid={vital ? "delivery-vital" : undefined}>
      <summary className="delivery-answer-summary">
        <span className="delivery-answer-title">{answerTitle(a.key)}</span>
        {vital && <span className="delivery-answer-teaser">{firstSentence(a.answer)}</span>}
        <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
      </summary>
      <Markdown className="delivery-answer-text">{a.answer}</Markdown>
      {a.evidenceRefs.length > 0 && (
        <ul className="delivery-evidence">
          {a.evidenceRefs.map((ref) =>
            ref.endsWith(".md") && ref.startsWith("/") && onOpenFile ? (
              <li key={ref} className="delivery-evidence-ref">
                <button type="button" className="delivery-ref-btn mono"
                        onClick={() => onOpenFile(ref, ref.split("/").pop()!)}>
                  {ref} →
                </button>
              </li>
            ) : (
              <li key={ref} className="delivery-evidence-ref mono">{ref}</li>
            ),
          )}
        </ul>
      )}
    </details>
  );
};

// JSX:
<div className="delivery-answers">
  {vitals.map((a, i) => renderAnswer(a, i === 0, true))}
  {rest.length > 0 && (
    <details className="delivery-more">
      <summary>ler parecer completo ({rest.length} respostas)</summary>
      {rest.map((a) => renderAnswer(a, false, false))}
    </details>
  )}
</div>
```

Critério do botão: só ref **absoluto** terminando em `.md` é clicável — o componente não conhece `projectPath`, então ref relativo não é resolvível com segurança aqui (YAGNI; o `mdPath` do report já cobre a narrativa completa).

- [ ] **Step 8: Estilos**

```css
.delivery-answer-teaser { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-dim); margin: 0 8px; }
.delivery-more > summary { cursor: pointer; font-size: 12.5px; color: var(--text-dim); padding: 6px 0; }
button.delivery-ref-btn { border: 0; background: transparent; color: var(--accent); cursor: pointer; padding: 0; font-size: inherit; }
```

(`.delivery-answer-summary` pode precisar de `display: flex; align-items: center;` se ainda não tiver — conferir.)

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx web/src/lib/markdownText.test.ts`
Expected: PASS (atualizar asserts antigos que esperavam as 11 respostas como irmãs diretas).

- [ ] **Step 10: Commit**

```bash
git add packages/os/web/src/lib/markdownText.ts packages/os/web/src/lib/markdownText.test.ts \
        packages/os/web/src/components/DeliveryReportBlock.tsx packages/os/web/src/components/DeliveryReportBlock.test.tsx \
        packages/os/web/src/app.css
git commit -m "feat(os/web): parecer em pirâmide invertida — vitais com teaser, resto colapsado, refs .md clicáveis"
```

---

### Task 6: WS3a — Dormência por gravidade

**Files:**
- Modify: `packages/os/web/src/lib/kanbanObserved.ts` (nova `isDormant` ao lado de `isArchived`)
- Modify: `packages/os/web/src/lib/kanbanObserved.test.ts`
- Modify: `packages/os/web/src/components/Board.tsx:54-58`
- Modify: `packages/os/web/src/components/Board.test.tsx`
- Modify: `packages/os/web/src/components/SpecTable.tsx:85-89` (chip "dormindo")
- Modify: `packages/os/web/src/app.css`

- [ ] **Step 1: Testes de `isDormant` (falhando)**

Em `kanbanObserved.test.ts` (seguir o padrão dos testes de `isArchived` no mesmo arquivo):

```ts
import { isDormant, DORMANT_AFTER_DAYS } from "./kanbanObserved";

const NOW = Date.parse("2026-06-12T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("isDormant", () => {
  it("running parado há mais de 3 dias dorme", () => {
    expect(isDormant(makeSpec({ status: "running", lastActivityAt: daysAgo(4) }), NOW)).toBe(true);
  });
  it("running ativo recentemente não dorme", () => {
    expect(isDormant(makeSpec({ status: "running", lastActivityAt: daysAgo(1) }), NOW)).toBe(false);
  });
  it("limite exclusivo: exatamente N dias ainda não dorme", () => {
    expect(isDormant(makeSpec({ status: "running", lastActivityAt: daysAgo(DORMANT_AFTER_DAYS) }), NOW)).toBe(false);
  });
  it("terminais nunca dormem (regra de arquivo cuida deles)", () => {
    expect(isDormant(makeSpec({ status: "done", lastActivityAt: daysAgo(30) }), NOW)).toBe(false);
    expect(isDormant(makeSpec({ status: "abandoned", lastActivityAt: daysAgo(30) }), NOW)).toBe(false);
  });
  it("sem lastActivityAt: conservador, não dorme", () => {
    expect(isDormant(makeSpec({ status: "running", lastActivityAt: null }), NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run web/src/lib/kanbanObserved.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

Em `kanbanObserved.ts`, abaixo de `isArchived`:

```ts
export const DORMANT_AFTER_DAYS = 3;

/**
 * Sessão dormente = não-terminal, parada há mais que o limite. Sai das colunas
 * ativas por gravidade (ninguém fecha sessão por disciplina); volta sozinha se
 * houver atividade nova. Terminais não dormem — isArchived cuida deles.
 * Sem lastActivityAt → conservador, NÃO dorme. Limite exclusivo, como isArchived.
 */
export function isDormant(spec: Spec, now: number, dormantAfterDays: number = DORMANT_AFTER_DAYS): boolean {
  if (spec.status === "done" || spec.status === "abandoned") return false;
  if (spec.lastActivityAt == null) return false;
  const ageDays = (now - Date.parse(spec.lastActivityAt)) / DAY_MS;
  return ageDays > dormantAfterDays;
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS.

- [ ] **Step 5: Roteamento no Board + chip na tabela (teste primeiro)**

Em `Board.test.tsx`:

```tsx
it("sessão dormente sai do kanban e aparece em arquivadas", () => {
  // fixture: spec running com lastActivityAt 10 dias atrás
  render(<Board onHide={() => {}} />); // com provider/fixtures do arquivo
  expect(screen.queryByText(dormantSpec.title)).toBeNull(); // kanban
  fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
  expect(screen.getByText(dormantSpec.title)).toBeTruthy();
  expect(screen.getByText("dormindo")).toBeTruthy();
});
```

Run → FAIL. Implementar em `Board.tsx:54-58`:

```ts
import { flattenSpecs, matchesQuery, isArchived, isDormant, type SpecWithProject } from "../lib/kanbanObserved";

const shown = visible.filter((sp) =>
  view === "archived"
    ? isArchived(sp.spec, now, archiveAfterDays) || isDormant(sp.spec, now)
    : !isArchived(sp.spec, now, archiveAfterDays) && !isDormant(sp.spec, now),
);
```

E em `SpecTable.tsx`, na célula de status (linhas 85-89):

```tsx
<td>
  <span className={`status status-${it.spec.status}`}>
    {STATUS_LABEL[it.spec.status]}
  </span>
  {isDormant(it.spec, Date.now()) && (
    <span className="status-dormant" title={`sem atividade há mais de ${DORMANT_AFTER_DAYS} dias`}>
      dormindo
    </span>
  )}
</td>
```

com `import { isDormant, DORMANT_AFTER_DAYS } from "../lib/kanbanObserved";`. CSS:

```css
.status-dormant { margin-left: 6px; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--surface-soft); border: 1px solid var(--border); color: var(--text-mute); }
```

Atualizar também o empty-state de arquivadas em `Board.tsx:110` para refletir o conteúdo novo: `Nenhuma feature arquivada ou dormente.`

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run web/src/components/Board.test.tsx web/src/components/SpecTable.test.tsx web/src/lib/kanbanObserved.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/os/web/src/lib/kanbanObserved.ts packages/os/web/src/lib/kanbanObserved.test.ts \
        packages/os/web/src/components/Board.tsx packages/os/web/src/components/Board.test.tsx \
        packages/os/web/src/components/SpecTable.tsx packages/os/web/src/app.css
git commit -m "feat(os/web): dormência por gravidade — sessão parada sai das colunas ativas"
```

---

### Task 7: WS3b — Vocabulário honesto por estado

**Files:**
- Modify: `packages/os/web/src/components/KanbanCard.tsx:51-100`
- Modify: `packages/os/web/src/components/KanbanCard.test.tsx`
- Modify: `packages/os/web/src/lib/buildStory.ts` (ramo observado: caso terminal sem report)
- Modify: `packages/os/web/src/lib/buildStory.test.ts`
- Modify: `packages/os/web/src/app.css`

Regra (princípio "três estados, três vocabulários"): **(i)** sessão ativa coletando → "(em coleta)", neutro; **(ii)** conceito que não se aplica → não renderiza; **(iii)** terminal sem dado que deveria existir → "custo não capturado", âmbar com tooltip.

- [ ] **Step 1: Testes (falhando)**

Em `KanbanCard.test.tsx`:

```tsx
it("observado TERMINAL sem cost_report: 'custo não capturado' em vez de '(em coleta)'", () => {
  // fixture observada: status "done", cost.source "partial", totalCostUsd 5.11
  render(<KanbanCard item={doneObservedPartial} onSelect={() => {}} />);
  expect(screen.getByText(/custo não capturado/)).toBeTruthy();
  expect(screen.queryByText(/em coleta/)).toBeNull();
});

it("SDD sem custo: 'sem custo registrado' em vez de 'em planejamento'", () => {
  render(<KanbanCard item={sddEmptyCost} onSelect={() => {}} />);
  expect(screen.getByText("sem custo registrado")).toBeTruthy();
  expect(screen.queryByText("em planejamento")).toBeNull();
});
```

Em `buildStory.test.ts`:

```ts
it("observado terminal com custo parcial: marca 'custo não capturado'", () => {
  const spec = makeSpec({ status: "done", observed: obsBase,
    cost: { ...emptyCost, source: "partial", totalCostUsd: 5.11, totalTokens: 100 } });
  expect(buildStory(spec, NOW)).toContain("custo não capturado");
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run web/src/components/KanbanCard.test.tsx web/src/lib/buildStory.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`KanbanCard.tsx` — no `renderCostLabel`, ramo observado:

```tsx
const terminal = spec.status === "done" || spec.status === "abandoned";

if (isObserved) {
  if (totalCostUsd !== null) {
    return (
      <>
        {fmtUsd(totalCostUsd)}
        {source === "partial" && (terminal ? (
          <span className="cost-uncaptured" title="sessão encerrada sem cost-report.json publicado — valor é a soma dos snapshots"> · custo não capturado</span>
        ) : (
          <span className="cost-partial"> (em coleta)</span>
        ))}
      </>
    );
  }
  // ...demais ramos: aplicar o mesmo ternário terminal/(em coleta) ao fallback de tokens:
  if (totalTokens > 0) {
    return terminal
      ? <span className="cost-uncaptured" title="sessão encerrada sem cost-report.json publicado">{fmtTokens(totalTokens)} tokens · custo não capturado</span>
      : <span className="cost-empty">{fmtTokens(totalTokens)} tokens (em coleta)</span>;
  }
  /* ramo cost_report e 'sem custo ainda' inalterados */
}

// Ramo SDD:
if (source === "empty") {
  return <span className="cost-empty">sem custo registrado</span>;
}
```

`buildStory.ts` — no ramo observado, o trecho de custo ganha o mesmo critério:

```ts
} else if (cost.totalTokens > 0) {
  parts.push(terminal
    ? `${fmtTokens(cost.totalTokens)} tokens · custo não capturado`
    : `${fmtTokens(cost.totalTokens)} tokens (em coleta)`);
}
```

e quando `totalCostUsd !== null && cost.source === "partial" && terminal`, anexar `"custo não capturado"` após o valor. CSS:

```css
.cost-uncaptured { color: var(--paused); }
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando, Expected: PASS (atualizar snapshots/strings antigas que citavam "em planejamento").

- [ ] **Step 5: Commit**

```bash
git add packages/os/web/src/components/KanbanCard.tsx packages/os/web/src/components/KanbanCard.test.tsx \
        packages/os/web/src/lib/buildStory.ts packages/os/web/src/lib/buildStory.test.ts packages/os/web/src/app.css
git commit -m "polish(os/web): vocabulário de custo honesto por estado (coleta × não capturado × sem registro)"
```

---

### Task 8: WS4 — Estética Anthropic Studio (tokens + calibração)

**Files:**
- Modify: `packages/os/web/src/app.css` (`:root` + hexes hardcoded fora do `:root`)

- [ ] **Step 1: Trocar o bloco `:root`**

```css
:root {
  --bg: #EEEAE3;
  --surface: #F7F5F0;
  --surface-soft: #F1EDE5;
  --border: #D8D2C8;
  --border-soft: #E4DFD6;
  --text: #1F1B15;
  --text-dim: #6E6459;
  --text-mute: #9E9186;
  --accent: #B85C3C;

  --running: #B85C3C;
  --paused: #A8742F;
  --blocked: #B0312A;
  --done: #2E8B57;
  --escalated: #8E5BA6;
  --audit: #A8742F;
  --planning: #9E9186;
  --planned: #A8742F;

  --sdd: #B85C3C;
  --discovery: #2E7D74;

  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(60, 30, 10, 0.05);
  --shadow-lift: 0 4px 12px rgba(60, 30, 10, 0.10);
}
```

- [ ] **Step 2: Atualizar hexes hardcoded fora do `:root`**

Rodar `grep -n "#2563eb\|#60a5fa\|#f3f4f6\|#f0fdf4\|#bbf7d0\|#15803d\|#fffbeb\|#fde68a\|#b45309" packages/os/web/src/app.css` e aplicar o mapa:

| Hex atual | Substituto | Onde aparece |
|---|---|---|
| `linear-gradient(135deg, #2563eb, #60a5fa)` | `linear-gradient(135deg, #B85C3C, #D98E6A)` | `.brand-mark` |
| `#f3f4f6` (inputs/segmento/hover) | `#ECE7DE` | `.search`, `.seg`, `.chip-hide:hover` |
| `#f0fdf4` / `#bbf7d0` / `#15803d` (conn-up) | `#EAF3EC` / `#C2DCC8` / `#1E5E3B` | `.conn-up` |
| `#fffbeb` / `#fde68a` / `#b45309` (conn-down) | `#FBF3E4` / `#EBD5A8` / `#8C5A1D` | `.conn-down` |

Hexes de status inline que apareçam no grep (ex.: tons de badge) trocam pelo token correspondente quando existir; os que sobrarem entram na calibração do Step 3.

- [ ] **Step 3: CHECKPOINT com o usuário — calibração ao vivo**

O usuário aprovou a direção C "com refinamento de tom". Com o dev server de pé:
1. Screenshot do board + drawer com os tokens novos.
2. Apresentar ao usuário e iterar nos valores (`--bg`/`--accent` são os mais sensíveis) até o ok.
3. Conferir contraste dos textos dim/mute sobre o fundo novo (WCAG AA ~4.5:1 para texto pequeno).

**Não commitar antes do ok do usuário.**

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npx vitest run` (em `packages/os/`)
Expected: PASS — tokens não afetam testes; qualquer quebra aqui é acidente de outra task.

- [ ] **Step 5: Commit**

```bash
git add packages/os/web/src/app.css
git commit -m "feat(os/web): tema Anthropic Studio — paleta quente creme + ferrugem"
```

---

### Task 9: Verificação final integrada

- [ ] **Step 1: Suíte completa** — `npx vitest run` em `packages/os/`. Expected: PASS, zero skips novos.

- [ ] **Step 2: Verificação visual no browser (dados reais)**

Com `npm run dev`: ① board sem scroll horizontal, 3 colunas iguais; ② card OBS-003 com manchete nova; ③ drawer OBS-003: forquilhas de decisão, verificações acopladas, SEM "Parecer de entrega"; ④ drawer de uma feature SDD com parecer: vitais + "ler parecer completo"; ⑤ vista Arquivadas: dormentes presentes com chip "dormindo"; ⑥ tema quente em tudo (sem ilha azul esquecida).

- [ ] **Step 3: Screenshot final para o usuário** — capturar board + drawer e enviar como prova da entrega.
