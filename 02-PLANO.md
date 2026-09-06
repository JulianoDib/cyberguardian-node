# 02 — PLANO DE ETAPAS

> Ordem de execução combinada. Cada etapa tem: objetivo, o que entrega, e critério de "pronto".
> Estimativas assumem a abordagem mista (Claude Code executa, aluno acompanha e calibra o quanto faz manualmente).

## Visão geral da ordem
Setup → Fila (Kafka) → Gateway (Sockets) → Workers → Lamport → Eleição Bully → Tolerância a falhas → Persistência/replicação → Integração e testes → Entregáveis

---

## Etapa 0 — Setup de ambiente
**Objetivo:** máquina pronta pra desenvolver.
**Entrega:** Node.js LTS + TypeScript, VS Code, Docker Desktop funcionando, pasta do projeto criada, Git inicializado, repositório GitHub do projeto criado (conta JulianoDib), primeiro push feito.
**Pronto quando:** `docker compose version` e `node -v` respondem; push de teste chega no GitHub.
**Estimativa:** 1–2h (por máquina).

## Etapa 1 — R2: Fila de Mensagens (Kafka)
**Objetivo:** subir o Kafka via Docker e provar que mensagens entram e saem.
**Entrega:** `docker-compose.yml` com Kafka; script mínimo produtor/consumidor de teste; formato da mensagem definido (id único + payload estruturado + metadados de rastreabilidade causal).
**Conceitos da etapa:** fila FIFO, broker, tópico, produtor/consumidor, por que desacoplar.
**Pronto quando:** mensagem publicada aparece no consumidor de teste.
**Estimativa:** 3–4h.

## Etapa 2 — R1: Gateway (Sockets TCP)
**Objetivo:** o Ponto de Entrada que recebe alertas dos sensores e enfileira no Kafka.
**Entrega:** servidor TCP com framing explícito (protocolo próprio simples, ex.: tamanho + JSON); resposta ACK imediata ao cliente (non-blocking, async/await); simulador de sensor (cliente TCP que envia alertas de anomalia).
**Conceitos da etapa:** socket, TCP, framing (por que precisa), ACK, non-blocking.
**Pronto quando:** simulador envia alerta → gateway responde ACK → mensagem aparece no tópico Kafka.
**Estimativa:** 3–4h.

## Etapa 3 — R3: Workers replicados
**Objetivo:** 3 workers idênticos consumindo o mesmo tópico (Competing Consumers).
**Entrega:** processo worker parametrizável por ID; os 3 rodando em paralelo, cada mensagem processada por exatamente um; proteção das seções críticas (sem race condition); processamento = validar regra de bloqueio (lógica simples de detecção DDoS, ex.: limiar de pacotes por origem).
**Conceitos da etapa:** consumer group, competing consumers, concorrência, race condition, seção crítica.
**Pronto quando:** logs mostram os 3 workers dividindo as mensagens sem duplicar processamento.
**Estimativa:** 4–5h.

## Etapa 4 — R4: Relógios de Lamport  ⚠️ conceito-chave pra defesa
**Objetivo:** carimbo lógico em todo evento; linha do tempo causal do ataque.
**Entrega:** contador de Lamport em gateway e workers; regra `L = max(L_local, L_msg) + 1` aplicada em todo recebimento; carimbo registrado no log de auditoria; ordenação determinística demonstrável nos logs.
**Conceitos da etapa:** por que relógio físico não serve, causalidade, eventos concorrentes, a regra do max+1.
**Pronto quando:** logs evidenciam carimbos atualizando corretamente entre processos (evidência exigida no README).
**Estimativa:** 3–5h.

## Etapa 5 — R5: Eleição de Líder (Bully)  ⚠️ conceito-chave pra defesa
**Objetivo:** workers elegem sozinhos um líder; só o líder consolida e "ordena bloqueio ao firewall".
**Entrega:** canal de coordenação entre workers; implementação do Bully (mensagens ELECTION / OK / COORDINATOR por ID); líder faz a consolidação do lote de anomalias e emite o comando de bloqueio (simulado) exatamente uma vez.
**Conceitos da etapa:** por que precisa de líder, como o Bully funciona (o maior ID vence), heartbeat/detecção de falha do líder.
**Pronto quando:** logs mostram eleição acontecendo na subida e o líder como único consolidador.
**Estimativa:** 5–7h. **Maior gargalo do projeto.**

## Etapa 6 — R6: Tolerância a falhas
**Objetivo:** derrubar worker/líder sem perder mensagem; reeleição automática.
**Entrega:** ack manual no Kafka (mensagem só confirmada após processar; queda → mensagem redistribuída); detecção de queda do líder → Bully dispara de novo sozinho; demonstração: matar o líder no meio do processamento e mostrar recuperação nos logs.
**Conceitos da etapa:** at-least-once, ack/nack/requeue, heartbeat.
**Pronto quando:** teste de matar processos passa sem perda e com reeleição registrada em log.
**Estimativa:** 3–4h.

## Etapa 7 — Memória Intacta: persistência e replicação
**Objetivo:** registros consolidados salvos com primário + réplica e histórico causal.
**Entrega:** banco (definir na hora: opção simples aceita pelo enunciado) com registro de auditoria ordenado por carimbo Lamport; réplica do estado consolidado; scripts de banco no repositório.
**Pronto quando:** consolidações do líder aparecem no primário e na réplica.
**Estimativa:** incluída/no fluxo das etapas 5–6 + 2–3h de fechamento.

## Etapa 8 — Integração e testes finais
**Objetivo:** o fluxo ponta a ponta rodando: sensor → gateway → Kafka → 3 workers → líder → persistência replicada.
**Entrega:** roteiro de demonstração (subir tudo com docker-compose, gerar carga, matar líder, mostrar logs); coleta das evidências de log exigidas no README (Lamport + eleição).
**Estimativa:** 3–5h.

## Etapa 9 — Entregáveis (responsabilidade: Claude)
**Entrega:** README.md completo (integrantes, tema, diagrama de portas/componentes/fluxo, guia passo a passo, evidências de log, Declaração de Uso de IA); revisão final do repositório; texto do e-mail de submissão com assunto `AP - PDP - Tema 10 - Nome do Grupo`.
**Pendências do aluno nesta etapa:** nomes completos e matrículas dos integrantes; nome do grupo.
**Estimativa:** ~0h do aluno.

---

## Marcos de calendário (entrega 10/09, quinta)
- Ideal: etapas 0–3 até sábado/domingo; 4–5 até terça; 6–8 até quarta; entrega quarta à noite ou quinta cedo.
- Regra de segurança: **não deixar a Etapa 8 (integração) pra quinta.** Integração é onde o tempo some.
