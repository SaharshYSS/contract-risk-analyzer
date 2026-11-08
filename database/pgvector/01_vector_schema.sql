-- =====================================================================
-- pgvector/01_vector_schema.sql  |  Owner: Varun (PES2UG24CS576)
-- Vector database: PostgreSQL 16 + pgvector extension.
-- Stores 384-dimension embeddings and is queried with plain SQL:
--   ORDER BY embedding <=> query_vector   (<=> = cosine distance)
--   similarity = 1 - cosine distance
-- Run with:  npm run vector:setup
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

DROP VIEW  IF EXISTS v_vector_stats;
DROP TABLE IF EXISTS clause_vector;
DROP TABLE IF EXISTS risk_pattern_vector;

-- ---------------------------------------------------------------------
-- Templates of risky clauses written in plain English. A contract clause
-- whose embedding is close to one of these is flagged as risky.
-- ---------------------------------------------------------------------
CREATE TABLE risk_pattern_vector (
    pattern_id          INT           PRIMARY KEY,
    title               VARCHAR(100)  NOT NULL UNIQUE,
    severity            VARCHAR(10)   NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    clause_type         VARCHAR(40)   NOT NULL,
    pattern_text        TEXT          NOT NULL CHECK (length(trim(pattern_text)) >= 10),
    suggested_revision  TEXT          NOT NULL,
    embedding           vector(384)   NOT NULL
);

-- ---------------------------------------------------------------------
-- One row per clause. clause_id is the SAME UUID as clause.clause_id in
-- MySQL, so every vector result joins back to the relational data.
-- (A foreign key cannot cross two database servers, so the upload code
--  writes both sides inside one transaction per database and rolls both
--  back if either fails.)
-- ---------------------------------------------------------------------
CREATE TABLE clause_vector (
    clause_id    UUID          PRIMARY KEY,
    contract_id  UUID          NOT NULL,
    clause_no    INT           NOT NULL CHECK (clause_no > 0),
    clause_type  VARCHAR(40)   NOT NULL,
    model_name   VARCHAR(100)  NOT NULL,
    embedding    vector(384)   NOT NULL,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_clause_vector_position UNIQUE (contract_id, clause_no)
);

-- HNSW = approximate nearest-neighbour index for fast cosine search
CREATE INDEX idx_clause_vector_hnsw  ON clause_vector       USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_risk_pattern_hnsw   ON risk_pattern_vector USING hnsw (embedding vector_cosine_ops);
-- B-tree indexes for the metadata filters used with similarity search
CREATE INDEX idx_clause_vector_contract ON clause_vector (contract_id);
CREATE INDEX idx_clause_vector_type     ON clause_vector (clause_type);

-- How many vectors are stored per clause type (shown on the dashboard)
CREATE VIEW v_vector_stats AS
SELECT clause_type,
       COUNT(*)                      AS vectors,
       COUNT(DISTINCT contract_id)   AS contracts
  FROM clause_vector
 GROUP BY clause_type;
