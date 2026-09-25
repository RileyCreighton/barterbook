import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function testDatabase(): D1Database & { close(): void } {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  function totalChanges(): number {
    return Number(sqlite.prepare("SELECT total_changes() AS n").get()!.n);
  }
  class Statement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) {
      const bound = new Statement(this.sql);
      bound.values = values;
      return bound;
    }
    execute() {
      const before = totalChanges();
      const result = sqlite.prepare(this.sql).run(...this.values);
      // D1 includes writes made by triggers, unlike SQLite's direct changes().
      return { ...result, changes: totalChanges() - before };
    }
    async run() {
      const result = this.execute();
      return {
        success: true,
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
        results: [],
      };
    }
    async first<T>(column?: string): Promise<T | null> {
      const row = sqlite.prepare(this.sql).get(...this.values);
      if (!row) return null;
      return (column ? row[column] : row) as T;
    }
    async all<T>() {
      const before = totalChanges();
      const results = sqlite.prepare(this.sql).all(...this.values) as T[];
      return {
        success: true,
        meta: { changes: totalChanges() - before },
        results,
      };
    }
  }
  return {
    prepare(sql: string) {
      return new Statement(sql);
    },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => {
          const result = s.execute();
          return {
            success: true,
            meta: { changes: Number(result.changes) },
            results: [],
          };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      sqlite.close();
    },
  } as unknown as D1Database & { close(): void };
}
