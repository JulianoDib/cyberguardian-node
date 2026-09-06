# 04 — PROGRESSO / ONDE PARAMOS

> Atualizar ao fim de TODA sessão de trabalho (regra 6 do CLAUDE.md).
> Este arquivo viaja no git e é o fio de continuidade entre as duas máquinas:
> chegou na outra máquina → `git pull` → ler este arquivo → retomar.

## Estado atual
**Fase:** Desenvolvimento iniciado.
**Etapa atual:** Etapa 0 (Setup) — estrutura do projeto PRONTA; faltam Docker Desktop e GitHub/push.
**Última atualização:** 05/09/2026 — sessão de trabalho: estrutura Node/TypeScript + git local.

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
  - [ ] **Docker Desktop instalado** (não está na máquina 1 — bloqueia a Etapa 1)
  - [ ] Repositório no GitHub + primeiro push (combinado de fazer junto com o aluno)
- [ ] Etapa 0b — Setup de ambiente (máquina 2, quando necessário)
- [ ] Etapa 1 — R2: Kafka rodando + produtor/consumidor de teste
- [ ] Etapa 2 — R1: Gateway TCP com framing + ACK + simulador de sensor
- [ ] Etapa 3 — R3: 3 workers em Competing Consumers
- [ ] Etapa 4 — R4: Relógios de Lamport nos logs de auditoria
- [ ] Etapa 5 — R5: Eleição Bully + líder único consolidador
- [ ] Etapa 6 — R6: Falhas sem perda + reeleição automática
- [ ] Etapa 7 — Persistência primário + réplica
- [ ] Etapa 8 — Integração ponta a ponta + coleta de evidências de log
- [ ] Etapa 9 — README, diagrama, Declaração de IA, e-mail de submissão

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

## Notas da última sessão (05/09 — Etapa 0)
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
