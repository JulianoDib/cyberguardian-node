-- ============================================================================
-- CyberGuardian Node — schema do estado consolidado ("A Memoria Intacta")
-- ============================================================================
--
-- Aplicado AUTOMATICAMENTE: a imagem oficial do Postgres executa os arquivos
-- .sql de /docker-entrypoint-initdb.d/ na primeira subida do container. O
-- docker-compose.yml monta a pasta ./banco ali, nos DOIS bancos.
--
-- Guarda a terceira entidade do dominio:
--
--     SensorRede  ->  AlertaAnomalia  ->  RegistroBloqueio
--
-- Um RegistroBloqueio e produzido APENAS pelo worker LIDER, ao consolidar um
-- lote de anomalias. Corresponde a `RegistroBloqueio` em src/compartilhado/tipos.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS registro_bloqueio (
    -- Identificador do registro. Gerado pela aplicacao (crypto.randomUUID).
    -- Chave primaria = IDEMPOTENCIA: gravar duas vezes o mesmo registro e
    -- rejeitado pelo BANCO. E o "sem comandos duplicados" do tema garantido
    -- tambem na camada de armazenamento, e nao so na logica do lider.
    id                     UUID         PRIMARY KEY,

    -- Numero sequencial do lote em que o bloqueio foi consolidado.
    lote_id                INTEGER      NOT NULL,

    -- O IP atacante bloqueado.
    ip_bloqueado           TEXT         NOT NULL,

    -- Qual worker era o LIDER no momento da consolidacao.
    emitido_por            INTEGER      NOT NULL,

    -- CARIMBO LOGICO de Lamport do lider ao fechar o lote (R4).
    -- BIGINT porque o contador cresce indefinidamente com os eventos.
    lamport                BIGINT       NOT NULL,

    -- Quantos alertas motivaram este bloqueio.
    quantidade_alertas     INTEGER      NOT NULL,

    -- HISTORICO CAUSAL: os ids dos alertas que levaram a esta decisao.
    -- Permite voltar do bloqueio ate os eventos de origem.
    alertas_que_motivaram  TEXT[]       NOT NULL,

    -- Carimbo FISICO da consolidacao (apenas leitura humana; quem ordena e o lamport).
    consolidado_em         TIMESTAMPTZ  NOT NULL,

    -- Quando esta linha entrou NESTE banco. Difere entre primario e replica
    -- e por isso NAO deve ser usado para comparar os dois.
    gravado_em             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- INTEGRIDADE: um IP so pode ter um bloqueio ativo. Esta restricao e a
    -- segunda linha de defesa contra comando duplicado — a primeira e o
    -- conjunto de IPs ja bloqueados que o lider mantem em memoria. Quando o
    -- lider morre, esse conjunto se perde com ele; e aqui que o banco segura.
    CONSTRAINT ip_bloqueado_unico UNIQUE (ip_bloqueado),

    -- Coerencia basica dos dados.
    CONSTRAINT quantidade_alertas_positiva CHECK (quantidade_alertas > 0),
    CONSTRAINT lamport_nao_negativo        CHECK (lamport >= 0)
);

-- ORDEM CAUSAL: e a mesma ordem total deterministica definida na Etapa 4 —
-- (lamport, processo). Permite reconstruir a linha do tempo logica dos
-- bloqueios com "ORDER BY lamport, emitido_por".
CREATE INDEX IF NOT EXISTS idx_registro_bloqueio_ordem_causal
    ON registro_bloqueio (lamport, emitido_por);

COMMENT ON TABLE  registro_bloqueio IS
    'Estado consolidado: bloqueios decididos pelo worker lider (R5). Terceira entidade do dominio.';
COMMENT ON COLUMN registro_bloqueio.lamport IS
    'Carimbo logico de Lamport (R4). Define a ordem causal, nao o relogio de parede.';
COMMENT ON COLUMN registro_bloqueio.alertas_que_motivaram IS
    'Historico causal: ids dos AlertaAnomalia que motivaram este bloqueio.';
