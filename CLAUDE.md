# CLAUDE.md — Regras de trabalho deste projeto

> Este arquivo fica na RAIZ do projeto. O Claude Code o lê automaticamente em toda sessão.
> Ele define COMO trabalhar, não O QUE fazer (o que fazer está em 01-ESCOPO.md e 02-PLANO.md).

## Contexto
Trabalho acadêmico de Programação Distribuída e Paralela (Multivix). Tema 10 — CyberGuardian
Node (NIDS distribuído). Entrega 10/09/2026. O aluno está aprendendo a matéria durante o
desenvolvimento e vai defender o projeto ORALMENTE e SOZINHO. As explicações importam
tanto quanto o código.

## Documentos do projeto (ler antes de qualquer trabalho)
- `01-ESCOPO.md` — fonte da verdade do que é pedido. **Nada além disso.**
- `02-PLANO.md` — ordem das etapas e critério de "pronto" de cada uma.
- `03-DECISOES.md` — diário de decisões. **Registrar aqui toda escolha técnica feita.**
- `04-PROGRESSO.md` — estado atual. **Atualizar ao fim de toda sessão de trabalho.**

## Regras de execução
1. **Escopo fechado:** implementar somente o que está em 01-ESCOPO.md. Não adicionar
   features, bibliotecas, camadas ou "melhorias" não pedidas. Em dúvida, perguntar antes.
2. **Uma etapa por vez**, na ordem do 02-PLANO.md. Não avançar pra próxima sem a atual
   atingir o critério de "pronto" (ou sem o aluno mandar seguir).
3. **Explicar antes de executar:** no início de cada etapa, explicar em linguagem simples
   o conceito envolvido e o que será feito, ANTES de escrever código. O aluno tem base de
   lógica e noções de OO, mas revisar conceitos (classe, construtor, método, fila, socket…)
   na primeira vez que aparecerem.
4. **Confirmar antes de agir:** o aluno decide, em cada etapa, o quanto ele faz manualmente
   e o quanto o Claude Code executa. Perguntar no início da etapa. Antes de comandos que
   alteram o sistema (instalações, docker, push), confirmar.
5. **Registrar decisões:** toda escolha técnica (biblioteca, estrutura, formato de mensagem,
   correção de rumo) vira entrada no 03-DECISOES.md, com alternativas descartadas e motivo.
6. **Atualizar progresso:** ao fim de cada sessão, atualizar 04-PROGRESSO.md (etapa atual,
   o que foi feito, o que falta, como retomar). O aluno alterna entre duas máquinas via
   git push/pull — este arquivo é o fio de continuidade.
7. **Código defensável:** priorizar clareza sobre esperteza. Comentários curtos em português
   nos pontos conceituais (Lamport, Bully, seções críticas, ack manual). Tipagem estática
   rigorosa (critério de nota). Nomes de variáveis/funções em português ou inglês simples,
   consistentes.
8. **Lamport (R4) e Bully (R5) são as etapas de aprendizado prioritário:** nelas, ir mais
   devagar, explicar linha a linha quando o aluno pedir, e ao final gerar um resumo de
   defesa (o que é, como funciona no nosso código, por que essa escolha).
9. **Logs são evidência de nota:** gateway e workers devem logar de forma legível os
   carimbos de Lamport e os eventos de eleição (o README exige prints/evidências disso).
10. **Honestidade em estimativas e problemas:** se algo vai atrasar ou está errado, dizer
    direto. Sem otimismo artificial.

## O que NÃO fazer
- Não usar gRPC, RabbitMQ, relógios vetoriais ou algoritmo Ring (são de outros temas).
- Não criar interface web, autenticação, deploy em nuvem, testes automatizados extensos.
- Não refatorar por estética fora do que o critério de qualidade exige.
- Não avançar etapas em lote sem o aluno pedir.
