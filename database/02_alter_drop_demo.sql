-- =====================================================================
-- 02_alter_drop_demo.sql  |  Owner: Saharsh
-- Shows ALTER and DROP (req. 5). Run once after 01_schema.sql.
-- =====================================================================
USE contract_analysis;

-- ALTER: add a column the app uses (auto-updated timestamp)
ALTER TABLE contract
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- ALTER: add a column to track logins
ALTER TABLE app_user
    ADD COLUMN last_login_at TIMESTAMP NULL AFTER is_active;

-- ALTER: widen a column
ALTER TABLE contract_review
    MODIFY COLUMN comments VARCHAR(2000) NULL;

-- ALTER: add an index after the fact
ALTER TABLE retrieval_query
    ADD INDEX idx_query_user_time (user_id, created_at);

-- DROP: create a scratch table, then drop it
CREATE TABLE tmp_import_staging (
    id INT PRIMARY KEY,
    raw_text TEXT
);
DROP TABLE tmp_import_staging;

-- DROP an index and re-create it (demonstrates DROP INDEX)
CREATE INDEX idx_review_decision ON contract_review (decision, reviewed_at);
DROP INDEX idx_review_decision ON contract_review;
CREATE INDEX idx_review_decision ON contract_review (decision, reviewed_at);
