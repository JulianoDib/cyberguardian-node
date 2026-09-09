#!/bin/bash
# ============================================================================
# Prepara o PRIMARIO para streaming replication.
#
# Executado UMA VEZ, na primeira subida do container primario, pelo mecanismo
# de /docker-entrypoint-initdb.d/ da imagem oficial do PostgreSQL.
#
# Faz duas coisas que o Postgres nao traz prontas:
#   1. cria um papel dedicado com o atributo REPLICATION;
#   2. libera conexoes de replicacao no pg_hba.conf.
#
# O `wal_level=replica` e o `max_wal_senders` ja sao o padrao no PostgreSQL 17,
# entao nao precisam ser alterados.
# ============================================================================
set -e

echo "[primario] criando papel de replicacao..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE replicador WITH REPLICATION LOGIN PASSWORD 'replicador';
EOSQL

echo "[primario] liberando conexoes de replicacao no pg_hba.conf..."

# "all" no lugar do endereco porque o IP do container da replica e atribuido
# dinamicamente pela rede do Docker. Aceitavel: a rede e interna ao compose.
cat >> "$PGDATA/pg_hba.conf" <<-EOF

# Streaming replication (Etapa 7)
host    replication    replicador    all    scram-sha-256
EOF

echo "[primario] pronto para replicar."
