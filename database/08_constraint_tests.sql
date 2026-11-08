-- =====================================================================
-- 08_constraint_tests.sql  |  Owner: Saharsh
-- Each statement below SHOULD FAIL. Run them one at a time in the MySQL
-- client and screenshot the error for the "Testing" section of the report.
-- (Do not run this file through `npm run db:setup`.)
-- =====================================================================
USE contract_analysis;

-- T1: invalid email -> chk_app_user_email
INSERT INTO app_user (user_id, full_name, email, password_hash, role)
VALUES (UUID(), 'Bad Email', 'not-an-email', REPEAT('x', 60), 'reviewer');

-- T2: duplicate email -> uq_app_user_email
INSERT INTO app_user (user_id, full_name, email, password_hash, role)
VALUES (UUID(), 'Dup', 'admin@contracts.local', REPEAT('x', 60), 'reviewer');

-- T3: invalid role -> ENUM rejects it (strict mode)
INSERT INTO app_user (user_id, full_name, email, password_hash, role)
VALUES (UUID(), 'Bad Role', 'x@y.com', REPEAT('x', 60), 'superuser');

-- T4: plain-text password (too short to be a hash) -> chk_app_user_hash
INSERT INTO app_user (user_id, full_name, email, password_hash, role)
VALUES (UUID(), 'Plain Pass', 'plain@y.com', 'password123', 'reviewer');

-- T5: expiry before effective date -> chk_contract_dates
INSERT INTO contract (contract_id, uploaded_by, title, counterparty, effective_date, expiry_date)
VALUES (UUID(), '11111111-1111-4111-8111-111111111111', 'Bad Dates', 'Acme', '2026-12-01', '2026-01-01');

-- T6: negative contract value -> chk_contract_value
INSERT INTO contract (contract_id, uploaded_by, title, counterparty, contract_value)
VALUES (UUID(), '11111111-1111-4111-8111-111111111111', 'Negative', 'Acme', -500);

-- T7: contract uploaded by a user that does not exist -> fk_contract_user
INSERT INTO contract (contract_id, uploaded_by, title, counterparty)
VALUES (UUID(), '99999999-9999-4999-8999-999999999999', 'Orphan', 'Acme');

-- T8: similarity score above 1 -> chk_finding_score
INSERT INTO risk_finding (finding_id, clause_id, detection_method, severity, similarity_score)
SELECT UUID(), clause_id, 'semantic', 'low', 1.5 FROM clause LIMIT 1;

-- T9: semantic finding without a score -> chk_finding_semantic
INSERT INTO risk_finding (finding_id, clause_id, detection_method, severity)
SELECT UUID(), clause_id, 'semantic', 'low' FROM clause LIMIT 1;

-- T10: deleting a user who still owns contracts -> ON DELETE RESTRICT
DELETE FROM app_user WHERE user_id = (SELECT uploaded_by FROM (SELECT uploaded_by FROM contract LIMIT 1) t);

-- T11: approving a contract with an open critical finding -> trg_block_approval
--      (needs a contract that currently has an OPEN critical finding, e.g. a fresh CloudNest upload)
UPDATE contract c
   SET c.status = 'approved'
 WHERE c.contract_id = (SELECT contract_id FROM v_contract_risk_summary WHERE open_critical > 0 LIMIT 1);

-- T12: a reviewer (not lawyer/admin) tries to review -> sp_submit_review raises error
CALL sp_submit_review(UUID(), (SELECT contract_id FROM contract LIMIT 1),
                      '33333333-3333-4333-8333-333333333333', 'approve', 'trying');
