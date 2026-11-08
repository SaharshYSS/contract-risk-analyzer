// Runs .sql files. Works on Windows, macOS and Linux.
//   npm run db:setup                         -> MySQL files 01-06
//   node scripts/run-sql.mjs database/07_queries.sql
//   npm run vector:setup                     -> PostgreSQL/pgvector schema (--pg)
// The MySQL mode understands the DELIMITER command (needed for procedures
// and triggers), which the mysql CLI supports but Node drivers do not.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import pg from 'pg';

const DEFAULT_MYSQL_FILES = [
  'database/01_schema.sql',
  'database/02_alter_drop_demo.sql',
  'database/03_views.sql',
  'database/04_functions_procedures.sql',
  'database/05_triggers.sql',
  'database/06_seed.sql',
];

const args = process.argv.slice(2);
const usePg = args.includes('--pg');
const files = args.filter((a) => a !== '--pg');

function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let buffer = [];
  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const delimMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      delimiter = delimMatch[1];
      continue;
    }
    if (buffer.length === 0 && (/^\s*--/.test(line) || line.trim() === '')) continue;
    buffer.push(rawLine);
    if (line.endsWith(delimiter)) {
      let stmt = buffer.join('\n').trim();
      stmt = stmt.slice(0, stmt.length - delimiter.length).trim();
      if (stmt) statements.push(stmt);
      buffer = [];
    }
  }
  const rest = buffer.join('\n').trim();
  if (rest) statements.push(rest);
  return statements;
}

async function runMysql(fileList) {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
  });
  let failed = false;
  for (const file of fileList) {
    const statements = splitStatements(fs.readFileSync(path.resolve(file), 'utf8'));
    console.log(`\n> ${file} (${statements.length} statements)`);
    for (const stmt of statements) {
      try {
        const [rows] = await conn.query(stmt);
        if (Array.isArray(rows) && rows.length && !Array.isArray(rows[0])) console.table(rows.slice(0, 15));
      } catch (err) {
        console.error(`  ERROR ${err.code}: ${err.sqlMessage ?? err.message}`);
        console.error(`  in: ${stmt.split('\n').slice(0, 3).join(' ').slice(0, 160)}...`);
        failed = true;
        if (!process.env.CONTINUE_ON_ERROR) break;
      }
    }
    if (failed && !process.env.CONTINUE_ON_ERROR) break;
  }
  await conn.end();
  return failed;
}

async function connectPg() {
  const url = process.env.PG_URL;
  if (!url) throw new Error('PG_URL is not set in .env');
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    return client;
  } catch (err) {
    if (err.code !== '3D000') throw err; // 3D000 = database does not exist
    // Create the database by connecting to the default "postgres" database first
    const u = new URL(url);
    const dbName = u.pathname.slice(1);
    u.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: u.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    await admin.end();
    console.log(`created PostgreSQL database ${dbName}`);
    const retry = new pg.Client({ connectionString: url });
    await retry.connect();
    return retry;
  }
}

async function runPg(fileList) {
  const client = await connectPg();
  let failed = false;
  for (const file of fileList) {
    console.log(`\n> ${file} (PostgreSQL)`);
    try {
      const result = await client.query(fs.readFileSync(path.resolve(file), 'utf8'));
      const last = Array.isArray(result) ? result.at(-1) : result;
      if (last?.rows?.length) console.table(last.rows.slice(0, 15));
    } catch (err) {
      console.error(`  ERROR ${err.code}: ${err.message}`);
      if (err.message.includes('extension "vector"')) {
        console.error('  pgvector is not installed on this PostgreSQL. Use the pgvector Docker image or a cloud Postgres (see README).');
      }
      failed = true;
      break;
    }
  }
  await client.end();
  return failed;
}

const failed = usePg
  ? await runPg(files)
  : await runMysql(files.length ? files : DEFAULT_MYSQL_FILES);
console.log(failed ? '\nFinished with errors.' : '\nDone.');
process.exit(failed ? 1 : 0);
