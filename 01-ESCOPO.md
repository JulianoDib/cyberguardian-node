# 01 — ESCOPO DO TRABALHO (fonte da verdade)

> **Regra de ouro deste projeto: NADA além do que está neste documento.**
> Antes de implementar qualquer coisa, conferir aqui. Se não está pedido, não fazemos.

## Dados da avaliação
- **Disciplina:** Programação Distribuída e Paralela — Multivix, Sistemas de Informação, 7º/8º período, noturna
- **Professor:** Edgard da Cunha Pontes
- **Valor:** 3,0 pontos (Código 2,0 + Defesa técnica presencial 1,0)
- **Entrega:** até **10/09/2026 (quinta-feira)**
- **Tipo:** grupo (máx. 5 pessoas)

## Tema escolhido — Tema 10: CyberGuardian Node (NIDS)
Sistema de Detecção de Intrusões Distribuído. Malha de sensores espalhados por datacenters
que inspecionam tráfego de pacotes IP e emitem alertas em tempo real sobre anomalias que
indicam ataques DDoS.

**Stack definida pelo próprio tema (não escolhemos — o tema manda):**
| Camada | Tecnologia exigida pelo tema 10 |
|---|---|
| Ponto de Entrada (Gateway) | **Sockets TCP** puros com framing explícito |
| Fila de Mensagens | **Apache Kafka** |
| Relógio lógico | **Relógios de Lamport** |
| Eleição de líder | **Algoritmo do Valentão (Bully)** — implementação rigorosa |

**Comportamento exigido pelo tema:** workers validam regras de bloqueio independentes;
Lamport estabelece a linha do tempo exata do ataque; o Worker Líder é o ÚNICO que
consolida o lote de anomalias e ordena o bloqueio ao firewall, sem comandos duplicados.

## Linguagem
TypeScript/Node.js (a confirmar com o professor — o PDF aceita Python 3.10+ ou TS/Node).
Critério de qualidade exige **tipagem estática rigorosa**.

## Arquitetura obrigatória — as 4 etapas ("A Metrópole Resiliente")
1. **Ponto de Entrada:** clientes enviam requisições por um Gateway; retorna ACK de enfileiramento.
2. **Coração Assíncrono:** solicitações pesadas vão pra Fila de Mensagens; cliente liberado imediatamente (non-blocking).
3. **Exército de Trabalhadores:** múltiplos workers replicados consomem a fila concorrentemente e de forma independente.
4. **Memória Intacta:** armazenamento e replicação dos estados consolidados com integridade e histórico causal (primário + réplica).

## Modelagem mínima
Cenário de missão crítica com **no mínimo 3 entidades correlacionadas**
(padrão sugerido: DispositivoEmissor → OrdemTransacao/Evento → RegistroConsolidado/Auditoria;
no nosso domínio: algo como SensorRede → AlertaAnomalia → RegistroBloqueio/Auditoria).

## Requisitos técnicos obrigatórios (R1–R6)
- **R1 — Ingress:** API de entrada via Sockets TCP puros com framing explícito (no tema 10).
  Processamento assíncrono (async/await ou Promises/threads) para baixa latência.
- **R2 — Mensageria:** integração obrigatória com Kafka (no tema 10). Cada mensagem com
  identificador único, payload estruturado e metadados de rastreabilidade causal.
- **R3 — Workers:** mínimo **3 workers** independentes consumindo a mesma fila
  (padrão Competing Consumers). Tratar concorrência local evitando race conditions.
- **R4 — Lamport:** cada worker implementa Relógio de Lamport. Cada mensagem processada
  atualiza o carimbo lógico pela regra `L(e') = max(L(e), L(m)) + 1`. Ordenação
  determinística das tarefas no log de auditoria.
- **R5 — Eleição de líder:** workers executam o **Bully** para eleger um Worker Líder.
  O líder é o ÚNICO responsável por consolidação (fechar lotes de auditoria / coordenar persistência na réplica).
- **R6 — Tolerância a falhas:** queda abrupta de worker ou líder → fila NÃO perde mensagens
  (Message Acknowledgment / nack com requeue) e nova eleição dispara automaticamente.

## Critérios de avaliação
### Etapa 1 — Desenvolvimento e Código (2,0)
| Critério | Pontos |
|---|---|
| Arquitetura, Ingress e Mensageria (Sockets corretos, desacoplamento Kafka, fluxo non-blocking) | 0,6 |
| Sincronização Lógica e Eleição de Líder (Lamport funcional + Bully entre os nós) | 0,6 |
| Concorrência, Resiliência e Persistência (consumo seguro, falha sem perda, replicação consistente) | 0,4 |
| Qualidade do Código e Tipagem (modular, tipagem estática rigorosa, exceções/timeouts robustos) | 0,4 |

### Etapa 2 — Entrevista e Defesa Técnica (1,0)
| Critério | Pontos |
|---|---|
| Domínio e Autoria do Código (cada integrante explica individualmente lógica, buffers, concorrência ou funções sorteadas) | 0,5 |
| Fundamentação e Decisões de Arquitetura (trade-offs: gRPC vs Sockets, Lamport vs relógio físico, Bully vs Ring, estratégias de fila) | 0,5 |

**Arguição (Semana 6, até 10 min por grupo), duas modalidades:**
- Com apresentação (opcional, até 10 min): responde 2 perguntas (0,25 cada) + 0,5 automático pela apresentação.
- Sem apresentação: responde 4 perguntas (0,25 cada).

## Formato de entrega
- **Repositório GitHub** com código organizado, scripts de banco e `docker-compose.yml`
  (ou instruções equivalentes) para subir broker, nós e banco.
- **README.md obrigatório** contendo:
  - Nome completo e matrícula de todos os integrantes
  - Tema e domínio escolhido
  - Diagrama com portas, componentes e fluxo das mensagens
  - Guia de execução local passo a passo (ambiente, dependências, comandos para subir Gateway, Fila e workers)
  - Evidência dos logs: atualização dos carimbos de Lamport e eleição de líder no console
  - **Declaração de Uso de IA:** ferramentas usadas (ex.: Claude) e papel específico de cada uma
- **Submissão:** líder envia o link do repositório para **edgardpontes@professor.multivix.edu.br** até a data limite.
  - Assunto: `AP - PDP - Tema 10 - Nome do Grupo`

## Política de IA (resumo fiel)
- Uso de IA generativa **AUTORIZADO** como suporte: brainstorming, depuração, refatoração.
- IA é complemento, **jamais substituta da autoria intelectual**.
- Declaração de Uso de IA no README é **OBRIGATÓRIA**.
- Código integralmente por IA **ou** incapacidade de fundamentar as escolhas na arguição oral = **NOTA ZERO**.
  → Consequência prática: o aluno PRECISA saber explicar Lamport, Bully e as decisões de arquitetura.

## Fora de escopo (não fazer)
- Interface gráfica/web bonita (não é pedida)
- Autenticação de usuários, criptografia, features extras de segurança real
- Deploy em nuvem (execução é LOCAL via docker-compose)
- Qualquer tecnologia fora da stack do tema 10 (ex.: gRPC, RabbitMQ, relógio vetorial, Ring — são de OUTROS temas)
- Testes automatizados extensos (não são exigidos; foco em funcionar e evidenciar por logs)
