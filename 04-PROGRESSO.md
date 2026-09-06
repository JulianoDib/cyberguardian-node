# 04 — PROGRESSO / ONDE PARAMOS

> Atualizar ao fim de TODA sessão de trabalho (regra 6 do CLAUDE.md).
> Este arquivo viaja no git e é o fio de continuidade entre as duas máquinas:
> chegou na outra máquina → `git pull` → ler este arquivo → retomar.

## Estado atual
**Fase:** Desenvolvimento iniciado.
**Etapa atual:** Etapa 3 (R3/Workers) CONCLUIDA. Proxima: Etapa 4 (R4 - Relogios de Lamport).
**Última atualização:** 06/09/2026 — sessão de trabalho: 3 workers em Competing Consumers, ack manual, regra de bloqueio em duas camadas.

## Checklist de etapas
- [x] Análise do enunciado e divisão em etapas
- [x] Documentos do projeto criados (escopo, plano, decisões, regras, progresso)
- [~] Etapa 0 — Setup de ambiente (máquina 1) — PARCIAL:
  - [x] Node.js v24.20.0 + npm 11.19.0 verificados
  - [x] `package.json` criado (nome: cyberguardian-node)
  - [x] TypeScript 7.0.2 + @types/node 26.4.1 instalados como devDependencies locais
  - [x] `tsconfig.json` com tipagem rigorosa (src/ → dist/) — compilação verificada
  - [x] `src/index.ts` compila e roda (`npm run build` + `npm start`)
  - [x] `git init` (branch main) + `.gitignore`
  - [x] **Docker Desktop instalado** (Engine 29.7.2 / Compose v5.5.0) — instalado em `AppData\Local\Programs\DockerDesktop`
  - [ ] Repositório no GitHub + primeiro push (combinado de fazer junto com o aluno)
- [ ] Etapa 0b — Setup de ambiente (máquina 2, quando necessário)
- [x] Etapa 1 — R2: Kafka rodando + produtor/consumidor de teste — **CONCLUIDA**
  - [x] `docker-compose.yml` com Apache Kafka 4.0.0 em modo KRaft (1 servico, sem Zookeeper)
  - [x] Duplo listener resolvido (INTERNO 9092 / EXTERNO 29092) — Node no Windows conecta em `localhost:29092`
  - [x] Topico `alertas-anomalia` criado com **3 particoes** (teto de paralelismo do R3)
  - [x] `kafkajs` 2.2.4 instalada (client puro JS, sem compilacao nativa)
  - [x] Contrato da mensagem em `src/compartilhado/tipos.ts`, **com campo `lamport` ja presente**
  - [x] Produtor e consumidor de teste rodando (`npm run teste:produtor` / `teste:consumidor`)
  - [x] **Mensagem viajou ponta a ponta** — mesmo UUID publicado e recebido
- [x] Etapa 2 — R1: Gateway TCP com framing + ACK + simulador de sensor — **CONCLUIDA**
  - [x] `src/compartilhado/framing.ts` — prefixo de tamanho (4 bytes) + JSON UTF-8, teto de 1 MB
  - [x] `src/gateway/servidor.ts` — servidor TCP, publica no Kafka, ACK **apos** confirmacao
  - [x] `src/sensor/simulador.ts` — cliente TCP que envia alertas em rajada e mede latencia
  - [x] `src/compartilhado/rede.ts` — host/porta/timeout
  - [x] Validacao de entrada com type guard + uniao discriminada ACK/ERRO
  - [x] Serializacao por conexao (ordem preservada dentro de cada socket)
  - [x] `demonstracoes/` — prova medida do problema que o framing resolve
  - [x] **Fluxo ponta a ponta validado:** 5 alertas -> 5 ACK (43-53 ms) -> 5 mensagens no Kafka
  - [x] **4 caminhos de erro testados:** JSON invalido, fora do contrato, quadro de 2 GB, e alerta valido depois (gateway sobreviveu)
- [x] Etapa 3 — R3: 3 workers em Competing Consumers — **CONCLUIDA**
  - [x] `src/worker/worker.ts` — consumidor com groupId unico `workers-nids`
  - [x] `src/worker/regra-bloqueio.ts` — regra em 2 camadas (limiar + janela deslizante)
  - [x] **ACK MANUAL** (`autoCommit: false`) — antecipado da Etapa 6 de proposito
  - [x] Mensagem envenenada tratada (erro permanente confirma; transitorio nao)
  - [x] `ehEnvelopeAlerta` — validacao do que vem da fila
  - [x] **Evidencia:** 12 alertas divididos 6/4/2 entre os 3 workers, LAG 0 nas 3 particoes
  - [x] **Rebalanceamento em cadeia capturado:** [0,1,2] -> [0,1] -> [1] conforme os workers entravam
- [ ] Etapa 4 — R4: Relógios de Lamport nos logs de auditoria
- [ ] Etapa 5 — R5: Eleição Bully + líder único consolidador
- [ ] Etapa 6 — R6: Falhas sem perda + reeleição automática
- [ ] Etapa 7 — Persistência primário + réplica
- [ ] Etapa 8 — Integração ponta a ponta + coleta de evidências de log
- [ ] Etapa 9 — README, diagrama, Declaração de IA, e-mail de submissão

## Pendências técnicas em aberto
- [ ] **Recriar o tópico após `docker compose down`.** Com `auto.create.topics.enable=false`, o tópico
  não volta sozinho e o gateway falha ao publicar. Precisa entrar no guia do README (Etapa 9) ou ser
  automatizado no docker-compose. Comando atual:
  `docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --create --topic alertas-anomalia --partitions 3 --replication-factor 1 --bootstrap-server localhost:9092`
- [ ] `src/index.ts` ainda é o arquivo placeholder da Etapa 0; remover quando não fizer mais falta.

## Pendências externas (não dependem de código)
- [ ] Confirmar linguagem com o professor (assumindo TypeScript/Node)
- [ ] Nomes completos e matrículas dos integrantes (pro README)
- [ ] Nome do grupo (pro README e assunto do e-mail)
- [ ] Testar credencial GitHub da máquina 2 (push de teste no repo antigo; token pode ter expirado — 5 meses)
- [ ] Decidir modalidade da arguição: com apresentação (2 perguntas + 0,5 automático) ou sem (4 perguntas)

## Como retomar (para o Claude Code)
1. Ler CLAUDE.md, 01-ESCOPO.md e este arquivo.
2. Conferir a etapa atual no checklist e o critério de "pronto" dela no 02-PLANO.md.
3. Perguntar ao aluno como ele quer conduzir a etapa (manual, misto ou delegado) e seguir.

## Notas da última sessão (06/09 — Etapa 3 concluída)
- **Competing Consumers provado:** 12 alertas, cada um processado por exatamente um worker.
  worker-1 = particao 1 (6 msgs), worker-2 = particao 2 (4), worker-3 = particao 0 (2).
- **Prova pelo lado do Kafka:** `kafka-consumer-groups.sh --describe --group workers-nids` mostrou
  3 CONSUMER-ID distintos, um por particao, com CURRENT-OFFSET == LOG-END-OFFSET e **LAG 0**.
  Isso e o ack manual se provando: o que foi confirmado bate exatamente com o que foi produzido.
- **Cada atacante caiu inteiro num worker so** (efeito da chave `ipOrigem` escolhida na Etapa 2):
  198.51.100.9 -> worker-1, 203.0.113.45 -> worker-2, 192.0.2.77 -> worker-3. E por isso que a
  contagem local da janela deslizante esta correta sem coordenacao entre processos.
- **A regra em 2 camadas compondo:** worker-2 recebeu 19675 pac/s, classificou NORMAL e NAO
  incrementou o contador — o alerta seguinte apareceu como "2/3", nao "3/3".
- **Decisao consciente: sem mutex.** Nao ha memoria compartilhada entre workers; a exclusao mutua
  vem da atribuicao de particoes do Kafka. A secao critica real e local (o Map da janela) e e
  atomica por ser sincrona. Verificado no codigo da kafkajs que ela ja serializa por padrao
  (partitionsConsumedConcurrently = 1), mas nao dependemos disso.
- Comandos: `npm run worker -- 1` / `-- 2` / `-- 3` em 3 terminais, `npm run gateway`, `npm run sensor -- 12`.

## Notas da sessão anterior (06/09 — Etapa 2 concluída)
- **Fluxo real funcionando:** `npm run gateway` num terminal, `npm run sensor -- 5` noutro. Os 5 UUIDs
  do ACK batem com os 5 recebidos pelo consumidor de teste lendo do Kafka.
- **Ordenação por atacante comprovada:** `203.0.113.45` caiu 3x na partição 2 (offsets 0,1,2) e
  `198.51.100.9` caiu 2x na partição 1 (offsets 0,1) — cada atacante numa partição só, em ordem.
- **Antes de implementar o framing, o problema foi medido** e guardado em `demonstracoes/`:
  sem enquadramento, 6 leituras geraram 6 falhas de JSON.parse e 0 mensagens.
- Latência medida do ACK: 43-53 ms (média 48 ms), em rajada de 5 alertas.
- Achado operacional registrado nas pendências: recriar o container exige recriar o tópico.
- Comandos da etapa: `docker compose up -d` -> `npm run build` -> `npm run gateway` | `npm run sensor -- 5`
  Demos de defesa: `npm run demo:problema` e `npm run demo:solucao`.

## Notas da sessão anterior (06/09 — Etapa 1 concluída)
- **Prova de que o Kafka funciona:** produtor publicou o envelope `a8643768-d5a1-427f-9f29-bb7d52f682d1`
  na partição 2; consumidor leu exatamente esse id, offset 2. A armadilha do `advertised.listeners`
  está vencida — cliente rodando no Windows fala com broker dentro do container.
- Chave da mensagem = `ipOrigem`: duas execuções caíram na **mesma partição (2)**, confirmando que
  eventos do mesmo atacante ficam ordenados.
- `kafka-consumer-groups.sh --describe` mostrou 1 consumidor segurando as 3 partições. Com os 3
  workers da Etapa 3, elas se dividem — é essa a evidência do Competing Consumers.
- **Duas correções de rumo** registradas no 03-DECISOES.md: volume do Kafka montado em caminho errado
  (não persistia nada, em silêncio) e depois quebrando por permissão — volume removido, fila é efêmera
  por decisão consciente.
- **Ruídos de log investigados até a raiz** (nenhum é incompatibilidade com Kafka 4.0):
  `TimeoutNegativeWarning` é bug latente da kafkajs (`requestQueue/index.js:312`), desligado com flag
  cirúrgica do Node; erro do `GroupCoordinator` é transitório da criação do grupo e foi mantido visível.
- Comandos da etapa: `docker compose up -d` → `npm run build` → `npm run teste:consumidor` (um terminal)
  → `npm run teste:produtor` (outro terminal).

## Notas da sessão anterior (05/09 — Etapa 0)
- Estrutura do projeto criada e **verificada**: `npm run build` gera `dist/` e `npm start` imprime a mensagem de setup.
- Tipagem rigorosa testada com erros propositais (índice possivelmente `undefined`, `null` em `number`, parâmetro sem tipo) — os três foram barrados pelo compilador.
- Ajuste necessário: TypeScript 7 não descobriu `@types/node` sozinho; foi preciso declarar `"types": ["node"]` no tsconfig.
- Nenhuma dependência além de `typescript` e `@types/node` (escopo fechado — `ts-node` recusado de propósito).
- Comandos do projeto: `npm install` → `npm run build` → `npm start`; `npm run typecheck` para só checar tipos.

## Notas da sessão anterior (planejamento)
- Planejamento completo feito no chat (análise do PDF, estratégia mista, estimativa 25–36h
  no modo acompanhado; menos no modo delegado).
- Aluno vai alternar entre duas máquinas (manhã/tarde) — git push/pull como sincronização.
- Máquina 2 já fez push pra conta JulianoDib há ~5 meses (repo teste-git): autenticação
  existiu; validar se ainda vale.
