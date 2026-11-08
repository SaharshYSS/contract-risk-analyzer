-- =====================================================================
-- 04_functions_procedures.sql  |  Owner: Saharsh
-- =====================================================================
USE contract_analysis;

DROP FUNCTION IF EXISTS fn_contract_risk_score;
DROP PROCEDURE IF EXISTS sp_submit_review;
DROP PROCEDURE IF EXISTS sp_run_keyword_rules;

DELIMITER $$

-- ---------------------------------------------------------------------
-- Risk score 0-100 for a contract.
-- Each clause scores the weight of its WORST open finding
-- (none=0, low=10, medium=25, high=50, critical=100). The contract score
-- is the average over all its clauses, so a long contract with one bad
-- clause is not ranked the same as a short contract full of bad clauses.
-- Any open critical finding sets a floor of 60.
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_contract_risk_score(p_contract_id CHAR(36))
RETURNS DECIMAL(5,2)
READS SQL DATA
BEGIN
    DECLARE v_avg DECIMAL(8,2) DEFAULT 0;
    DECLARE v_has_critical INT DEFAULT 0;

    SELECT COALESCE(AVG(worst), 0), COALESCE(MAX(worst = 100), 0)
      INTO v_avg, v_has_critical
      FROM (SELECT cl.clause_id,
                   COALESCE(MAX(CASE rf.severity
                                    WHEN 'low'      THEN 10
                                    WHEN 'medium'   THEN 25
                                    WHEN 'high'     THEN 50
                                    WHEN 'critical' THEN 100
                                END), 0) AS worst
              FROM clause cl
              LEFT JOIN risk_finding rf
                     ON rf.clause_id = cl.clause_id AND rf.status = 'open'
             WHERE cl.contract_id = p_contract_id
             GROUP BY cl.clause_id) per_clause;

    IF v_has_critical = 1 THEN
        RETURN GREATEST(v_avg, 60);
    END IF;
    RETURN LEAST(v_avg, 100);
END$$

-- ---------------------------------------------------------------------
-- Records a review and moves the contract to the matching status,
-- all in ONE transaction. If trg_block_approval refuses the status
-- change, the review insert is rolled back too and the error is re-raised.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_submit_review(
    IN p_review_id   CHAR(36),
    IN p_contract_id CHAR(36),
    IN p_reviewer_id CHAR(36),
    IN p_decision    VARCHAR(20),
    IN p_comments    VARCHAR(2000)
)
BEGIN
    DECLARE v_role VARCHAR(20);
    DECLARE v_new_status VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SELECT role INTO v_role FROM app_user WHERE user_id = p_reviewer_id AND is_active = TRUE;
    IF v_role IS NULL OR v_role NOT IN ('lawyer','admin') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only an active lawyer or admin can review contracts';
    END IF;

    SET v_new_status = CASE p_decision
                           WHEN 'approve'         THEN 'approved'
                           WHEN 'reject'          THEN 'rejected'
                           WHEN 'request_changes' THEN 'under_review'
                       END;
    IF v_new_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Decision must be approve, reject or request_changes';
    END IF;

    START TRANSACTION;
        INSERT INTO contract_review (review_id, contract_id, reviewer_id, decision, comments)
        VALUES (p_review_id, p_contract_id, p_reviewer_id, p_decision, p_comments);

        UPDATE contract
           SET status = v_new_status
         WHERE contract_id = p_contract_id;
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- Runs every keyword rule against every clause of one contract and
-- inserts a risk_finding for each match not already recorded.
-- Uses a CURSOR over risk_rule.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_run_keyword_rules(IN p_contract_id CHAR(36))
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_rule_id INT;
    DECLARE v_pattern VARCHAR(255);
    DECLARE v_severity VARCHAR(10);
    DECLARE v_type VARCHAR(40);
    DECLARE v_fix TEXT;
    DECLARE v_name VARCHAR(100);

    DECLARE cur_rules CURSOR FOR
        SELECT rule_id, keyword_pattern, severity, clause_type, suggested_revision, rule_name FROM risk_rule;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    OPEN cur_rules;
    rule_loop: LOOP
        FETCH cur_rules INTO v_rule_id, v_pattern, v_severity, v_type, v_fix, v_name;
        IF v_done = 1 THEN
            LEAVE rule_loop;
        END IF;

        INSERT INTO risk_finding (finding_id, clause_id, rule_id, detection_method,
                                  matched_pattern, severity, suggested_revision)
        SELECT UUID(), cl.clause_id, v_rule_id, 'keyword', v_name, v_severity, v_fix
          FROM clause cl
         WHERE cl.contract_id = p_contract_id
           AND REGEXP_LIKE(cl.content, v_pattern, 'i')
           AND (v_type IS NULL OR cl.clause_type = v_type OR cl.clause_type = 'general')
           AND NOT EXISTS (SELECT 1 FROM risk_finding x
                            WHERE x.clause_id = cl.clause_id AND x.rule_id = v_rule_id);
    END LOOP;
    CLOSE cur_rules;

    UPDATE contract
       SET risk_score = fn_contract_risk_score(p_contract_id)
     WHERE contract_id = p_contract_id;
END$$

DELIMITER ;
