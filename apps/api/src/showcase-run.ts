import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, seedShowcase } from "@salon/db";

// Запуск: остановить сервер, затем `npx tsx apps/api/src/showcase-run.ts`. Наполняет демо-клинику историей приёмов.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const db = await openDb(process.env.DATA_DIR ?? join(repoRoot, ".data", "pg"));
const salon = await db.query<{ id: string }>(`SELECT id FROM salons WHERE slug = 'demo'`);
if (!salon.rows[0]) throw new Error("Демо-клиника не найдена: сначала запустите сервер один раз");
console.log(await seedShowcase(db, salon.rows[0].id));
await db.close();
