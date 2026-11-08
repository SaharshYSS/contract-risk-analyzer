// Owner: Varun — embeds the 25 risky-clause templates and stores them in
// PostgreSQL/pgvector with plain SQL.   Usage: npm run vector:seed
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { embedMany } from '../src/lib/embed';

type Pattern = { id: number; title: string; severity: string; clause_type: string; text: string; suggested_revision: string };

async function main() {
  const patterns: Pattern[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vector', 'risk_patterns.json'), 'utf8'));
  console.log(`Embedding ${patterns.length} risk patterns (first run downloads the model)…`);
  const vectors = await embedMany(patterns.map((p) => p.text));

  const client = new pg.Client({ connectionString: process.env.PG_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      await client.query(
        `INSERT INTO risk_pattern_vector
               (pattern_id, title, severity, clause_type, pattern_text, suggested_revision, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         ON CONFLICT (pattern_id) DO UPDATE
            SET title = EXCLUDED.title, severity = EXCLUDED.severity, clause_type = EXCLUDED.clause_type,
                pattern_text = EXCLUDED.pattern_text, suggested_revision = EXCLUDED.suggested_revision,
                embedding = EXCLUDED.embedding`,
        [p.id, p.title, p.severity, p.clause_type, p.text, p.suggested_revision, `[${vectors[i].join(',')}]`],
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT COUNT(*) AS n FROM risk_pattern_vector');
    console.log(`Stored. risk_pattern_vector now has ${rows[0].n} rows.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
