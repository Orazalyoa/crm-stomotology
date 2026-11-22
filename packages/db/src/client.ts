import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrate } from "./migrate";

/** Выполняет SQL внутри транзакции клиники: q(sql, params) → { rows }. */
export type Queryable = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

export type Database = PGlite;

/**
 * Открывает базу. Без dataDir — в памяти (тесты); с dataDir — на диске.
 * Встроенный PGlite нужен для разработки без Docker; продакшен переключим на сервер Postgres.
 */
export async function openDb(dataDir?: string): Promise<Database> {
  const options = { extensions: { btree_gist } };
  const db = dataDir ? new PGlite(dataDir, options) : new PGlite(options);
  await db.waitReady;
  await migrate(db);
  return db;
}

/**
 * Выполняет работу в транзакции от имени приложения (не суперпользователя)
 * в контексте одной клиники — так включается RLS (ADR-0001).
 */
export function withSalon<T>(
  db: Database,
  salonId: string,
  run: (q: Queryable) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE app_user`);
    await tx.query(`SELECT set_config('app.salon_id', $1, true)`, [salonId]);
    return run(((sql, params) => tx.query(sql, params)) as Queryable);
  });
}
