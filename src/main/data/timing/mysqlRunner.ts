/**
 * Split Control's MySQL/MariaDB connection for SQL profiles and code plugins.
 *
 * Read-only by construction: every pooled connection runs SET SESSION TRANSACTION READ ONLY,
 * every query must pass assertReadOnlySelect, and each query has a timeout and a row limit.
 * Recommend a database user with SELECT rights only on top of that.
 */

import { createPool, Pool } from 'mysql2/promise';
import type { MySqlConnection, SqlRunner } from '../../../shared/timing-sdk';
import { assertReadOnlySelect, bindNamed } from './sql/sqlText';

export interface MySqlRunnerOptions extends MySqlConnection {
  connectionLimit?: number;
  connectTimeout?: number;
  rejectUnauthorized?: boolean;
  /** Per-query timeout (ms, default 10000) */
  queryTimeoutMs?: number;
  /** A query returning more rows fails (default 50000) */
  maxRows?: number;
}

export interface MySqlRunner extends SqlRunner {
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createMySqlRunner(options: MySqlRunnerOptions): MySqlRunner {
  const pool: Pool = createPool({
    host: options.host,
    port: options.port || 3306,
    database: options.database,
    user: options.user,
    password: options.password,
    connectionLimit: options.connectionLimit || 10,
    connectTimeout: options.connectTimeout || 10000,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ...(options.ssl ? { ssl: { rejectUnauthorized: options.rejectUnauthorized ?? true } } : {})
  });
  // Queries on a connection run in order, so this always runs before the profile's first query
  pool.on('connection', (connection: any) => {
    const r = connection.query('SET SESSION TRANSACTION READ ONLY');
    if (r && typeof r.catch === 'function') r.catch(() => undefined);
  });
  const timeout = options.queryTimeoutMs ?? 10000;
  const maxRows = options.maxRows ?? 50000;
  let closed = false;

  return {
    async query(sql, params = {}) {
      if (closed) throw new Error('The database connection is closed');
      assertReadOnlySelect(sql);
      const bound = bindNamed(sql, params);
      const [rows] = await pool.query({ sql: bound.sql, timeout }, bound.values as any[]);
      const list = rows as Record<string, unknown>[];
      if (list.length > maxRows) throw new Error(`Query returned ${list.length} rows (limit ${maxRows})`);
      return list;
    },
    async ping() {
      const connection = await pool.getConnection();
      try { await connection.ping(); } finally { connection.release(); }
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end().catch(() => undefined);
    }
  };
}
