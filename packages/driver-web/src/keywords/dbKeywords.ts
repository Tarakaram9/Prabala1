// ─────────────────────────────────────────────────────────────────────────────
// Prabala – Database Assertion Keywords
//
// Uses the 'knex' query builder. Install it with:
//   npm install knex  (and the relevant driver: pg, mysql2, better-sqlite3, etc.)
//
// Connection config in prabala.config.yaml under the 'db' key:
//   db:
//     client: pg
//     connection: postgres://user:pass@localhost/mydb
// ─────────────────────────────────────────────────────────────────────────────

import { KeywordDefinition, PrabalaConfig } from '@prabala/core';

type KnexInstance = any;
const connections = new Map<string, KnexInstance>();

function getKnex(context: import('@prabala/core').ExecutionContext): KnexInstance {
  const existing = connections.get('default');
  if (existing) return existing;

  const cfg = (context.variables['__config__'] ?? {}) as any;
  const dbCfg = cfg['db'];
  if (!dbCfg) {
    throw new Error(
      'No database configuration found. Add a "db" section to prabala.config.yaml:\n' +
      '  db:\n    client: pg\n    connection: postgres://user:pass@localhost/mydb'
    );
  }

  let knex: any;
  try {
    knex = require('knex');
  } catch {
    throw new Error(
      'knex is not installed. Run: npm install knex\n' +
      'And install the relevant driver (e.g.: npm install pg)'
    );
  }

  const instance = knex(dbCfg);
  connections.set('default', instance);
  return instance;
}

export const dbKeywords: KeywordDefinition[] = [
  {
    name: 'DB.Connect',
    description: 'Establish a database connection using config from prabala.config.yaml.',
    params: [],
    execute: async (_params, context) => {
      const db = getKnex(context);
      await db.raw('SELECT 1');
      console.log('[DB] Connected');
    },
  },
  {
    name: 'DB.Query',
    description: 'Run a raw SQL query and store results in a variable.',
    params: ['sql', 'variable'],
    execute: async (params, context) => {
      const db = getKnex(context);
      const sql = String(params['sql'] ?? '');
      const varName = String(params['variable'] ?? 'dbResult');
      const result = await db.raw(sql);
      const rows = result.rows ?? result[0] ?? result;
      context.variables[varName] = rows;
      console.log(`[DB] Query returned ${Array.isArray(rows) ? rows.length : 1} row(s) → ${varName}`);
    },
  },
  {
    name: 'DB.AssertRowExists',
    description: 'Assert that a SQL query returns at least one row.',
    params: ['sql'],
    execute: async (params, context) => {
      const db = getKnex(context);
      const sql = String(params['sql'] ?? '');
      const result = await db.raw(sql);
      const rows = result.rows ?? result[0] ?? [];
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`DB assertion failed: no rows returned for query: ${sql}`);
      }
      console.log(`[DB] AssertRowExists passed (${rows.length} row(s))`);
    },
  },
  {
    name: 'DB.AssertValue',
    description: 'Assert that the first row of a SQL query has a specific column value.',
    params: ['sql', 'column', 'expected'],
    execute: async (params, context) => {
      const db = getKnex(context);
      const sql = String(params['sql'] ?? '');
      const column = String(params['column'] ?? '');
      const expected = String(params['expected'] ?? '');
      const result = await db.raw(sql);
      const rows = result.rows ?? result[0] ?? [];
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`DB assertion failed: no rows returned for query: ${sql}`);
      }
      const actual = String(rows[0][column] ?? '');
      if (actual !== expected) {
        throw new Error(`DB column "${column}" = "${actual}" but expected "${expected}"`);
      }
      console.log(`[DB] AssertValue passed: ${column}="${actual}"`);
    },
  },
  {
    name: 'DB.Cleanup',
    description: 'Execute a SQL statement to clean up test data (DELETE/TRUNCATE).',
    params: ['sql'],
    execute: async (params, context) => {
      const db = getKnex(context);
      const sql = String(params['sql'] ?? '');
      await db.raw(sql);
      console.log(`[DB] Cleanup executed: ${sql}`);
    },
  },
  {
    name: 'DB.Disconnect',
    description: 'Close the database connection.',
    params: [],
    execute: async () => {
      const db = connections.get('default');
      if (db) {
        await db.destroy();
        connections.delete('default');
        console.log('[DB] Disconnected');
      }
    },
  },
];
