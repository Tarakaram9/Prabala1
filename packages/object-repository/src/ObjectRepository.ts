// ─────────────────────────────────────────────────────────────────────────────
// Prabala Object Repository – SQLite-backed locator store
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import { ObjectEntry } from '@prabala/core';
import * as path from 'path';
import * as fs from 'fs';

export class ObjectRepository {
  private db: Database.Database;

  constructor(dbPath: string = './prabala-objects.db') {
    const dir = path.dirname(dbPath);
    if (dir) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        key         TEXT PRIMARY KEY,
        strategy    TEXT NOT NULL,
        locator     TEXT NOT NULL,
        description TEXT,
        fallback    TEXT,
        page        TEXT,
        tags        TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  upsert(key: string, entry: ObjectEntry & { page?: string; tags?: string[] }): void {
    const stmt = this.db.prepare(`
      INSERT INTO objects (key, strategy, locator, description, fallback, page, tags, updated_at)
      VALUES (@key, @strategy, @locator, @description, @fallback, @page, @tags, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        strategy    = excluded.strategy,
        locator     = excluded.locator,
        description = excluded.description,
        fallback    = excluded.fallback,
        page        = excluded.page,
        tags        = excluded.tags,
        updated_at  = excluded.updated_at
    `);

    stmt.run({
      key,
      strategy: entry.strategy,
      locator: entry.locator,
      description: entry.description ?? null,
      fallback: entry.fallbacks ? JSON.stringify(entry.fallbacks) : null,
      page: entry.page ?? null,
      tags: entry.tags ? JSON.stringify(entry.tags) : null,
    });
  }

  get(key: string): ObjectEntry | undefined {
    const row = this.db
      .prepare('SELECT * FROM objects WHERE key = ?')
      .get(key) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return {
      strategy: row['strategy'] as ObjectEntry['strategy'],
      locator: row['locator'] as string,
      description: row['description'] as string | undefined,
      fallbacks: row['fallback']
        ? (JSON.parse(row['fallback'] as string) as ObjectEntry['fallbacks'])
        : undefined,
    };
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM objects WHERE key = ?').run(key);
  }

  list(page?: string): Array<{ key: string } & ObjectEntry> {
    const rows = page
      ? (this.db.prepare('SELECT * FROM objects WHERE page = ?').all(page) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM objects').all() as Record<string, unknown>[]);

    return rows.map((row) => ({
      key: row['key'] as string,
      strategy: row['strategy'] as ObjectEntry['strategy'],
      locator: row['locator'] as string,
      description: row['description'] as string | undefined,
      fallbacks: row['fallback'] ? JSON.parse(row['fallback'] as string) : undefined,
    }));
  }

  exportAsRecord(): Record<string, ObjectEntry> {
    const all = this.list();
    const result: Record<string, ObjectEntry> = {};
    for (const entry of all) {
      const { key, ...obj } = entry;
      result[key] = obj;
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}
