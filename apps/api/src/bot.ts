import { withSalon } from "@salon/db";
import { almatyDateOf } from "./availability";
import * as msg from "./messages";
import {
  apptInfo, clientUpcomingText, daySummaryText, masterScheduleText, nextDate, notifyCancelled, salonScheduleText, sendSafe,
  type NoticeCtx,
} from "./notify";
import { CANCEL_MIN_HOURS } from "./status";
import type { SendOptions, TgUpdate } from "./telegram";

type Action = "today" | "tomorrow" | "summary" | "mine" | "help" | "stop";

/** Кнопки меню и команды сводятся к одним и тем же действиям. */
const ACTIONS: Record<string, Action> = {
  [msg.BTN.today]: "today", [msg.BTN.tomorrow]: "tomorrow", [msg.BTN.summary]: "summary", [msg.BTN.mine]: "mine", [msg.BTN.help]: "help",
  "/today": "today", "/tomorrow": "tomorrow", "/summary": "summary", "/mine": "mine", "/help": "help", "/stop": "stop",
};

type Who =
  | { kind: "user"; salonId: string; role: "owner" | "admin" | "master"; masterId: string | null; name: string }
  | { kind: "client"; salonId: string; clientId: string; name: string };

/** Кто пишет. Права определяются по привязанному чату, а не по тексту сообщения. */
async function whoIs(ctx: NoticeCtx, chatId: number): Promise<Who | null> {
  const u = (await ctx.db.query<{ salon_id: string; role: "owner" | "admin" | "master"; master_id: string | null; full_name: string }>(
    `SELECT u.salon_id, u.role, u.master_id, u.full_name FROM telegram_links tl JOIN users u ON u.id = tl.user_id WHERE tl.chat_id = $1 AND u.active LIMIT 1`, [chatId])).rows[0];
  if (u) return { kind: "user", salonId: u.salon_id, role: u.role, masterId: u.master_id, name: u.full_name };
  const c = (await ctx.db.query<{ salon_id: string; client_id: string; full_name: string }>(
    `SELECT tl.salon_id, tl.client_id, c.full_name FROM telegram_links tl JOIN clients c ON c.id = tl.client_id WHERE tl.chat_id = $1 AND tl.kind = 'client' LIMIT 1`, [chatId])).rows[0];
  return c ? { kind: "client", salonId: c.salon_id, clientId: c.client_id, name: c.full_name } : null;
}
const roleOf = (w: Who): msg.Role => (w.kind === "client" ? "client" : w.role);

const say = (ctx: NoticeCtx, chatId: number, text: string, options?: SendOptions) => sendSafe(ctx.telegram, chatId, text, options);

/** Разбирает входящее сообщение или нажатие кнопки. */
export async function handleUpdate(ctx: NoticeCtx, update: TgUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(ctx, update.callback_query);
  const message = update.message;
  if (!message?.text) return;
  const chatId = message.chat.id;
  const [command, arg] = message.text.trim().split(/\s+/, 2);

  if (command === "/start" && arg) return link(ctx, chatId, arg);

  const who = await whoIs(ctx, chatId);
  if (!who) return void (await say(ctx, chatId, msg.notConnected(), { menu: "remove" }));

  const action = ACTIONS[message.text.trim()] ?? (command === "/start" ? "help" : undefined);
  if (!action) return void (await say(ctx, chatId, msg.unknownCommand(), { menu: msg.MENU[roleOf(who)] }));
  return run(ctx, chatId, who, action);
}

async function run(ctx: NoticeCtx, chatId: number, who: Who, action: Action) {
  const role = roleOf(who);
  const menu = { menu: msg.MENU[role] };
  const today = almatyDateOf(ctx.now());
  const isAdmin = who.kind === "user" && who.role !== "master";

  switch (action) {
    case "help":
      return void (await say(ctx, chatId, msg.help(role), menu));
    case "stop":
      await ctx.db.query(`DELETE FROM telegram_links WHERE chat_id = $1`, [chatId]);
      return void (await say(ctx, chatId, msg.stopped(), { menu: "remove" }));
    case "mine":
      if (who.kind !== "client") return void (await say(ctx, chatId, msg.unknownCommand(), menu));
      return void (await say(ctx, chatId, await clientUpcomingText(ctx, who.salonId, who.clientId), menu));
    case "summary":
      if (!isAdmin) return void (await say(ctx, chatId, msg.summaryForbidden(), menu));
      return void (await say(ctx, chatId, await daySummaryText(ctx, who.salonId, today), menu));
    case "today":
    case "tomorrow": {
      if (who.kind === "client") return void (await say(ctx, chatId, msg.unknownCommand(), menu));
      const date = action === "today" ? today : nextDate(today);
      const text = who.role === "master"
        ? (await masterScheduleText(ctx, who.salonId, who.masterId!, date, action === "today" ? "Ваше расписание" : "Расписание на завтра")).text
        : await salonScheduleText(ctx, who.salonId, date, action === "today" ? "Записи клиники" : "Записи на завтра");
      return void (await say(ctx, chatId, text, menu));
    }
  }
}

async function link(ctx: NoticeCtx, chatId: number, code: string) {
  const { rows } = await ctx.db.query<{ salon_id: string; kind: string; user_id: string | null; client_id: string | null }>(
    `DELETE FROM telegram_codes WHERE code = $1 AND expires_at > $2 RETURNING salon_id, kind, user_id, client_id`,
    [code, ctx.now()],
  );
  const c = rows[0];
  if (!c) return void (await say(ctx, chatId, msg.linkExpired()));

  await ctx.db.query(
    `INSERT INTO telegram_links (salon_id, kind, user_id, client_id, chat_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [c.salon_id, c.kind, c.user_id, c.client_id, chatId],
  );
  const who = await whoIs(ctx, chatId);
  const role: msg.Role = c.kind === "client" ? "client"
    : ((await ctx.db.query<{ role: "owner" | "admin" | "master" }>(`SELECT role FROM users WHERE id = $1`, [c.user_id])).rows[0]?.role ?? "admin");
  await say(ctx, chatId, msg.linked(who?.name ?? "", role), { menu: msg.MENU[role] });
}

/** Кнопки «Приду» и «Отменить» под напоминанием. Действует только клиент, привязанный к этому чату. */
async function handleCallback(ctx: NoticeCtx, cb: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const [action, id] = (cb.data ?? "").split(":");
  const answer = (t: string) => ctx.telegram?.answerCallback?.(cb.id, t).catch(() => {});
  if (!chatId || !id || !["confirm", "cancel"].includes(action ?? "")) return void (await answer("Неизвестное действие"));

  const own = (await ctx.db.query<{ salon_id: string; status: string; starts_at: Date }>(
    `SELECT a.salon_id, a.status, a.starts_at FROM appointments a JOIN telegram_links tl ON tl.client_id = a.client_id
      WHERE a.id = $1 AND tl.chat_id = $2`, [id, chatId])).rows[0];
  if (!own || !["booked", "confirmed"].includes(own.status)) {
    await answer("Запись уже недоступна");
    return void (await replace(ctx, chatId, messageId, msg.noAppointment()));
  }

  const info = await apptInfo(ctx, own.salon_id, id);
  if (action === "confirm") {
    await withSalon(ctx.db, own.salon_id, (q) => q(`UPDATE appointments SET status = 'confirmed' WHERE id = $1`, [id]));
    await answer("Спасибо, ждём вас!");
    return void (await replace(ctx, chatId, messageId, info ? msg.confirmedCard(info) : "✅ Запись подтверждена"));
  }
  if (own.starts_at.getTime() - ctx.now().getTime() < CANCEL_MIN_HOURS * 3600_000) {
    await answer("Слишком поздно отменять");
    return void (await say(ctx, chatId, msg.tooLateToCancel(CANCEL_MIN_HOURS)));
  }
  await withSalon(ctx.db, own.salon_id, (q) => q(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [id]));
  await answer("Запись отменена");
  await replace(ctx, chatId, messageId, info ? msg.cancelledCard(info) : "❌ Запись отменена");
  await notifyCancelled(ctx, own.salon_id, id, true);
}

/** Меняет само напоминание на итог (кнопки исчезают); если нельзя — отправляет новое сообщение. */
async function replace(ctx: NoticeCtx, chatId: number, messageId: number | undefined, text: string) {
  if (messageId && ctx.telegram?.edit) {
    try { return await ctx.telegram.edit(chatId, messageId, text); } catch { /* сообщение устарело — отправим новое */ }
  }
  await say(ctx, chatId, text);
}
