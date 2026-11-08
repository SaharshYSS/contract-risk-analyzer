-- =====================================================================
-- 01_schema.sql  |  Owner: Saharsh (PES2UG24CS618)
-- AI-Assisted Legal Contract Risk Analysis & Semantic Clause Retrieval
-- Relational part (MySQL 8). Vectors live in PostgreSQL + pgvector
-- (see database/pgvector/01_vector_schema.sql).
-- =====================================================================

DROP DATABASE IF EXISTS contract_analysis;
CREATE DATABASE contract_analysis CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE contract_analysis;

-- ---------------------------------------------------------------------
-- 1. app_user : people who log in. Passwords are bcrypt hashes only.
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
    user_id        CHAR(36)      NOT NULL,
    full_name      VARCHAR(100)  NOT NULL,
    email          VARCHAR(120)  NOT NULL,
    password_hash  VARCHAR(255)  NOT NULL,
    role           ENUM('admin','lawyer','reviewer') NOT NULL DEFAULT 'reviewer',
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_app_user PRIMARY KEY (user_id),
    CONSTRAINT uq_app_user_email UNIQUE (email),
    CONSTRAINT chk_app_user_email CHECK (email LIKE '%_@_%._%'),
    CONSTRAINT chk_app_user_name CHECK (CHAR_LENGTH(TRIM(full_name)) >= 2),
    CONSTRAINT chk_app_user_hash CHECK (CHAR_LENGTH(password_hash) >= 50)
);

-- ---------------------------------------------------------------------
-- 2. contract : one uploaded legal contract
-- ---------------------------------------------------------------------
CREATE TABLE contract (
    contract_id     CHAR(36)       NOT NULL,
    uploaded_by     CHAR(36)       NOT NULL,
    title           VARCHAR(200)   NOT NULL,
    counterparty    VARCHAR(150)   NOT NULL,
    contract_type   ENUM('nda','service','employment','lease','saas','other') NOT NULL DEFAULT 'other',
    effective_date  DATE           NULL,
    expiry_date     DATE           NULL,
    contract_value  DECIMAL(14,2)  NULL,
    status          ENUM('uploaded','under_review','approved','rejected') NOT NULL DEFAULT 'uploaded',
    risk_score      DECIMAL(5,2)   NOT NULL DEFAULT 0,
    created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_contract PRIMARY KEY (contract_id),
    CONSTRAINT fk_contract_user FOREIGN KEY (uploaded_by)
        REFERENCES app_user(user_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_contract_dates CHECK (expiry_date IS NULL OR effective_date IS NULL OR expiry_date > effective_date),
    CONSTRAINT chk_contract_value CHECK (contract_value IS NULL OR contract_value >= 0),
    CONSTRAINT chk_contract_risk CHECK (risk_score BETWEEN 0 AND 100),
    CONSTRAINT chk_contract_title CHECK (CHAR_LENGTH(TRIM(title)) >= 3)
);

-- ---------------------------------------------------------------------
-- 3. clause : a contract is split into numbered clauses
-- ---------------------------------------------------------------------
CREATE TABLE clause (
    clause_id    CHAR(36)     NOT NULL,
    contract_id  CHAR(36)     NOT NULL,
    clause_no    INT          NOT NULL,
    clause_type  ENUM('liability','indemnity','termination','payment','confidentiality',
                      'non_compete','renewal','governing_law','intellectual_property',
                      'warranty','dispute_resolution','general') NOT NULL DEFAULT 'general',
    content      TEXT         NOT NULL,
    CONSTRAINT pk_clause PRIMARY KEY (clause_id),
    CONSTRAINT fk_clause_contract FOREIGN KEY (contract_id)
        REFERENCES contract(contract_id) ON DELETE CASCADE,
    CONSTRAINT uq_clause_no UNIQUE (contract_id, clause_no),
    CONSTRAINT chk_clause_no CHECK (clause_no > 0),
    CONSTRAINT chk_clause_content CHECK (CHAR_LENGTH(TRIM(content)) >= 10)
);

-- ---------------------------------------------------------------------
-- 4. clause_embedding : metadata only. The vector itself is stored in
--    PostgreSQL/pgvector (table clause_vector) under the same clause_id.
-- ---------------------------------------------------------------------
CREATE TABLE clause_embedding (
    clause_id        CHAR(36)     NOT NULL,
    vector_store     ENUM('pgvector') NOT NULL DEFAULT 'pgvector',
    model_name       VARCHAR(100) NOT NULL,
    dimension        SMALLINT     NOT NULL,
    embedded_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_clause_embedding PRIMARY KEY (clause_id),
    CONSTRAINT fk_embedding_clause FOREIGN KEY (clause_id)
        REFERENCES clause(clause_id) ON DELETE CASCADE,
    CONSTRAINT chk_embedding_dim CHECK (dimension > 0)
);

-- ---------------------------------------------------------------------
-- 5. risk_rule : keyword rules for the rule-based risk check
-- ---------------------------------------------------------------------
CREATE TABLE risk_rule (
    rule_id          INT           NOT NULL AUTO_INCREMENT,
    rule_name        VARCHAR(100)  NOT NULL,
    clause_type      VARCHAR(40)   NULL,
    keyword_pattern  VARCHAR(255)  NOT NULL,   -- MySQL REGEXP, case-insensitive
    severity         ENUM('low','medium','high','critical') NOT NULL,
    description      VARCHAR(500)  NOT NULL,
    suggested_revision TEXT        NULL,
    created_by       CHAR(36)      NULL,
    CONSTRAINT pk_risk_rule PRIMARY KEY (rule_id),
    CONSTRAINT uq_risk_rule_name UNIQUE (rule_name),
    CONSTRAINT fk_rule_user FOREIGN KEY (created_by)
        REFERENCES app_user(user_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- 6. risk_finding : a risk detected on one clause (keyword or semantic)
-- ---------------------------------------------------------------------
CREATE TABLE risk_finding (
    finding_id          CHAR(36)      NOT NULL,
    clause_id           CHAR(36)      NOT NULL,
    rule_id             INT           NULL,
    detection_method    ENUM('keyword','semantic') NOT NULL,
    matched_pattern     VARCHAR(200)  NULL,
    severity            ENUM('low','medium','high','critical') NOT NULL,
    similarity_score    DECIMAL(5,4)  NULL,
    suggested_revision  TEXT          NULL,
    status              ENUM('open','accepted','mitigated') NOT NULL DEFAULT 'open',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_risk_finding PRIMARY KEY (finding_id),
    CONSTRAINT fk_finding_clause FOREIGN KEY (clause_id)
        REFERENCES clause(clause_id) ON DELETE CASCADE,
    CONSTRAINT fk_finding_rule FOREIGN KEY (rule_id)
        REFERENCES risk_rule(rule_id) ON DELETE SET NULL,
    CONSTRAINT chk_finding_score CHECK (similarity_score IS NULL OR similarity_score BETWEEN 0 AND 1),
    CONSTRAINT chk_finding_semantic CHECK (detection_method <> 'semantic' OR similarity_score IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 7. contract_review : a lawyer/admin decision on a contract
-- ---------------------------------------------------------------------
CREATE TABLE contract_review (
    review_id     CHAR(36)     NOT NULL,
    contract_id   CHAR(36)     NOT NULL,
    reviewer_id   CHAR(36)     NOT NULL,
    decision      ENUM('approve','reject','request_changes') NOT NULL,
    comments      VARCHAR(1000) NULL,
    reviewed_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_contract_review PRIMARY KEY (review_id),
    CONSTRAINT fk_review_contract FOREIGN KEY (contract_id)
        REFERENCES contract(contract_id) ON DELETE CASCADE,
    CONSTRAINT fk_review_user FOREIGN KEY (reviewer_id)
        REFERENCES app_user(user_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 8. retrieval_query : every search a user runs
-- ---------------------------------------------------------------------
CREATE TABLE retrieval_query (
    query_id     CHAR(36)     NOT NULL,
    user_id      CHAR(36)     NOT NULL,
    query_text   VARCHAR(500) NOT NULL,
    search_mode  ENUM('keyword','semantic') NOT NULL,
    filter_type  VARCHAR(40)  NULL,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_retrieval_query PRIMARY KEY (query_id),
    CONSTRAINT fk_query_user FOREIGN KEY (user_id)
        REFERENCES app_user(user_id) ON DELETE CASCADE,
    CONSTRAINT chk_query_text CHECK (CHAR_LENGTH(TRIM(query_text)) > 0)
);

-- ---------------------------------------------------------------------
-- 9. query_result : M:N between retrieval_query and clause
-- ---------------------------------------------------------------------
CREATE TABLE query_result (
    query_id          CHAR(36)     NOT NULL,
    clause_id         CHAR(36)     NOT NULL,
    similarity_score  DECIMAL(6,4) NULL,
    result_rank       INT          NOT NULL,
    CONSTRAINT pk_query_result PRIMARY KEY (query_id, clause_id),
    CONSTRAINT fk_result_query FOREIGN KEY (query_id)
        REFERENCES retrieval_query(query_id) ON DELETE CASCADE,
    CONSTRAINT fk_result_clause FOREIGN KEY (clause_id)
        REFERENCES clause(clause_id) ON DELETE CASCADE,
    CONSTRAINT chk_result_rank CHECK (result_rank > 0)
);

-- ---------------------------------------------------------------------
-- 10. audit_log : written only by triggers
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    log_id      BIGINT       NOT NULL AUTO_INCREMENT,
    table_name  VARCHAR(50)  NOT NULL,
    record_id   CHAR(36)     NOT NULL,
    action      ENUM('INSERT','UPDATE','DELETE') NOT NULL,
    old_value   VARCHAR(255) NULL,
    new_value   VARCHAR(255) NULL,
    changed_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_audit_log PRIMARY KEY (log_id)
);

-- ---------------------------------------------------------------------
-- Indexes (beyond PK / UNIQUE / FK indexes created automatically)
-- ---------------------------------------------------------------------
CREATE INDEX idx_contract_status_created ON contract (status, created_at);
CREATE INDEX idx_clause_contract_type    ON clause (contract_id, clause_type);
CREATE INDEX idx_finding_severity_status ON risk_finding (severity, status);
CREATE FULLTEXT INDEX ftx_clause_content ON clause (content);
