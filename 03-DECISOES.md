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

---

## Etapa 3 — R3: Workers replicados (Competing Consumers)

### 06/09 — Consumer group único `workers-nids` para os 3 workers
- Decisão: os três processos declaram o **mesmo** `groupId`.
- Justificativa: é esse campo que faz o Kafka **dividir** o trabalho, atribuindo cada partição a exatamente um consumidor do grupo. Nenhuma mensagem é processada duas vezes.
- Alternativa descartada: `groupId` diferente por worker — cada um receberia **todas** as mensagens (publish/subscribe). Seria processamento triplicado, não divisão de trabalho.
- Evidência medida: com os 3 no ar, `kafka-consumer-groups.sh --describe` mostrou partições 0, 1 e 2 com três `CONSUMER-ID` distintos e **LAG 0** em todas.

### 06/09 — ACK MANUAL (`autoCommit: false`) implementado JÁ nesta etapa
- Contexto: o 02-PLANO.md previa isso para a Etapa 6. Antecipado deliberadamente.
- Justificativa da antecipação: ack manual não é recurso que se acrescenta depois — é **como o laço de consumo é escrito**. Deixar para a Etapa 6 significaria reescrever o núcleo do worker com Lamport (Etapa 4) e Bully (Etapa 5) já empilhados em cima.
- Como funciona: o offset só é confirmado **depois** do processamento concluído, via `commitOffsets`. Com a confirmação automática (padrão), a biblioteca salva o offset periodicamente em segundo plano, sem saber se o processamento terminou — se o worker morresse nessa janela, o Kafka consideraria a mensagem lida e nunca mais a entregaria (perda silenciosa).
- **Armadilha do `+1`:** o Kafka guarda o offset da **próxima** mensagem a ler, não o da última processada. Commitar `message.offset` faria o worker reler a mesma mensagem em laço infinito. Usamos `BigInt(offset) + 1n` (BigInt porque offsets do Kafka são inteiros de 64 bits).
- **Garantia obtida: at-least-once, não exactly-once.** Existe janela real: processar com sucesso e morrer antes de commitar faz a mensagem voltar. É por isso que o envelope carrega `id` único desde a Etapa 1. Resposta honesta para a defesa: *"duplicata acontece por desenho; escolhemos at-least-once porque perder alerta de ataque é pior que processar duas vezes, e o `id` permite identificar a repetição."*

### 06/09 — Mensagem envenenada: erro permanente é confirmado e descartado
- Contexto: o ack manual protege contra perda, mas cria o risco oposto — uma mensagem que **nunca** pode ser processada e nunca é confirmada **trava a partição inteira**, em laço infinito de reentrega.
- Decisão: separar dois casos no worker.
  - **Erro permanente** (sem conteúdo, JSON inválido, envelope fora do contrato): registra em log, **confirma o offset** e descarta. Reprocessar não ajudaria.
  - **Erro transitório** (falha inesperada no processamento): **não confirma**, deixando a mensagem pendente para reentrega numa próxima atribuição da partição.
- Alternativa descartada: tópico de dead-letter para as descartadas — fora do escopo do trabalho.

### 06/09 — SEÇÃO CRÍTICA: nenhum mutex, e o motivo (ponto de defesa)
- **Onde NÃO há contenção:** entre os 3 workers não existe memória compartilhada — são processos separados do sistema operacional. Um mutex entre eles seria não só decorativo, seria impossível sem coordenador externo. E dois workers nunca recebem a mesma mensagem, porque cada partição pertence a um único consumidor do grupo.
- **Formulação para a arguição:** *a exclusão mútua do sistema existe, mas está na arquitetura, não no código* — quem serializa o acesso às mensagens é a atribuição de partições do Kafka.
- **Onde HÁ contenção de verdade:** dentro de um worker, no `Map` de janela deslizante por IP (`historicoPorIp`), cujo padrão de acesso é ler → modificar → escrever. O Node é single-thread mas **concorrente**: um `await` entre a leitura e a escrita abriria a corrida clássica *check-then-act*.
- **Decisão: manter a seção crítica SÍNCRONA**, sem `await` entre ler e escrever. Fica atômica por construção — melhor que travar com lock.
- **Verificação feita no código da biblioteca antes de decidir:** `partitionsConsumedConcurrently` tem padrão **1** e o runner faz `await this.eachMessage(...)` antes de buscar a próxima mensagem (`node_modules/kafkajs/src/consumer/index.js:194` e `runner.js:231`). Ou seja, a kafkajs já serializa por padrão — mas não dependemos disso: a atomicidade vem de a operação ser síncrona.
- Alternativa descartada: colocar um mutex "para mostrar que sabemos" — indefensável na arguição, já que não protegeria nada.
- **Aviso registrado:** se a Etapa 7 inserir gravação em banco dentro dessa seção, a janela de corrida se abre e passará a ser necessária serialização explícita.

### 06/09 — A escolha da chave da Etapa 2 resolveu a concorrência de graça
- Observação de arquitetura: como a chave da mensagem é o `ipOrigem`, **todos os alertas de um mesmo atacante caem sempre na mesma partição e são entregues sempre ao mesmo worker**.
- Consequência: a contagem local da janela deslizante está **correta sem nenhuma coordenação entre processos**. Se as mensagens fossem distribuídas em rodízio, nenhum worker teria a contagem completa e seria necessário estado compartilhado.
- Evidência: no teste com 12 alertas, `198.51.100.9` foi inteiramente para o worker-1 (6 mensagens), `203.0.113.45` para o worker-2 (4) e `192.0.2.77` para o worker-3 (2).
- Custo honesto do trade-off: a divisão é por **partição**, não por mensagem, então um atacante muito ativo concentra carga num worker só. Trocamos balanceamento perfeito por ordenação garantida — que é o que o tema pede.

### 06/09 — Regra de bloqueio em duas camadas, isolada do worker
- Decisão: `src/worker/regra-bloqueio.ts` separado do `worker.ts`.
- Motivo: o tema diz que os workers "validam regras de bloqueio de forma independente". Isolada, a regra fica explicável em 30 segundos na defesa e o `worker.ts` trata de consumo, não de negócio.
- A regra:
  1. **Imediata:** `pacotesPorSegundo` acima de 20.000 → é um pico. Abaixo disso é `NORMAL` e **não entra na contagem**.
  2. **Acumulada:** 3 picos do mesmo `ipOrigem` numa janela de 30 s → `BLOQUEAR` (ataque sustentado). Entre 1 e 2 picos → `SUSPEITO`.
- Justificativa da composição: *"um pico isolado é suspeito; picos repetidos do mesmo IP caracterizam ataque sustentado."* Só contar quem passou do limiar evita que tráfego normal infle a janela.
- Evidência de que as camadas compõem: no teste, o worker-2 recebeu um alerta de 19.675 pacotes/s, classificou como `NORMAL` e **não incrementou o contador** — o alerta seguinte apareceu como "2/3", não "3/3".
- Nota: o worker apenas **recomenda** o bloqueio. Consolidar o lote e emitir o comando único é papel do líder (R5).

### 06/09 — Três workers em três terminais
- Decisão: `npm run worker -- 1`, `-- 2`, `-- 3`, cada um no seu terminal.
- Alternativa descartada: script único que sobe os três como processos filhos. Motivos: na Etapa 6 é preciso **matar um worker específico** para demonstrar a redistribuição, o que fica desajeitado com um script só; e os logs separados por worker são exatamente o formato de evidência que o README exige.

### 06/09 — Ruído de log do rebalanceamento: mantido visível
- Observação: ao subir os workers, a kafkajs registra em nível ERROR mensagens do tipo `The group is rebalancing, so a rejoin is needed`.
- Diagnóstico: não é erro — é o fluxo normal do protocolo quando a composição do grupo muda. O broker rejeita os heartbeats em curso e os consumidores reentram no grupo. Acontece só na entrada/saída de membros.
- Decisão: **manter visível**, sem filtro. Além de coerente com a postura de não suprimir erros reais, essas linhas são a evidência de que o rebalanceamento realmente ocorreu — o que é justamente o que o R3 precisa demonstrar.
- Evidência do rebalanceamento em cadeia, capturada no log do worker-1: `[0, 1, 2]` sozinho → `[0, 1]` quando o worker-2 entrou → `[1]` quando o worker-3 entrou.

---

## Etapa 4 — R4: Relógios de Lamport

### 06/09 — Modelagem A: cada ação é um evento separado
- Decisão: receber, processar e enviar são eventos distintos, cada um incrementando o contador. Consistente do início ao fim do sistema.
- Alternativa descartada: contar apenas o par envio/recepção (modelo mínimo). Descartada porque o escopo pede evidência de "atualização dos carimbos" nos logs, e a modelagem granular torna essa evidência mais rica e mais fácil de auditar.

### 06/09 — Quem tem relógio: gateway e workers; o Kafka não participa
- Decisão: um `RelogioLamport` por processo — o gateway tem um, cada worker tem o seu. O sensor **não** tem relógio. O Kafka apenas transporta.
- Consequência: quando o gateway recebe um alerta do sensor, não há `L_msg` para compor — é `eventoInterno()`, equivalente a `max(L, 0) + 1`.
- Justificativa: o relógio pertence ao processo que participa da cadeia causal do sistema distribuído. O sensor é cliente externo; o broker é infraestrutura de transporte.
- Detalhe de implementação: o relógio do gateway é **um por processo**, não um por conexão. Todos os eventos do gateway compartilham a mesma linha do tempo lógica.

### 06/09 — O carimbo viaja no envelope, não em headers do Kafka
- Decisão: usar `metadados.lamport`, campo que já existia desde a Etapa 1.
- Justificativa: o carimbo é metadado **causal** e pertence junto de `correlacaoId` e `causaId`. Mantém a mensagem auto-contida — quem lê a mensagem tem toda a informação causal sem depender de metadados do transporte.
- Alternativa descartada: headers do Kafka — acoplaria a informação causal ao broker e a perderia se a mensagem fosse repassada por outro meio.
- Benefício colateral da antecipação feita na Etapa 1: **nenhuma mudança de contrato foi necessária**. Só a lógica que preenche o campo mudou.

### 06/09 — Eventos que incrementam, por processo
- **Gateway (3 por alerta):** `RECEBE-SENSOR` (interno) → `PUBLICA-FILA` (envio, é o carimbo que viaja) → `ENVIA-ACK` (envio).
- **Worker (2 por mensagem):** `RECEBE-FILA` (`max(L_local, L_msg) + 1`) → `PROCESSA` (interno).
- **O ACK ao sensor incrementa**, decidido pela consistência da Modelagem A. Contra-argumento considerado: o destinatário não tem relógio, então o carimbo não é consumido por ninguém. A favor (venceu): o contador também ordena os eventos locais do gateway, onde o ACK existe de fato.
- **O `commitOffsets` NÃO incrementa.** É escrituração de infraestrutura do Kafka, não evento de domínio. Se contasse, o relógio passaria a medir mecânica de biblioteca em vez de causalidade.
- **Quadros inválidos e respostas de erro NÃO incrementam.** Mesmo critério: lixo de protocolo não é um alerta recebido.
- Efeito visível: como o gateway avança de 3 em 3, os carimbos das mensagens publicadas saem 2, 5, 8, 11... — fica óbvio nos logs que houve eventos entre uma publicação e outra.

### 06/09 — Validação do carimbo na FRONTEIRA, não no relógio
- Contexto: `NaN` passa por `typeof x === "number"`, e `Math.max(qualquer, NaN)` é `NaN` — um carimbo NaN contaminaria o contador do worker **permanentemente**.
- Decisão: `ehEnvelopeAlerta` passou a exigir `Number.isInteger(lamport) && lamport >= 0`. Assim um carimbo inválido vira **erro permanente** (mensagem descartada e offset confirmado), sem travar a partição.
- Segunda linha de defesa: `RelogioLamport.aoReceber` também valida e lança `ErroDeRelogio`; o worker trata essa exceção como erro permanente. Nunca deveria disparar — existe para o relógio jamais ser contaminado.

### 06/09 — Ordenação determinística por `(lamport, processo)`
- Contexto: o escopo pede ordenação **determinística**, e Lamport sozinho dá apenas ordem **parcial** — eventos concorrentes podem ter carimbos iguais.
- Decisão: ordem total por `(lamport, nome do processo)`, com desempate lexicográfico. É a técnica clássica de totalização.
- Impacto: rodar a ferramenta de ordenação duas vezes produz sempre o mesmo resultado.

### 06/09 — Log de auditoria: um arquivo por processo, em JSONL
- Decisão: `logs/auditoria-<processo>.jsonl`, uma linha JSON por evento, truncado no início de cada execução.
- Arquivos separados (e não um compartilhado) por dois motivos: escrita concorrente de vários processos no mesmo arquivo pode intercalar e corromper linhas no Windows; e separados reproduzem exatamente o cenário que Lamport endereça — registros locais independentes reconciliados depois.
- `logs/` já estava no `.gitignore` desde a Etapa 0.
- **Uma única chamada (`RegistradorAuditoria.registrar`) escreve o console E o arquivo.** Se fossem chamadas separadas, os dois poderiam divergir e a demonstração perderia valor de prova.
- Escrita **síncrona**, logo após o incremento, sem `await` no meio: o registro nunca sai de ordem em relação ao contador. Custo honesto: é I/O bloqueante — aceitável neste volume, seria bufferizado em produção.
- Nota: isto é log de auditoria em arquivo, **não** a persistência primário+réplica da Etapa 7.

### 06/09 — Formato do log com a aritmética explícita
- Decisão: toda linha de relógio leva o marcador `LAMPORT` e **escreve a conta**: `max(local=4, msg=20)+1 = 21`.
- Justificativa: o README exige evidência da atualização dos carimbos. Escrever a conta permite ao avaliador **conferir a regra na própria linha**, em vez de acreditar na afirmação. `grep LAMPORT` extrai a evidência pronta.
- Evidência colhida: `[worker-1] LAMPORT L=3 RECEBE-FILA max(local=0, msg=2)+1 = 3` — o relógio pula de 0 para **3**, não para 1, porque aprendeu sobre eventos que o precedem causalmente. Nenhum relógio físico transporta essa informação.

### 06/09 — Demonstração "Lamport vs Relógio Físico": o que é e o que NÃO é demonstrável
- **Não é demonstrável nesta montagem:** relógio físico atrasado invertendo uma relação causal real. Isso exige desvio de relógio entre máquinas, e todos os processos rodam na mesma máquina com o mesmo relógio de parede. Aqui o relógio físico está no **melhor cenário possível**. Fingir o contrário seria desonesto.
- **É demonstrável, e basta:** que mesmo com relógios físicos perfeitamente sincronizados, a ordem física e a ordem lógica **discordam** — e que a ordem física é a que carece de significado.
- Resultado medido (execução de 06/09, 45 eventos): **104 pares invertidos encontrados naturalmente**, sem nenhuma encenação. Exemplo: `gateway L=4 às 13:50:23.952` e `worker-1 L=3 às 13:50:23.956` — fisicamente o gateway veio antes, logicamente o worker-1 veio antes.
- **O contraponto que fecha o argumento:** as **9/9 cadeias causais** (gateway publica → worker recebe) foram respeitadas pelo Lamport. Ou seja, onde existe causalidade ele nunca inverteu; onde não existe, as duas réguas discordam — e só a física finge saber a resposta.
- Registro honesto: o tempo físico também respeitou as 9/9 cadeias causais nesta execução. Esperado — sem desvio de relógio, ele não tem como errar nesse quesito. A falha que a demonstração expõe é a **falsa precisão** ao ordenar eventos concorrentes, não inversão causal.
- Ferramenta: `demonstracoes/ordenar-auditoria.mjs` (`npm run demo:lamport`). Mescla os logs, imprime as duas ordens, encontra os pares invertidos automaticamente e verifica as cadeias causais.

### 06/09 — Observação: nesta topologia o `max` sempre escolhe o carimbo da mensagem
- Fato observado nos logs: em todas as recepções, `L_msg > L_local` — o `max` sempre pegou o valor da mensagem.
- Explicação: o gateway é ancestral causal de tudo e avança 3 por alerta, enquanto os workers avançam 2 por mensagem. O gateway está sempre à frente.
- Consequência honesta: o `max` está funcionando (os saltos de 0→3, 4→21, 10→18 provam isso), mas um caso em que o relógio **local** domina não aparece nesta topologia. Ele exigiria um processo com mais eventos locais que o carimbo recebido.
- Não foi forçado artificialmente. Registrado para não afirmar mais do que os dados mostram.

---

## Etapa 5 — R5: Eleição de Líder (Algoritmo do Valentão / Bully)

### 06/09 — Canal de coordenação: TCP com CONEXÃO POR MENSAGEM
- Contexto: o Bully precisa de um canal entre os workers para ELECTION / OK / COORDINATOR e para a sondagem de vida. Esse canal não existia no sistema.
- Decisão: **TCP, abrindo uma conexão por mensagem** (abre, envia, recebe a resposta, fecha). Sem pool, sem reconexão, sem estado de conexão.
- Motivos:
  1. O grande defeito do TCP em malha entre nós é o gerenciamento de conexões — conexão por mensagem elimina isso por completo.
  2. Ganha-se o **`ECONNREFUSED`**: ao conectar num processo morto, o sistema operacional responde imediatamente "não há ninguém nessa porta". É evidência **direta** de queda, não um palpite por ausência de resposta.
  3. O canal é **independente do Kafka**: uma falha do broker não afeta a detecção de queda de worker, e vice-versa.
  4. Reaproveita o `framing.ts` já escrito e validado na Etapa 2.
- **RESSALVA PARA A DEFESA — a alternativa mais canônica era UDP.** As implementações de livro-texto do Bully usam UDP, e por bons motivos: sem conexão para gerenciar, cada datagrama já é uma mensagem com fronteira preservada (dispensa framing), latência mínima, e o algoritmo **já tolera perda por desenho** (se um OK se perde, o timeout dispara e há nova eleição). Se perguntarem "por que não UDP?", a resposta honesta é: *"UDP é o mais canônico e teria funcionado; escolhemos TCP porque o `ECONNREFUSED` dá detecção imediata e inequívoca de queda — com UDP só haveria o silêncio, que é ambíguo entre morto, lento e pacote perdido — e porque reaproveitamos o enquadramento já validado."* Não dizer que UDP está errado.
- Alternativas descartadas:
  - **Tópico do Kafka** — teria menos código, mas: o Bully precisa de mensagens **dirigidas** (Kafka é difusão); precisa de **timeouts previsíveis** (a latência do consumidor inclui busca, lotes e rebalanceamento, que pode atrasar segundos e fazer a eleição oscilar); exigiria três consumer groups extras; e o mais grave, **acoplaria a detecção de falha à saúde do broker**, impedindo distinguir "worker caiu" de "fila com problema". Além de ser circular usar o Kafka para eleger o líder que coordena o Kafka.
  - **HTTP/REST** — pilha inteira para trocar mensagens de três campos.

### 06/09 — O OK realizado como RESPOSTA ao ELECTION, na mesma conexão
- Contexto: no Bully clássico o OK é uma mensagem separada, enviada de volta pelo nó maior.
- Decisão: como cada mensagem abre a própria conexão, o OK é a **resposta** da requisição ELECTION.
- Justificativa: as mensagens do algoritmo são exatamente as mesmas; muda apenas como o transporte as materializa. E simplifica a espera pelo OK — ela vira o timeout da própria requisição, em vez de um temporizador separado.
- Registrado por ser detalhe que um examinador atento pode questionar.

### 06/09 — Descoberta estática da composição do grupo
- Decisão: tabela fixa em `rede.ts` — worker 1 → porta 5101, worker 2 → 5102, worker 3 → 5103.
- Justificativa: **não é simplificação, é exigência do Bully.** O algoritmo assume que cada nó conhece a lista completa de participantes e seus IDs, senão não sabe a quem enviar ELECTION. É uma limitação real do algoritmo — o Ring, em comparação, precisa conhecer apenas o próprio sucessor.

### 06/09 — Tempos da detecção de falha e da eleição
- Sondagem do líder a cada **1000 ms**; timeout de resposta **500 ms**; **3 falhas consecutivas** para declarar o líder morto. Detecção no pior caso: ~3 s.
- **Direção da sondagem: os seguidores sondam o líder** (e não o líder empurrando heartbeat). Motivo: é o seguidor que precisa detectar a queda, e sondando ele obtém o `ECONNREFUSED` na hora. Se o líder empurrasse, o seguidor só descobriria por silêncio.
- Três defesas contra falso positivo: (1) as falhas precisam ser **consecutivas** e qualquer resposta bem-sucedida **zera** o contador; (2) margem de ~100× no timeout (500 ms para latência real < 5 ms); (3) como o `ECONNREFUSED` retorna instantaneamente, um líder **morto** acumula as três falhas rápido, enquanto um líder **lento** que ainda responde zera o contador — o mesmo mecanismo distingue os dois casos sem código extra.
- `TIMEOUT_OK = 1000 ms` e `TIMEOUT_COORDINATOR = 2500 ms`. **A ordem entre eles importa:** o de COORDINATOR precisa ser maior, senão o nó reiniciaria a eleição antes de o nó maior ter tempo de concluir a dele. É erro clássico de implementação de Bully.
- `setTimeout` encadeado em vez de `setInterval` na sondagem: assim uma sondagem lenta nunca se sobrepõe à próxima.

### 06/09 — Convivência do Bully com o consumo do Kafka no mesmo processo
- Ambos são I/O assíncrono sobre o mesmo event loop do Node, então os heartbeats continuam fluindo enquanto o `eachMessage` espera o commit.
- **Risco declarado:** se o processamento fizesse trabalho **síncrono pesado**, bloquearia o event loop e atrasaria os heartbeats — gerando falso positivo de líder morto. No nosso caso o processamento é uma operação de `Map` mais um append pequeno, na casa dos microssegundos. É por isso que a margem do timeout é folgada.

### 06/09 — Lamport nas mensagens de coordenação
- **ELECTION / OK / COORDINATOR / RECOMENDACAO incrementam** o relógio: são eventos de coordenação com significado causal.
- **HEARTBEAT / VIVO NÃO incrementam:** sondagem periódica de vida é infraestrutura — mesmo critério que já excluiu o `commitOffsets`. Sem essa exclusão, milhares de heartbeats afogariam os eventos de domínio no log de auditoria.
- **Um BROADCAST conta como UM evento**, e todos os destinatários recebem o mesmo carimbo. Enviar a mesma mensagem a vários pares é uma única ação do processo.
- **Ganho inesperado:** o canal de coordenação produziu finalmente o caso em que o **relógio local domina o `max`**, que faltava na Etapa 4 — ex.: `max(local=34, msg=17)+1 = 35`, quando o líder (relógio alto de tanto processar) recebe recomendação de um worker com relógio menor. A demonstração de Lamport agora cobre os dois lados do `max`.

### 06/09 — Separação bully.ts (algoritmo) / coordenacao.ts (transporte)
- Decisão: dois arquivos. O `bully.ts` fala só de ELECTION/OK/COORDINATOR e sondagem; o `coordenacao.ts` só de sockets e protocolo.
- Justificativa: na defesa, abrir o `bully.ts` e ver o algoritmo sem ruído de rede.
- Para o Bully não precisar conhecer consolidação, foi usado um **observador** (`ObservadorBully`) com dois ganchos: `aoReceberRecomendacao` e `aoMudarPapel`. O `worker.ts` faz a ligação.

### 06/09 — Reação a COORDINATOR vindo de um ID MENOR
- Decisão: se um nó recebe COORDINATOR de alguém com ID menor que o seu, ele **dispara uma nova eleição** em vez de aceitar.
- Justificativa: é a essência do "valentão" — o maior vivo sempre vence. Sem isso, um nó menor que se elegeu durante uma janela de indisponibilidade permaneceria líder indevidamente.

### 06/09 — Consolidação: RECOMENDACAO dos workers para o líder
- Contexto: cada worker detecta anomalias apenas na sua partição. O líder precisa reunir as detecções de todos para "consolidar o lote de anomalias".
- Decisão: ao decidir BLOQUEAR, o worker envia uma `RecomendacaoBloqueio` ao líder pelo canal de coordenação. Se o próprio worker for o líder, a entrega é **local**, sem passar pela rede.
- Recomendações produzidas enquanto não há líder conhecido (durante uma eleição) são **acumuladas** e despachadas assim que houver líder, com teto de 200 para não crescer sem limite.
- Falha ao entregar a recomendação **não impede** a confirmação do offset no Kafka: o alerta já foi processado, e o enviador guarda a pendência. Reprocessar a mensagem só geraria recomendação duplicada.
- Nota honesta: o incremento de Lamport acontece na **tentativa** de envio, não na entrega. O evento de envio ocorreu ainda que a entrega falhe; uma retentativa incrementa de novo. É consistente com o modelo, mas registrado para não haver surpresa.

### 06/09 — "Sem comandos duplicados" em três camadas
1. **Um só emissor.** O Bully garante um líder; seguidores apenas recomendam. **A ausência de linhas `FIREWALL` nos logs dos seguidores é a prova.**
2. **Deduplicação por IP dentro do lote.** N recomendações do mesmo atacante viram UM comando, que lista os alertas que o motivaram.
3. **Conjunto de IPs já bloqueados.** Um lote posterior não reemite comando para IP já bloqueado — a linha `JA BLOQUEADO ... comando SUPRIMIDO` é a evidência.
- Trava adicional: se uma RECOMENDACAO chega a um nó que **não é** o líder (mensagem atrasada, endereçada a um líder já deposto), ela é **recusada** — assim não entra em dois lotes diferentes.
- Evidência medida: 6 recomendações de 3 workers → 3 IPs distintos → **3 comandos**. Lote seguinte: 4 recomendações → 2 IPs, ambos já bloqueados → **0 comandos**. Contagem final de linhas `FIREWALL`: worker-1 = 0, worker-2 = 0, worker-3 (líder) = 3.

### 06/09 — Fechamento do lote a cada 5 segundos
- Decisão: `INTERVALO_CONSOLIDACAO_MS = 5000`.
- Justificativa: fechar em **lote**, e não a cada recomendação, é justamente o que permite deduplicar por IP. A cada recomendação, cada uma viraria um comando.
- Um evento de Lamport (`CONSOLIDA`) por lote fechado, compartilhado por todos os `RegistroBloqueio` daquele lote — consistente com a regra de "uma ação lógica, um evento".

### 06/09 — RegistroBloqueio: a terceira entidade
- Fecha a modelagem mínima exigida pelo escopo: **SensorRede → AlertaAnomalia → RegistroBloqueio**.
- Campos: `id`, `loteId`, `ipBloqueado`, `emitidoPor` (o worker líder), `lamport` (carimbo do líder ao consolidar), `alertasQueMotivaram` (histórico causal), `quantidadeAlertas`, `consolidadoEm` (físico).
- O firewall é **simulado**: o comando é uma linha de log, conforme o escopo.
- Persistir esses registros em primário + réplica é a Etapa 7.

### 06/09 — Bully vs Ring (munição de defesa)
- **Mensagens:** Bully é O(n²) no pior caso; Ring é O(n), mas sempre duas voltas completas no anel.
- **Rodadas até eleger:** Bully converge em poucas — o maior vivo se declara quase imediatamente. Ring precisa circular o anel inteiro.
- **Conhecimento exigido:** Bully precisa de todos os IDs e endereços; Ring só do sucessor — aí o Ring escala melhor.
- **Nó que morre durante a eleição:** o Bully trata naturalmente por timeout; o Ring precisa pular para o próximo sucessor, o que é mais frágil.
- Frase: *"Com 3 nós, o custo O(n²) do Bully é irrelevante. O que importa é a convergência: num NIDS, líder ausente significa comando de bloqueio não emitido enquanto o ataque continua, então eleger rápido vale mais que economizar mensagens. O preço é exigir o conhecimento de toda a composição do grupo."*

---

## Etapa 6 — R6: Tolerância a Falhas (demonstração e evidências)

### 06/09 — Etapa executada como DEMONSTRAÇÃO, não como implementação
- Contexto: o código do R6 já existia — ack manual veio na Etapa 3 (antecipado de propósito) e a reeleição automática na Etapa 5.
- Decisão: esta etapa é coleta de evidência. Nenhum código de produção novo foi escrito; só instrumentação de demonstração e uma ferramenta de conferência.
- Confirma a análise crítica do plano feita em 06/09: a Etapa 6, como estava escrita no 02-PLANO.md, misturava duas metades que pertenciam às etapas 3 e 5.

### 06/09 — `ATRASO_COMMIT_MS`: instrumentação para tornar a falha demonstrável
- **Problema encontrado ao planejar:** o worker confirma o offset na linha seguinte ao processamento, então a janela em que uma mensagem está "processada mas não confirmada" dura **microssegundos**. É boa engenharia, mas torna impossível acertar a morte do processo na mão.
- Decisão: variável de ambiente `ATRASO_COMMIT_MS`, **desligada por padrão**, que insere uma espera entre processar e confirmar.
- Por que não é trapaça: (a) sem a variável, o comportamento é exatamente o de produção; (b) a espera **simula uma operação lenta entre processar e confirmar**, que é literalmente o que a Etapa 7 vai inserir ali (gravação em banco). Não é um atraso fantasioso — é o futuro daquele trecho.
- O worker anuncia em log quando a instrumentação está ativa: `>>> [DEMO] ATRASO_COMMIT_MS=3000 ATIVO ... Isto NAO e o comportamento padrao.`

### 06/09 — Medição por DUAS fontes independentes, com a do Kafka como principal
- **Fonte principal — a contabilidade do próprio broker:** `kafka-consumer-groups.sh --describe`. Se `CURRENT-OFFSET == LOG-END-OFFSET` e `LAG = 0` nas três partições, todo offset produzido foi confirmado. Vale mais que nosso log porque **não é nossa**.
- **Fonte secundária — reconciliação dos nossos logs de auditoria** (`demonstracoes/conferir-entrega.mjs`): compara os ids publicados pelo gateway (`PUBLICA-FILA`) com os processados pelos workers (`PROCESSA`), apontando faltantes e reprocessados.
- Decisão de apresentação: **as duplicatas são apresentadas como PROVA DE RECUPERAÇÃO, não como defeito.** Uma mensagem processada duas vezes é a evidência de que ela foi reentregue em vez de perdida. Se não houvesse duplicata nesse cenário, é porque a mensagem teria sumido.

### 06/09 — Morte violenta como método (pior caso, não o mais fácil)
- Decisão: matar com `Stop-Process -Force` (equivalente a SIGKILL), sem encerramento gracioso, sem sair do grupo de consumidores educadamente.
- Justificativa: é o cenário mais adverso. Um `Ctrl+C` acionaria o encerramento gracioso que já implementamos (`consumidor.disconnect()`), que avisa o broker e acelera a redistribuição — seria uma demonstração mais fácil e menos convincente.

### 06/09 — RESULTADO MEDIDO (execução de 06/09, tópico recriado do zero)
Cenário: gateway + 3 workers, o **worker-3 (líder, maior ID) com `ATRASO_COMMIT_MS=3000`**. 30 alertas disparados. Worker-3 morto à força enquanto estava na janela, com uma mensagem processada e não confirmada.

**Contabilidade do Kafka (fonte principal):**
```
PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
    0            14              14         0
    1             8               8         0
    2             8               8         0
```
14 + 8 + 8 = **30 produzidas, 30 confirmadas, LAG zero**.

**Momento da falha capturado** (20 s após a morte, antes da redistribuição):
```
PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CLIENT-ID
    0            6              14          8    worker-3  <- MORTO, 8 mensagens presas
```

**Reconciliação dos logs:**
```
PUBLICADOS na fila (gateway)    : 30
PROCESSADOS distintos (workers) : 30
FALTANTES (perdidos)            : 0
REPROCESSADOS (entregues 2x+)   : 1
```
A mensagem reprocessada foi `32d51fdd-3770-49e6-9db4-28f5b550f4c8`: processada pelo **worker-3 às 02:26:30.530** (morto às 02:26:33) e reprocessada pelo **worker-1 às 02:27:02.611**. É exatamente a que estava na janela.

**Reeleição (metade 2):** worker-1 detectou `FALHA 1/3 → 2/3 → 3/3 (RECUSADA)`, declarou `LIDER 3 CONSIDERADO MORTO` e disparou eleição; worker-2 respondeu OK, disputou, não achou ninguém maior vivo e assumiu. Detecção em **~3 s**.

**O sistema continuou operando:** o novo líder (worker-2) fechou um lote e emitiu `FIREWALL >>> BLOQUEAR 192.0.2.77`. Contagem final de linhas `FIREWALL`: worker-1 = 0, worker-2 = 1 (depois de assumir), worker-3 = 3 (enquanto era líder). **Em nenhum instante dois workers emitiram comando.**

### 06/09 — Dois detectores de falha, tempos muito diferentes (confirmação empírica)
| Detector | Tempo medido |
|---|---|
| Nosso Bully (sondagem TCP) | **~3 s** |
| Kafka (session timeout do consumer group) | entre 20 s e ~50 s |

- Aos 20 s após a morte a partição 0 ainda estava atribuída ao worker-3 morto, com LAG 8. Na verificação seguinte já havia sido redistribuída ao worker-1.
- **Isso confirma empiricamente o argumento usado na Etapa 5 para NÃO colocar a coordenação no Kafka:** os tempos do broker são altos e imprevisíveis demais para sustentar uma eleição de líder.
- Decisão consciente: **manter o `sessionTimeout` padrão** (30 s) da kafkajs. Reduzir para ~10 s deixaria a demonstração mais rápida, mas mexer em configuração só para a demo ficar bonita é difícil de defender oralmente, e a espera é real.

### 06/09 — LIMITES: o que esta demonstração NÃO prova
Registrado para ser dito na arguição em vez de ser descoberto pelo avaliador.

- **Queda do broker.** A fila é efêmera por decisão consciente (sem volume, ver Etapa 1). Se o *Kafka* morresse, as mensagens se perderiam. O R6 fala em queda de **nó**, não de broker — mas a distinção precisa estar explícita.
- **Partição de rede / split-brain.** Tudo roda em `localhost`; não há como simular um particionamento em que dois workers se julguem líderes ao mesmo tempo. **Essa é uma fraqueza real e conhecida do algoritmo Bully** — melhor citá-la você mesmo do que ser pego por ela.
- **Exactly-once.** Provamos *at-least-once*. A duplicata observada é esperada por desenho, não um bug.
- **Nó travado (vivo mas sem responder).** Matar o processo produz `ECONNREFUSED`, que é o caso limpo. Um processo *pendurado* seria detectado pelo caminho do `TIMEOUT`, que existe no código (`CausaFalha = "TIMEOUT"`) mas **não foi exercitado** — faltaria ferramenta de suspensão de processo no Windows. Registrado como não demonstrado, em vez de fingido.

### 06/09 — `demonstracoes/conferir-entrega.mjs` versionado
- Decisão: fica no repositório, mesmo padrão dos demos de framing e de Lamport — fora de `src/`, com cabeçalho declarando que é material de demonstração.
- Atalho: `npm run demo:entrega`.
- Justificativa: o README exige evidência de tratamento de falha sem perda de dados. Uma ferramenta que **conta e confere** é evidência mais forte que um print de log.
