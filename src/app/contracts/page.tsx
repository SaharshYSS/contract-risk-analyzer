// Owner: Varun — contract list. The filter form is a plain GET form; the
// page builds a parameterised SQL query from the URL values.
import Link from 'next/link';
import { mysqlPool, type Row } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { Badge, RiskScore } from '@/components/ui';

type Filters = { q?: string; status?: string; type?: string; minRisk?: string; sort?: string };

// ORDER BY cannot use a ? placeholder, so only these fixed strings are allowed
const SORTS: Record<string, string> = {
  newest: 'created_at DESC',
  risk: 'risk_score DESC',
  title: 'title ASC',
};

export default async function ContractsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireUser();
  const f = await searchParams;

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  if (f.type) { where.push('contract_type = ?'); params.push(f.type); }
  if (f.minRisk) { where.push('risk_score >= ?'); params.push(Number(f.minRisk)); }
  if (f.q) { where.push('(title LIKE ? OR counterparty LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const orderBy = SORTS[f.sort ?? 'newest'] ?? SORTS.newest;

  const [contracts] = await mysqlPool.query<Row[]>(
    `SELECT contract_id, title, counterparty, contract_type, status, risk_score,
            clause_count, open_critical, open_high, uploaded_by_name
       FROM v_contract_risk_summary
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy}`,
    params,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contracts</h1>
        <Link href="/contracts/new" className="btn">Upload contract</Link>
      </div>

      <form method="get" className="card grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label">Title or counterparty</label>
          <input name="q" className="input" defaultValue={f.q} placeholder="e.g. CloudNest" />
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" className="input" defaultValue={f.status ?? ''}>
            <option value="">All</option>
            <option value="uploaded">Uploaded</option>
            <option value="under_review">Under review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <select name="type" className="input" defaultValue={f.type ?? ''}>
            <option value="">All</option>
            {['nda', 'service', 'employment', 'lease', 'saas', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Min risk</label>
            <input name="minRisk" className="input" type="number" min={0} max={100} defaultValue={f.minRisk} />
          </div>
          <div>
            <label className="label">Sort</label>
            <select name="sort" className="input" defaultValue={f.sort ?? 'newest'}>
              <option value="newest">Newest</option>
              <option value="risk">Risk</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <button className="btn">Filter</button>
          <Link href="/contracts" className="btn-ghost">Clear</Link>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>Title</th><th>Counterparty</th><th>Type</th><th>Status</th><th>Clauses</th><th>Crit / High</th><th>Risk</th><th>Uploaded by</th></tr>
          </thead>
          <tbody>
            {contracts.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">No contracts match these filters.</td></tr>
            )}
            {contracts.map((c) => (
              <tr key={c.contract_id} className="hover:bg-slate-50">
                <td><Link href={`/contracts/${c.contract_id}`} className="font-medium text-indigo-700 hover:underline">{c.title}</Link></td>
                <td>{c.counterparty}</td>
                <td>{c.contract_type}</td>
                <td><Badge value={c.status} kind="status" /></td>
                <td className="tabular-nums">{c.clause_count}</td>
                <td className="tabular-nums">{c.open_critical} / {c.open_high}</td>
                <td><RiskScore score={c.risk_score} /></td>
                <td className="text-slate-500">{c.uploaded_by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
