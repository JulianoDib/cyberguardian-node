# CyberGuardian Node

Sistema de Detecção de Intrusões Distribuído (NIDS), desenvolvido como Avaliação Processual da disciplina de Programação Distribuída e Paralela.

Malha de sensores espalhados por datacenters inspeciona tráfego de pacotes IP e emite alertas em tempo real sobre anomalias que indicam ataques DDoS. Os workers validam regras de bloqueio de forma independente, os Relógios de Lamport estabelecem a linha do tempo exata do ataque, e o Worker Líder eleito pelo Algoritmo do Valentão é o único autorizado a consolidar o lote de anomalias e ordenar o bloqueio ao firewall, sem emitir comandos duplicados.

---

## 1. Integrantes

| Nome completo | Matrícula |
|---|---|
| Davi Checon Bresinski | 6-2211454 |
| Juliano Jean Pierre | 6-2211481 |
| Raphael Picoli Zucolotto | 6-2211442 |

**Curso:** Sistemas de Informação, 7º/8º período, turma noturna
**Disciplina:** Programação Distribuída e Paralela
**Professor:** Edgard da Cunha Pontes
**Modalidade de arguição escolhida:** Com Apresentação

---

## 2. Tema e domínio de negócio

**Tema 10: CyberGuardian Node (Sistema de Detecção de Intrusões Distribuído).**

O domínio modela três entidades correlacionadas:

| Entidade | Papel | Onde vive |
|---|---|---|
| `SensorRede` | Sensor de datacenter que observa o tráfego e emite alertas | `src/sensor/simulador.ts`, identificado por `sensorId` |
| `AlertaAnomalia` | Observação de tráfego suspeito (IP origem, IP destino, protocolo, pacotes por segundo) | `src/compartilhado/tipos.ts`, trafega pela fila |
| `RegistroBloqueio` | Decisão consolidada de bloqueio, produzida apenas pelo líder | `src/compartilhado/tipos.ts`, persistido na tabela `registro_bloqueio` |

A cadeia causal completa é: um `SensorRede` emite um `AlertaAnomalia`; os workers avaliam a regra de bloqueio; o líder consolida um lote e grava um `RegistroBloqueio` que guarda, no campo `alertas_que_motivaram`, os identificadores dos alertas que originaram a decisão.

### Stack técnica

| Camada | Tecnologia |
|---|---|
| Ponto de Entrada (Ingress) | Sockets TCP puros com framing explícito por prefixo de tamanho |
| Fila de Mensagens | Apache Kafka 4.0 em modo KRaft |
| Relógio lógico | Relógios de Lamport |
| Eleição de líder | Algoritmo do Valentão (Bully) |
| Persistência | PostgreSQL 17 com streaming replication nativa |
| Linguagem | TypeScript 7 sobre Node.js 24, com tipagem estática rigorosa |

---

## 3. Diagrama: componentes, portas e fluxo das mensagens

```
                     CLIENTES: sensores de rede
                     (src/sensor/simulador.ts)
                                |
                                |  TCP 127.0.0.1:5000
                                |  quadro = [4 bytes: tamanho][N bytes: JSON UTF-8]
                                v
        +--------------------------------------------------+
        |  1. PONTO DE ENTRADA (Gateway)                   |
        |     src/gateway/servidor.ts                      |
        |     escuta TCP em 127.0.0.1:5000                 |
        |     valida, monta o envelope, carimba Lamport    |
        +--------------------------------------------------+
                 ^                              |
                 |                              |  produz no topico
   ACK de enfileiramento, enquadrado            |  chave da mensagem = ipOrigem
   (enviado APOS o Kafka confirmar)             v
                 |            +--------------------------------------------------+
                 +----------- |  2. CORACAO ASSINCRONO (Fila de Mensagens)      |
                              |     Apache Kafka 4.0, modo KRaft                 |
                              |     topico: alertas-anomalia, 3 particoes        |
                              |     listener EXTERNO: localhost:29092            |
                              |     listener INTERNO: kafka:9092                 |
                              +--------------------------------------------------+
                                    |             |             |
                            particao 0     particao 1     particao 2
                                    v             v             v
        +--------------------------------------------------------------+
        |  3. EXERCITO DE TRABALHADORES                                |
        |     consumer group unico: workers-nids                       |
        |     padrao Competing Consumers, ack manual                   |
        |                                                              |
        |   worker-1          worker-2          worker-3               |
        |   TCP 5101          TCP 5102          TCP 5103               |
        |       |                 |                 |                  |
        |       +--------- canal de coordenacao ----+                  |
        |         Bully: ELECTION / OK / COORDINATOR                   |
        |         heartbeat de 1s, TCP conexao por mensagem            |
        +--------------------------------------------------------------+
                                |
                 apenas o LIDER consolida e persiste
                                |  TCP localhost:5432
                                v
        +--------------------------------------------------+
        |  4. MEMORIA INTACTA                              |
        |     PostgreSQL PRIMARIO, porta 5432              |
        |     tabela: registro_bloqueio                    |
        +--------------------------------------------------+
                                |
                     streaming replication (WAL)
                                |
                                v
        +--------------------------------------------------+
        |     PostgreSQL REPLICA, porta 5433               |
        |     standby, somente leitura                     |
        +--------------------------------------------------+
```

### Tabela de portas

| Porta | Componente | Protocolo | Observação |
|---|---|---|---|
| 5000 | Gateway (Ponto de Entrada) | TCP com framing explícito | Onde os sensores conectam |
| 5101 | worker-1, canal de coordenação | TCP com framing explícito | Bully e heartbeat |
| 5102 | worker-2, canal de coordenação | TCP com framing explícito | Bully e heartbeat |
| 5103 | worker-3, canal de coordenação | TCP com framing explícito | Bully e heartbeat |
| 29092 | Kafka, listener EXTERNO | Protocolo Kafka | Usado pelos processos Node que rodam no host |
| 9092 | Kafka, listener INTERNO | Protocolo Kafka | Usado dentro da rede do Docker, não é publicado no host |
| 9093 | Kafka, listener CONTROLLER | Protocolo Kafka | Uso interno do modo KRaft |
| 5432 | PostgreSQL primário | PostgreSQL | Único destino de escrita da aplicação |
| 5433 | PostgreSQL réplica | PostgreSQL | Standby, somente leitura |

### Fluxo de uma mensagem, passo a passo

1. O sensor abre um socket TCP na porta 5000 e envia um `AlertaAnomalia` enquadrado.
2. O gateway remonta o quadro, valida o conteúdo, incrementa o relógio de Lamport e monta um envelope com identificador único (UUID), payload estruturado e metadados de rastreabilidade causal.
3. O gateway publica no tópico `alertas-anomalia` usando o IP de origem como chave da mensagem, o que mantém todos os alertas de um mesmo atacante na mesma partição e, portanto, em ordem.
4. Só depois que o Kafka confirma a gravação, o gateway devolve o ACK de enfileiramento ao sensor.
5. Um dos três workers recebe a mensagem, aplica a regra `L = max(L_local, L_mensagem) + 1`, avalia a regra de bloqueio e confirma o offset manualmente.
6. Se a regra indicar bloqueio, o worker envia uma recomendação ao líder pelo canal de coordenação.
7. O líder acumula as recomendações, fecha o lote a cada 5 segundos, deduplica por IP, grava o `RegistroBloqueio` no primário e só então emite o comando de bloqueio ao firewall.
8. A réplica recebe a alteração por streaming replication do próprio PostgreSQL.

---

## 4. Guia de execução local passo a passo

### 4.1. Requisitos de ambiente

| Software | Versão usada no desenvolvimento |
|---|---|
| Node.js | v24.20.0 (LTS) |
| npm | 11.19.0 |
| Docker Engine | 29.7.2 |
| Docker Compose | v5.5.0 |
| Git | 2.53.0 |

**O Docker Desktop precisa estar ABERTO, e não apenas instalado.** Abra o aplicativo e aguarde o indicador no canto inferior esquerdo mostrar `Engine running` antes de continuar. Sem isso, todos os comandos `docker` falham com uma mensagem de que não conseguem se conectar ao daemon.

Verifique o ambiente:

```bash
node -v
npm -v
git --version
docker compose version
```

**Portas que precisam estar livres** na máquina antes de começar:

| Porta | Usada por |
|---|---|
| 5000 | Gateway (Ponto de Entrada) |
| 5101, 5102, 5103 | Canal de coordenação dos workers 1, 2 e 3 |
| 5432 | PostgreSQL primário |
| 5433 | PostgreSQL réplica |
| 29092 | Kafka, listener externo |

Para conferir no Windows, em PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5000,5101,5102,5103,5432,5433,29092 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```

Se o comando não devolver nada, todas as portas estão livres.

### 4.2. Obter o projeto

```bash
git clone <url-do-repositorio>
cd cyberguardian-node
```

**Todos os comandos deste guia, sem exceção, são executados a partir da pasta `cyberguardian-node`.** Isso vale para os cinco terminais da seção 4.5: cada um precisa estar nessa pasta antes de rodar qualquer coisa.

### 4.3. Instalar dependências e compilar

```bash
npm install
npm run build
```

Dependências de execução: `kafkajs` (cliente Kafka em JavaScript puro) e `pg` (driver PostgreSQL).
Dependências de desenvolvimento: `typescript` e os pacotes de tipos.

### 4.4. Subir a infraestrutura

```bash
docker compose up -d
```

Um único comando entrega tudo pronto, sem passo manual:

* Kafka em modo KRaft, sem Zookeeper;
* o tópico `alertas-anomalia` criado automaticamente com 3 partições, pelo serviço `criar-topico`;
* PostgreSQL primário com o schema de `banco/01-schema.sql` já aplicado;
* PostgreSQL réplica inicializado por `pg_basebackup` e em modo standby.

**Aguarde os serviços ficarem saudáveis antes de subir a aplicação.** O comando `docker compose up -d` devolve o terminal em poucos segundos, mas os serviços ainda estão iniciando por dentro. Numa máquina de referência, o comando retornou em 8 segundos e os três serviços só ficaram `healthy` aos 14 segundos. Se a aplicação subir antes disso, ela falha ao conectar no Kafka ou no banco.

Rode o comando abaixo e repita até que os três serviços apareçam como `healthy`:

```bash
docker compose ps
```

A saída esperada é esta:

```
NAME                              STATUS
cyberguardian-kafka               Up (healthy)
cyberguardian-postgres-primario   Up (healthy)
cyberguardian-postgres-replica    Up (healthy)
```

O serviço `criar-topico` não aparece nessa listagem porque já terminou. Para vê-lo, use `docker compose ps -a`: ele deve constar como `Exited (0)`. Isso é o esperado, pois ele executa uma vez e encerra. O log dele mostra a criação do tópico:

```bash
docker compose logs criar-topico
```

### 4.5. Subir a aplicação

A aplicação roda por comando, fora do Docker. São necessários **cinco terminais**, todos posicionados na pasta `cyberguardian-node`.

Suba os workers **um de cada vez**, com alguns segundos de intervalo. Isso torna a eleição de líder visível nos logs.

**Terminal 1:**
```bash
npm run worker -- 1
```

**Terminal 2:**
```bash
npm run worker -- 2
```

**Terminal 3:**
```bash
npm run worker -- 3
```

**Terminal 4 (Gateway):**
```bash
npm run gateway
```

**Terminal 5 (simulador de sensor, envia 20 alertas em rajada):**
```bash
npm run sensor -- 20
```

O simulador aceita dois argumentos opcionais: a quantidade de alertas e a identificação do sensor. Para rodar dois sensores em paralelo e observar o gateway atendendo várias conexões:

```bash
npm run sensor -- 20 sensor-filial-02
```

### 4.6. Encerrar e limpar entre execuções

Use `Ctrl+C` em cada terminal da aplicação, o que aciona o encerramento gracioso, e depois:

```bash
docker compose down
```

Para apagar também os dados dos bancos e a fila:

```bash
docker compose down -v
```

**Atenção a processos remanescentes.** Se algum worker de uma execução anterior continuar vivo, por exemplo depois de um terminal fechado sem `Ctrl+C`, dois problemas aparecem:

1. O novo worker não consegue abrir a porta de coordenação, que já está ocupada pelo processo antigo.
2. Os processos antigos continuam no grupo de consumidores `workers-nids`. O Kafka reparte as três partições entre todos os membros, antigos e novos, e os workers recém-iniciados podem receber nenhuma partição ou partições diferentes das esperadas.

O sintoma típico é um worker que sobe, entra no grupo e fica sem processar nada.

Para diagnosticar, verifique se as portas da aplicação ainda estão ocupadas:

```powershell
Get-NetTCPConnection -LocalPort 5000,5101,5102,5103 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess
```

E confira quantos membros o grupo de consumidores tem. Com três workers ativos, devem aparecer exatamente três `CLIENT-ID` distintos:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group workers-nids
```

Para encerrar os processos remanescentes, em PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 5000,5101,5102,5103 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Se ainda assim o grupo aparecer com membros indevidos, apague o grupo com todos os workers já encerrados. Ele é recriado na próxima subida:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --delete --group workers-nids
```

### 4.7. Comandos de verificação

Divisão do trabalho entre os workers e confirmação de que nada ficou pendente na fila:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group workers-nids
```

Estado consolidado no primário:

```bash
docker compose exec postgres-primario psql -U cyberguardian -d cyberguardian -c "SELECT lote_id, ip_bloqueado, emitido_por, lamport, quantidade_alertas FROM registro_bloqueio ORDER BY lamport, emitido_por;"
```

O mesmo estado na réplica, que chegou por streaming replication:

```bash
docker compose exec postgres-replica psql -U cyberguardian -d cyberguardian -c "SELECT lote_id, ip_bloqueado, emitido_por, lamport, quantidade_alertas FROM registro_bloqueio ORDER BY lamport, emitido_por;"
```

Ferramentas de conferência incluídas no repositório:

```bash
npm run demo:lamport    # reconcilia os logs de auditoria e compara ordem fisica com ordem logica
npm run demo:entrega    # confere publicados contra processados, apontando perdas e reprocessamentos
npm run demo:problema   # demonstra o problema que o framing resolve
npm run demo:solucao    # demonstra o framing resolvendo o mesmo problema
```

---

## 5. Evidência dos logs

Todas as saídas abaixo foram capturadas em execuções reais do sistema. As linhas de relógio lógico carregam o marcador `LAMPORT` e as de eleição carregam `BULLY`, o que permite extraí-las com `grep LAMPORT` e `grep BULLY`.

### 5.1. Atualização dos carimbos lógicos de Lamport

**No Gateway**, três eventos por alerta: recepção do sensor (evento interno, porque o sensor não tem relógio próprio), publicação na fila (envio, e é este o carimbo que viaja na mensagem) e envio do ACK.

```
[gateway] LAMPORT L=1    RECEBE-SENSOR interno: 0+1 = 1              sensor-datacenter-01 198.51.100.9 -> 10.0.0.12
[gateway] LAMPORT L=2    PUBLICA-FILA  envio: 1+1 = 2  [carimbo=2]   p1 off=0 37249 pac/s
[gateway] LAMPORT L=3    ENVIA-ACK     envio: 2+1 = 3                para 127.0.0.1:50257
[gateway] LAMPORT L=4    RECEBE-SENSOR interno: 3+1 = 4              sensor-datacenter-01 203.0.113.45 -> 10.0.0.7
[gateway] LAMPORT L=5    PUBLICA-FILA  envio: 4+1 = 5  [carimbo=5]   p2 off=0 11224 pac/s
```

**Nos workers**, a regra de recepção `L = max(L_local, L_mensagem) + 1` aparece escrita por extenso em cada linha, o que permite conferir o cálculo sem depender de confiança:

```
[worker-1] LAMPORT L=3    RECEBE-FILA   max(local=0, msg=2)+1 = 3     p1 off=0 de gateway
[worker-1] LAMPORT L=4    PROCESSA      interno: 3+1 = 4              198.51.100.9 37249 pac/s | SUSPEITO | pico de 37249 pacotes/s (1/3 para bloqueio)
[worker-1] LAMPORT L=21   RECEBE-FILA   max(local=4, msg=20)+1 = 21   p1 off=1 de gateway
[worker-1] LAMPORT L=22   PROCESSA      interno: 21+1 = 22            198.51.100.9 30147 pac/s | SUSPEITO | pico de 30147 pacotes/s (2/3 para bloqueio)
[worker-1] LAMPORT L=24   RECEBE-FILA   max(local=22, msg=23)+1 = 24  p1 off=2 de gateway
[worker-1] LAMPORT L=25   PROCESSA      interno: 24+1 = 25            198.51.100.9 27597 pac/s | BLOQUEAR | 3 picos de 198.51.100.9 em 30s
```

A primeira linha é a mais ilustrativa do algoritmo: o relógio do worker salta de 0 para **3**, e não para 1. Ele avançou porque aprendeu, pela mensagem, sobre eventos que o precedem causalmente. Um relógio físico não transporta essa informação.

O caso oposto, em que o relógio **local** domina o `max`, aparece no canal de coordenação, quando o líder (com relógio alto de tanto processar) recebe uma recomendação de um worker com relógio menor:

```
[worker-3] LAMPORT L=35   RECOMENDACAO-RECEBE max(local=34, msg=17)+1 = 35  <- RECOMENDACAO de worker-1 : 198.51.100.9
[worker-3] LAMPORT L=51   RECOMENDACAO-RECEBE max(local=50, msg=20)+1 = 51  <- RECOMENDACAO de worker-1 : 198.51.100.9
```

### 5.2. Ordem lógica contra ordem física

A ferramenta `npm run demo:lamport` reconcilia os logs de auditoria dos quatro processos e compara as duas ordenações. Numa execução com 45 eventos:

```
 PUBLICADOS ... eventos totais : 45
   gateway      27 evento(s)
   worker-1     6 evento(s)
   worker-2     6 evento(s)
   worker-3     6 evento(s)

 3. PARES EM QUE AS DUAS ORDENS DISCORDAM
    104 par(es) encontrado(s).

   gateway    L=  4  13:50:23.952  RECEBE-SENSOR
   worker-1   L=  3  13:50:23.956  RECEBE-FILA
      -> ordem FISICA : gateway antes de worker-1
      -> ordem LOGICA : worker-1 (L=3) antes de gateway (L=4)

 4. CADEIAS CAUSAIS (gateway publica -> worker recebe)
    cadeias verificadas          : 9
    respeitadas pelo LAMPORT     : 9/9
```

A leitura correta é: onde existe relação causal de verdade, o Lamport acertou 9 de 9. Onde não existe, as duas réguas discordam, porque os eventos são concorrentes e o Lamport nunca prometeu ordená-los. O relógio físico, por sua vez, afirma uma ordem com precisão de milissegundos que não carrega informação causal alguma.

### 5.3. Eleição de líder (Algoritmo do Valentão)

**Eleição na subida.** O worker-1 sobe sozinho, envia ELECTION aos identificadores maiores, recebe recusa de conexão dos dois (nenhum está no ar) e assume:

```
[worker-1] BULLY  canal de coordenacao ouvindo na porta 5101 | meu id=1
[worker-1] BULLY  composicao do grupo: [1:5101, 2:5102, 3:5103]
[worker-1] BULLY  >>> INICIANDO ELEICAO (motivo: subida do processo)
[worker-1] BULLY  ELECTION -> worker-2 (5102) : FALHOU (RECUSADA)
[worker-1] BULLY  ELECTION -> worker-3 (5103) : FALHOU (RECUSADA)
[worker-1] BULLY  >>> EU SOU O LIDER (id=1)
[worker-1] BULLY  estado=LIDER  lider=1
```

**O valentão chega.** O worker-3 sobe, verifica que não há identificador maior que o seu, assume e anuncia. Os outros dois abdicam:

```
[worker-3] BULLY  >>> INICIANDO ELEICAO (motivo: subida do processo)
[worker-3] BULLY  nenhum id maior que 3 na composicao
[worker-3] BULLY  >>> EU SOU O LIDER (id=3)
[worker-3] BULLY  COORDINATOR -> worker-1 : entregue
[worker-3] BULLY  COORDINATOR -> worker-2 : entregue

[worker-2] BULLY  <- COORDINATOR de worker-3 : novo lider = 3
[worker-2] BULLY  estado=SEGUIDOR  lider=3  (deixei de ser lider)
```

**Morte do líder e reeleição automática.** O processo do worker-3 foi encerrado à força. Três sondagens consecutivas falharam com recusa de conexão, o que disparou nova eleição:

```
[worker-1] BULLY  heartbeat -> lider 3 : FALHA 1/3 (RECUSADA)
[worker-1] BULLY  heartbeat -> lider 3 : FALHA 2/3 (RECUSADA)
[worker-1] BULLY  heartbeat -> lider 3 : FALHA 3/3 (RECUSADA)
[worker-1] BULLY  >>> LIDER 3 CONSIDERADO MORTO
[worker-1] BULLY  >>> INICIANDO ELEICAO (motivo: lider 3 nao responde)
[worker-1] BULLY  ELECTION -> worker-3 (5103) : FALHOU (RECUSADA)
[worker-1] BULLY  <- OK de worker-2 : ele esta vivo e e maior
[worker-1] BULLY  existe no maior vivo, aguardo COORDINATOR por 2500 ms
[worker-1] BULLY  <- COORDINATOR de worker-2 : novo lider = 2
[worker-1] BULLY  estado=SEGUIDOR  lider=2

[worker-2] BULLY  >>> EU SOU O LIDER (id=2)
[worker-2] BULLY  estado=LIDER  lider=2
```

O código `RECUSADA` corresponde a `ECONNREFUSED`: o sistema operacional afirma que não há processo escutando naquela porta. É evidência direta de queda, e não uma suposição por ausência de resposta.

### 5.4. Consumo concorrente (Competing Consumers)

Os três workers dividem as três partições. A atribuição é renegociada pelo Kafka a cada entrada ou saída de membro, como mostra o log do worker-1 enquanto os outros dois subiam:

```
[worker-1] >>> GRUPO "workers-nids" | particoes atribuidas: [0, 1, 2]
[worker-1] >>> rebalanceamento em andamento (algum worker entrou ou saiu do grupo)
[worker-1] >>> GRUPO "workers-nids" | particoes atribuidas: [0, 1]
[worker-1] >>> rebalanceamento em andamento (algum worker entrou ou saiu do grupo)
[worker-1] >>> GRUPO "workers-nids" | particoes atribuidas: [1]
```

Confirmação pelo lado do broker, com os três workers no ar. Cada partição tem exatamente um dono e o atraso é zero:

```
GROUP         TOPIC             PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CLIENT-ID
workers-nids  alertas-anomalia  0          2               2               0    worker-3
workers-nids  alertas-anomalia  1          6               6               0    worker-1
workers-nids  alertas-anomalia  2          4               4               0    worker-2
```

### 5.5. Líder único consolidando, sem comandos duplicados

O líder recebe as recomendações dos três workers, deduplica por IP e emite um comando por atacante:

```
[worker-3] LOTE      fechando lote #1 | 6 recomendacao(oes) de 3 worker(s)
[worker-3] LOTE      dedup por IP: 6 recomendacao(oes) -> 3 IP(s) distinto(s)
[worker-3] FIREWALL  >>> BLOQUEAR 192.0.2.77 (motivado por 3 alerta(s)) [lote #1 | registro 387f6546 | persistido]
[worker-3] FIREWALL  >>> BLOQUEAR 198.51.100.9 (motivado por 2 alerta(s)) [lote #1 | registro ad107174 | persistido]
[worker-3] FIREWALL  >>> BLOQUEAR 203.0.113.45 (motivado por 1 alerta(s)) [lote #1 | registro 8ad1942f | persistido]
[worker-3] LOTE      lote #1 consolidado | 3 RegistroBloqueio novo(s) | total de IPs bloqueados: 3
```

Seis recomendações resultaram em três comandos. A contagem de linhas `FIREWALL` em cada worker, na mesma execução, foi:

```
worker-1 (seguidor): 0
worker-2 (seguidor): 0
worker-3 (LIDER)   : 3
```

A **ausência** de linhas `FIREWALL` nos seguidores é a evidência de que apenas o líder emite comandos.

### 5.6. Tolerância a falhas: nenhuma mensagem perdida

Cenário: 30 alertas enviados, três workers ativos e o worker-3 encerrado à força enquanto tinha uma mensagem processada e ainda não confirmada.

Momento da falha, capturado 20 segundos após a morte, antes de o Kafka redistribuir a partição órfã:

```
PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CLIENT-ID
    0            6              14          8    worker-3
```

Oito mensagens presas numa partição cujo dono não existe mais. Após a redistribuição, a contabilidade final do próprio broker:

```
PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
    0            14              14         0
    1             8               8         0
    2             8               8         0
```

E a reconciliação dos logs de auditoria, com `npm run demo:entrega`:

```
 PUBLICADOS na fila (gateway)      : 30
 PROCESSADOS distintos (workers)   : 30
 FALTANTES (perdidos)              : 0
 REPROCESSADOS (entregues 2x+)     : 1

 32d51fdd-3770-49e6-9db4-28f5b550f4c8
    worker-3   L= 94  02:26:30.530
    worker-1   L= 90  02:27:02.611
```

O reprocessamento **não é defeito**: é a prova da recuperação. Aquela mensagem foi processada pelo worker-3 às 02:26:30, o processo foi encerrado às 02:26:33 antes de confirmar o offset, e o Kafka a reentregou ao worker-1. Sem esse mecanismo, ela apareceria na lista de perdidas. A garantia obtida é de entrega ao menos uma vez (at-least-once), e o identificador único do envelope permite reconhecer a repetição.

### 5.7. Persistência e replicação

A aplicação escreve apenas no primário. A réplica se mantém atualizada pelo próprio PostgreSQL.

Replicação ativa, vista do primário:

```
 usename    | application_name | state     | sent_lsn  | replay_lsn | em_dia
 replicador | walreceiver      | streaming | 0/3045EF8 | 0/3045EF8  | t
```

A réplica está em modo standby e recusa escrita, o que confirma que se trata de replicação de verdade, e não de duas gravações feitas pela aplicação:

```
SELECT pg_is_in_recovery();  -->  t

INSERT INTO registro_bloqueio ...
ERROR:  cannot execute INSERT in a read-only transaction
```

Mesma consulta nos dois bancos, após uma carga real de 20 alertas:

```
PRIMARIO (5432)                                    REPLICA (5433)
 lote_id | ip_bloqueado | emitido_por | lamport      lote_id | ip_bloqueado | emitido_por | lamport
       1 | 198.51.100.9 |           3 |      62            1 | 198.51.100.9 |           3 |      62
       1 | 203.0.113.45 |           3 |      62            1 | 203.0.113.45 |           3 |      62
```

**A Memória Intacta na prática.** O conjunto de IPs já bloqueados é estado em memória do líder e morre junto com o processo. Ao assumir, o novo líder recupera esse estado do banco:

```
[worker-2] BULLY  >>> LIDER 3 CONSIDERADO MORTO
[worker-2] BULLY  >>> EU SOU O LIDER (id=2)
[worker-2] LOTE      consolidacao ATIVA (lider) | fechando lote a cada 5000 ms
[worker-2] LOTE      estado recuperado do banco: 2 IP(s) ja bloqueado(s) por lideres anteriores [198.51.100.9, 203.0.113.45]
```

E o estado recuperado é efetivamente usado. Novos alertas dos mesmos atacantes não geraram comandos duplicados:

```
[worker-2] LOTE      fechando lote #1 | 1 recomendacao(oes) de 1 worker(s)
[worker-2] LOTE      lote #1 consolidado | 0 RegistroBloqueio novo(s) | total de IPs bloqueados: 2
```

---

## 6. Requisitos técnicos: onde cada um está implementado

| Requisito | Implementação | Arquivos principais |
|---|---|---|
| **R1** Ingress com Sockets TCP e framing explícito, processamento assíncrono | Servidor TCP puro, quadro de 4 bytes de tamanho mais JSON UTF-8, tratamento com `async/await` e uma fila de promessas por conexão | `src/compartilhado/framing.ts`, `src/gateway/servidor.ts` |
| **R2** Mensageria com Kafka, identificador único, payload estruturado e metadados causais | Envelope com UUID, payload tipado e metadados (`origemId`, `lamport`, `emitidoEm`, `correlacaoId`, `causaId`) | `src/compartilhado/tipos.ts`, `src/compartilhado/kafka.ts` |
| **R3** Três workers em Competing Consumers, sem condição de corrida | Consumer group único sobre tópico de 3 partições, ack manual, seção crítica local mantida atômica por ser síncrona | `src/worker/worker.ts`, `src/worker/regra-bloqueio.ts` |
| **R4** Relógios de Lamport com atualização causal e ordenação determinística | As três regras encapsuladas numa classe, ordem total por `(lamport, processo)` no log de auditoria | `src/compartilhado/lamport.ts`, `src/compartilhado/auditoria.ts` |
| **R5** Eleição de líder pelo Algoritmo do Valentão, líder único consolidador | ELECTION, OK e COORDINATOR sobre canal TCP próprio, com heartbeat, e consolidação exclusiva do líder | `src/worker/bully.ts`, `src/worker/coordenacao.ts`, `src/worker/consolidador.ts` |
| **R6** Tolerância a falhas sem perda de mensagem e reeleição automática | `autoCommit: false` com confirmação após processar, detecção de queda em três sondagens consecutivas | `src/worker/worker.ts`, `src/worker/bully.ts` |
| **4ª camada** Memória Intacta com replicação e histórico causal | PostgreSQL primário e réplica em streaming replication, com restrições de integridade e histórico causal na tabela | `banco/01-schema.sql`, `src/compartilhado/repositorio.ts` |

---

## 7. Estrutura do projeto

```
cyberguardian-node/
├── banco/
│   ├── 01-schema.sql                      Schema aplicado automaticamente nos dois bancos
│   └── replicacao/
│       ├── 01-primario-replicacao.sh      Cria o papel replicador e libera o pg_hba
│       └── 02-entrypoint-replica.sh       Faz o pg_basebackup e sobe a replica em standby
├── demonstracoes/                         Material de apoio, fora do sistema em producao
│   ├── problema-sem-framing.mjs           Evidencia o problema que o framing resolve
│   ├── solucao-com-framing.mjs            Os mesmos cenarios com framing
│   ├── ordenar-auditoria.mjs              Compara ordem logica com ordem fisica
│   └── conferir-entrega.mjs               Confere publicados contra processados
├── src/
│   ├── compartilhado/
│   │   ├── tipos.ts                       Contrato das mensagens e as tres entidades
│   │   ├── framing.ts                     Enquadramento por prefixo de tamanho
│   │   ├── lamport.ts                     As tres regras do relogio logico
│   │   ├── auditoria.ts                   Log de auditoria com carimbo logico e fisico
│   │   ├── kafka.ts                       Conexao com o broker
│   │   ├── rede.ts                        Portas, tempos e composicao do grupo
│   │   └── repositorio.ts                 Persistencia do estado consolidado
│   ├── gateway/
│   │   └── servidor.ts                    Ponto de Entrada (R1)
│   ├── worker/
│   │   ├── worker.ts                      Consumo da fila com ack manual (R3, R6)
│   │   ├── regra-bloqueio.ts              Deteccao de DDoS em duas camadas
│   │   ├── bully.ts                       Algoritmo do Valentao (R5)
│   │   ├── coordenacao.ts                 Transporte do canal de coordenacao
│   │   └── consolidador.ts                Consolidacao do lote pelo lider
│   └── sensor/
│       └── simulador.ts                   Simulador de SensorRede
├── docker-compose.yml                     Kafka, criacao do topico e os dois bancos
├── tsconfig.json                          Tipagem estatica rigorosa
└── package.json
```

### Sobre a tipagem estática

O `tsconfig.json` vai além do `strict: true`. Estão ativas também `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature` e `isolatedModules`.

Nas fronteiras de rede, onde `JSON.parse` devolve valores sem garantia de formato, a verificação em tempo de execução é feita por funções de guarda de tipo (`ehAlertaAnomalia`, `ehEnvelopeAlerta`, `ehMensagemCoordenacao`, `ehRecomendacaoBloqueio`). Sem elas a tipagem estática seria uma ficção justamente onde os dados entram no sistema.

---

## 8. Declaração de Uso de IA

Este projeto utilizou a ferramenta de IA generativa **Claude (Anthropic), por meio do Claude Code**.

O papel específico da ferramenta foi:

* discussão e revisão do plano de etapas, com análise crítica da ordem de execução proposta pelo grupo;
* geração de código a partir de decisões de arquitetura já tomadas pelo grupo, com explicação prévia de cada peça antes de escrevê-la;
* explicação de conceitos da disciplina (framing em TCP, semântica de offsets no Kafka, regras de Lamport, mensagens do Algoritmo do Valentão) durante o desenvolvimento;
* depuração de problemas concretos, como a configuração de `advertised.listeners` do Kafka, permissões de volume no Docker e a inicialização da réplica por `pg_basebackup`;
* revisão de tipagem e sugestão de tratamento de exceções e timeouts;
* redação da documentação do repositório.

A ferramenta atuou como recurso complementar, e não como substituta da autoria intelectual. Todas as decisões de arquitetura foram tomadas pelo grupo, de forma explícita e com conhecimento das alternativas: a cada etapa, a ferramenta apresentou as opções e os respectivos custos e riscos, e o grupo decidiu qual caminho seguir antes de qualquer implementação. Em diversos pontos o grupo decidiu de forma diferente da recomendação apresentada, por exemplo ao optar pela replicação nativa do PostgreSQL em vez da replicação em nível de aplicação, e ao recusar a inclusão de um mecanismo de troca de modo de replicação no código por considerá-lo fora do escopo do enunciado. Nenhuma linha foi incorporada ao projeto sem que o grupo entendesse sua função e conseguisse justificá-la.

O histórico das decisões técnicas, com as alternativas descartadas e os motivos de cada escolha, está registrado no arquivo `DECISOES.md` deste repositório.

---

## 9. Submissão

Enviado para `edgardpontes@professor.multivix.edu.br`
Assunto: `AP - PDP - Tema 10 - CyberGuardian`
