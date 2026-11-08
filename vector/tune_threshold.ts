// Owner: Varun — helps choose RISK_SIMILARITY_THRESHOLD with the REAL model.
// Upload the 3 sample contracts first, then run:  npm run vector:tune
// For every clause it prints the closest risk pattern and its cosine
// similarity. Pick a threshold that keeps the risky clauses (CloudNest,
// Brightline) and drops most clauses of the safe Mutual NDA, put it in .env,
// restart the app and press "Re-run analysis" on each contract.
import 'dotenv/config';
import pg from 'pg';
import mysql from 'mysql2/promise';

async function main() {
  const client = new pg.Client({ connectionString: process.env.PG_URL });
  await client.connect();

  // Closest pattern for every clause (pgvector, LATERAL nearest-neighbour)
  const { rows } = await client.query<{ clause_id: string; contract_id: string; clause_no: number; title: string; similarity: string }>(
    `SELECT cv.clause_id, cv.contract_id, cv.clause_no, best.title,
            ROUND((1 - (cv.embedding <=> best.embedding))::numeric, 3) AS similarity
       FROM clause_vector cv
       CROSS JOIN LATERAL (
             SELECT p.title, p.embedding
               FROM risk_pattern_vector p
              ORDER BY cv.embedding <=> p.embedding
              LIMIT 1) best
      ORDER BY cv.contract_id, cv.clause_no`,
  );
  await client.end();

  // Contract titles come from MySQL
  const my = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [titles] = await my.query<mysql.RowDataPacket[]>('SELECT contract_id, title FROM contract');
  await my.end();
  const titleOf = new Map(titles.map((t) => [t.contract_id as string, t.title as string]));

  for (const r of rows) {
    console.log(`${r.similarity}  ${String(titleOf.get(r.contract_id) ?? '?').slice(0, 26).padEnd(26)} #${String(r.clause_no).padEnd(3)} ${r.title}`);
  }
  const scores = rows.map((r) => Number(r.similarity)).sort((a, b) => a - b);
  const q = (p: number) => scores[Math.floor((scores.length - 1) * p)]?.toFixed(3);
  console.log(`\n${scores.length} clauses · min ${q(0)} · median ${q(0.5)} · p75 ${q(0.75)} · max ${q(1)}`);
  console.log(`Current RISK_SIMILARITY_THRESHOLD = ${process.env.RISK_SIMILARITY_THRESHOLD ?? 0.6}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
