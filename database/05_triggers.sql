-- =====================================================================
-- 05_triggers.sql  |  Owner: Saharsh
-- =====================================================================
USE contract_analysis;

DROP TRIGGER IF EXISTS trg_finding_critical;
DROP TRIGGER IF EXISTS trg_block_approval;
DROP TRIGGER IF EXISTS trg_contract_audit_insert;
DROP TRIGGER IF EXISTS trg_contract_audit_update;
DROP TRIGGER IF EXISTS trg_finding_status_change;
DROP TRIGGER IF EXISTS trg_contract_audit_delete;

DELIMITER $$

-- 1) A new CRITICAL finding pushes its contract into review automatically.
CREATE TRIGGER trg_finding_critical
AFTER INSERT ON risk_finding
FOR EACH ROW
BEGIN
    IF NEW.severity = 'critical' THEN
        UPDATE contract c
          JOIN clause cl ON cl.contract_id = c.contract_id
           SET c.status = 'under_review'
         WHERE cl.clause_id = NEW.clause_id
           AND c.status = 'uploaded';
    END IF;
END$$

-- 2) Business rule enforced in the database: a contract cannot be
--    approved while any of its critical findings is still open.
CREATE TRIGGER trg_block_approval
BEFORE UPDATE ON contract
FOR EACH ROW
BEGIN
    IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
        IF EXISTS (SELECT 1
                     FROM risk_finding rf
                     JOIN clause cl ON cl.clause_id = rf.clause_id
                    WHERE cl.contract_id = NEW.contract_id
                      AND rf.severity = 'critical'
                      AND rf.status = 'open') THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cannot approve: contract still has open critical risk findings';
        END IF;
    END IF;
END$$

-- 3) Audit trail for contracts
CREATE TRIGGER trg_contract_audit_insert
AFTER INSERT ON contract
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, record_id, action, old_value, new_value)
    VALUES ('contract', NEW.contract_id, 'INSERT', NULL, CONCAT('status=', NEW.status));
END$$

CREATE TRIGGER trg_contract_audit_update
AFTER UPDATE ON contract
FOR EACH ROW
BEGIN
    IF NOT (OLD.status <=> NEW.status) THEN
        INSERT INTO audit_log (table_name, record_id, action, old_value, new_value)
        VALUES ('contract', NEW.contract_id, 'UPDATE',
                CONCAT('status=', OLD.status), CONCAT('status=', NEW.status));
    END IF;
END$$

CREATE TRIGGER trg_contract_audit_delete
AFTER DELETE ON contract
FOR EACH ROW
BEGIN
    INSERT INTO audit_log (table_name, record_id, action, old_value, new_value)
    VALUES ('contract', OLD.contract_id, 'DELETE', CONCAT('title=', LEFT(OLD.title, 180)), NULL);
END$$

-- 4) When a finding is mitigated/accepted, log it and refresh the
--    contract's risk score so the dashboard is always consistent.
CREATE TRIGGER trg_finding_status_change
AFTER UPDATE ON risk_finding
FOR EACH ROW
BEGIN
    IF NOT (OLD.status <=> NEW.status) THEN
        INSERT INTO audit_log (table_name, record_id, action, old_value, new_value)
        VALUES ('risk_finding', NEW.finding_id, 'UPDATE',
                CONCAT('status=', OLD.status), CONCAT('status=', NEW.status));

        UPDATE contract c
          JOIN clause cl ON cl.contract_id = c.contract_id
           SET c.risk_score = fn_contract_risk_score(c.contract_id)
         WHERE cl.clause_id = NEW.clause_id;
    END IF;
END$$

DELIMITER ;
