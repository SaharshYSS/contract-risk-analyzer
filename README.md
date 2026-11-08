# Contract Risk Analyzer

**AI-Assisted Legal Contract Risk Analysis & Semantic Clause Retrieval System**
DBMS Level 3 Mini Project: Yerramilli Siva Sai Saharsh (PES2UG24CS618), Varun Sahu (PES2UG24CS576)

Upload a contract and the system splits it into clauses, stores them in MySQL, stores an embedding of every clause in PostgreSQL + pgvector, flags risky clauses (keyword rules + semantic similarity), and lets lawyers review and approve contracts. Users can search clauses by keyword (MySQL FULLTEXT) or by meaning (pgvector cosine similarity).

| Layer | Technology |
|---|---|
| Web app | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Relational DB | MySQL 8: users, contracts, clauses, rules, findings, reviews, search log, audit log |
| Vector DB | PostgreSQL 16 + pgvector: 384-dim clause and risk-pattern embeddings, HNSW cosine index |
| Embeddings | `Xenova/all-MiniLM-L6-v2` via Transformers.js (runs locally, no API key) |
| Auth | bcrypt password hashes + signed JWT cookie (`jose`), 3 roles |

## Embedded SQL: how the app talks to the databases

There is **no separate API layer**. Every page is a server component that runs its SQL statements directly:
- **Reads** run at the top of the page (`SELECT … FROM … WHERE … = ?`).
- **Changes** run in server actions written *inside the same page file* (`'use server'` functions attached to `<form action={…}>`). They contain `INSERT`, `UPDATE`, `DELETE`, `CALL` and transactions.
- All statements use placeholders (`?` for MySQL, `$1` for PostgreSQL), so user input can never change a query.
- `src/lib/` holds only connection setup, sessions, the embedding model and the clause splitter. It contains **no SQL**.

| Page file | SQL it contains |
|---|---|
| `src/app/login/page.tsx` | SELECT user by email, UPDATE last_login_at |
| `src/app/register/page.tsx` | INSERT app_user (CHECK / UNIQUE errors shown to the user) |
| `src/app/dashboard/page.tsx` | Aggregates with GROUP BY, views `v_contract_risk_summary`, `v_reviewer_workload`, audit_log; pgvector view `v_vector_stats` |
| `src/app/contracts/page.tsx` | Filtered SELECT on `v_contract_risk_summary` (dynamic WHERE with placeholders) |
| `src/app/contracts/new/page.tsx` | Transaction on **both** databases (INSERT contract, clause, clause_embedding + INSERT clause_vector); `CALL sp_run_keyword_rules`; pgvector `CROSS JOIN LATERAL … ORDER BY embedding <=> …`; INSERT risk_finding; UPDATE with `fn_contract_risk_score` |
| `src/app/contracts/[id]/page.tsx` | SELECTs with JOINs; `CALL sp_submit_review`; UPDATE … JOIN on risk_finding; re-analysis; DELETE on both databases |
| `src/app/search/page.tsx` | MySQL `MATCH … AGAINST`; pgvector `ORDER BY embedding <=> $1::vector`; join back by clause_id; logging transaction |

## Why two databases

| Data | Store | Reason |
|---|---|---|
| Users, contracts, clauses, findings, reviews | MySQL | Related by foreign keys; needs constraints, transactions, triggers, procedures, views |
| Clause meaning (embeddings) | PostgreSQL + pgvector | Similarity search over 384-dim vectors with an HNSW index; MySQL has no vector type or vector index |

`clause_vector.clause_id` in PostgreSQL **is** `clause.clause_id` in MySQL, so every vector hit joins back to its relational row. A foreign key cannot cross two servers, so the upload runs a transaction on each database and rolls both back if either fails.

---

## Setup (about 20 minutes)

### 1. Prerequisites
- **Node.js 20+**
- **MySQL 8**: your existing local install is fine
- **PostgreSQL with pgvector**, using one of these:
  - **Docker (easiest):** `docker compose up -d pgvector`. This starts PostgreSQL 16 with pgvector on port 5432.
  - **Free cloud, no install:** create a project on neon.tech or supabase.com (both include pgvector) and copy its connection string into `PG_URL`.
  - A plain PostgreSQL install on Windows does **not** include pgvector, so use one of the two options above.

### 2. Install and configure
```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
```
Edit `.env`:
- `DB_PASSWORD`: your MySQL root password
- `PG_URL`: your PostgreSQL connection string. With Docker it is `postgres://postgres:<PG_PASSWORD>@localhost:5432/contract_vectors`.
- `AUTH_SECRET`: a random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### 3. Create both databases
```bash
npm run db:setup        # MySQL: database/01 to 06 (schema, alter/drop, views, procedures, triggers, seed)
npm run vector:setup    # PostgreSQL: database/pgvector/01_vector_schema.sql (creates the database if missing)
npm run vector:seed     # embeds 25 risk patterns and INSERTs them (first run downloads the ~25 MB model)
```
If `db:setup` fails creating the function with error 1418, run this once in MySQL as root:
`SET GLOBAL log_bin_trust_function_creators = 1;`

### 4. Run
```bash
npm run dev
```
Open http://localhost:3000 and log in with:

| Role | Email | Password |
|---|---|---|
| admin | admin@contracts.local | Password@123 |
| lawyer | lawyer@contracts.local | Password@123 |
| reviewer | reviewer@contracts.local | Password@123 |

Upload the three files in `database/sample_contracts/` on the **Upload** page.

### 5. Tune the semantic threshold (5 minutes, do once)
```bash
npm run vector:tune
```
This prints the closest risk pattern and its similarity for every clause. Choose a `RISK_SIMILARITY_THRESHOLD` that flags the risky CloudNest and Brightline clauses but not most of the safe Mutual NDA (usually 0.5–0.65). Then restart `npm run dev` and press **Re-run analysis** on each contract.

---

## What each role can do

| Action | reviewer | lawyer | admin |
|---|:-:|:-:|:-:|
| View dashboard, contracts, search | ✓ | ✓ | ✓ |
| Upload contracts | ✓ | ✓ | ✓ |
| Re-run analysis, mark findings mitigated/accepted | | ✓ | ✓ |
| Approve / reject / request changes | | ✓ | ✓ |
| Delete contracts, see audit log | | | ✓ |

Roles are checked in each server action and again inside the database by `sp_submit_review`.

## Database objects

| Feature | Where |
|---|---|
| 10 MySQL tables with PK, FK (CASCADE / RESTRICT / SET NULL), UNIQUE, CHECK, ENUM, DEFAULT | `database/01_schema.sql` |
| ALTER TABLE (add, modify, index) and DROP TABLE / DROP INDEX | `database/02_alter_drop_demo.sql` |
| Views: `v_contract_risk_summary`, `v_reviewer_workload` (GROUP BY + HAVING), `v_high_risk_clauses` | `database/03_views.sql` |
| Function `fn_contract_risk_score`; procedures `sp_submit_review` (transaction + RESIGNAL), `sp_run_keyword_rules` (cursor) | `database/04_functions_procedures.sql` |
| Triggers: critical finding → under_review; block approval with open criticals; audit log; score refresh | `database/05_triggers.sql` |
| pgvector tables, CHECK constraints, HNSW cosine indexes, B-tree filter indexes, view `v_vector_stats` | `database/pgvector/01_vector_schema.sql` |
| Transactions across both databases with rollback | `src/app/contracts/new/page.tsx` |
| Full-text search and vector similarity search | `src/app/search/page.tsx` |
| JOIN / GROUP BY / HAVING / subqueries / EXPLAIN demos | `database/07_queries.sql` (`npm run db:queries`) |
| 12 constraint tests that must fail | `database/08_constraint_tests.sql` (run one at a time in the MySQL client) |

## How risk detection works
1. **Keyword rules** (`risk_rule` table): `sp_run_keyword_rules` loops over every rule with a cursor and matches each clause with `REGEXP_LIKE`.
2. **Semantic rules**: one SQL query in PostgreSQL finds, for every clause, the 2 nearest risk patterns:
   `CROSS JOIN LATERAL (SELECT … FROM risk_pattern_vector ORDER BY clause.embedding <=> pattern.embedding LIMIT 2)`.
   Matches with similarity (1 − cosine distance) at or above `RISK_SIMILARITY_THRESHOLD` become `risk_finding` rows with `detection_method = 'semantic'`.
3. `fn_contract_risk_score` scores each clause by its worst open finding (low 10, medium 25, high 50, critical 100) and averages over all clauses. Any open critical finding sets a floor of 60.

## Project structure
```
database/            MySQL files 01-08, pgvector/01_vector_schema.sql, sample_contracts/
vector/              risk_patterns.json, seed and tuning scripts (SQL inside)
scripts/run-sql.mjs  runs .sql files on MySQL (understands DELIMITER) or PostgreSQL (--pg)
src/app/             pages, each containing its own SQL and form actions
src/lib/             connections (db.ts), session.ts, embed.ts, clauseSplitter.ts (no SQL)
src/components/      Badge / Notice / SubmitButton display components
```

## Troubleshooting
| Problem | Fix |
|---|---|
| "A database server is not reachable" | Start MySQL and PostgreSQL; check `DB_*` and `PG_URL` in `.env` |
| `extension "vector" is not available` | Your PostgreSQL has no pgvector: use the Docker image or Neon/Supabase |
| First upload is slow | The embedding model downloads once (~25 MB), then it is cached |
| No semantic findings | Lower `RISK_SIMILARITY_THRESHOLD` (see step 5) |
