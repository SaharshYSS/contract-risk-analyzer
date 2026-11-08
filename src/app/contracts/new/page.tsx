// Owner: Varun — upload a contract.
// The server action below:
//   1. splits the text into clauses and embeds each clause (384 numbers)
//   2. writes MySQL (contract, clause, clause_embedding) and PostgreSQL
//      (clause_vector) inside one transaction on EACH database; if anything
//      fails, BOTH are rolled back, so the two databases never disagree
//   3. runs risk detection: keyword rules (MySQL stored procedure) and
//      semantic rules (pgvector cosine similarity), then saves the findings
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import type { PoolClient } from 'pg';
import { mysqlPool, pgPool, toVector, dbErrorMessage, type Row } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { embedMany, EMBEDDING_MODEL } from '@/lib/embed';
import { splitIntoClauses } from '@/lib/clauseSplitter';
import { Notice } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;

  async function upload(formData: FormData) {
    'use server';
    const user = await requireUser();

    const file = formData.get('file');
    const pasted = String(formData.get('text') ?? '');
    const text = file instanceof File && file.size > 0 ? await file.text() : pasted;
    const title = String(formData.get('title') ?? '').trim();
    const counterparty = String(formData.get('counterparty') ?? '').trim();
    const contractType = String(formData.get('contract_type') ?? 'other');
    const effectiveDate = String(formData.get('effective_date') ?? '') || null;
    const expiryDate = String(formData.get('expiry_date') ?? '') || null;
    const valueText = String(formData.get('contract_value') ?? '');
    const contractValue = valueText === '' ? null : Number(valueText);

    if (text.trim().length < 100) {
      redirect('/contracts/new?error=' + encodeURIComponent('Paste the contract text or choose a .txt file (at least 100 characters)'));
    }
    const clauses = splitIntoClauses(text);
    if (clauses.length === 0) redirect('/contracts/new?error=' + encodeURIComponent('Could not find any clauses in the text'));

    // Embedding is slow, so do it before opening the transactions
    const vectors = await embedMany(clauses.map((c) => c.content));

    const contractId = randomUUID();
    const clauseIds = clauses.map(() => randomUUID());
    let message: string | null = null;
    let my: PoolConnection | null = null;
    let pg: PoolClient | null = null;

    try {
      my = await mysqlPool.getConnection();
      pg = await pgPool.connect();
      await my.beginTransaction();
      await pg.query('BEGIN');

      // ---- MySQL (title length, dates, value are validated by CHECK constraints)
      await my.query(
        `INSERT INTO contract (contract_id, uploaded_by, title, counterparty, contract_type,
                               effective_date, expiry_date, contract_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [contractId, user.userId, title, counterparty, contractType, effectiveDate, expiryDate, contractValue],
      );
      await my.query(
        `INSERT INTO clause (clause_id, contract_id, clause_no, clause_type, content) VALUES ?`,
        [clauses.map((c, i) => [clauseIds[i], contractId, c.clause_no, c.clause_type, c.content])],
      );
      await my.query(
        `INSERT INTO clause_embedding (clause_id, vector_store, model_name, dimension) VALUES ?`,
        [clauseIds.map((id) => [id, 'pgvector', EMBEDDING_MODEL, 384])],
      );

      // ---- PostgreSQL / pgvector
      for (let i = 0; i < clauses.length; i++) {
        await pg.query(
          `INSERT INTO clause_vector (clause_id, contract_id, clause_no, clause_type, model_name, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          [clauseIds[i], contractId, clauses[i].clause_no, clauses[i].clause_type, EMBEDDING_MODEL, toVector(vectors[i])],
        );
      }

      await pg.query('COMMIT');
      try {
        await my.commit();
      } catch (commitErr) {
        // MySQL failed after PostgreSQL committed: undo the vectors by hand
        await pgPool.query('DELETE FROM clause_vector WHERE contract_id = $1', [contractId]);
        throw commitErr;
      }
    } catch (err) {
      await my?.rollback().catch(() => {});
      await pg?.query('ROLLBACK').catch(() => {});
      message = dbErrorMessage(err);
    } finally {
      my?.release();
      pg?.release();
    }
    if (message) redirect('/contracts/new?error=' + encodeURIComponent(message));

    // ---- Risk detection --------------------------------------------------
    // (a) keyword rules: stored procedure loops over risk_rule with a cursor
    await mysqlPool.query('CALL sp_run_keyword_rules(?)', [contractId]);

    // (b) semantic rules: for every clause, the 2 closest risk patterns
    //     (cosine distance <=>) that are above the similarity threshold
    const threshold = Number(process.env.RISK_SIMILARITY_THRESHOLD ?? 0.6);
    const matches = await pgPool.query<{ clause_id: string; title: string; severity: string; suggested_revision: string; similarity: string }>(
      `SELECT cv.clause_id, rp.title, rp.severity, rp.suggested_revision,
              ROUND((1 - (cv.embedding <=> rp.embedding))::numeric, 4) AS similarity
         FROM clause_vector cv
         CROSS JOIN LATERAL (
               SELECT p.title, p.severity, p.suggested_revision, p.embedding
                 FROM risk_pattern_vector p
                ORDER BY cv.embedding <=> p.embedding
                LIMIT 2) rp
        WHERE cv.contract_id = $1
          AND 1 - (cv.embedding <=> rp.embedding) >= $2`,
      [contractId, threshold],
    );
    for (const m of matches.rows) {
      await mysqlPool.query(
        `INSERT INTO risk_finding (finding_id, clause_id, detection_method, matched_pattern,
                                   severity, similarity_score, suggested_revision)
         VALUES (?, ?, 'semantic', ?, ?, ?, ?)`,
        [randomUUID(), m.clause_id, m.title, m.severity, Number(m.similarity), m.suggested_revision],
      );
    }

    // (c) store the score computed by the SQL function
    await mysqlPool.query(
      'UPDATE contract SET risk_score = fn_contract_risk_score(contract_id) WHERE contract_id = ?',
      [contractId],
    );

    const [[summary]] = await mysqlPool.query<Row[]>(
      'SELECT finding_count FROM v_contract_risk_summary WHERE contract_id = ?',
      [contractId],
    );
    redirect(`/contracts/${contractId}?msg=` +
      encodeURIComponent(`Uploaded ${clauses.length} clauses; ${summary.finding_count} risk findings detected.`));
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Upload contract</h1>
      <Notice error={error} />
      <form action={upload} className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Title</label>
            <input name="title" className="input" required />
          </div>
          <div>
            <label className="label">Counterparty</label>
            <input name="counterparty" className="input" required />
          </div>
          <div>
            <label className="label">Type</label>
            <select name="contract_type" className="input" defaultValue="service">
              {['nda', 'service', 'employment', 'lease', 'saas', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Contract value (₹)</label>
            <input name="contract_value" className="input" type="number" min={0} step="0.01" />
          </div>
          <div>
            <label className="label">Effective date</label>
            <input name="effective_date" className="input" type="date" />
          </div>
          <div>
            <label className="label">Expiry date</label>
            <input name="expiry_date" className="input" type="date" />
          </div>
        </div>
        <div>
          <label className="label">Contract file (.txt)</label>
          <input name="file" type="file" accept=".txt,text/plain" className="input" />
        </div>
        <div>
          <label className="label">…or paste the contract text</label>
          <textarea name="text" className="input h-64 font-mono text-xs"
            placeholder="Numbered clauses (1., 2., Clause 3 …) are split automatically." />
        </div>
        <SubmitButton pending="Splitting, embedding and analysing… (first run downloads the model)">Upload and analyse</SubmitButton>
      </form>
    </div>
  );
}
