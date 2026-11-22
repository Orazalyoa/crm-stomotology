import type { Database } from "@salon/db";
import { withSalon } from "@salon/db";
import { almatyDateOf } from "./availability";
import type { SmsSender } from "./ctx";
import * as msg from "./messages";
import type { Button, SendOptions, TelegramClient } from "./telegram";

/** Всё, что нужно уведомлениям. Фоновые задачи читают данные через withSalon, то есть под RLS клиники. */
export interface NoticeCtx {
  db: Database;
  now: () => Date;
  sms: SmsSender;
  telegram: TelegramClient | null;
}

const hm = msg.hm;
export const dayBounds = (date: string) => {
  const start = new Date(`${date}T00:00:00+05:00`);
  return [start, new Date(start.getTime() + 86_400_000)] as const;
};
export const nextDate = (date: string) => almatyDateOf(new Date(new Date(`${date}T00:00:00+05:00`).getTime() + 36 * 3600_000));

export async function sendSafe(t: TelegramClient | null, chatId: number | string, text: string, options?: SendOptions) {
  if (!t) return false;
  try { await t.send(chatId, text, options); return true; }
  catch (e) { console.error("[telegram] send failed:", (e as Error).message); return false; }
}

/** Чаты сотрудников клиники: админы и владелец, плюс при необходимости конкретный врач. */
async function staffChats(db: Database, salonId: string, masterId?: string): Promise<number[]> {
  const { rows } = await db.query<{ chat_id: string }>(
    `SELECT DISTINCT tl.chat_id FROM telegram_links tl JOIN users u ON u.id = tl.user_id
      WHERE u.salon_id = $1 AND u.active AND (u.role IN ('owner','admin') OR ($2::uuid IS NOT NULL AND u.master_id = $2::uuid))`,
    [salonId, masterId ?? null],
  );
  return rows.map((r) => Number(r.chat_id));
}
const clientChats = async (db: Database, clientId: string) =>
  (await db.query<{ chat_id: string }>(`SELECT chat_id FROM telegram_links WHERE client_id = $1`, [clientId])).rows.map((r) => Number(r.chat_id));

export interface ApptInfo extends msg.ApptView { id: string; status: string; masterId: string; clientId: string }

export async function apptInfo(ctx: NoticeCtx, salonId: string, id: string): Promise<ApptInfo | undefined> {
  const r = await withSalon(ctx.db, salonId, async (q) =>
    (await q<{ id: string; status: string; starts_at: Date; ends_at: Date; price_tenge: number; master_id: string; master_name: string; client_id: string; client_name: string; client_phone: string; services: string; tooth: string }>(
      `SELECT a.id, a.status, a.starts_at, a.ends_at, a.price_tenge, m.id AS master_id, m.full_name AS master_name, c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
              coalesce((SELECT string_agg(s.name, ', ') FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '') AS services,
              coalesce((SELECT 'зуб ' || v.tooth_no || ' · ' || v.diagnosis FROM teeth v WHERE v.id = a.tooth_id), '') AS tooth
         FROM appointments a JOIN masters m ON m.id = a.master_id JOIN clients c ON c.id = a.client_id WHERE a.id = $1`,
      [id],
    )).rows[0]);
  return r && {
    id: r.id, status: r.status, masterId: r.master_id, clientId: r.client_id,
    startsAt: r.starts_at, endsAt: r.ends_at, priceTenge: r.price_tenge,
    masterName: r.master_name, clientName: r.client_name, clientPhone: r.client_phone, services: r.services, tooth: r.tooth,
  };
}

/* ------------------------------- события ------------------------------- */

export async function notifyBooked(ctx: NoticeCtx, salonId: string, appointmentId: string) {
  const a = await apptInfo(ctx, salonId, appointmentId);
  if (!a) return;
  for (const chat of await staffChats(ctx.db, salonId, a.masterId)) await sendSafe(ctx.telegram, chat, msg.bookedForStaff(a));
  for (const chat of await clientChats(ctx.db, a.clientId)) await sendSafe(ctx.telegram, chat, msg.bookedForClient(a));
}

export async function notifyCancelled(ctx: NoticeCtx, salonId: string, appointmentId: string, byClient: boolean) {
  const a = await apptInfo(ctx, salonId, appointmentId);
  if (!a) return;
  for (const chat of await staffChats(ctx.db, salonId, a.masterId)) await sendSafe(ctx.telegram, chat, msg.cancelledForStaff(a, byClient));
}

/* ---------------------------- тексты сводок ---------------------------- */

export async function daySummaryText(ctx: NoticeCtx, salonId: string, date: string): Promise<string> {
  const [from, to] = dayBounds(date);
  const [nFrom, nTo] = dayBounds(nextDate(date));
  const stats = await withSalon(ctx.db, salonId, async (q) => {
    const c = (await q<Record<string, number>>(
      `SELECT count(*) FILTER (WHERE status IN ('arrived','in_progress','ready','paid'))::int AS visits,
              count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM appointments WHERE starts_at >= $1 AND starts_at < $2`, [from, to])).rows[0]!;
    const revenue = Number((await q<{ s: string | null }>(`SELECT sum(amount_tenge) AS s FROM payments WHERE created_at >= $1 AND created_at < $2`, [from, to])).rows[0]!.s ?? 0);
    const tomorrow = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM appointments WHERE status IN ('booked','confirmed') AND starts_at >= $1 AND starts_at < $2`, [nFrom, nTo])).rows[0]!.n);
    return { visits: c.visits!, noShow: c.no_show!, cancelled: c.cancelled!, revenue, tomorrow };
  });
  return msg.daySummary(from, stats);
}

async function scheduleRows(ctx: NoticeCtx, salonId: string, date: string, masterId?: string): Promise<msg.ScheduleRow[]> {
  const [from, to] = dayBounds(date);
  const rows = await withSalon(ctx.db, salonId, async (q) =>
    (await q<{ starts_at: Date; ends_at: Date; client_name: string; master_name: string; services: string }>(
      `SELECT a.starts_at, a.ends_at, c.full_name AS client_name, m.full_name AS master_name,
              coalesce((SELECT string_agg(s.name, ', ') FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '') AS services
         FROM appointments a JOIN clients c ON c.id = a.client_id JOIN masters m ON m.id = a.master_id
        WHERE ($1::uuid IS NULL OR a.master_id = $1::uuid) AND a.status NOT IN ('cancelled','no_show') AND a.starts_at >= $2 AND a.starts_at < $3
        ORDER BY m.full_name, a.starts_at`,
      [masterId ?? null, from, to])).rows);
  return rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at, clientName: r.client_name, services: r.services, masterName: r.master_name }));
}

/** Расписание одного мастера; count нужен, чтобы утром не будить пустым сообщением. */
export async function masterScheduleText(ctx: NoticeCtx, salonId: string, masterId: string, date: string, title = "Ваше расписание") {
  const rows = (await scheduleRows(ctx, salonId, date, masterId)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { count: rows.length, text: msg.masterSchedule(dayBounds(date)[0], title, rows) };
}

export async function salonScheduleText(ctx: NoticeCtx, salonId: string, date: string, title = "Записи клиники") {
  return msg.salonSchedule(dayBounds(date)[0], title, await scheduleRows(ctx, salonId, date));
}

export async function clientUpcomingText(ctx: NoticeCtx, salonId: string, clientId: string): Promise<string> {
  const rows = await withSalon(ctx.db, salonId, async (q) =>
    (await q<{ starts_at: Date; master_name: string; services: string }>(
      `SELECT a.starts_at, m.full_name AS master_name,
              coalesce((SELECT string_agg(s.name, ', ') FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '') AS services
         FROM appointments a JOIN masters m ON m.id = a.master_id
        WHERE a.client_id = $1 AND a.status IN ('booked','confirmed') AND a.starts_at >= $2 ORDER BY a.starts_at LIMIT 5`,
      [clientId, ctx.now()])).rows);
  return msg.clientUpcoming(rows.map((r) => ({ startsAt: r.starts_at, services: r.services, masterName: r.master_name })));
}

/* ------------------------- напоминания и сводки по расписанию ------------------------- */

/** Отправляет напоминания клиентам за 24 ч и за 2 ч до визита. Каждое — не более одного раза. */
export async function runReminders(ctx: NoticeCtx): Promise<number> {
  const now = ctx.now();
  const { rows } = await ctx.db.query<{ id: string; salon_id: string; starts_at: Date; created_at: Date }>(
    `SELECT id, salon_id, starts_at, created_at FROM appointments
      WHERE status IN ('booked','confirmed') AND starts_at > $1 AND starts_at <= $1::timestamptz + interval '24 hours'`,
    [now],
  );
  let sent = 0;
  for (const r of rows) {
    const hoursLeft = (r.starts_at.getTime() - now.getTime()) / 3600_000;
    // За 24 ч — только если запись создана заранее; поздние записи получают лишь напоминание за 2 ч.
    const kind = hoursLeft <= 2 ? "2h" : hoursLeft > 3 && r.created_at.getTime() <= r.starts_at.getTime() - 24 * 3600_000 ? "24h" : null;
    if (!kind) continue;
    const claimed = await ctx.db.query(`INSERT INTO notices_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key`, [`rem:${kind}:${r.id}`]);
    if (!claimed.rows.length) continue;

    const a = await apptInfo(ctx, r.salon_id, r.id);
    if (!a) continue;
    const text = msg.reminder(a, kind);
    const chats = await clientChats(ctx.db, a.clientId);
    let ok = false;
    if (chats.length && ctx.telegram) {
      const buttons: Button[][] = [[{ text: "✅ Приду", data: `confirm:${a.id}` }, { text: "❌ Отменить", data: `cancel:${a.id}` }]];
      for (const chat of chats) ok = (await sendSafe(ctx.telegram, chat, text, { buttons })) || ok;
    } else {
      // SMS без разметки: короткий текст
      const plain = `Sergek Dent: напоминание, ${kind === "24h" ? "завтра" : "через 2 часа"} в ${hm(a.startsAt)} — ${a.services}${a.tooth ? ` (${a.tooth})` : ""}, врач ${a.masterName}.`;
      try { await ctx.sms.send(a.clientPhone, plain); ok = true; } catch (e) { console.error("[sms] reminder failed:", (e as Error).message); }
    }
    if (ok) sent++;
    else await ctx.db.query(`DELETE FROM notices_sent WHERE key = $1`, [`rem:${kind}:${r.id}`]); // повторим на следующей минуте
  }
  return sent;
}

/** Вечерняя сводка владельцу/админу (с 21:00) и утреннее расписание врачу (с 08:30). */
export async function runSummaries(ctx: NoticeCtx): Promise<number> {
  const now = ctx.now();
  const date = almatyDateOf(now);
  const minutes = Number(hm(now).slice(0, 2)) * 60 + Number(hm(now).slice(3));
  let sent = 0;

  const links = await ctx.db.query<{ salon_id: string; user_id: string; chat_id: string; role: string; master_id: string | null }>(
    `SELECT u.salon_id, u.id AS user_id, tl.chat_id, u.role, u.master_id
       FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE u.active`,
  );
  for (const l of links.rows) {
    const isAdmin = l.role !== "master";
    if (isAdmin ? minutes < 21 * 60 : minutes < 8 * 60 + 30) continue;
    const key = `${isAdmin ? "sum" : "sched"}:${l.user_id}:${date}:${l.chat_id}`;
    const claimed = await ctx.db.query(`INSERT INTO notices_sent (key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING key`, [key]);
    if (!claimed.rows.length) continue;
    const text = isAdmin
      ? await daySummaryText(ctx, l.salon_id, date)
      : await masterScheduleText(ctx, l.salon_id, l.master_id!, date).then((s) => (s.count ? s.text : null));
    if (text && (await sendSafe(ctx.telegram, Number(l.chat_id), text))) sent++;
    else if (text) await ctx.db.query(`DELETE FROM notices_sent WHERE key = $1`, [key]);
  }
  return sent;
}

/** Запускает проверки раз в минуту. */
export function startScheduler(ctx: NoticeCtx): () => void {
  const tick = () => {
    runReminders(ctx).catch((e) => console.error("[scheduler] reminders:", e.message));
    runSummaries(ctx).catch((e) => console.error("[scheduler] summaries:", e.message));
  };
  const timer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  return () => clearInterval(timer);
}
