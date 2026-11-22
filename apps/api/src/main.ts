import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_PASSWORD, openDb, seedDemo } from "@salon/db";
import { ClaudeAi, RuleBasedAi } from "./ai";
import { buildApp } from "./app";
import { handleUpdate } from "./bot";
import { startScheduler } from "./notify";
import { TelegramApi, startPolling } from "./telegram";

const production = process.env.NODE_ENV === "production";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// База лежит в .data/ в корне репозитория независимо от места запуска.
const dataDir = process.env.DATA_DIR ?? join(repoRoot, ".data", "pg");
mkdirSync(dirname(dataDir), { recursive: true });

/** Ключ подписи сессий: из окружения или, в разработке, сохранённый в .data/secret. */
function loadSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (production) throw new Error("SESSION_SECRET is required in production");
  const file = join(dirname(dataDir), "secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"));
  return readFileSync(file, "utf8").trim();
}

if (production) throw new Error("Production needs a real SMS provider and Postgres server; not wired yet");

const db = await openDb(dataDir);

// Первый запуск: создаём демо-клинику с врачами, услугами, зубами пациентов и записями.
const existing = await db.query<{ id: string }>(`SELECT id FROM salons WHERE slug = 'demo'`);
if (!existing.rows[0]) {
  await seedDemo(db);
  console.log(`Создана демо-клиника. Пароль всех демо-пользователей: ${DEMO_PASSWORD}`);
}

/** Токен бота: из окружения или из файла .data/telegram-token (в git не попадает). */
function loadTelegramToken(): string | null {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim();
  const file = join(dirname(dataDir), "telegram-token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

let telegram: TelegramApi | null = null;
const token = loadTelegramToken();
if (token) {
  try { telegram = await TelegramApi.connect(token); }
  catch (e) { console.error(`Telegram недоступен, уведомления выключены: ${(e as Error).message}`); }
}
const ai = process.env.ANTHROPIC_API_KEY ? new ClaudeAi(process.env.ANTHROPIC_API_KEY) : new RuleBasedAi();

const app = buildApp({ db, secret: loadSecret(), telegram, ai });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "127.0.0.1" });

if (telegram) {
  const notice = { db, now: () => new Date(), sms: { send: async (p: string, t: string) => void console.log(`[SMS dev] ${p}: ${t}`) }, telegram };
  startPolling(telegram, (update) => handleUpdate(notice, update));
  startScheduler(notice);
}
console.log(`Sergek Dent запущен: http://127.0.0.1:${port}`);
console.log(`  Telegram-бот        ${telegram ? `@${telegram.username}` : "не подключён"}`);
console.log(`  ИИ-вопросы          ${ai.canAsk ? "включены" : "выключены (нужен ANTHROPIC_API_KEY); диктовка работает по правилам"}`);
console.log(`  вход персонала      /login   (owner@sergek.ai, admin@sergek.ai, daniyar@sergek.ai)`);
console.log(`  онлайн-запись       /b/demo`);
