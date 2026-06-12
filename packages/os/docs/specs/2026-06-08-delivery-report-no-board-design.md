# Exibir o delivery-report no board — design

**Data:** 2026-06-08
**Status:** aprovado (brainstorming)

## Problema

Ao fim de toda pipeline, o squad SDD do ai-squad emite um **delivery-report** — o
parecer de entrega: um veredicto, 11 respostas em prosa (o que foi feito, como, por
quê, desvios, evidências, riscos…) e uma tabela de critérios de aceite (ACs)
classificados. Esse parecer é a melhor leitura humana do que uma feature concluída
realmente entregou, mas hoje o aiOS **não o mostra**. O usuário precisa abrir o
`delivery-report.md` na mão, fora do board.

O aiOS é **observador READ-ONLY**: lê os artefatos do ai-squad e exibe; **nunca gera
nem edita** o parecer. Esta feature só acrescenta leitura + exibição.

## Forma do artefato (confirmada nas fixtures reais)

Cada Session concluída tem dois arquivos no diretório `.agent-session/<spec_id>/`:

- `delivery-report.json` — os dados estruturados (veredicto, 11 respostas, ACs).
- `delivery-report.md` — a narrativa humana, mais rica (tem contexto e notas que o
  JSON não carrega).

Duas fixtures reais guiaram o design, com uma diferença proposital:

| Aspecto | FEAT-011 | FEAT-012 |
|---|---|---|
| Container das 11 respostas | `answers` | **`questions`** |
| As 11 chaves canônicas | idênticas | idênticas |
| `verdict.value` | `approved_with_caveats` | `approved_with_caveats` |
| ACs | 25 met, 6 partially_met | 13 met, 1 partially_met |
| Extras top-level | `schema_version`, `dispatch_id`, `gate_dispatch_id` | `cost`, `gate`, `role` |

### Normalização obrigatória — `answers` ⟺ `questions`

O container das 11 respostas pode vir como `answers` **ou** `questions` (ambos um
*map* indexado pelas mesmas 11 chaves) — varia conforme a versão do chronicler que
gerou o report. A forma canônica daqui pra frente é `answers`; reports antigos usam
`questions`. **Regra:** `blocos = report.answers ?? report.questions`. As duas
fixtures devem normalizar para a **forma idêntica** — esse é o critério de aceite
central.

### Pegadinha: `acceptance_criteria` aparece em dois lugares

- **top-level** `acceptance_criteria`: array de `{ id, description, classification,
  evidence_refs[] }` — a tabela de ACs.
- **dentro de** `answers`/`questions`: a chave `acceptance_criteria` é uma das 11
  respostas — uma **prosa** sobre os ACs.

São coisas diferentes e tratadas separadamente: a tabela vem do array top-level; a
prosa entra como mais uma das 11 respostas.

## Decisão de arquitetura — Padrão "scan", igual ao `cost`

O coletor tem dois caminhos para levar um artefato à tela:

- **Padrão "scan"** (o `cost` usa): [`parseSession`](../../src/collector/session.ts)
  lê o artefato no momento do scan via `readCostRollup(specDir)` e anexa ao `Spec`. O
  objeto viaja dentro do **snapshot** (a fotografia do estado que o servidor manda ao
  front por WebSocket). O watcher rebroadcasta o snapshot a cada mudança de arquivo; o
  front só lê e desenha. Zero código de transporte novo.
- **Padrão "sob demanda"** (`spec-summary`, `summary`, `attention` usam): o front pede,
  um handler roda o **Claude**, faz *streaming* e grava cache em `.aios-cache/`. Existe
  uma maquinaria de fingerprint/fila/cancelamento **porque a geração por IA custa**.

**Escolhido: Padrão "scan".** O delivery-report **já está pronto em disco** — o aiOS só
lê e exibe, exatamente como faz com o `cost`. Não há geração nem custo de IA, então a
maquinaria do Padrão "sob demanda" seria *over-engineering* e contraria o pedido de
"estenda o coletor existente".

**Trade-off explícito:** o Padrão "scan" coloca o report (~26KB por Session concluída)
dentro do snapshot, que é rebroadcastado a cada mudança de arquivo; como o report é
imutável depois de pronto, reenvia bytes estáticos à toa. Em `localhost`, com algumas
dezenas de specs (~0,3–1,3MB), o custo é irrelevante (milissegundos de serialização).
A alternativa (endpoint sob demanda que lê do disco só ao abrir a gaveta) deixaria o
snapshot leve, mas exigiria handler + client + hook novos só para ler um arquivo
estático — mais código, sem ganho real num app local de um usuário. Rejeitada.

## Decisão de render — JSON estruturado + link para o `.md`

As 11 respostas serão **renderizadas a partir do JSON** (o campo `answer` de cada uma é
prosa auto-contida), e o `.md` completo será **linkado** via `/file`, igual o board já
faz com o `report.html` ([DetailDrawer.tsx](../../web/src/components/DetailDrawer.tsx)).

**Por quê:** os elementos estruturados que a UI precisa — realce do veredicto, badge de
`confidence` por resposta, tabela de ACs colorida por `classification` — **só existem no
JSON**. Renderizar só o `.md` exigiria um parser de markdown no front e perderia esses
elementos. Renderizar do JSON e oferecer o `.md` num clique entrega o melhor dos dois:
card estruturado e robusto + narrativa humana rica a um clique. Não se parseia markdown.

## Modelo de dados (`src/store/types.ts`)

Enums **canônicos em inglês** — a UI roteia (cor/realce) sobre o valor inglês; rótulos
pt-BR são só apresentação. O parser **não faz whitelist** do enum: passa a string crua
adiante, então um valor novo de uma versão futura do chronicler ainda renderiza (sem cor
custom, via fallback). Isso é o que dá "robustez a versões".

```ts
export type DeliveryConfidence = "recorded" | "inferred" | "not_recorded";
export type DeliveryVerdictValue =
  | "approved" | "approved_with_caveats" | "needs_changes" | "blocked" | "needs_human_review";
export type DeliveryAcClassification =
  | "met" | "partially_met" | "not_met" | "not_validated";

export interface DeliveryAnswer {
  key: string;            // uma das 11 chaves canônicas
  answer: string;         // prosa no output_locale
  confidence: string;     // canônico = DeliveryConfidence; string crua se vier desconhecido
  evidenceRefs: string[];
}

export interface DeliveryVerdict {
  value: string;          // canônico = DeliveryVerdictValue; string crua se desconhecido
  rationale: string;
  evidenceRefs: string[];
}

export interface DeliveryAcceptanceCriterion {
  id: string;
  description: string;
  classification: string; // canônico = DeliveryAcClassification; string crua se desconhecido
  evidenceRefs: string[];
}

export interface DeliveryReport {
  specId: string | null;
  outputLocale: string | null;
  generatedAt: string | null;
  verdict: DeliveryVerdict | null;
  answers: DeliveryAnswer[];                    // ordenadas pelas 11 chaves canônicas
  acceptanceCriteria: DeliveryAcceptanceCriterion[];
  container: "answers" | "questions";          // qual chave estava presente (transparência)
  mdPath: string | null;                       // delivery-report.md, se existir (link /file)
  jsonPath: string;                            // delivery-report.json
}
```

E o `Spec` ganha um campo opcional:

```ts
deliveryReport?: DeliveryReport | null;        // null em sessões sem parecer (antigas/em curso)
```

> **Sobre tipar `confidence`/`value`/`classification` como `string`:** o ideal seria a
> union canônica, mas como o parser passa valores desconhecidos adiante (robustez a
> versões), tipar como union *mentiria* em runtime. Fica `string`, com as unions
> canônicas exportadas e documentadas para a UI usar nos mapas de rótulo/cor.

## Backend — peças e fronteiras

### 1. `src/collector/delivery-report.ts` (novo) — o parser

Função `readDeliveryReport(specDir: string): DeliveryReport | null`, espelhando
`readCostRollup`:

- Sem `delivery-report.json` → `null` (sessões antigas/em curso não têm parecer).
- `JSON.parse` em `try/catch` → `null` se malformado (não derruba o scan, igual ao
  resto do coletor).
- **Normalização:** `const blocks = raw.answers ?? raw.questions ?? {}`; `container` =
  `"answers"` se `raw.answers` existir, senão `"questions"` se `raw.questions` existir,
  senão `"answers"` (default).
- Itera uma **constante ordenada das 11 chaves canônicas** e inclui só as presentes em
  `blocks` (tolera ausência de alguma). Cada uma vira `DeliveryAnswer` com defaults
  defensivos (`answer: ""`, `confidence: ""`, `evidenceRefs: []`).
- `verdict`: de `raw.verdict` → `{ value, rationale, evidenceRefs }` (ou `null` se
  ausente).
- `acceptanceCriteria`: do array **top-level** `raw.acceptance_criteria` → cada item
  `{ id, description, classification, evidenceRefs }`.
- `specId`, `outputLocale`, `generatedAt`: do top-level.
- `mdPath`: `<specDir>/delivery-report.md` se existir, senão `null`.
- `jsonPath`: o caminho do `.json`.
- Campos extras top-level são **ignorados** (`additionalProperties` tolerado).

As 11 chaves canônicas, em ordem de exibição:

```
what_was_done, how_it_was_done, why_this_way, deviations_from_plan,
acceptance_criteria, evidence, impacts, out_of_scope, risks_and_pending,
how_to_validate, final_verdict
```

### 2. `src/collector/session.ts` — fiação (uma linha)

Em `parseSession`, ao lado do `cost`:

```ts
cost: readCostRollup(specDir),
deliveryReport: readDeliveryReport(specDir),   // ← novo
```

Mais o `import`. Nada mais muda no backend — o snapshot e o WS já existentes carregam o
campo novo de graça.

### 3. Testes — `src/collector/delivery-report.test.ts`

Critério central: **as duas fixtures (answers e questions) normalizam para a forma
idêntica.** Casos:

- FEAT-011 (`answers`) e FEAT-012 (`questions`) → mesma estrutura, 11 respostas, mesma
  ordem de chaves.
- `delivery-report.json` ausente → `null`.
- JSON malformado → `null`.
- `.md` ausente → `mdPath: null`.
- Enum desconhecido (ex.: `confidence: "guessed"`) → passa adiante intacto.
- Colisão `acceptance_criteria`: o array top-level vira a tabela; a chave homônima
  dentro de `answers` vira uma das 11 respostas — ambas presentes e distintas.

Fixtures de teste **derivadas das reais** (uma com `answers`, outra com `questions`),
enxutas, seguindo a convenção de fixtures dos testes do coletor já existentes.

## Frontend — peças e fronteiras

### 1. `web/src/lib/deliveryLabels.ts` (novo) — mapas de rótulo/cor

Chaveados pelo **valor inglês canônico**, com fallback (mostra o valor cru) para enums
desconhecidos. Nunca se roteia sobre rótulo traduzido.

- **Título pt-BR das 11 seções** (por chave):

  | chave | título |
  |---|---|
  | `what_was_done` | O que foi entregue |
  | `how_it_was_done` | Como foi feito |
  | `why_this_way` | Por que assim |
  | `deviations_from_plan` | Desvios do plano |
  | `acceptance_criteria` | Critérios de aceite |
  | `evidence` | Evidências |
  | `impacts` | Impactos |
  | `out_of_scope` | Fora de escopo |
  | `risks_and_pending` | Riscos e pendências |
  | `how_to_validate` | Como validar |
  | `final_verdict` | Veredicto final |

- **Veredicto** → rótulo + classe de cor:

  | valor | rótulo | cor |
  |---|---|---|
  | `approved` | Aprovado | verde |
  | `approved_with_caveats` | Aprovado com ressalvas | âmbar |
  | `needs_changes` | Precisa de mudanças | laranja |
  | `blocked` | Bloqueado | vermelho |
  | `needs_human_review` | Requer revisão humana | azul |

- **Confidence** → `recorded`=registrado, `inferred`=inferido, `not_recorded`=não
  registrado (badges coloridos, **nunca escondidos** — ancorado vs inferido vs lacuna
  admitida é informação).

- **Classification** (ACs) → `met`=atendido, `partially_met`=parcialmente atendido,
  `not_met`=não atendido, `not_validated`=não validado (cor por status).

### 2. `web/src/components/DeliveryReportBlock.tsx` (novo)

Props: `{ report: DeliveryReport | null | undefined }`. Se `null`/`undefined`, mostra um
**placeholder** — `sem parecer de entrega ainda` —, consistente com o hint do
`SpecSummaryBlock` ("sem spec.md disponível"). A seção e seu cabeçalho sempre aparecem
(igual a "Custo"/"Fases"); o placeholder sinaliza que o parecer ainda não existe (sessão
em curso) ou não foi gerado (sessão antiga), em vez de a seção sumir sem aviso.

Layout:
1. **Banner do veredicto** — colorido por `verdict.value`, com rótulo pt-BR + rationale.
2. **As 11 respostas** — cada uma: título pt-BR (via mapa), prosa (`answer`), **badge de
   confidence** e `evidence_refs` como chips mono.
3. **Tabela de ACs** — linhas `{ id, description, badge de classification colorido }`.
4. **Link** "ver narrativa completa →" → `/file?path=<mdPath>` (só se `mdPath`), igual ao
   `report.html`.

### 3. `web/src/components/DetailDrawer.tsx` — encaixe

Nova seção **"Parecer de entrega"** logo após o `SpecSummaryBlock` e antes de "Fases" —
é a conclusão do pipeline, merece destaque alto:

```tsx
<SpecSummaryBlock ... />

<h4 className="drawer-section">Parecer de entrega</h4>
<DeliveryReportBlock report={spec.deliveryReport} />

<h4 className="drawer-section">Fases</h4>
```

Estilo **light** (preferência do usuário), reaproveitando os tokens de cor do board.

### 4. Testes — front

- `DeliveryReportBlock.test.tsx`: banner com rótulo+classe certos; 11 respostas com
  badges de confidence; tabela de ACs colorida; link `.md` presente/ausente; `report`
  null → mostra o placeholder "sem parecer de entrega ainda".
- `deliveryLabels.test.ts`: mapas + **fallback de enum desconhecido**.

## Garantia READ-ONLY

Tudo é `readFileSync`/`existsSync`. Nenhuma escrita no repo observado, consistente com a
regra do projeto ("nunca escreve" nos artefatos do ai-squad).

## Fora de escopo (YAGNI)

- **Badge de veredicto no card do board** (sem abrir a gaveta): possível evolução, não
  pedido agora.
- **Cache/fingerprint** do report: desnecessário — o artefato é estático e barato de ler.
- **Parser de markdown** do `.md`: evitado de propósito; o `.md` só é linkado.
