// Owner: Varun (clauses, findings, re-analysis, delete) and
//        Saharsh (review form: stored procedure + trigger rules).
// Reads and every change are embedded SQL in this file.
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { mysqlPool, pgPool, dbErrorMessage, type Row, type Result } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { Badge, Notice, RiskScore } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string; risky?: string }> };

export default async function ContractDetailPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const { error, msg, risky } = await searchParams;
  const canReview = user.role === 'admin' || user.role === 'lawyer';
  const here = `/contracts/${id}`;

  // ------------------------------------------------------------------ reads
  const [[contract]] = await mysqlPool.query<Row[]>(
    `SELECT c.contract_id, c.title, c.counterparty, c.contract_type, c.status, c.risk_score,
            c.effective_date, c.expiry_date, c.contract_value,
            s.open_critical, s.open_high, s.open_medium, s.open_low, s.uploaded_by_name
       FROM contract c
       JOIN v_contract_risk_summary s ON s.contract_id = c.contract_id
      WHERE c.contract_id = ?`,
    [id],
  );
  if (!contract) notFound();

  const [clauses] = await mysqlPool.query<Row[]>(
    `SELECT clause_id, clause_no, clause_type, content
       FROM clause
      WHERE contract_id = ?
      ORDER BY clause_no`,
    [id],
  );

  const [findings] = await mysqlPool.query<Row[]>(
    `SELECT rf.finding_id, rf.clause_id, rf.severity, rf.detection_method, rf.matched_pattern,
            rf.similarity_score, rf.suggested_revision, rf.status, rr.rule_name
       FROM risk_finding rf
       JOIN clause cl       ON cl.clause_id = rf.clause_id
       LEFT JOIN risk_rule rr ON rr.rule_id = rf.rule_id
      WHERE cl.contract_id = ?
      ORDER BY FIELD(rf.severity,'critical','high','medium','low')`,
    [id],
  );

  const [reviews] = await mysqlPool.query<Row[]>(
    `SELECT r.review_id, r.decision, r.comments, r.reviewed_at, u.full_name AS reviewer_name
       FROM contract_review r
       JOIN app_user u ON u.user_id = r.reviewer_id
      WHERE r.contract_id = ?
      ORDER BY r.reviewed_at DESC`,
    [id],
  );

  // ---------------------------------------------------------------- actions
  async function submitReview(formData: FormData) {
    'use server';
    const me = await requireUser();
    let message: string | null = null;
    try {
      // The procedure checks the role and runs INSERT + UPDATE in one transaction.
      // trg_block_approval refuses approval while critical findings are open.
      await mysqlPool.query('CALL sp_submit_review(?, ?, ?, ?, ?)', [
        randomUUID(), id, me.userId, String(formData.get('decision')), String(formData.get('comments') ?? '') || null,
      ]);
    } catch (err) {
      message = dbErrorMessage(err);
    }
    redirect(here + (message ? '?error=' + encodeURIComponent(message) : '?msg=Review%20saved'));
  }

  async function setFindingStatus(formData: FormData) {
    'use server';
    const me = await requireUser();
    if (me.role === 'reviewer') redirect(here + '?error=' + encodeURIComponent('Only lawyers and admins can change findings'));
    // trg_finding_status_change logs this and refreshes the contract's risk score
    await mysqlPool.query<Result>(
      `UPDATE risk_finding rf
         JOIN clause cl ON cl.clause_id = rf.clause_id
          SET rf.status = ?
        WHERE rf.finding_id = ? AND cl.contract_id = ?`,
      [String(formData.get('status')), String(formData.get('finding_id')), id],
    );
    redirect(here + '?msg=' + encodeURIComponent(`Finding marked ${formData.get('status')}`));
  }

  async function reanalyze() {
    'use server';
    const me = await requireUser();
    if (me.role === 'reviewer') redirect(here + '?error=' + encodeURIComponent('Only lawyers and admins can re-run analysis'));

    // keyword rules (stored procedure with a cursor)
    await mysqlPool.query('CALL sp_run_keyword_rules(?)', [id]);

    // semantic rules (pgvector): 2 nearest risk patterns per clause above the threshold
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
      [id, threshold],
    );
    let added = 0;
    for (const m of matches.rows) {
      // only add a semantic finding that is not already recorded for this clause
      const [res] = await mysqlPool.query<Result>(
        `INSERT INTO risk_finding (finding_id, clause_id, detection_method, matched_pattern,
                                   severity, similarity_score, suggested_revision)
         SELECT ?, ?, 'semantic', ?, ?, ?, ? FROM DUAL
          WHERE NOT EXISTS (SELECT 1 FROM risk_finding
                             WHERE clause_id = ? AND detection_method = 'semantic' AND matched_pattern = ?)`,
        [randomUUID(), m.clause_id, m.title, m.severity, Number(m.similarity), m.suggested_revision, m.clause_id, m.title],
      );
      added += res.affectedRows;
    }
    await mysqlPool.query('UPDATE contract SET risk_score = fn_contract_risk_score(contract_id) WHERE contract_id = ?', [id]);
    redirect(here + '?msg=' + encodeURIComponent(`Analysis finished (threshold ${threshold}); ${added} new semantic findings`));
  }

  async function deleteContract() {
    'use server';
    const me = await requireUser();
    if (me.role !== 'admin') redirect(here + '?error=' + encodeURIComponent('Only admins can delete contracts'));
    // ON DELETE CASCADE removes clauses, embeddings metadata, findings, reviews;
    // trg_contract_audit_delete logs it. Then remove the vectors in PostgreSQL.
    await mysqlPool.query('DELETE FROM contract WHERE contract_id = ?', [id]);
    await pgPool.query('DELETE FROM clause_vector WHERE contract_id = $1', [id]);
    redirect('/contracts');
  }

  // ----------------------------------------------------------------- render
  const findingsByClause = new Map<string, Row[]>();
  for (const f of findings) findingsByClause.set(f.clause_id, [...(findingsByClause.get(f.clause_id) ?? []), f]);
  const shown = risky ? clauses.filter((c) => findingsByClause.has(c.clause_id)) : clauses;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{contract.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {contract.counterparty} · {contract.contract_type} · uploaded by {contract.uploaded_by_name}
            {contract.effective_date && ` · ${contract.effective_date} → ${contract.expiry_date ?? 'open-ended'}`}
            {contract.contract_value != null && ` · ₹${Number(contract.contract_value).toLocaleString('en-IN')}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge value={contract.status} kind="status" />
          <div className="text-right">
            <div className="text-xs uppercase text-slate-500">Risk score</div>
            <div className="text-2xl"><RiskScore score={contract.risk_score} /></div>
          </div>
        </div>
      </div>

      <Notice error={error} msg={msg} />

      <div className="card flex flex-wrap items-center gap-4">
        <span className="text-sm">Open findings:</span>
        <span className="flex items-center gap-2 text-sm">
          <Badge value="critical" /> {contract.open_critical}
          <Badge value="high" /> {contract.open_high}
          <Badge value="medium" /> {contract.open_medium}
          <Badge value="low" /> {contract.open_low}
        </span>
        <a className="ml-auto text-sm text-indigo-700 hover:underline" href={risky ? here : `${here}?risky=1`}>
          {risky ? 'Show all clauses' : 'Only risky clauses'}
        </a>
        {canReview && (
          <form action={reanalyze}><SubmitButton className="btn-ghost" pending="Analysing…">Re-run analysis</SubmitButton></form>
        )}
        {user.role === 'admin' && (
          <form action={deleteContract} className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1"><input type="checkbox" required /> confirm</label>
            <SubmitButton className="btn-ghost text-red-700" pending="Deleting…">Delete</SubmitButton>
          </form>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {shown.map((cl) => {
            const list = findingsByClause.get(cl.clause_id) ?? [];
            return (
              <div key={cl.clause_id} className={`card ${list.some((f) => f.status === 'open') ? 'border-l-4 border-l-red-400' : ''}`}>
                <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">Clause {cl.clause_no}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{String(cl.clause_type).replace('_', ' ')}</span>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed">{cl.content}</p>
                {list.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {list.map((f) => (
                      <div key={f.finding_id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge value={f.severity} />
                          <span className="font-medium">{f.rule_name ?? f.matched_pattern}</span>
                          <span className="text-xs text-slate-500">
                            {f.detection_method === 'semantic'
                              ? `semantic match · similarity ${Number(f.similarity_score).toFixed(2)}`
                              : 'keyword rule'}
                          </span>
                          <span className="ml-auto"><Badge value={f.status} kind="status" /></span>
                        </div>
                        {f.suggested_revision && <p className="mt-2 text-slate-600"><span className="font-medium">Suggested:</span> {f.suggested_revision}</p>}
                        {canReview && (
                          <div className="mt-2 flex gap-2">
                            {['mitigated', 'accepted', 'open'].filter((s) => s !== f.status).map((s) => (
                              <form key={s} action={setFindingStatus}>
                                <input type="hidden" name="finding_id" value={f.finding_id} />
                                <input type="hidden" name="status" value={s} />
                                <button className="btn-ghost text-xs">
                                  {s === 'mitigated' ? 'Mark mitigated' : s === 'accepted' ? 'Accept risk' : 'Re-open'}
                                </button>
                              </form>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          {canReview ? (
            <form action={submitReview} className="card space-y-3">
              <h2 className="font-semibold">Review decision</h2>
              <select name="decision" className="input" defaultValue="approve">
                <option value="approve">Approve</option>
                <option value="request_changes">Request changes</option>
                <option value="reject">Reject</option>
              </select>
              <textarea name="comments" className="input h-24" placeholder="Comments" />
              <SubmitButton className="btn w-full" pending="Saving…">Submit review</SubmitButton>
              <p className="text-xs text-slate-500">Approval is blocked by the database while critical findings are open.</p>
            </form>
          ) : (
            <div className="card text-sm text-slate-500">Only lawyers and admins can review contracts.</div>
          )}
          <div className="card">
            <h2 className="mb-2 font-semibold">Review history</h2>
            {reviews.length === 0 && <p className="text-sm text-slate-500">No reviews yet.</p>}
            <ul className="space-y-3 text-sm">
              {reviews.map((r) => (
                <li key={r.review_id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.reviewer_name}</span>
                    <span className="text-slate-500">{String(r.decision).replace('_', ' ')}</span>
                  </div>
                  <div className="text-xs text-slate-400">{r.reviewed_at}</div>
                  {r.comments && <p className="mt-1 text-slate-600">{r.comments}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
