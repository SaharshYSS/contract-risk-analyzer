// Small display components (no SQL, no data fetching).

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-200',
  high: 'bg-orange-100 text-orange-800 ring-orange-200',
  medium: 'bg-amber-100 text-amber-800 ring-amber-200',
  low: 'bg-sky-100 text-sky-800 ring-sky-200',
};

const STATUS_STYLES: Record<string, string> = {
  uploaded: 'bg-slate-100 text-slate-700 ring-slate-200',
  under_review: 'bg-amber-100 text-amber-800 ring-amber-200',
  approved: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  rejected: 'bg-red-100 text-red-800 ring-red-200',
  open: 'bg-red-50 text-red-700 ring-red-200',
  accepted: 'bg-slate-100 text-slate-700 ring-slate-200',
  mitigated: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
};

export function Badge({ value, kind = 'severity' }: { value: string; kind?: 'severity' | 'status' }) {
  const styles = (kind === 'severity' ? SEVERITY_STYLES : STATUS_STYLES)[value] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>
      {value.replace('_', ' ')}
    </span>
  );
}

export function RiskScore({ score }: { score: number }) {
  const color = score >= 40 ? 'text-red-600' : score >= 15 ? 'text-amber-600' : 'text-emerald-600';
  return <span className={`font-semibold tabular-nums ${color}`}>{Number(score).toFixed(0)}</span>;
}

/** Shows ?error= and ?msg= messages that server actions pass back through the URL. */
export function Notice({ error, msg }: { error?: string; msg?: string }) {
  return (
    <>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{msg}</div>}
    </>
  );
}
