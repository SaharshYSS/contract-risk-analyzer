// Owner: Varun — clause search, all embedded SQL:
//   keyword  -> MySQL      MATCH(content) AGAINST(...)           (FULLTEXT index)
//   semantic -> PostgreSQL ORDER BY embedding <=> query_vector   (pgvector HNSW index)
// Results from pgvector are joined back to MySQL by clause_id, and every
// search is logged in retrieval_query + query_result inside a transaction.
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { mysqlPool, pgPool, toVector, type Row } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { embed } from '@/lib/embed';

type Params = { q?: string; mode?: string; type?: string };
type Hit = { clause_id: string; score: number };

const TYPES = ['liability', 'indemnity', 'termination', 'payment', 'confidentiality', 'non_compete',
  'renewal', 'governing_law', 'intellectual_property', 'warranty', 'dispute_resolution', 'general'];

const EXAMPLES = [
  'supplier has no cap on what it owes if something goes wrong',
  'they can end the deal whenever they want',
  'contract keeps going unless we cancel',
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const { q = '', mode = 'compare', type = '' } = await searchParams;
  const query = q.trim();
  const clauseType = TYPES.includes(type) ? type : null;

  async function keywordSearch(): Promise<Hit[]> {
    const [rows] = await mysqlPool.query<Row[]>(
      `SELECT clause_id,
              MATCH(content) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
         FROM clause
        WHERE MATCH(content) AGAINST (? IN NATURAL LANGUAGE MODE)
          AND (? IS NULL OR clause_type = ?)
        ORDER BY score DESC
        LIMIT 10`,
      [query, query, clauseType, clauseType],
    );
    return rows.map((r) => ({ clause_id: r.clause_id, score: Number(r.score) }));
  }

  async function semanticSearch(): Promise<Hit[]> {
    const vector = toVector(await embed(query));
    const result = await pgPool.query<{ clause_id: string; similarity: string }>(
      `SELECT clause_id,
              ROUND((1 - (embedding <=> $1::vector))::numeric, 4) AS similarity
         FROM clause_vector
        WHERE ($2::text IS NULL OR clause_type = $2)
        ORDER BY embedding <=> $1::vector
        LIMIT 10`,
      [vector, clauseType],
    );
    return result.rows.map((r) => ({ clause_id: r.clause_id, score: Number(r.similarity) }));
  }

  async function runAndLog(searchMode: 'keyword' | 'semantic') {
    const hits = searchMode === 'keyword' ? await keywordSearch() : await semanticSearch();
    if (hits.length === 0) return [];

    // Full clause + contract rows from MySQL, in ranking order
    const [rows] = await mysqlPool.query<Row[]>(
      `SELECT cl.clause_id, cl.clause_no, cl.clause_type, cl.content,
              c.contract_id, c.title AS contract_title,
              (SELECT COUNT(*) FROM risk_finding rf
                WHERE rf.clause_id = cl.clause_id AND rf.status = 'open') AS open_findings
         FROM clause cl
         JOIN contract c ON c.contract_id = cl.contract_id
        WHERE cl.clause_id IN (?)`,
      [hits.map((h) => h.clause_id)],
    );
    const byId = new Map(rows.map((r) => [r.clause_id as string, r]));
    const results = hits.filter((h) => byId.has(h.clause_id)).map((h) => ({ ...byId.get(h.clause_id)!, score: h.score }) as Row);

    // Log the search (transaction: both inserts or neither)
    const queryId = randomUUID();
    const conn = await mysqlPool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO retrieval_query (query_id, user_id, query_text, search_mode, filter_type)
         VALUES (?, ?, ?, ?, ?)`,
        [queryId, user.userId, query, searchMode, clauseType],
      );
      await conn.query(
        `INSERT INTO query_result (query_id, clause_id, similarity_score, result_rank) VALUES ?`,
        [results.map((r, i) => [queryId, r.clause_id, Math.min(99, r.score), i + 1])],
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return results;
  }

  const ran = query.length >= 2;
  const semantic = ran && mode !== 'keyword' ? await runAndLog('semantic') : null;
  const keyword = ran && mode !== 'semantic' ? await runAndLog('keyword') : null;

  const column = (title: string, results: Row[] | null, label: string) => (
    <div className="space-y-3">
      <h2 className="font-semibold">{title} {results && <span className="text-sm font-normal text-slate-500">({results.length})</span>}</h2>
      {results?.length === 0 && <div className="card text-sm text-slate-500">No matching clauses.</div>}
      {results?.map((r, i) => (
        <div key={r.clause_id} className="card">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">#{i + 1}</span>
            <Link className="text-indigo-700 hover:underline" href={`/contracts/${r.contract_id}`}>{r.contract_title}</Link>
            <span>· clause {r.clause_no}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5">{String(r.clause_type).replace('_', ' ')}</span>
            {r.open_findings > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">{r.open_findings} open risk</span>}
            <span className="ml-auto tabular-nums">{label} {Number(r.score).toFixed(3)}</span>
          </div>
          <p className="line-clamp-4 text-sm">{r.content}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clause search</h1>
      <form method="get" className="card space-y-3">
        <div className="flex flex-col gap-3 md:flex-row">
          <input name="q" className="input flex-1" defaultValue={query} placeholder="Describe the clause in plain words…" />
          <select name="type" className="input md:w-48" defaultValue={clauseType ?? ''}>
            <option value="">Any clause type</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <select name="mode" className="input md:w-44" defaultValue={mode}>
            <option value="compare">Compare both</option>
            <option value="semantic">Semantic only</option>
            <option value="keyword">Keyword only</option>
          </select>
          <button className="btn">Search</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-slate-500">Try:</span>
          {EXAMPLES.map((ex) => (
            <Link key={ex} href={`/search?${new URLSearchParams({ q: ex, mode: 'compare' })}`}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200">{ex}</Link>
          ))}
        </div>
      </form>

      {ran && (
        <div className={`grid gap-6 ${mode === 'compare' ? 'md:grid-cols-2' : ''}`}>
          {mode !== 'keyword' && column('Semantic (pgvector, cosine)', semantic, 'similarity')}
          {mode !== 'semantic' && column('Keyword (MySQL FULLTEXT)', keyword, 'relevance')}
        </div>
      )}
    </div>
  );
}
