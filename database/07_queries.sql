-- =====================================================================
-- 07_queries.sql  |  Owner: Saharsh
-- DML + query demos for req. 6 and 7. Run AFTER uploading 2-3 sample
-- contracts through the app, so there is data to show.
-- Screenshot each result for the report.
-- =====================================================================
USE contract_analysis;

-- ---------- INSERT ----------------------------------------------------
INSERT INTO risk_rule (rule_name, keyword_pattern, severity, description, suggested_revision)
VALUES ('Assignment without consent', 'assign this agreement.{0,40}without (the )?(prior )?consent',
        'medium', 'Contract can be transferred to an unknown party.',
        'Require prior written consent, not unreasonably withheld.');

-- ---------- UPDATE ----------------------------------------------------
UPDATE risk_rule
   SET severity = 'high'
 WHERE rule_name = 'Assignment without consent';

-- ---------- DELETE ----------------------------------------------------
DELETE FROM risk_rule
 WHERE rule_name = 'Assignment without consent';

-- ---------- SELECT with JOIN (3 tables) -------------------------------
SELECT c.title, cl.clause_no, cl.clause_type, rf.severity, rf.detection_method, rf.matched_pattern
  FROM contract c
  JOIN clause cl       ON cl.contract_id = c.contract_id
  JOIN risk_finding rf ON rf.clause_id   = cl.clause_id
 ORDER BY c.title, cl.clause_no;

-- ---------- Aggregates + GROUP BY + HAVING ----------------------------
-- Contracts with more than 2 high-or-critical findings
SELECT c.title, COUNT(*) AS serious_findings
  FROM contract c
  JOIN clause cl       ON cl.contract_id = c.contract_id
  JOIN risk_finding rf ON rf.clause_id   = cl.clause_id
 WHERE rf.severity IN ('high','critical')
 GROUP BY c.contract_id, c.title
HAVING COUNT(*) > 2
 ORDER BY serious_findings DESC;

-- Findings per clause type with average semantic similarity
SELECT cl.clause_type,
       COUNT(rf.finding_id)              AS findings,
       ROUND(AVG(rf.similarity_score),3) AS avg_similarity,
       MAX(rf.similarity_score)          AS max_similarity
  FROM clause cl
  LEFT JOIN risk_finding rf ON rf.clause_id = cl.clause_id
 GROUP BY cl.clause_type
 ORDER BY findings DESC;

-- ---------- Subqueries ------------------------------------------------
-- Contracts riskier than the average contract (scalar subquery)
SELECT title, risk_score
  FROM contract
 WHERE risk_score > (SELECT AVG(risk_score) FROM contract)
 ORDER BY risk_score DESC;

-- Clauses that have NO findings at all (NOT EXISTS)
SELECT c.title, cl.clause_no, cl.clause_type
  FROM clause cl
  JOIN contract c ON c.contract_id = cl.contract_id
 WHERE NOT EXISTS (SELECT 1 FROM risk_finding rf WHERE rf.clause_id = cl.clause_id);

-- Correlated subquery: each contract's most severe open finding
SELECT c.title,
       (SELECT rf.severity
          FROM risk_finding rf
          JOIN clause cl ON cl.clause_id = rf.clause_id
         WHERE cl.contract_id = c.contract_id AND rf.status = 'open'
         ORDER BY FIELD(rf.severity,'critical','high','medium','low')
         LIMIT 1) AS worst_open_severity
  FROM contract c;

-- Users who uploaded a contract but never searched (IN / NOT IN)
SELECT full_name, role
  FROM app_user
 WHERE user_id IN (SELECT uploaded_by FROM contract)
   AND user_id NOT IN (SELECT user_id FROM retrieval_query);

-- ---------- Views -----------------------------------------------------
SELECT * FROM v_contract_risk_summary ORDER BY risk_score DESC;
SELECT * FROM v_reviewer_workload;
SELECT * FROM v_high_risk_clauses;

-- ---------- Function --------------------------------------------------
SELECT title, fn_contract_risk_score(contract_id) AS computed_score, risk_score AS stored_score
  FROM contract;

-- ---------- Full-text search -----------------------------------------
SELECT c.title, cl.clause_no,
       MATCH(cl.content) AGAINST ('terminate notice' IN NATURAL LANGUAGE MODE) AS relevance
  FROM clause cl
  JOIN contract c ON c.contract_id = cl.contract_id
 WHERE MATCH(cl.content) AGAINST ('terminate notice' IN NATURAL LANGUAGE MODE)
 ORDER BY relevance DESC;

-- ---------- Indexing: compare plans ----------------------------------
EXPLAIN SELECT * FROM contract WHERE status = 'under_review' ORDER BY created_at;
EXPLAIN SELECT * FROM clause WHERE contract_id = (SELECT contract_id FROM contract LIMIT 1) AND clause_type = 'termination';
SHOW INDEX FROM clause;

-- ---------- Audit log written by triggers ----------------------------
SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT 20;

-- ---------- Search analytics -----------------------------------------
SELECT q.search_mode, COUNT(*) AS searches, ROUND(AVG(r.similarity_score),3) AS avg_top_score
  FROM retrieval_query q
  LEFT JOIN query_result r ON r.query_id = q.query_id AND r.result_rank = 1
 GROUP BY q.search_mode;
