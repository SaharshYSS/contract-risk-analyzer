// Owner: Saharsh — dashboard. All numbers come from SQL written below
// (MySQL views + aggregates, and one pgvector view).
import Link from 'next/link';
import { mysqlPool, pgPool, type Row } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { Badge, RiskScore } from '@/components/ui';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? 0}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();

  // ---- MySQL -------------------------------------------------------------
  const [[totals]] = await mysqlPool.query<Row[]>(
    `SELECT COUNT(*)                              AS contracts,
            COALESCE(SUM(status = 'under_review'),0) AS under_review,
            COALESCE(SUM(status = 'approved'),0)     AS approved,
            COALESCE(SUM(status = 'rejected'),0)     AS rejected,
            COALESCE(ROUND(AVG(risk_score),1),0)     AS avg_risk
       FROM contract`,
  );

  const [bySeverity] = await mysqlPool.query<Row[]>(
    `SELECT severity, COUNT(*) AS open_findings
       FROM risk_finding
      WHERE status = 'open'
      GROUP BY severity
      ORDER BY FIELD(severity,'critical','high','medium','low')`,
  );

  const [byMethod] = await mysqlPool.query<Row[]>(
    `SELECT detection_method, COUNT(*) AS findings
       FROM risk_finding
      GROUP BY detection_method`,
  );

  const [topRisky] = await mysqlPool.query<Row[]>(
    `SELECT contract_id, title, status, risk_score, open_critical, open_high
       FROM v_contract_risk_summary
      ORDER BY risk_score DESC
      LIMIT 5`,
  );

  const [workload] = await mysqlPool.query<Row[]>(
    `SELECT user_id, full_name, role, total_reviews, approvals, rejections, change_requests
       FROM v_reviewer_workload
      ORDER BY total_reviews DESC`,
  );

  const [[searches]] = await mysqlPool.query<Row[]>(
    `SELECT COUNT(*)                                    AS total,
            COALESCE(SUM(search_mode = 'semantic'),0)   AS semantic,
            COALESCE(SUM(search_mode = 'keyword'),0)    AS keyword
       FROM retrieval_query`,
  );

  let audit: Row[] = [];
  if (user.role === 'admin') {
    [audit] = await mysqlPool.query<Row[]>(
      `SELECT log_id, table_name, action, old_value, new_value, changed_at
         FROM audit_log
        ORDER BY log_id DESC
        LIMIT 15`,
    );
  }

  // ---- PostgreSQL / pgvector -------------------------------------------
  const vectorStats = await pgPool.query<{ clause_type: string; vectors: string; contracts: string }>(
    `SELECT clause_type, vectors, contracts
       FROM v_vector_stats
      ORDER BY vectors DESC`,
  );
  const totalVectors = vectorStats.rows.reduce((sum, r) => sum + Number(r.vectors), 0);

  const maxSeverity = Math.max(1, ...bySeverity.map((s) => s.open_findings));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Contracts" value={totals.contracts} />
        <Stat label="Under review" value={totals.under_review} />
        <Stat label="Approved" value={totals.approved} />
        <Stat label="Rejected" value={totals.rejected} />
        <Stat label="Avg risk score" value={totals.avg_risk} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Open findings by severity</h2>
          {bySeverity.length === 0 && <p className="text-sm text-slate-500">No open findings.</p>}
          <div className="space-y-2">
            {bySeverity.map((s) => (
              <div key={s.severity} className="flex items-center gap-3">
                <div className="w-20"><Badge value={s.severity} /></div>
                <div className="h-3 flex-1 rounded bg-slate-100">
                  <div className="h-3 rounded bg-indigo-500" style={{ width: `${(s.open_findings / maxSeverity) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-sm tabular-nums">{s.open_findings}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Detected by: {byMethod.map((m) => `${m.detection_method} ${m.findings}`).join(' · ') || '—'} ·
            Searches: {searches.total} ({searches.semantic} semantic, {searches.keyword} keyword)
          </p>
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold">Highest-risk contracts</h2>
          <table className="table">
            <thead><tr><th>Contract</th><th>Status</th><th>Crit/High</th><th>Risk</th></tr></thead>
            <tbody>
              {topRisky.map((c) => (
                <tr key={c.contract_id}>
                  <td><Link className="text-indigo-700 hover:underline" href={`/contracts/${c.contract_id}`}>{c.title}</Link></td>
                  <td><Badge value={c.status} kind="status" /></td>
                  <td className="tabular-nums">{c.open_critical} / {c.open_high}</td>
                  <td><RiskScore score={c.risk_score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Reviewer workload</h2>
          {workload.length === 0 ? (
            <p className="text-sm text-slate-500">No reviews yet.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Reviews</th><th>Approved</th><th>Rejected</th><th>Changes</th></tr></thead>
              <tbody>
                {workload.map((w) => (
                  <tr key={w.user_id}>
                    <td>{w.full_name}</td><td>{w.role}</td><td>{w.total_reviews}</td>
                    <td>{w.approvals}</td><td>{w.rejections}</td><td>{w.change_requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Vectors in pgvector <span className="text-sm font-normal text-slate-500">({totalVectors})</span></h2>
          <table className="table">
            <thead><tr><th>Clause type</th><th>Vectors</th><th>Contracts</th></tr></thead>
            <tbody>
              {vectorStats.rows.map((v) => (
                <tr key={v.clause_type}><td>{v.clause_type.replace('_', ' ')}</td><td>{v.vectors}</td><td>{v.contracts}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {audit.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-semibold">Audit log <span className="text-xs font-normal text-slate-500">(written by triggers · admin only)</span></h2>
          <table className="table">
            <thead><tr><th>When</th><th>Table</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.log_id}>
                  <td className="whitespace-nowrap text-slate-500">{a.changed_at}</td>
                  <td>{a.table_name}</td><td>{a.action}</td>
                  <td className="text-slate-500">{a.old_value}</td><td>{a.new_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
