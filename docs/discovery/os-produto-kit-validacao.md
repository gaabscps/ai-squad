# Kit de validação — Resumo de sessão para produto/design

> Sessão de descoberta: OBS-008 · ai-squad
> Objetivo: validar, com uma primeira usuária real (designer/PM), se um **resumo por sessão**
> gerado do transcript tem valor — **antes** de construir board/drawer/integração no aiOS.

## Por que este kit existe

A captura mecânica do aiOS (custo, tempo, atenção) já é agnóstica e serve qualquer pessoa.
O que ainda **não sabemos** é o que produto/design considera "sucesso" numa sessão com IA — e
nós (devs) não podemos inventar isso pela persona. Este kit é o instrumento de descoberta:
um **prompt de extração** que gera o resumo, e um **roteiro de conversa** para ouvir a usuária.

Invariantes (não negociar durante o teste):
- **Colaborador-primeiro**: o resumo é da pessoa, para a pessoa. Nunca enquadrar como relatório à liderança.
- **Observar, não prescrever**: o resumo espelha o que houve; não dá conselho nem corrige.
- **Linguagem de produto**, nunca de engenharia.
- **Não inventar**: sessão sem decisão/entregável deve dizer isso honestamente.

> Este kit foi testado em 3 sessões sintéticas (PM, designer, e uma exploratória sem entregável)
> e passou por red-team adversarial. O caso exploratório flagrou uma invenção real no rascunho
> original (um "próximo passo" que ninguém assumiu); as regras abaixo já corrigem isso.

---

## Como usar (operacional)

1. **Escolha antes uma sessão real dela COM sinal** (que teve decisão/entregável). Não use uma
   sessão divagante como teste principal — daria falso-negativo. (A exploratória fica para o
   teste opcional do fim.)
2. Ela roda (ou já rodou) essa sessão de trabalho normal com `/observe` ligado.
3. **Obtenha o transcript** da sessão. Caminho simples: copiar a conversa dela. Caminho fiel:
   o arquivo `~/.claude/projects/<projeto>/<session-id>.jsonl`. (Dá para automatizar com um
   helper a partir do `OBS-NNN` — peça se a cópia manual incomodar.)
4. **Gere o resumo**: cole a Peça 1 + o transcript numa conversa com o Claude.
5. **Conduza a conversa** com a Peça 2 — na ordem, sem mostrar o resumo antes da hora.

---

## Peça 1 — Prompt de extração

```
Você recebe o TRANSCRIPT de uma sessão de trabalho entre uma pessoa de produto/design e um
assistente de IA. Gere um RESUMO DA SESSÃO para a PRÓPRIA pessoa se organizar (e, se ela quiser,
levar adiante). NÃO é relatório para chefe; é a memória dela.

Regras invioláveis:

1. Linguagem de produto e de negócio. Nunca jargão de engenharia (PR, diff, commit, deploy,
   teste, pipeline). E nunca descreva o trabalho pela ótica de quem constrói — evite "técnico",
   "requisito técnico", "integração" como categoria. Descreva pela necessidade de produto.

2. Use SOMENTE o que está no transcript. Não invente, não complete, não suponha.

3. A linha entre o que é real e o que não é:
   - IA sugeriu + a pessoa aceitou explicitamente ("vou com isso", "fechado") = conteúdo legítimo.
   - IA sugeriu + a pessoa NÃO se comprometeu = não entra (nem decisão, nem próximo passo).
   - Possibilidade em condicional ("se eu decidir", "talvez") = não é decisão nem próximo passo;
     se virou dúvida, é "Em aberto".

4. Seção vazia recebe "—". É legítimo uma sessão não ter decisão, não ter pergunta aberta, ou não
   ter próximo passo. Preencher seção vazia com algo cogitado-mas-não-assumido é o PIOR erro.

5. Não repita um item em duas seções. Uma pergunta sem resposta fica só em "Em aberto"; a ação de
   respondê-la NÃO vira "Próximo passo" automaticamente.

6. "Próximo passo" só existe quando a pessoa usou verbo de compromisso ("vou fazer X", "preciso
   de Y"). Sem isso, "—".

7. Texto entre aspas é uma sequência de palavras IDÊNTICA à do transcript. Na dúvida, escreva sem
   aspas. Aspas em paráfrase contam como invenção de fala.

8. Descritivo, nunca avaliativo. Não diga se a sessão foi boa ou ruim, não dê conselhos, não
   corrija a pessoa.

9. Cada bullet = UMA oração (sem ponto-e-vírgula nem dois-pontos que abram segunda cláusula), até
   ~20 palavras. Lógica longa vira bullets separados. No máximo 5 bullets por seção; se houver mais
   decisões REAIS, mantenha todas — o teto é contra redundância, jamais para descartar conteúdo real.

Formato de saída (markdown), exatamente:

**TL;DR:** <uma frase: o que a sessão produziu ou explorou>

**Decidido**
- <decisão> — <porquê> (descartado: <alternativa>, quando houver)

**Em aberto**
- <pergunta que ficou sem resposta>

**Próximo passo**
- <ação que a pessoa assumiu fazer>

**Entregável desta sessão:** <1 frase nomeando o artefato concreto; OU "Sessão exploratória —
sem decisão/entregável fechado">

_Inferido da conversa — confira antes de usar._

TRANSCRIPT:
{{COLE_O_TRANSCRIPT_AQUI}}
```

> O custo/tempo da sessão não saem do transcript — vêm da captura mecânica (`cost-report` / `session.yml`).
> Nesta primeira rodada o foco é o conteúdo; anexe custo manualmente só se ela perguntar.

---

## Peça 2 — Roteiro de conversa

### Abertura (despersonalizar — tira o peso de "agradar o marido")
> "Isso foi gerado por um sistema, não por mim — não sei se presta. Meu trabalho hoje é anotar
> onde ele falha pra eu destruir as partes ruins. Quanto mais você odiar, mais útil pra mim."

### Postura de quem conduz
- Nunca defenda o resumo. Se ela criticar, pergunte mais — não explique.
- Depois de entregar o resumo, fique calado e deixe ela ler e falar.
- Anote as palavras EXATAS dela, sobretudo as reclamações.

### Fase A — o mundo dela e onde o trabalho vive (sem mostrar nada nosso)
1. Me conta como foi seu último dia de trabalho de verdade — onde você usou IA e onde não?
2. Pega a última sessão concreta com IA. O que você fez DEPOIS de fechar a janela? Passo a passo
   até onde o trabalho parou de existir.
   - Rastreie o artefato: "O resultado daquela sessão, onde está agora? Consegue me mostrar na tela?"
   - "De cada 10 sessões, em quantas o que saiu foi direto pra frente, e em quantas você jogou fora e refez?"
   - "As decisões que importam são TOMADAS na conversa com a IA, ou você já chega decidida e só executa?"
   - _(estas três respondem a hipótese-matadora: o trabalho vive na sessão ou fora dela)_
3. Você precisa contar pra alguém o que fez numa sessão? Com que frequência?
   - Se sim: "Como você faz isso hoje? O que é chato?"
   - "O que você usa HOJE pra lembrar do que fez?" _(se "nada, e nunca fez falta" → a dor pode não existir)_
4. O que te faz sentir que uma sessão valeu a pena? E que foi tempo jogado fora?
   - Densidade: "Quantas sessões por dia? Quais são trabalho de verdade e quais são perguntas descartáveis?"
   - "Que parte do seu trabalho de verdade NÃO passa por IA?"

### Baseline (faça ANTES de mostrar o resumo — é o que mede se o resumo acerta)
> "Imagina que sua líder perguntou no Slack o que você fez nessa sessão. Sem eu te mostrar nada,
> me responde agora, do seu jeito."

Anote a resposta palavra por palavra — é o padrão-ouro contra o qual o resumo será comparado.

### Fase B — agora sim, mostre o resumo da sessão real (regra: não revele o resumo até aqui)
5. [entregue em silêncio] "Dá uma olhada e me diz EM VOZ ALTA o que você está pensando enquanto lê."
6. "O que você acabou de me dizer está aqui? E o que tem aqui que você NÃO disse — e por quê?"
7. "Se você fosse usar QUALQUER pedaço disso, o que faria com ele? E se não faria nada com nenhum
   pedaço, tudo bem dizer."
8. "Tem algo aqui errado, ou que você nunca diria desse jeito?"

### Fase C — valor recorrente e limite (medo)
9. (valor) "Das últimas vezes que você fechou uma sessão, em quais você teria aberto isso e em
   quais teria fechado sem ler? Um exemplo de cada."
   - Teste real, se ela topar: "deixo isso aparecer 1 semana sem te avisar; depois eu olho sozinho
     quantas você abriu."
10. (medo/vigilância) (a) "Quem já te pediu pra contar o que fez numa sessão? De quem você esconderia?"
    (b) "Tem alguma linha desse resumo que você APAGARIA antes do seu líder ler? Qual?"

### Opcional — teste da omissão (se houver tempo + um resumo de sessão exploratória em mãos)
11. Mostre de propósito o resumo de uma sessão de baixo sinal (sem decisão). "E esse aqui?" Veja se
    ela percebe que está honestamente vazio, ou se acha que o resumo deixou a desejar / inventou.

### O que observar nos dados crus (anote ao qualificar a sessão e durante)
- A sessão tinha decisões fechadas distinguíveis de exploração?
- Teve um entregável nomeável, ou terminou sem artefato?
- O trabalho passou por ferramentas/MCP (Figma, busca) cujo resultado não aparece no texto? _(muda a fonte de sinal)_
- Quantos bloqueios reais, e sobre o quê?
- Ordem de grandeza do custo real de uma sessão dela.
- Ela leu o resumo inteiro ou bateu o olho e parou? Onde travou?
- Ela corrigiu algum rótulo? Quais? _(tamanho do gap inferência-realidade)_

### Critério de decisão (depois)
- Usaria sem reescrever **e** o resumo bate com a baseline → núcleo validado, seguir pro build.
- Reescreveria tudo, ou o resumo erra feio vs. a baseline → a extração não chega lá; investigar o quê.
- **Kill-signals** (qualquer um pesa muito):
  - O trabalho real vive FORA da sessão de IA (Figma/reunião) e a sessão é rascunho descartável → o cockpit observa o lugar errado.
  - "Nada, e nunca fez falta" pra lembrar o que fez → a dor não existe.
  - Dezenas de sessões/dia → resumo-por-sessão vira enxurrada ignorada.

---

## Riscos residuais (o que este teste NÃO resolve — honestidade)

- **Viés de agradar (entrevistador = marido)**: a abertura despersonalizada e as perguntas
  comportamentais reduzem, mas só a usuária na cadeira revela se o teste real (deixar aparecer 1
  semana e contar aberturas) fura a educação.
- **Hipótese-matadora**: só se resolve quando ela abre a tela e vemos se o conteúdo da IA sobreviveu
  ou foi refeito. Se o trabalho dela vive em Figma/reunião, o cockpit observa o lugar errado.
- **Densidade real** e **existência da dor** são possíveis kill-signals que só ela confirma.
- **N=1**: uma designer/PM não generaliza para o time — serve para matar hipóteses erradas, é fraco
  para confirmar valor. Repetir com 2-3 pessoas depois.
- **Terreno não testado**: corrigimos contra 3 casos sintéticos; uma sessão 100% visual pode ter
  padrão novo e o resumo pode inventar onde não foi testado.
