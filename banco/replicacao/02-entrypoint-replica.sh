#!/bin/bash
# ============================================================================
# Entrypoint da REPLICA — streaming replication do PostgreSQL.
#
# A imagem oficial do Postgres, ao encontrar o diretorio de dados vazio, roda um
# `initdb` e cria um banco NOVO e independente. Nao e o que queremos: a replica
# precisa ser uma COPIA do primario, iniciada a partir de um `pg_basebackup`.
#
# Por isso este script substitui o entrypoint:
#   1. se ainda nao ha dados, copia o primario inteiro com pg_basebackup;
#   2. so entao delega para o entrypoint oficial, que sobe o Postgres.
#
# A flag `-R` do pg_basebackup cria o arquivo `standby.signal` e grava o
# `primary_conninfo`. E isso que faz o PostgreSQL subir em modo STANDBY,
# somente-leitura, consumindo o WAL do primario continuamente.
# ============================================================================
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"
PRIMARIO_HOST="${PRIMARIO_HOST:-postgres-primario}"
PRIMARIO_PORTA="${PRIMARIO_PORTA:-5432}"
USUARIO_REPLICACAO="${USUARIO_REPLICACAO:-replicador}"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[replica] diretorio de dados vazio — iniciando copia do primario"

  # O ponto de montagem do volume nasce pertencendo ao root; o Postgres roda
  # como o usuario 'postgres'. Sem este ajuste o pg_basebackup nao consegue
  # escrever. (Mesma classe de problema que enfrentamos com o volume do Kafka
  # na Etapa 1 — aqui, porem, tem solucao simples.)
  rm -rf "${PGDATA:?}"/* 2>/dev/null || true
  chown -R postgres:postgres "$PGDATA"

  export PGPASSWORD="${PGPASSWORD_REPLICACAO:-replicador}"

  # O primario pode ainda estar aceitando conexoes normais mas nao replicacao
  # (o script de init roda antes de ele reiniciar com o pg_hba novo).
  # Tentamos ate conseguir, em vez de falhar na primeira.
  tentativa=1
  until gosu postgres pg_basebackup \
      --host="$PRIMARIO_HOST" \
      --port="$PRIMARIO_PORTA" \
      --username="$USUARIO_REPLICACAO" \
      --pgdata="$PGDATA" \
      --format=plain \
      --wal-method=stream \
      --write-recovery-conf \
      --no-password \
      --progress; do
    echo "[replica] primario ainda nao aceita replicacao (tentativa $tentativa) — nova tentativa em 3s"
    tentativa=$((tentativa + 1))
    if [ "$tentativa" -gt 20 ]; then
      echo "[replica] ERRO: nao consegui replicar do primario apos 20 tentativas"
      exit 1
    fi
    sleep 3
  done

  chmod 0700 "$PGDATA"
  chown -R postgres:postgres "$PGDATA"

  echo "[replica] copia concluida. standby.signal presente? $([ -f "$PGDATA/standby.signal" ] && echo SIM || echo NAO)"
else
  echo "[replica] ja existem dados — subindo como standby"
fi

# Entrega ao entrypoint oficial, que vai encontrar os dados prontos, pular o
# initdb e subir o Postgres. Como ha standby.signal, ele sobe em modo replica.
exec docker-entrypoint.sh postgres
