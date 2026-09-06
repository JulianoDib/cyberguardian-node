# 03 — DIÁRIO DE DECISÕES

> Toda decisão relevante entra aqui: o que foi decidido, por quê, e o que foi descartado.
> O Claude Code DEVE registrar aqui cada escolha técnica que fizer durante a execução,
> incluindo correções de rumo (passo errado / fora de ordem e como foi corrigido).
> Este arquivo alimenta duas coisas no final: a Declaração de Uso de IA e a defesa oral
> (perguntas de trade-off: "por que X e não Y?").

## Formato de cada registro
```
### [data] — Título curto da decisão
- Contexto: por que a decisão apareceu
- Decisão: o que foi escolhido
- Alternativas descartadas e motivo
- Impacto: o que muda no projeto
```

---

## Decisões já tomadas (fase de planejamento)

### 05/09 — Stack fixada pelo tema 10 (não é escolha nossa)
- Contexto: o enunciado dá opções (gRPC vs Sockets, RabbitMQ vs Kafka, Lamport vs Vetorial, Bully vs Ring), mas o tema 10 já determina a combinação.
- Decisão: Sockets TCP + Apache Kafka + Relógios de Lamport + Algoritmo Bully.
- Alternativas: as demais combinações pertencem a outros temas; usá-las descumpriria o enunciado.
- Impacto: zero tempo gasto escolhendo tecnologia; na defesa, os trade-offs devem ser justificados mesmo assim (o critério de 0,5 ponto cobra "gRPC vs Sockets, Lamport vs relógio físico, Bully vs Ring").

### 05/09 — Linguagem: TypeScript/Node.js (pendente confirmação)
- Contexto: PDF aceita Python ou TS/Node; aluno prefere TS por coincidir com a prova da disciplina.
- Decisão: TypeScript/Node.js, com tipagem estática rigorosa (critério de 0,4 ponto).
- Alternativa descartada: Python (mais simples, mas sem o ganho de estudo pra prova).
- Impacto: aguardar confirmação do professor antes de escrever código.

### 05/09 — Método de trabalho: abordagem mista com Claude Code
- Contexto: prazo de 6 dias, aluno com base de lógica/OO mas sem rotina de programação, defesa individual.
- Decisão: Claude Code executa; aluno calibra etapa por etapa o quanto faz manualmente. Etapas mecânicas (setup, boilerplate) podem ser totalmente delegadas. R4 (Lamport) e R5 (Bully) recebem atenção de entendimento prioritária por serem os alvos prováveis da arguição.
- Impacto: documentação 100% delegada ao Claude (Etapa 9). Registro fiel do uso de IA neste diário.

### 05/09 — Execução local, sem nada além do escopo
- Decisão: rodar tudo local via docker-compose; nenhuma feature fora do 01-ESCOPO.md (ver seção "Fora de escopo").
- Impacto: qualquer sugestão de melhoria extra deve ser recusada ou anotada aqui como "consciente e descartada".

---

## Registros de execução
(preencher a partir do início do desenvolvimento)

### 05/09 — Etapa 0: versões do ambiente (máquina 1)
- Contexto: fixar as versões usadas para que a máquina 2 reproduza o mesmo ambiente.
- Decisão: Node.js **v24.20.0** (LTS), npm **11.19.0**, Git **2.53.0**.
- Impacto: a máquina 2 deve usar Node 24.x. Divergência grande de versão pode mudar comportamento de `async`/sockets.

### 05/09 — Etapa 0: TypeScript instalado LOCAL (devDependency), não global
- Contexto: precisamos do compilador TS, e o projeto roda em duas máquinas diferentes.
- Decisão: `npm install --save-dev typescript @types/node` → TypeScript **7.0.2** e @types/node **26.4.1** dentro de `node_modules/`, versões travadas no `package.json` e no `package-lock.json`.
- Alternativa descartada: instalação global (`npm i -g typescript`) — a versão não ficaria registrada no projeto, a máquina 2 poderia compilar com outra versão e o professor não conseguiria reproduzir o build só com `npm install`.
- Impacto: `npx tsc` usa sempre a versão do projeto. Nada de global é exigido para rodar o trabalho.

### 05/09 — Etapa 0: tsconfig.json com tipagem estática rigorosa
- Contexto: o critério "Qualidade do Código e Tipagem" vale 0,4 e exige tipagem estática rigorosa.
- Decisão: além de `strict: true`, ligamos as checagens que o `strict` NÃO cobre:
  `noUncheckedIndexedAccess` (acesso a índice de array pode ser `undefined` — importante para buffers/framing na Etapa 2),
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch` (evita bug clássico na máquina de estados do Bully),
  `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `isolatedModules`.
  Alvo `ES2022`, módulos `nodenext`, `rootDir: src` → `outDir: dist`, `sourceMap: true`.
- Alternativa descartada: apenas `strict: true` (padrão do `tsc --init`) — atenderia o mínimo, mas as flags extras são exatamente o que caracteriza "rigorosa" e são defensáveis na arguição.
- Verificação: um arquivo de teste com 3 erros propositais (índice fora de faixa, `null` em `number`, parâmetro sem tipo) foi rejeitado pelo compilador; o arquivo foi removido depois.
- Impacto: o código vai exigir mais cuidado (checar `undefined` antes de usar), mas erros de concorrência/parsing aparecem em tempo de compilação, não em produção.

### 05/09 — Etapa 0: `"types": ["node"]` explícito no tsconfig
- Contexto: com o TypeScript 7 (compilador nativo), o build falhou com `Cannot find name 'process'` / `'console'` mesmo com `@types/node` instalado — a descoberta automática de `@types` não ocorreu.
- Decisão: declarar `"types": ["node"]` no `tsconfig.json`.
- Impacto: build volta a funcionar e a dependência de tipos fica explícita (mais claro para quem lê o projeto).

### 05/09 — Etapa 0: estrutura de pastas e scripts npm
- Decisão: código-fonte em `src/`, saída compilada em `dist/` (ignorada pelo git). Scripts: `npm run build` (compila), `npm start` (roda `dist/index.js`), `npm run typecheck` (só checa tipos, sem gerar arquivos).
- Alternativa descartada: `ts-node` / `tsx` para rodar TypeScript direto sem compilar. Motivo: é dependência extra não pedida no escopo, e o ciclo "compilar → rodar" evidencia melhor a tipagem estática (o build falha antes de executar).
- Impacto: fluxo de trabalho padrão do projeto é `npm run build && npm start`.

### 05/09 — Etapa 0: git inicializado com branch `main`
- Decisão: `git init -b main`; `.gitignore` cobrindo `node_modules/`, `dist/`, `.env*`, logs, `data/` (futuros volumes do Docker) e arquivos de SO/editor.
- Motivo de ignorar `node_modules/` e `dist/`: são gerados (`npm install` e `npm run build` os recriam) — versioná-los incharia o repositório e causaria conflito entre as duas máquinas.
- Impacto: GitHub e primeiro push ficaram pendentes, a pedido do aluno, para serem feitos juntos.

### 05/09 — Etapa 0: Docker Desktop ausente na máquina 1 (pendência bloqueante)
- Contexto: `docker compose version` não é reconhecido — Docker Desktop não está instalado.
- Decisão: registrar como pendência; não instalar sem confirmação do aluno.
- Impacto: **bloqueia a Etapa 1** (Kafka sobe via docker-compose). Precisa ser resolvido antes de iniciá-la.
