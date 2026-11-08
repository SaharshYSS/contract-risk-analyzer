// Connection setup only (no SQL in this file). Every SQL statement is
// written directly inside the page that uses it.
//   mysqlPool -> MySQL 8 (relational data)
//   pgPool    -> PostgreSQL + pgvector (embeddings / similarity search)
// All credentials come from .env, never from the source code.
import mysql from 'mysql2/promise';
import { Pool as PgPool } from 'pg';

const globalForDb = globalThis as unknown as { mysqlPool?: mysql.Pool; pgPool?: PgPool };

export const mysqlPool =
  globalForDb.mysqlPool ??
  mysql.createPool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'contract_analysis',
    connectionLimit: 10,
    dateStrings: true,
    decimalNumbers: true,
  });

export const pgPool = globalForDb.pgPool ?? new PgPool({ connectionString: process.env.PG_URL, max: 5 });

// Re-use the pools across hot reloads in development
if (process.env.NODE_ENV !== 'production') {
  globalForDb.mysqlPool = mysqlPool;
  globalForDb.pgPool = pgPool;
}

export type Row = mysql.RowDataPacket;
export type Result = mysql.ResultSetHeader;

/** number[] -> '[0.1,0.2,...]', the text form pgvector accepts with ::vector */
export function toVector(values: number[]): string {
  return `[${values.join(',')}]`;
}

/** Turns a database error into a message that is safe to show on screen. */
export function dbErrorMessage(err: unknown): string {
  const e = err as { code?: string; sqlState?: string; sqlMessage?: string; message?: string };
  if (e?.sqlState === '45000') return e.sqlMessage ?? 'Rejected by a database rule'; // our SIGNALs
  if (e?.sqlMessage) return `Database rejected the data: ${e.sqlMessage}`;            // MySQL constraint errors
  if (e?.code === 'ECONNREFUSED') return 'A database server is not reachable. Check that MySQL and PostgreSQL are running and .env is correct.';
  if (e?.code && /^[0-9A-Z]{5}$/.test(e.code)) return `Vector database error: ${e.message}`; // PostgreSQL SQLSTATE codes
  console.error(err);
  return 'Something went wrong on the server';
}
