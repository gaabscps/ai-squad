# UX markdown do parecer (e .md viewer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o delivery-report (e os `.md` do board) legíveis — renderizar markdown (negrito/código/listas/tabelas), pôr as 11 respostas e os ACs em accordion colapsável, e abrir os `.md` num visualizador in-app estilizado.

**Architecture:** Um componente `Markdown` (react-markdown + remark-gfm) vira a peça única de render. O `DeliveryReportBlock` passa a usar `<details>` nativo (accordion) com markdown nos corpos. Um `MarkdownViewer` (modal) busca `.md` via `/file` (texto cru, sem mexer no backend) e renderiza; o `DetailDrawer` guarda o estado do viewer e passa `onOpenFile` pro `Timeline` e pro `DeliveryReportBlock`.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react, react-markdown@9 + remark-gfm@4.

> **Local do plano:** `docs/specs/` (convenção do projeto). READ-ONLY preservado: nada novo escreve em disco; o viewer só faz `GET /file`.

---

## File Structure

- Create: `web/src/components/Markdown.tsx` (+ test) — wrapper react-markdown.
- Create: `web/src/components/MarkdownViewer.tsx` (+ test) — modal de `.md`.
- Modify: `web/src/lib/deliveryLabels.ts` (+ test) — helper `acClassificationSummary`.
- Modify: `web/src/components/DeliveryReportBlock.tsx` (+ test) — accordion + markdown + onOpenFile.
- Modify: `web/src/components/Timeline.tsx` (+ test) — links viram botões + onOpenFile.
- Modify: `web/src/components/DetailDrawer.tsx` — estado do viewer + fiação.
- Modify: `web/src/components/SpecSummaryBlock.tsx` (+ test se quebrar) — texto via `<Markdown>`.
- Modify: `web/src/app.css` — `.md-body`, accordion, viewer, botões do Timeline.
- Modify: `package.json` — deps react-markdown + remark-gfm.

---

## Task 1: Dependência + componente `Markdown` + CSS `.md-body`

**Files:**
- Modify: `package.json` (via npm install)
- Create: `web/src/components/Markdown.tsx`
- Test: `web/src/components/Markdown.test.tsx`
- Modify: `web/src/app.css`

- [ ] **Step 1: Instalar as dependências**

Run: `npm install react-markdown@^9 remark-gfm@^4`
Expected: ambas entram em `dependencies` do `package.json`; `npm ls react-markdown` resolve sem erro.

- [ ] **Step 2: Escrever o teste que falha**

Criar `web/src/components/Markdown.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renderiza negrito, código inline e listas como tags (não texto cru)", () => {
    render(<Markdown>{"texto **forte** e `code`\n\n- um\n- dois"}</Markdown>);
    expect(screen.getByText("forte").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renderiza tabela gfm", () => {
    render(<Markdown>{"| a | b |\n|---|---|\n| 1 | 2 |"}</Markdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("a").tagName).toBe("TH");
  });

  it("aceita className extra além de md-body", () => {
    const { container } = render(<Markdown className="x">{"oi"}</Markdown>);
    expect(container.querySelector(".md-body.x")).not.toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run web/src/components/Markdown.test.tsx`
Expected: FAIL — módulo `./Markdown` não existe.

- [ ] **Step 4: Implementar `web/src/components/Markdown.tsx`**

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Peça única de renderização de markdown no app. Sem rehype-raw de propósito:
// react-markdown NÃO injeta HTML cru por padrão, então conteúdo entre tags é
// escapado (seguro). O estilo de cada elemento vem do CSS escopado em .md-body.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `md-body ${className}` : "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run web/src/components/Markdown.test.tsx`
Expected: PASS. (Se houver erro de ESM ao importar react-markdown no vitest, confirme que está usando react-markdown v9 — ESM — com vitest 2; normalmente funciona sem config extra.)

- [ ] **Step 6: Adicionar o CSS `.md-body` ao fim de `web/src/app.css`**

```css
/* ── Markdown renderizado (.md-body) ────────────────────────────────────── */
.md-body { font-size: 0.85rem; line-height: 1.55; color: #1f2937; }
.md-body > :first-child { margin-top: 0; }
.md-body > :last-child { margin-bottom: 0; }
.md-body h1, .md-body h2, .md-body h3, .md-body h4 { margin: 0.8em 0 0.35em; font-weight: 700; line-height: 1.25; }
.md-body h1 { font-size: 1.15rem; }
.md-body h2 { font-size: 1.05rem; }
.md-body h3 { font-size: 0.95rem; }
.md-body h4 { font-size: 0.88rem; }
.md-body p { margin: 0 0 0.6em; }
.md-body ul, .md-body ol { margin: 0 0 0.6em; padding-left: 1.4em; }
.md-body li { margin: 0.15em 0; }
.md-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; background: #eef1f4; color: #1f2937; padding: 0.05em 0.35em; border-radius: 4px; }
.md-body pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 0.6rem 0.8rem; overflow-x: auto; margin: 0 0 0.6em; }
.md-body pre code { background: none; padding: 0; font-size: 0.8rem; }
.md-body a { color: #2563eb; text-decoration: none; }
.md-body a:hover { text-decoration: underline; }
.md-body blockquote { margin: 0 0 0.6em; padding: 0.2em 0.8em; border-left: 3px solid #d1d5db; color: #4b5563; }
.md-body table { border-collapse: collapse; width: 100%; margin: 0 0 0.6em; font-size: 0.8rem; }
.md-body th, .md-body td { border: 1px solid #e5e7eb; padding: 0.3em 0.5em; text-align: left; vertical-align: top; }
.md-body th { background: #f9fafb; font-weight: 700; }
.md-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 0.8em 0; }
```

- [ ] **Step 7: Rodar a suíte do front afetada e commitar**

Run: `npx vitest run web/src/components/Markdown.test.tsx`
Expected: PASS.

```bash
git add package.json package-lock.json web/src/components/Markdown.tsx web/src/components/Markdown.test.tsx web/src/app.css
git commit -m "feat: componente Markdown (react-markdown + remark-gfm) + estilos .md-body"
```

---

## Task 2: `MarkdownViewer` (modal de `.md`) + CSS

**Files:**
- Create: `web/src/components/MarkdownViewer.tsx`
- Test: `web/src/components/MarkdownViewer.test.tsx`
- Modify: `web/src/app.css`

- [ ] **Step 1: Escrever o teste que falha**

Criar `web/src/components/MarkdownViewer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MarkdownViewer } from "./MarkdownViewer";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve("# Título\n\ncorpo **forte**") }),
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("MarkdownViewer", () => {
  it("não renderiza nada quando path é null", () => {
    const { container } = render(<MarkdownViewer path={null} title="" onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("busca o path e renderiza o markdown", async () => {
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Título")).toBeInTheDocument());
    expect(screen.getByText("forte").tagName).toBe("STRONG");
    expect(fetch).toHaveBeenCalledWith(
      "/file?path=" + encodeURIComponent("/x/spec.md"),
      expect.anything(),
    );
  });

  it("mostra erro quando o fetch falha", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("boom"))));
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/erro/i)).toBeInTheDocument());
  });

  it("✕ chama onClose", () => {
    const onClose = vi.fn();
    render(<MarkdownViewer path="/x/spec.md" title="spec.md" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("fechar"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run web/src/components/MarkdownViewer.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `web/src/components/MarkdownViewer.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";

// Modal read-only que busca um .md via /file (texto cru) e renderiza com <Markdown>.
// Não muda nada no backend: /file já serve .md como text/plain.
export function MarkdownViewer({
  path,
  title,
  onClose,
}: {
  path: string | null;
  title: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (path == null) {
      setText(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setText(null);
    fetch(`/file?path=${encodeURIComponent(path)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        setText(t);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [path]);

  useEffect(() => {
    if (path == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, onClose]);

  if (path == null) return null;

  return (
    <div className="md-viewer-overlay" onClick={onClose}>
      <div className="md-viewer" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="md-viewer-head">
          <span className="md-viewer-title mono">{title}</span>
          <button type="button" className="md-viewer-close" aria-label="fechar" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="md-viewer-body">
          {loading && <p className="md-viewer-hint">carregando…</p>}
          {error && <p className="md-viewer-hint">erro ao carregar: {error}</p>}
          {text != null && <Markdown>{text}</Markdown>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run web/src/components/MarkdownViewer.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 5: Adicionar o CSS do viewer ao fim de `web/src/app.css`**

```css
/* ── Markdown viewer (modal de .md) ─────────────────────────────────────── */
.md-viewer-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.4);
  display: flex; justify-content: center; align-items: flex-start;
  padding: 3rem 1rem;
}
.md-viewer {
  background: #fff; border-radius: 10px;
  width: min(820px, 100%); max-height: 85vh;
  display: flex; flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}
.md-viewer-head {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.7rem 1rem; border-bottom: 1px solid #eee;
}
.md-viewer-title { flex: 1; font-size: 0.85rem; color: #374151; }
.md-viewer-close { background: none; border: none; font-size: 1rem; cursor: pointer; color: #6b7280; }
.md-viewer-body { padding: 1rem 1.25rem; overflow-y: auto; }
.md-viewer-hint { color: #6b7280; font-style: italic; }
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/MarkdownViewer.tsx web/src/components/MarkdownViewer.test.tsx web/src/app.css
git commit -m "feat: MarkdownViewer (modal in-app para .md)"
```

---

## Task 3: Helper `acClassificationSummary`

**Files:**
- Modify: `web/src/lib/deliveryLabels.ts`
- Test: `web/src/lib/deliveryLabels.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `web/src/lib/deliveryLabels.test.ts` (no topo, incluir `acClassificationSummary` no import existente de `./deliveryLabels`):

```ts
describe("acClassificationSummary", () => {
  it("resume contagens por classificação, na ordem canônica, pluralizando", () => {
    const acs = [
      { classification: "met" }, { classification: "met" },
      { classification: "partially_met" }, { classification: "not_met" },
    ];
    expect(acClassificationSummary(acs)).toBe("2 atendidos · 1 parcialmente atendido · 1 não atendido");
  });

  it("vazio → string vazia", () => {
    expect(acClassificationSummary([])).toBe("");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run web/src/lib/deliveryLabels.test.ts`
Expected: FAIL — `acClassificationSummary` não existe.

- [ ] **Step 3: Implementar o helper em `web/src/lib/deliveryLabels.ts`**

Adicionar ao fim do arquivo:

```ts
// Resume a tabela de ACs por classificação, ex.: "25 atendidos · 6 parcialmente atendidos".
// Ordem canônica met→partial→not_met→not_validated, depois quaisquer valores desconhecidos.
// Plural simples: +"s" quando a contagem > 1 (vale pros 4 rótulos canônicos).
export function acClassificationSummary(acs: { classification: string }[]): string {
  const order = ["met", "partially_met", "not_met", "not_validated"];
  const counts = new Map<string, number>();
  for (const ac of acs) counts.set(ac.classification, (counts.get(ac.classification) ?? 0) + 1);
  const keys = [
    ...order.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !order.includes(k)),
  ];
  return keys
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${classificationLabel(k).label}${n > 1 ? "s" : ""}`;
    })
    .join(" · ");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run web/src/lib/deliveryLabels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/deliveryLabels.ts web/src/lib/deliveryLabels.test.ts
git commit -m "feat: acClassificationSummary para o cabeçalho colapsável de ACs"
```

---

## Task 4: `DeliveryReportBlock` → accordion + markdown + ACs colapsáveis

**Files:**
- Modify: `web/src/components/DeliveryReportBlock.tsx`
- Test: `web/src/components/DeliveryReportBlock.test.tsx`
- Modify: `web/src/app.css`

- [ ] **Step 1: Atualizar o teste**

Substituir o conteúdo de `web/src/components/DeliveryReportBlock.test.tsx` por:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeliveryReportBlock } from "./DeliveryReportBlock";
import { makeDeliveryReport } from "../test-utils";

describe("DeliveryReportBlock", () => {
  it("sem report mostra placeholder", () => {
    render(<DeliveryReportBlock report={null} />);
    expect(screen.getByText("sem parecer de entrega ainda")).toBeInTheDocument();
  });

  it("veredicto, respostas em accordion com confidence, e markdown renderizado", () => {
    const report = makeDeliveryReport({
      answers: [
        { key: "what_was_done", answer: "entregou **o módulo** novo", confidence: "recorded", evidenceRefs: ["d#f"] },
        { key: "risks_and_pending", answer: "risco Y", confidence: "inferred", evidenceRefs: [] },
      ],
    });
    render(<DeliveryReportBlock report={report} />);
    expect(screen.getByText("Aprovado com ressalvas")).toBeInTheDocument();
    // título e badge no summary
    expect(screen.getByText("O que foi entregue")).toBeInTheDocument();
    expect(screen.getByText("registrado")).toBeInTheDocument();
    expect(screen.getByText("inferido")).toBeInTheDocument();
    // markdown da primeira resposta (aberta por padrão) vira <strong>
    expect(screen.getByText("o módulo").tagName).toBe("STRONG");
    // chip de evidence
    expect(screen.getByText("d#f")).toBeInTheDocument();
  });

  it("a primeira resposta abre por padrão; as demais ficam fechadas", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    const items = document.querySelectorAll("details.delivery-answer");
    expect(items[0]).toHaveProperty("open", true);
    expect(items[1]).toHaveProperty("open", false);
  });

  it("ACs em seção colapsável com resumo de contagem", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport()} />);
    // makeDeliveryReport: AC-001 met + AC-002 partially_met
    expect(screen.getByText(/Critérios de aceite/)).toBeInTheDocument();
    expect(screen.getByText(/1 atendido · 1 parcialmente atendido/)).toBeInTheDocument();
    expect(screen.getByText("AC-001")).toBeInTheDocument();
  });

  it("'ver narrativa completa' é botão e chama onOpenFile com o path do .md", () => {
    const onOpenFile = vi.fn();
    render(<DeliveryReportBlock report={makeDeliveryReport()} onOpenFile={onOpenFile} />);
    const btn = screen.getByRole("button", { name: /ver narrativa completa/ });
    btn.click();
    expect(onOpenFile).toHaveBeenCalledWith("/x/delivery-report.md", "delivery-report.md");
  });

  it("sem mdPath não mostra o botão de narrativa", () => {
    render(<DeliveryReportBlock report={makeDeliveryReport({ mdPath: null })} />);
    expect(screen.queryByRole("button", { name: /ver narrativa completa/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx`
Expected: FAIL (accordion/markdown/onOpenFile ainda não existem).

- [ ] **Step 3: Reescrever `web/src/components/DeliveryReportBlock.tsx`**

```tsx
import type { DeliveryReport } from "../../../src/store/types";
import { answerTitle, verdictLabel, confidenceLabel, classificationLabel, acClassificationSummary } from "../lib/deliveryLabels";
import { Markdown } from "./Markdown";

export function DeliveryReportBlock({
  report,
  onOpenFile,
}: {
  report: DeliveryReport | null | undefined;
  onOpenFile?: (path: string, title: string) => void;
}) {
  if (!report) {
    return <p className="delivery-empty">sem parecer de entrega ainda</p>;
  }

  const v = report.verdict ? verdictLabel(report.verdict.value) : null;

  return (
    <section className="delivery" data-testid="delivery-report">
      {report.verdict && v && (
        <div className={`delivery-verdict verdict-${v.cls}`}>
          <span className="delivery-verdict-label">{v.label}</span>
          {report.verdict.rationale && (
            <Markdown className="delivery-verdict-rationale">{report.verdict.rationale}</Markdown>
          )}
        </div>
      )}

      <div className="delivery-answers">
        {report.answers.map((a, idx) => {
          const c = confidenceLabel(a.confidence);
          return (
            <details key={a.key} className="delivery-answer" open={idx === 0}>
              <summary className="delivery-answer-summary">
                <span className="delivery-answer-title">{answerTitle(a.key)}</span>
                <span className={`delivery-conf conf-${c.cls}`}>{c.label}</span>
              </summary>
              <Markdown className="delivery-answer-text">{a.answer}</Markdown>
              {a.evidenceRefs.length > 0 && (
                <ul className="delivery-evidence">
                  {a.evidenceRefs.map((ref) => (
                    <li key={ref} className="delivery-evidence-ref mono">{ref}</li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </div>

      {report.acceptanceCriteria.length > 0 && (
        <details className="delivery-acs-wrap">
          <summary className="delivery-acs-summary">
            Critérios de aceite — {acClassificationSummary(report.acceptanceCriteria)}
          </summary>
          <table className="delivery-acs">
            <tbody>
              {report.acceptanceCriteria.map((ac) => {
                const cl = classificationLabel(ac.classification);
                return (
                  <tr key={ac.id} className="delivery-ac">
                    <td className="delivery-ac-id mono">{ac.id}</td>
                    <td className="delivery-ac-desc"><Markdown>{ac.description}</Markdown></td>
                    <td className={`delivery-ac-class class-${cl.cls}`}>{cl.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}

      {report.mdPath && onOpenFile && (
        <button
          type="button"
          className="delivery-md-link"
          onClick={() => onOpenFile(report.mdPath!, "delivery-report.md")}
        >
          ver narrativa completa →
        </button>
      )}
    </section>
  );
}
```

> Nota: o botão de narrativa só aparece com `mdPath` E `onOpenFile`. Nos testes que checam o botão, passe `onOpenFile`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Substituir os estilos antigos de resposta/AC em `web/src/app.css`**

Localizar o bloco de respostas atual e substituí-lo. Remover as regras antigas:
```css
/* separador sutil entre as 11 respostas empilhadas (some na última) */
.delivery-answer { padding-bottom: 0.6rem; border-bottom: 1px solid #f3f4f6; }
.delivery-answer:last-child { padding-bottom: 0; border-bottom: none; }
.delivery-answer-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.2rem;
  font-size: 0.85rem;
  font-weight: 600;
}
```
e colocar no lugar:
```css
/* accordion das 11 respostas */
details.delivery-answer { border-bottom: 1px solid #f0f0f0; }
details.delivery-answer:last-of-type { border-bottom: none; }
.delivery-answer-summary {
  display: flex; align-items: center; gap: 0.5rem;
  cursor: pointer; list-style: none;
  padding: 0.45rem 0; font-size: 0.85rem; font-weight: 600;
}
.delivery-answer-summary::-webkit-details-marker { display: none; }
.delivery-answer-summary::before { content: "▸"; color: #9ca3af; font-size: 0.7rem; }
details.delivery-answer[open] > .delivery-answer-summary::before { content: "▾"; }
.delivery-answer-title { flex: 1; }
.delivery-answer-summary .delivery-conf { flex: none; }
.delivery-answer .delivery-answer-text { margin: 0 0 0.6rem 1.1rem; }
.delivery-answer .delivery-evidence { margin-left: 1.1rem; }

/* seção colapsável dos ACs */
details.delivery-acs-wrap { margin-top: 0.25rem; }
.delivery-acs-summary {
  cursor: pointer; list-style: none;
  font-size: 0.82rem; font-weight: 600; color: #374151; padding: 0.45rem 0;
}
.delivery-acs-summary::-webkit-details-marker { display: none; }
.delivery-acs-summary::before { content: "▸ "; color: #9ca3af; }
details.delivery-acs-wrap[open] > .delivery-acs-summary::before { content: "▾ "; }
.delivery-ac-desc .md-body { font-size: inherit; line-height: 1.4; }
.delivery-ac-desc .md-body p { margin: 0; }
```

> A regra antiga `.delivery-answer-text { ... white-space: pre-wrap ... }` (logo abaixo) deve ser REMOVIDA — o markdown agora controla o layout do corpo. Localize e apague o bloco `.delivery-answer-text { margin:0; font-size:0.85rem; line-height:1.5; color:#1f2937; white-space:pre-wrap; }`.

- [ ] **Step 6: Rodar a suíte do front e commitar**

Run: `npx vitest run web/src/components/DeliveryReportBlock.test.tsx web/src/lib/deliveryLabels.test.ts`
Expected: PASS.

```bash
git add web/src/components/DeliveryReportBlock.tsx web/src/components/DeliveryReportBlock.test.tsx web/src/app.css
git commit -m "feat: parecer em accordion com markdown e ACs colapsáveis"
```

---

## Task 5: `Timeline` → botões que abrem o viewer

**Files:**
- Modify: `web/src/components/Timeline.tsx`
- Test: `web/src/components/Timeline.test.tsx`
- Modify: `web/src/app.css`

- [ ] **Step 1: Atualizar o teste**

Substituir o conteúdo de `web/src/components/Timeline.test.tsx` por:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";
import { makeSpec } from "../test-utils";

describe("Timeline", () => {
  it("lista as notas e abre os .md de SDD via onOpenFile", () => {
    const onOpenFile = vi.fn();
    const spec = makeSpec({
      id: "FEAT-007",
      squad: "sdd",
      timeline: [{ kind: "pm_init", timestamp: "2026-05-20T09:00:00Z", note: "início" }],
    });
    render(<Timeline spec={spec} projectPath="/x/proj" onOpenFile={onOpenFile} />);
    expect(screen.getByText("início")).toBeInTheDocument();

    const specBtn = screen.getByRole("button", { name: "spec.md" });
    specBtn.click();
    expect(onOpenFile).toHaveBeenCalledWith("/x/proj/.agent-session/FEAT-007/spec.md", "spec.md");
    expect(screen.getByRole("button", { name: "plan.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tasks.md" })).toBeInTheDocument();
  });

  it("Discovery abre memo.md (não spec/plan/tasks)", () => {
    const spec = makeSpec({ id: "DISC-001", squad: "discovery", plannedPhases: ["frame"], phase: "frame" });
    render(<Timeline spec={spec} projectPath="/x/proj" onOpenFile={vi.fn()} />);
    expect(screen.getByRole("button", { name: "memo.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "spec.md" })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run web/src/components/Timeline.test.tsx`
Expected: FAIL (ainda são `<a>`, sem `onOpenFile`).

- [ ] **Step 3: Atualizar `web/src/components/Timeline.tsx`**

```tsx
import type { Spec } from "../../../src/store/types";

/**
 * Lista os notes[] da Session e abre os .md no visualizador in-app (via onOpenFile).
 * O path do .md deriva de projectPath + spec.id (a Session vive em
 * <projectPath>/.agent-session/<id>/). O squad decide QUAIS docs: SDD tem
 * spec/plan/tasks; Discovery tem memo.
 */
export function Timeline({
  spec,
  projectPath,
  onOpenFile,
}: {
  spec: Spec;
  projectPath: string;
  onOpenFile: (path: string, title: string) => void;
}) {
  const specDir = `${projectPath}/.agent-session/${spec.id}`;
  const docs = spec.squad === "discovery" ? ["memo.md"] : ["spec.md", "plan.md", "tasks.md"];
  return (
    <div className="timeline">
      <ul className="timeline-notes">
        {spec.timeline.map((e, i) => (
          <li key={i}>
            <time>{e.timestamp}</time> <b>{e.kind}</b> {e.note}
          </li>
        ))}
      </ul>
      <nav className="timeline-docs">
        {docs.map((d) => (
          <button key={d} type="button" onClick={() => onOpenFile(`${specDir}/${d}`, d)}>
            {d}
          </button>
        ))}
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run web/src/components/Timeline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Estilo dos botões em `web/src/app.css`**

Acrescentar ao fim (faz os botões parecerem os links de antes):

```css
/* docs da timeline: botões que abrem o viewer, com aparência de link */
.timeline-docs button {
  background: none; border: none; padding: 0; cursor: pointer;
  color: #2563eb; font-size: 0.8rem; font-family: inherit;
  text-decoration: none;
}
.timeline-docs button:hover { text-decoration: underline; }
```

> Se já existir uma regra `.timeline-docs a { ... }` no app.css, mantenha-a (não atrapalha) ou replique seus valores no seletor de `button` acima para preservar espaçamento.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Timeline.tsx web/src/components/Timeline.test.tsx web/src/app.css
git commit -m "feat: Timeline abre .md no visualizador in-app"
```

---

## Task 6: `DetailDrawer` — estado do viewer + fiação

**Files:**
- Modify: `web/src/components/DetailDrawer.tsx`

> Sem teste unitário próprio (o drawer compõe muitos filhos com hooks/WS; mock pesado). Cobertura via os testes dos filhos + validação no preview (Task 8). Decisão consciente, igual à feature anterior.

- [ ] **Step 1: Importar `useState` e `MarkdownViewer`**

No topo de `web/src/components/DetailDrawer.tsx`, garantir os imports:

```ts
import { useState } from "react";
import { MarkdownViewer } from "./MarkdownViewer";
```

(Os demais imports — `DeliveryReportBlock`, `Timeline`, etc. — já existem.)

- [ ] **Step 2: Adicionar o estado do viewer no início do componente**

Logo após `const { spec, projectId, projectName, projectPath } = item;` (e antes do `return`), adicionar:

```ts
  const [viewer, setViewer] = useState<{ path: string; title: string } | null>(null);
  const openFile = (path: string, title: string) => setViewer({ path, title });
```

- [ ] **Step 3: Passar `onOpenFile` ao `DeliveryReportBlock` e ao `Timeline`**

Trocar:
```tsx
        <DeliveryReportBlock report={spec.deliveryReport} />
```
por:
```tsx
        <DeliveryReportBlock report={spec.deliveryReport} onOpenFile={openFile} />
```

E trocar:
```tsx
        <Timeline spec={spec} projectPath={projectPath} />
```
por:
```tsx
        <Timeline spec={spec} projectPath={projectPath} onOpenFile={openFile} />
```

- [ ] **Step 4: Renderizar o `MarkdownViewer` no fim da `<aside>`**

Imediatamente antes do fechamento `</aside>` (após a seção "Linha do tempo"/`<Timeline ... />`), adicionar:

```tsx
        <MarkdownViewer
          path={viewer?.path ?? null}
          title={viewer?.title ?? ""}
          onClose={() => setViewer(null)}
        />
```

- [ ] **Step 5: Rodar a suíte inteira do front e commitar**

Run: `npm test`
Expected: verde, exceto a falha pré-existente conhecida em `FolderManager.test.tsx` (AC-013, WIP não relacionado).

```bash
git add web/src/components/DetailDrawer.tsx
git commit -m "feat: DetailDrawer abre .md no MarkdownViewer e fia onOpenFile"
```

---

## Task 7: `SpecSummaryBlock` → texto via `<Markdown>`

**Files:**
- Modify: `web/src/components/SpecSummaryBlock.tsx`
- Test: `web/src/components/SpecSummaryBlock.test.tsx` (ajustar só se quebrar)

- [ ] **Step 1: Importar `Markdown` e trocar o `<div>` de texto**

No topo de `web/src/components/SpecSummaryBlock.tsx`, adicionar:
```ts
import { Markdown } from "./Markdown";
```

Trocar a linha:
```tsx
        <div className="spec-summary-text">{s.text}</div>
```
por:
```tsx
        <Markdown className="spec-summary-text">{s.text}</Markdown>
```

- [ ] **Step 2: Rodar o teste e ajustar se necessário**

Run: `npx vitest run web/src/components/SpecSummaryBlock.test.tsx`
Expected: PASS. Se algum teste falhar porque procurava o texto direto num `.spec-summary-text` que agora é um wrapper `.md-body` com `<p>` dentro: o `screen.getByText("...")` continua achando o texto (está num `<p>` interno). Só ajuste se a query usar `.textContent` exato do `<div>`; nesse caso troque para `screen.getByText(/trecho/)`.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SpecSummaryBlock.tsx web/src/components/SpecSummaryBlock.test.tsx
git commit -m "feat: resumo de spec renderizado como markdown"
```

---

## Task 8: Validação no preview (coordenador) + suíte

> Esta task é executada pelo COORDENADOR (tem o preview MCP), não por subagente.

- [ ] **Step 1: Build + subir o preview isolado**

Run: `npm run build` então `preview_start "aios-preview"` (porta 4732).

- [ ] **Step 2: Validar o parecer (FEAT-011 answers, FEAT-012 questions)**

Abrir a gaveta de cada um e conferir:
- Markdown renderizado nas respostas (negrito/código/listas — sem `**`/`` ` `` literais).
- Accordion: "O que foi entregue" aberto, demais fechadas; clicar expande/colapsa.
- ACs colapsados com resumo de contagem; expandir mostra a tabela colorida; descrições com código formatado.
- "ver narrativa completa →" abre o `MarkdownViewer` com o delivery-report.md renderizado.

- [ ] **Step 3: Validar o viewer dos .md**

Na seção "Linha do tempo", clicar em spec.md / plan.md / tasks.md → abre o modal in-app com markdown completo (headings, tabelas) renderizado. Fechar por ✕/overlay/Esc.

- [ ] **Step 4: Conferir console + screenshots**

`preview_console_logs` (sem erros); `preview_screenshot` do parecer renderizado e do viewer de um .md.

- [ ] **Step 5: Suíte final**

Run: `npm test`
Expected: verde exceto a falha pré-existente `FolderManager.test.tsx` AC-013.

---

## Verificação final (cobertura do spec)

- [ ] Markdown renderizado (negrito/código/listas/tabelas) → Task 1 (`Markdown`) + uso em Tasks 4/6/7.
- [ ] 11 respostas em accordion, 1ª aberta → Task 4.
- [ ] ACs colapsáveis com resumo de contagem → Tasks 3 + 4.
- [ ] `.md` no visualizador in-app (spec/tasks/plan/narrativa) → Tasks 2 + 5 + 6.
- [ ] `report.html` continua link externo → inalterado em DetailDrawer.
- [ ] spec-summary como markdown → Task 7.
- [ ] READ-ONLY (viewer só faz GET /file; backend intocado) → Task 2.
