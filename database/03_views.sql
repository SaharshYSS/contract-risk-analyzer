-- =====================================================================
-- 03_views.sql  |  Owner: Saharsh
-- =====================================================================
USE contract_analysis;

-- Findings per severity for every contract (used by dashboard + list)
CREATE OR REPLACE VIEW v_contract_risk_summary AS
SELECT  c.contract_id,
        c.title,
        c.counterparty,
        c.contract_type,
        c.status,
        c.risk_score,
        u.full_name                                                AS uploaded_by_name,
        COUNT(DISTINCT cl.clause_id)                               AS clause_count,
        COUNT(rf.finding_id)                                       AS finding_count,
        SUM(CASE WHEN rf.severity = 'critical' AND rf.status = 'open' THEN 1 ELSE 0 END) AS open_critical,
        SUM(CASE WHEN rf.severity = 'high'     AND rf.status = 'open' THEN 1 ELSE 0 END) AS open_high,
        SUM(CASE WHEN rf.severity = 'medium'   AND rf.status = 'open' THEN 1 ELSE 0 END) AS open_medium,
        SUM(CASE WHEN rf.severity = 'low'      AND rf.status = 'open' THEN 1 ELSE 0 END) AS open_low,
        c.created_at
FROM        contract c
JOIN        app_user u      ON u.user_id = c.uploaded_by
LEFT JOIN   clause cl       ON cl.contract_id = c.contract_id
LEFT JOIN   risk_finding rf ON rf.clause_id = cl.clause_id
GROUP BY    c.contract_id, c.title, c.counterparty, c.contract_type, c.status,
            c.risk_score, u.full_name, c.created_at;

-- Reviewers who have done at least one review (GROUP BY + HAVING)
CREATE OR REPLACE VIEW v_reviewer_workload AS
SELECT  u.user_id,
        u.full_name,
        u.role,
        COUNT(r.review_id)                                         AS total_reviews,
        SUM(r.decision = 'approve')                                AS approvals,
        SUM(r.decision = 'reject')                                 AS rejections,
        SUM(r.decision = 'request_changes')                        AS change_requests,
        MAX(r.reviewed_at)                                         AS last_review_at
FROM        app_user u
JOIN        contract_review r ON r.reviewer_id = u.user_id
GROUP BY    u.user_id, u.full_name, u.role
HAVING      COUNT(r.review_id) >= 1;

-- Every open high/critical clause with its contract (3-table JOIN)
CREATE OR REPLACE VIEW v_high_risk_clauses AS
SELECT  rf.finding_id,
        rf.severity,
        rf.detection_method,
        rf.similarity_score,
        rf.matched_pattern,
        cl.clause_id,
        cl.clause_no,
        cl.clause_type,
        LEFT(cl.content, 200)  AS clause_excerpt,
        c.contract_id,
        c.title                AS contract_title
FROM    risk_finding rf
JOIN    clause cl   ON cl.clause_id  = rf.clause_id
JOIN    contract c  ON c.contract_id = cl.contract_id
WHERE   rf.severity IN ('high','critical')
  AND   rf.status = 'open';
