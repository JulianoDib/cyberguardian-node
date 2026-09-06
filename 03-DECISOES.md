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

---

## Etapa 1 — R2: Fila de Mensagens (Kafka)

### 06/09 — Imagem oficial `apache/kafka:4.0.0` em modo KRaft (sem Zookeeper)
- Contexto: precisávamos subir o broker via docker-compose; a maioria dos tutoriais usa imagens de terceiros com Zookeeper.
- Decisão: imagem **oficial da Apache**, versão **fixada em 4.0.0**, rodando em modo **KRaft** (o próprio Kafka faz a coordenação do cluster).
- Alternativas descartadas:
  - `bitnami/kafka` — imagem de terceiros, política de distribuição instável.
  - `confluentinc/cp-kafka` — mais pesada e voltada à plataforma Confluent.
  - Kafka + Zookeeper (arquitetura antiga) — dois serviços em vez de um, sem ganho nenhum para nós; o Zookeeper foi removido do Kafka 4.
- Impacto: `docker-compose.yml` com **um único serviço**. Versão fixa garante que máquina 1, máquina 2 e o professor rodem o mesmo broker.

### 06/09 — Duplo listener (INTERNO/EXTERNO) e `advertised.listeners`
- Contexto: o Kafka não devolve dados direto — ele **anuncia** ao cliente um endereço para a continuação da conversa. Se o endereço anunciado não for resolvível pelo cliente, a conexão é aceita e depois morre. É a falha clássica de Kafka em container com cliente no host.
- Decisão: três listeners — `INTERNO` (9092, anuncia `kafka:9092`), `EXTERNO` (29092, anuncia `localhost:29092`) e `CONTROLLER` (9093, uso interno do KRaft). Apenas a **29092** é publicada para o Windows.
- Alternativa descartada: listener único anunciando `localhost` — funcionaria para o Node no host, mas quebraria a comunicação entre containers, fechando a porta para containerizar os workers na Etapa 8.
- Impacto: o código no Windows conecta em `localhost:29092`. **Validado empiricamente** na Parte 2 (produtor publicou e consumidor leu, ambos fora do Docker).

### 06/09 — Tópico `alertas-anomalia` com 3 partições
- Contexto: o R3 exige no mínimo 3 workers consumindo em paralelo (Competing Consumers).
- Decisão: 3 partições, fator de replicação 1.
- Justificativa: no Kafka, **dentro de um grupo de consumidores cada partição vai para no máximo um consumidor**. Com 1 partição, os 3 workers subiriam e conectariam normalmente, mas só um receberia mensagens — o R3 quebrado de forma silenciosa. O número de partições é o teto físico de paralelismo do tópico.
- Fator de replicação 1 porque há **um único broker**. Não confundir com o "primário + réplica" dos dados consolidados (Etapa 7) — são coisas diferentes.
- Evidência coletada: `kafka-consumer-groups.sh --describe` mostrou um consumidor sozinho segurando as 3 partições; com 3 workers elas se dividem, uma para cada.

### 06/09 — `auto.create.topics.enable = false`
- Contexto: por padrão o Kafka cria um tópico automaticamente quando alguém escreve num nome inexistente — com **1 partição**.
- Decisão: desligar.
- Impacto: um erro de digitação no nome do tópico agora dá erro imediato, em vez de criar silenciosamente um tópico de 1 partição que quebraria o R3 sem aviso.

### 06/09 — Fila EFÊMERA: sem volume de persistência (correção de rumo)
- Contexto: a primeira versão do compose tinha volume nomeado. Duas falhas em sequência:
  1. Montei o volume em `/tmp/kraft-combined-logs`, mas o caminho real é `/tmp/kafka-logs` — o volume ficou num diretório não usado, **sem persistir nada e sem dar erro**.
  2. Ao corrigir o caminho, o container passou a não subir: `AccessDeniedException`. Volume nomeado é criado pertencendo ao `root`, e o Kafka roda como `appuser` (uid 1000).
- Decisão: **remover o volume**. A fila é efêmera; `docker compose down` limpa as mensagens.
- Alternativa descartada: rodar o container como `root` para contornar a permissão — má prática e difícil de defender.
- Justificativa: **nenhum requisito exige durabilidade do broker.** O R6 trata de queda de *worker*, resolvida por ack manual + offsets, não de queda do broker.
- Impacto: ambiente sempre limpo a cada demonstração. Se persistência vier a ser exigida, a solução correta é montar em caminho já existente na imagem (o Docker preserva o dono) ou ajustar permissões na inicialização.

### 06/09 — Biblioteca cliente: `kafkajs`
- Contexto: o Kafka usa protocolo binário próprio; é preciso um cliente.
- Decisão: **`kafkajs` 2.2.4**, como `dependency` (o gateway e os workers precisam dela em execução, não só para compilar).
- Alternativas descartadas: `@confluentinc/kafka-javascript` e `node-rdkafka` — ambas envelopam a `librdkafka` (código C). São mais rápidas, mas exigem binário pré-compilado para a combinação exata de SO + versão do Node; na falta dele, o `npm install` tenta compilar e passa a exigir Visual Studio Build Tools. Com **três máquinas envolvidas** (duas do aluno + a do professor) e prazo curto, o risco de instalação não compensa um desempenho que a carga simulada não precisa.
- Motivo técnico decisivo: a `kafkajs` expõe explicitamente `autoCommit: false` e confirmação manual de offset — exatamente o que o **R6** exige. Uma biblioteca que escondesse esse controle nos custaria o requisito.
- Bônus: tipagem TypeScript embutida (sem pacote `@types/` extra) e **zero dependências transitivas** (o `npm install` reportou "added 1 package").
- Compatibilidade com Kafka 4.0: **verificada empiricamente** — produção e consumo funcionaram.

### 06/09 — Sem biblioteca de UUID: `crypto.randomUUID()` do Node
- Decisão: usar a função nativa do Node 24 em vez de instalar o pacote `uuid`.
- Impacto: uma dependência a menos, sem perda de funcionalidade.

### 06/09 — Contrato da mensagem definido COMPLETO já na Etapa 1
- Contexto: o plano previa definir o formato na Etapa 1 e o carimbo de Lamport só na Etapa 4. Isso obrigaria a alterar o contrato depois que gateway, 3 workers e simulador já dependessem dele.
- Decisão: definir o envelope inteiro agora, em `src/compartilhado/tipos.ts`, **com o campo `lamport` já presente**, circulando com valor 0 até a Etapa 4 dar sentido a ele.
- Estrutura: `Envelope<T>` = `id` (UUID) + `payload` + `metadados`. `MetadadosCausais` = `origemId`, `lamport`, `emitidoEm`, `correlacaoId`, `causaId`.
- Mapeamento com o R2: `id` = identificador único; `payload` (`AlertaAnomalia` tipado) = payload estruturado; `metadados` = rastreabilidade causal.
- Ponto de defesa embutido: `emitidoEm` (relógio físico) e `lamport` (relógio lógico) coexistem de propósito. O físico **não** serve para ordenar entre máquinas; os dois lado a lado permitem *mostrar nos logs* um caso em que a ordem física e a causal discordam.
- Descartes conscientes: campos `versao` (versionamento de esquema) e `tipo` (discriminador). São boa prática em sistemas reais, mas nenhum requisito pede e a regra de escopo fechado manda não adicionar. O `Envelope<T>` é genérico, então reaproveitar para o `RegistroBloqueio` do líder na Etapa 5 não custa nada.

### 06/09 — Chave da mensagem = `ipOrigem`
- Contexto: o Kafka usa o hash da chave para escolher a partição.
- Decisão: usar o IP de origem do ataque como chave da mensagem.
- Justificativa: o Kafka **só garante ordem dentro de uma partição**. Com essa chave, todos os alertas do mesmo IP atacante caem na mesma partição, são entregues ao mesmo worker e chegam em ordem — que é o que o tema pede ao falar em "estabelecer a linha do tempo exata do ataque".
- Alternativa descartada: sem chave (distribuição em rodízio) — espalharia eventos do mesmo ataque por partições diferentes, permitindo processamento fora de ordem.
- Evidência: duas execuções do produtor caíram ambas na partição 2, com a mesma chave.

### 06/09 — Particionador declarado explicitamente
- Decisão: `createPartitioner: Partitioners.DefaultPartitioner` em `criarProdutor()`.
- Motivo: o `DefaultPartitioner` da v2 calcula a partição igual ao cliente Java oficial. O `LegacyPartitioner` existe só por compatibilidade com a v1 da kafkajs.
- Efeito colateral positivo: elimina o aviso de migração da biblioteca — ela só avisa `if (createPartitioner == null)`. Preferimos **documentar a escolha no código** a silenciar por variável de ambiente.

### 06/09 — Ruídos de log investigados (nenhum é incompatibilidade com Kafka 4.0)
- **`TimeoutNegativeWarning`** — bug latente da própria `kafkajs`, rastreado até `requestQueue/index.js:312`: `scheduleAt = this.throttledUntil - Date.now()`, com `throttledUntil` inicializado em `-1`. A linha que corrigiria (`scheduleAt > 0 ? ... : INTERVAL`) só executa `if (this.pending.length > 0)`; sem requisições pendentes, o valor negativo vai direto ao `setTimeout`. Efeito prático nulo (o Node limita a 1 ms). Só ficou visível porque o Node 24 passou a avisar sobre timeouts negativos.
  - Tratamento: flag nativa `--disable-warning=TimeoutNegativeWarning` nos scripts npm. Cirúrgica — qualquer outro aviso continua aparecendo.
- **`The group coordinator is not available` (nível ERROR)** — transitório, uma única vez na criação do grupo: o tópico interno de offsets é criado sob demanda e o primeiro pedido chega antes dele existir. A biblioteca tenta de novo e funciona. **Decidimos deixar aparecer** — suprimir erros reais esconderia informação útil. Não se repetiu nas execuções seguintes.
- Justificativa de tratar ruído: logs são evidência de nota (regra 9 do CLAUDE.md); avisos espúrios nos prints da defesa atrapalham.

### 06/09 — Estrutura de pastas do código
- Decisão: `src/compartilhado/` (contrato de mensagem e conexão Kafka, usados por todos os processos) e `src/testes/` (scripts de verificação manual).
- Motivo: se o contrato morasse dentro da pasta do gateway, os workers teriam que importar "de dentro" do gateway — dependência invertida, ruim de explicar.
- Nota: `src/testes/` contém scripts de verificação **manual**, executados à mão. Não são testes automatizados (explicitamente fora do escopo).

---

## Etapa 2 — R1: Ponto de Entrada (Gateway TCP)

### 06/09 — Pasta `demonstracoes/` versionada como evidência de defesa
- Contexto: antes de implementar o framing, foram escritos dois scripts para *ver* o problema acontecer — um servidor TCP sem enquadramento sofrendo aglutinação e fragmentação, e o par mostrando os mesmos cenários resolvidos.
- Decisão: **guardar os dois no repositório**, em `demonstracoes/`, fora de `src/`.
- Justificativa: o critério de defesa "Fundamentação e Decisões de Arquitetura" (0,5) cobra justificar trade-offs. Poder responder "por que framing explícito?" com números medidos — 3 alertas de 69 bytes chegando grudados numa leitura de 207; 1 alerta de 300 KB picado em 5 leituras de 64 KB; 100% de falha no `JSON.parse` nos dois casos — vale mais que uma explicação teórica.
- Cuidados tomados para não confundir com código de produção:
  - ficam **fora de `src/`**, então não entram na compilação do `tsc`;
  - cabeçalho no topo de cada arquivo em caixa alta: "MATERIAL DE DEMONSTRACAO — NAO FAZ PARTE DO SISTEMA EM PRODUCAO";
  - nenhum módulo do gateway, dos workers ou do sensor os importa (a dependência é no sentido oposto: o demo é que usa o `framing` real do projeto).
- Correção aplicada ao mover: o `solucao-com-framing.mjs` importava o framing por **caminho absoluto** (`C:/Users/Julia/...`), o que quebraria na máquina 2 e na do professor. Trocado por caminho relativo `../dist/compartilhado/framing.js`.
- Atalhos: `npm run demo:problema` e `npm run demo:solucao`.
- Alternativa descartada: deixá-los fora do repositório (pasta temporária). Perderíamos a evidência justamente na hora da arguição.

### 06/09 — Framing por prefixo de tamanho (4 bytes) + JSON UTF-8
- Contexto: o TCP entrega um fluxo de bytes, não de mensagens. As leituras não correspondem às escritas do outro lado.
- Evidência medida antes de decidir (`demonstracoes/problema-sem-framing.mjs`): 3 alertas de 69 bytes chegaram **grudados numa leitura de 207 bytes** (aglutinação), e 1 alerta de 300.070 bytes chegou **picado em 5 leituras** de 65.536/65.536/65.536/65.536/37.926 (fragmentação). Nos dois casos, **100% de falha** no `JSON.parse` — 6 leituras, 6 erros, 0 mensagens recuperadas.
- Decisão: cada quadro = 4 bytes de tamanho (inteiro sem sinal, big-endian) + N bytes de JSON em UTF-8. Teto de 1 MB por quadro.
- Alternativas descartadas:
  - **Delimitador `\n` (NDJSON)** — funcionaria, porque `JSON.stringify` já escapa quebras de linha internas, então não haveria colisão. Descartado por dois motivos: (a) com prefixo, o tamanho é conhecido **antes** de receber o corpo, o que permite recusar quadros abusivos sem alocar memória; (b) o enunciado pede framing *explícito*, e o tamanho como campo é mais explícito que "leia até achar o marcador". **Registrar que NDJSON não está errado** — é escolha de trade-off, não de correção.
  - **Tamanho fixo** — desperdiça espaço e engessa o payload.
- Verificação (`demonstracoes/solucao-com-framing.mjs`): os mesmos cenários passam a 100%; alimentado **byte a byte**, o decodificador só entrega a mensagem no byte 52 de 52; e um cabeçalho anunciando 2 GB é recusado lendo apenas 4 bytes.
- Custo do enquadramento: 69 → 73 bytes na mensagem pequena; 300.070 → 300.074 na grande.

### 06/09 — ACK enviado APÓS a confirmação do Kafka
- Contexto: duas opções — responder na hora e publicar em segundo plano, ou publicar e só então responder.
- Decisão: **ACK após o Kafka confirmar**.
- Justificativa: o escopo fala em "ACK de enfileiramento"; um ACK enviado antes da confirmação poderia **mentir** ao sensor se a publicação falhasse em seguida. Continua sendo non-blocking no sentido que importa: o sensor não espera o *processamento* (a análise do worker), e o gateway não trava para outros sensores enquanto aguarda o broker.
- Medição: latência de 43 a 53 ms por alerta (média 48 ms) em rajada de 5, com Kafka local.
- Alternativa descartada: ACK imediato — ganharia poucos milissegundos ao custo de um ACK potencialmente falso, difícil de defender oralmente.

### 06/09 — Serialização do processamento POR CONEXÃO (seção crítica do gateway)
- Contexto: o tratador de `data` é assíncrono (aguarda o Kafka). Dois quadros chegando em sequência teriam publicações disparadas em paralelo.
- Problema evitado: as gravações poderiam chegar **fora de ordem** na partição, destruindo a ordenação por atacante que a chave da mensagem garante.
- Decisão: encadear promessas (`fila = fila.then(...)`) — uma fila por socket.
- Impacto: ordena **dentro** de cada conexão sem bloquear as demais; conexões diferentes seguem atendidas em paralelo pelo event loop. É a seção crítica concreta do gateway — resposta pronta para a pergunta "onde está a race condition?".
- Evidência: 5 alertas enviados em rajada foram enfileirados na ordem exata 1→5 no log do gateway.

### 06/09 — Divisão de responsabilidade: sensor manda ALERTA, gateway monta o ENVELOPE
- Decisão: o sensor envia apenas o `AlertaAnomalia`; o gateway gera `id`, `correlacaoId`, `emitidoEm` e o carimbo de Lamport.
- Justificativa: o identificador único e os metadados causais são responsabilidade do Ponto de Entrada, não de um cliente externo (que poderia repetir ids). E na Etapa 4 a mudança de Lamport fica **local ao gateway**.
- Consequência: `origemId` do envelope é `"gateway"`; o sensor de origem continua identificado dentro do payload, em `sensorId`.

### 06/09 — Validação da entrada com type guard (`ehAlertaAnomalia`)
- Contexto: `JSON.parse` devolve algo sem nenhuma garantia de formato. Sem verificação em execução, a tipagem estática seria ficção na fronteira da rede.
- Decisão: type guard (`valor is AlertaAnomalia`) checando tipo de cada campo, valor do enum `protocolo` e `Number.isFinite` nos numéricos.
- Impacto: alerta fora do contrato recebe `{"tipo":"ERRO","motivo":"alerta fora do contrato esperado"}` e o gateway segue vivo.

### 06/09 — Protocolo de resposta como união discriminada
- Decisão: `RespostaGateway = AckEnfileiramento | ErroGateway`, discriminadas pelo campo `tipo`.
- Justificativa: o TypeScript estreita o tipo sozinho ao testar `resposta.tipo === "ACK"`, tornando impossível ler um campo que não existe naquele ramo. Serve ao critério de tipagem rigorosa.

### 06/09 — Tratamento de falhas do gateway (critério "exceções e timeouts robustos")
- Decisões e o que cada uma protege:
  - **JSON inválido** → responde ERRO, mantém a conexão (é erro de conteúdo, o fluxo segue alinhado).
  - **Alerta fora do contrato** → responde ERRO, mantém a conexão.
  - **Violação de framing** → responde ERRO e **derruba a conexão**: perdido o alinhamento do fluxo, não há como reencontrá-lo.
  - **Falha ao publicar no Kafka** → responde ERRO genérico ao sensor; o detalhe fica no log do servidor (não vaza interno para o cliente).
  - **Timeout de ociosidade (30 s)** → derruba conexões mortas; sem isso, uma conexão meio-aberta prenderia socket e memória para sempre.
  - **`error` de socket** → registrado em log, nunca derruba o gateway.
  - **`.catch()` na fila de processamento** → uma falha inesperada não trava o restante da fila daquela conexão.
- Verificação: os quatro casos foram testados manualmente com o gateway no ar. Após os três erros seguidos, um alerta válido foi aceito normalmente (ACK, partição 0) — o gateway sobreviveu a todos.

### 06/09 — `src/compartilhado/rede.ts` para os parâmetros de rede
- Decisão: `HOST_GATEWAY`, `PORTA_GATEWAY` (5000) e `TIMEOUT_OCIOSIDADE_MS` num módulo próprio.
- Motivo: o simulador de sensor precisa do endereço do gateway. Importá-lo de `gateway/servidor.ts` faria o módulo do **servidor ser executado** ao ser importado — o servidor subiria junto com o sensor.

### 06/09 — Módulo de framing separado (`src/compartilhado/framing.ts`)
- Decisão: framing em arquivo próprio, e não embutido no gateway.
- Motivo: custo zero (é só escolher um nome de arquivo) e separação honesta de responsabilidade — o framing não sabe nada sobre Kafka nem sobre alertas.
- Nota, sem antecipar desenho: se a Etapa 5 (Bully) usar sockets entre workers, este módulo provavelmente serve sem alteração. **Nenhuma generalização foi feita para isso.**

### 06/09 — ACHADO OPERACIONAL: recriar o container exige recriar o tópico
- Contexto: durante o teste ponta a ponta, os offsets recomeçaram do zero e o erro transitório do `GroupCoordinator` reapareceu. Investigado com `docker inspect` e `kafka-get-offsets.sh`: o container foi **criado hoje às 16:08Z** (`RestartCount: 0`), e o tópico contém apenas as mensagens desta sessão — as da Etapa 1 (04:02Z) se perderam.
- Diagnóstico: é a consequência esperada e já documentada da decisão de **fila efêmera** (sem volume). Não é defeito novo.
- **Porém, gera um requisito operacional:** como `auto.create.topics.enable=false`, depois de um `docker compose down` o tópico precisa ser **recriado manualmente**, senão o gateway falha ao publicar. Isso precisa entrar no guia de execução do README (Etapa 9) ou ser automatizado no compose.
- Pendência registrada em 04-PROGRESSO.md.
