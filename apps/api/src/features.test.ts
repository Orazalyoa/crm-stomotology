import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DEMO_PASSWORD, openDb, seedDemo, withSalon, type Database } from "@salon/db";
import { ClaudeAi, RuleBasedAi } from "./ai";
import { buildApp } from "./app";
import { handleUpdate } from "./bot";
import { runReminders, runSummaries, type NoticeCtx } from "./notify";
import type { Button, TelegramClient } from "./telegram";
import * as messages from "./messages";
import { totpCode } from "./totp";

const NOW = new Date("2026-11-04T09:00:00+05:00");
const SECRET = "test-secret-test-secret-test-secret";

const sent: { chat: number; text: string; buttons?: Button[][]; menu?: string[][] | "remove" }[] = [];
const edits: { chat: number; messageId: number; text: string }[] = [];
const sms: { phone: string; text: string }[] = [];
const telegram: TelegramClient = {
  username: "test_bot",
  send: async (chat, text, options) => void sent.push({ chat: Number(chat), text, buttons: options?.buttons, menu: options?.menu }),
  edit: async (chat, messageId, text) => void edits.push({ chat: Number(chat), messageId, text }),
  answerCallback: async () => {},
};

let db: Database;
let app: FastifyInstance;
let salonId: string;
let nctx: NoticeCtx;
const ids = {} as Record<"daniyar" | "aidos" | "caries" | "consult" | "client", string>;

const cookieOf = (res: LightMyRequestResponse, name: string) =>
  [res.headers["set-cookie"]].flat().find((c) => c?.startsWith(`${name}=`))?.split(";")[0] as string;
const login = async (email: string, extra: object = {}) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: DEMO_PASSWORD, ...extra } });
const as = async (email: string) => cookieOf(await login(email), "sid_staff");
const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(payload !== undefined && { payload: payload as object }) });

async function clientLogin(phone: string, name: string) {
  await app.inject({ method: "POST", url: "/api/auth/client/request-otp", payload: { slug: "demo", phone } });
  const code = sms.at(-1)!.text.match(/код входа (\d{6})/)![1];
  const res = await app.inject({ method: "POST", url: "/api/auth/client/verify", payload: { slug: "demo", phone, code, fullName: name } });
  return cookieOf(res, "sid_client");
}

const startOf = (date: string, h: number) => `${date}T${String(h).padStart(2, "0")}:00:00+05:00`;

beforeAll(async () => {
  db = await openDb();
  salonId = await seedDemo(db, NOW);
  app = buildApp({ db, secret: SECRET, now: () => NOW, telegram, sms: { send: async (phone, text) => void sms.push({ phone, text }) } });
  nctx = { db, now: () => NOW, sms: { send: async (phone, text) => void sms.push({ phone, text }) }, telegram };
  await withSalon(db, salonId, async (q) => {
    ids.daniyar = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Данияр%'`)).rows[0]!.id;
    ids.aidos = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Айдос%'`)).rows[0]!.id;
    ids.caries = (await q<{ id: string }>(`SELECT id FROM services WHERE name = 'Лечение кариеса'`)).rows[0]!.id;
    ids.consult = (await q<{ id: string }>(`SELECT id FROM services WHERE name = 'Консультация стоматолога'`)).rows[0]!.id;
    ids.client = (await q<{ id: string }>(`SELECT id FROM clients ORDER BY full_name LIMIT 1`)).rows[0]!.id;
  });
});

describe("клиенты и конструктор полей", () => {
  let admin: string;
  beforeAll(async () => void (admin = await as("admin@sergek.ai")));

  it("создаёт поля разных типов и сохраняет значения в карточке", async () => {
    const text = (await call("POST", "/api/staff/custom-fields", admin, { label: "Формула краски", type: "text" })).json();
    const check = (await call("POST", "/api/staff/custom-fields", admin, { label: "Аллергия", type: "checkbox" })).json();
    const select = (await call("POST", "/api/staff/custom-fields", admin, { label: "Тип волос", type: "select", options: ["Жирные", "Сухие"] })).json();
    const money = (await call("POST", "/api/staff/custom-fields", admin, { label: "Депозит", type: "money" })).json();

    const res = await call("PATCH", `/api/staff/clients/${ids.client}`, admin, {
      notes: "Предпочитает оригинальные запчасти", tags: ["VIP", "VIP", "  "],
      custom: { [text.key]: "6.1 + 20%", [check.key]: true, [select.key]: "Сухие", [money.key]: 5000 },
    });
    expect(res.statusCode).toBe(200);

    const card = (await call("GET", `/api/staff/clients/${ids.client}`, admin)).json();
    expect(card.notes).toBe("Предпочитает оригинальные запчасти");
    expect(card.tags).toEqual(["VIP"]);
    expect(card.custom).toMatchObject({ [text.key]: "6.1 + 20%", [check.key]: true, [select.key]: "Сухие", [money.key]: 5000 });
    expect(Array.isArray(card.history)).toBe(true);
  });

  it("отклоняет неверные значения и неизвестные поля", async () => {
    const fields = (await call("GET", "/api/staff/custom-fields", admin)).json();
    const select = fields.find((f: { type: string }) => f.type === "select");
    const money = fields.find((f: { type: string }) => f.type === "money");
    expect((await call("PATCH", `/api/staff/clients/${ids.client}`, admin, { custom: { [select.key]: "Лысые" } })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/staff/clients/${ids.client}`, admin, { custom: { [money.key]: -5 } })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/staff/clients/${ids.client}`, admin, { custom: { nope: "x" } })).statusCode).toBe(400);
    expect((await call("POST", "/api/staff/custom-fields", admin, { label: "Тип", type: "select", options: ["один"] })).statusCode).toBe(400);
  });

  it("поиск и сегменты: «не были 60 дней»", async () => {
    const found = (await call("GET", `/api/staff/clients?q=${encodeURIComponent("Динара")}`, admin)).json();
    expect(found).toHaveLength(1);
    // Давний визит одного клиента → попадает в сегмент
    await db.query(
      `UPDATE appointments SET starts_at = starts_at - interval '100 days', ends_at = ends_at - interval '100 days'
        WHERE id = (SELECT id FROM appointments WHERE client_id = $1 AND status = 'paid' LIMIT 1)`, [found[0].id]);
    const all = (await call("GET", "/api/staff/clients", admin)).json();
    expect(all.length).toBeGreaterThanOrEqual(17);
  });

  it("мастер не видит карточки клиентов", async () => {
    expect((await call("GET", `/api/staff/clients/${ids.client}`, await as("daniyar@sergek.ai"))).statusCode).toBe(403);
  });
});

describe("услуги и мастера", () => {
  it("админ добавляет и правит услугу, скрытая услуга пропадает из онлайн-записи", async () => {
    const admin = await as("admin@sergek.ai");
    const created = await call("POST", "/api/staff/services", admin, { name: "Тонирование", durationMin: 50, priceTenge: 7000 });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await call("PATCH", `/api/staff/services/${id}`, admin, { priceTenge: 8000 })).statusCode).toBe(200);
    expect((await app.inject("/api/public/demo")).json().services.some((s: { id: string }) => s.id === id)).toBe(true);
    await call("PATCH", `/api/staff/services/${id}`, admin, { active: false });
    expect((await app.inject("/api/public/demo")).json().services.some((s: { id: string }) => s.id === id)).toBe(false);
    expect((await call("POST", "/api/staff/services", admin, { name: "x", durationMin: 0, priceTenge: 1 })).statusCode).toBe(400);
  });

  it("владелец создаёт мастера с входом; админ — не может; уволенный не входит", async () => {
    const owner = await as("owner@sergek.ai");
    const admin = await as("admin@sergek.ai");
    const body = { fullName: "Новый Мастер", email: "new.master@sergek.ai", password: "SuperSecret123", commissionPercent: 35 };
    expect((await call("POST", "/api/staff/masters", admin, body)).statusCode).toBe(403);
    const created = await call("POST", "/api/staff/masters", owner, body);
    expect(created.statusCode).toBe(201);
    expect((await call("POST", "/api/staff/masters", owner, body)).statusCode).toBe(409);

    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: body.email, password: body.password } });
    expect(res.json().redirect).toBe("/master");

    await call("PATCH", `/api/staff/masters/${created.json().id}`, owner, { active: false });
    const again = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: body.email, password: body.password } });
    expect(again.statusCode).toBe(401);
  });

  it("ставки видит только владелец", async () => {
    const asOwner = (await call("GET", "/api/staff/masters/full", await as("owner@sergek.ai"))).json();
    const asAdmin = (await call("GET", "/api/staff/masters/full", await as("admin@sergek.ai"))).json();
    expect(asOwner[0]).toHaveProperty("commissionPercent");
    expect(asAdmin[0]).not.toHaveProperty("commissionPercent");
  });

  it("график мастера меняет свободные слоты; пересекающиеся интервалы отклоняются", async () => {
    const admin = await as("admin@sergek.ai");
    const day = "2026-11-24"; // вторник
    const url = `/api/staff/slots?masterId=${ids.aidos}&date=${day}&serviceIds=${ids.caries}`;
    expect((await call("GET", url, admin)).json().slots).toContain(startOf(day, 10));

    const put = await call("PUT", `/api/staff/masters/${ids.aidos}/schedule`, admin, { intervals: [{ weekday: 2, start: 14 * 60, end: 18 * 60 }] });
    expect(put.statusCode).toBe(200);
    const slots: string[] = (await call("GET", url, admin)).json().slots;
    expect(slots[0]).toBe(startOf(day, 14));
    expect(slots).not.toContain(startOf(day, 10));

    const bad = await call("PUT", `/api/staff/masters/${ids.aidos}/schedule`, admin, { intervals: [{ weekday: 2, start: 600, end: 800 }, { weekday: 2, start: 700, end: 900 }] });
    expect(bad.statusCode).toBe(400);
  });
});

describe("касса, зарплата и аналитика", () => {
  it("оплата создаёт платёж, повторная оплата запрещена, неверный способ — 400", async () => {
    const admin = await as("admin@sergek.ai");
    const book = await call("POST", "/api/staff/appointments", admin, { masterId: ids.daniyar, clientId: ids.client, serviceIds: [ids.caries], startsAt: startOf("2026-11-04", 10) });
    expect(book.statusCode).toBe(201);
    const id = book.json().id;
    expect((await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "bitcoin" })).statusCode).toBe(400);
    const paid = await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "cash" });
    expect(paid.json()).toMatchObject({ status: "paid", amount: 20000 });
    expect((await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "cash" })).statusCode).toBe(409);

    const cash = (await call("GET", "/api/staff/cash?from=2026-11-04&to=2026-11-04", admin)).json();
    expect(cash.byMethod.find((m: { method: string }) => m.method === "cash").amount).toBeGreaterThanOrEqual(20000);
  });

  it("зарплата считается по схеме мастера и недоступна администратору", async () => {
    const owner = await as("owner@sergek.ai");
    const admin = await as("admin@sergek.ai");
    expect((await call("GET", "/api/staff/payroll", admin)).statusCode).toBe(403);

    await call("PATCH", `/api/staff/masters/${ids.daniyar}`, owner, { commissionPercent: 50, dayRateTenge: 1000 });
    const payroll = (await call("GET", "/api/staff/payroll?from=2026-11-01&to=2026-11-30", owner)).json();
    const row = payroll.items.find((i: { masterId: string }) => i.masterId === ids.daniyar);
    expect(row.commission).toBe(Math.round(row.revenue * 0.5));
    expect(row.rate).toBe(row.workedDays * 1000);
    expect(row.total).toBe(row.commission + row.rate);
    expect(row.revenue).toBeGreaterThan(0);
    expect(payroll.total).toBe(payroll.items.reduce((s: number, i: { total: number }) => s + i.total, 0));
  });

  it("аналитика согласована с кассой", async () => {
    const admin = await as("admin@sergek.ai");
    const a = (await call("GET", "/api/staff/analytics?from=2026-11-01&to=2026-11-30", admin)).json();
    const cash = (await call("GET", "/api/staff/cash?from=2026-11-01&to=2026-11-30", admin)).json();
    expect(a.revenue).toBe(cash.total);
    expect(a.visits).toBeGreaterThan(0);
    expect(a.avgCheck).toBe(Math.round(a.revenue / a.visits));
    expect(a.byDay).toHaveLength(30);
    expect(a.byMaster).toHaveLength(6);
    expect(a.byMaster.every((m: { loadPercent: number }) => m.loadPercent >= 0 && m.loadPercent <= 100)).toBe(true);
    expect((await call("GET", "/api/staff/analytics?from=2020-01-01&to=2026-11-30", admin)).statusCode).toBe(400); // слишком длинный период
  });
});

describe("двухфакторная защита (2FA)", () => {
  it("после включения вход требует код из приложения", async () => {
    const cookie = await as("admin@sergek.ai");
    const setup = (await call("POST", "/api/auth/2fa/setup", cookie, {})).json();
    expect(setup.otpauthUrl).toContain("otpauth://totp/");
    expect((await call("POST", "/api/auth/2fa/enable", cookie, { code: "000000" })).statusCode).toBe(400);
    expect((await call("POST", "/api/auth/2fa/enable", cookie, { code: totpCode(setup.secret, NOW.getTime()) })).statusCode).toBe(200);

    const noCode = await login("admin@sergek.ai");
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().needCode).toBe(true);
    expect(cookieOf(noCode, "sid_staff")).toBeUndefined();
    expect((await login("admin@sergek.ai", { code: "123456" })).statusCode).toBe(401);
    const ok = await login("admin@sergek.ai", { code: totpCode(setup.secret, NOW.getTime()) });
    expect(ok.statusCode).toBe(200);

    // отключить можно только с паролем и кодом
    const fresh = cookieOf(ok, "sid_staff");
    expect((await call("POST", "/api/auth/2fa/disable", fresh, { code: totpCode(setup.secret, NOW.getTime()), password: "wrong" })).statusCode).toBe(400);
    expect((await call("POST", "/api/auth/2fa/disable", fresh, { code: totpCode(setup.secret, NOW.getTime()), password: DEMO_PASSWORD })).statusCode).toBe(200);
    expect((await login("admin@sergek.ai")).statusCode).toBe(200);
  });
});

describe("Telegram: привязка, уведомления, напоминания, сводки", () => {
  const OWNER_CHAT = 1001, MASTER_CHAT = 1002, CLIENT_CHAT = 2001, OTHER_CHAT = 9999;
  let owner: string, master: string;

  const link = async (cookie: string, url: string, chat: number) => {
    const res = await call("POST", url, cookie, {});
    expect(res.statusCode).toBe(200);
    const code = res.json().url.split("start=")[1];
    expect(res.json().url).toContain("t.me/test_bot");
    await handleUpdate(nctx, { update_id: 1, message: { chat: { id: chat }, text: `/start ${code}` } });
    return code;
  };
  const textsTo = (chat: number) => sent.filter((s) => s.chat === chat).map((s) => s.text);

  beforeAll(async () => {
    owner = await as("owner@sergek.ai");
    master = await as("daniyar@sergek.ai");
    await link(owner, "/api/staff/telegram/link", OWNER_CHAT);
    await link(master, "/api/staff/telegram/link", MASTER_CHAT);
  });

  it("ссылка привязки одноразовая и чужой код не работает", async () => {
    const code = await link(owner, "/api/staff/telegram/link", 3001);
    await handleUpdate(nctx, { update_id: 2, message: { chat: { id: OTHER_CHAT }, text: `/start ${code}` } });
    expect(textsTo(OTHER_CHAT).at(-1)).toContain("Ссылка устарела");
    await handleUpdate(nctx, { update_id: 3, message: { chat: { id: OTHER_CHAT }, text: "/start fake" } });
    expect(textsTo(OTHER_CHAT).at(-1)).toContain("устарела");
  });

  it("новая запись приходит мастеру и владельцу, но не чужому мастеру", async () => {
    const admin = await as("admin@sergek.ai");
    const before = sent.length;
    const book = await call("POST", "/api/staff/appointments", admin, { masterId: ids.daniyar, clientId: ids.client, serviceIds: [ids.caries], startsAt: startOf("2026-11-17", 12) });
    expect(book.statusCode).toBe(201);
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(before + 2));
    expect(textsTo(OWNER_CHAT).at(-1)).toContain("Новая запись");
    expect(textsTo(MASTER_CHAT).at(-1)).toContain("Лечение кариеса");
  });

  it("напоминания: за 24 ч и за 2 ч, по одному разу; кнопка «Приду» подтверждает", async () => {
    const clientCookie = await clientLogin("+77019990001", "Клиент Телеграма");
    await link(clientCookie, "/api/my/telegram/link", CLIENT_CHAT);
    const book = await app.inject({ method: "POST", url: "/api/public/demo/book", headers: { cookie: clientCookie }, payload: { masterId: ids.daniyar, serviceIds: [ids.caries], startsAt: startOf("2026-11-18", 10) } });
    const apptId = book.json().id;

    const at = (iso: string): NoticeCtx => ({ ...nctx, now: () => new Date(iso) });
    expect(await runReminders(at("2026-11-17T12:00:00+05:00"))).toBeGreaterThanOrEqual(1);
    const reminder = sent.filter((s) => s.chat === CLIENT_CHAT && s.text.includes("Напоминание")).at(-1)!;
    expect(reminder.text).toMatch(/завтра/i);
    expect(reminder.buttons?.[0]?.map((b) => b.data)).toEqual([`confirm:${apptId}`, `cancel:${apptId}`]);
    expect(reminder.buttons?.[0]?.map((b) => b.text)).toEqual(["✅ Приду", "❌ Отменить"]);

    const count = sent.length;
    await runReminders(at("2026-11-17T12:05:00+05:00"));
    expect(sent.length).toBe(count); // повторно не шлём

    await runReminders(at("2026-11-18T08:30:00+05:00"));
    expect(sent.filter((s) => s.chat === CLIENT_CHAT && /через 2 часа/i.test(s.text))).toHaveLength(1);

    // чужой чат не может подтвердить чужую запись
    await handleUpdate(nctx, { update_id: 4, callback_query: { id: "x", data: `confirm:${apptId}`, message: { chat: { id: OTHER_CHAT } } } });
    expect((await db.query<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [apptId])).rows[0]!.status).toBe("booked");
    await handleUpdate(nctx, { update_id: 5, callback_query: { id: "y", data: `confirm:${apptId}`, message: { message_id: 55, chat: { id: CLIENT_CHAT } } } });
    expect((await db.query<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [apptId])).rows[0]!.status).toBe("confirmed");
    // напоминание превращается в карточку «подтверждено», кнопки исчезают
    expect(edits.at(-1)).toMatchObject({ chat: CLIENT_CHAT, messageId: 55 });
    expect(edits.at(-1)!.text).toContain("Запись подтверждена");
  });

  it("клиент без Telegram получает напоминание по SMS", async () => {
    const cookie = await clientLogin("+77019990002", "Клиент СМС");
    await app.inject({ method: "POST", url: "/api/public/demo/book", headers: { cookie }, payload: { masterId: ids.aidos, serviceIds: [ids.consult], startsAt: startOf("2026-12-01", 15) } });
    await runReminders({ ...nctx, now: () => new Date("2026-11-30T16:00:00+05:00") });
    expect(sms.some((m) => m.phone === "+77019990002" && /напоминание/i.test(m.text))).toBe(true);
  });

  it("сводки: вечером владельцу, утром мастеру, один раз в день", async () => {
    const evening: NoticeCtx = { ...nctx, now: () => new Date("2026-11-04T21:30:00+05:00") };
    await runSummaries(evening);
    expect(textsTo(OWNER_CHAT).some((t) => t.includes("Итоги дня"))).toBe(true);
    const count = sent.length;
    await runSummaries(evening);
    expect(sent.length).toBe(count);

    await runSummaries({ ...nctx, now: () => new Date("2026-11-04T08:45:00+05:00") });
    expect(textsTo(MASTER_CHAT).some((t) => t.includes("Ваше расписание"))).toBe(true);
  });

  it("команды бота: /today для мастера, отключение через /stop", async () => {
    await handleUpdate(nctx, { update_id: 6, message: { chat: { id: MASTER_CHAT }, text: "/today" } });
    expect(textsTo(MASTER_CHAT).at(-1)).toMatch(/Ваше расписание|Записей нет/);
    await handleUpdate(nctx, { update_id: 7, message: { chat: { id: MASTER_CHAT }, text: "/summary" } });
    expect(textsTo(MASTER_CHAT).at(-1)).toMatch(/владелец/);
    await handleUpdate(nctx, { update_id: 8, message: { chat: { id: MASTER_CHAT }, text: "/stop" } });
    expect((await call("GET", "/api/staff/telegram", master)).json().linked).toBe(false);
  });
});

describe("ИИ", () => {
  it("диктовка даёт черновик по правилам и ничего не сохраняет", async () => {
    const admin = await as("admin@sergek.ai");
    const res = await call("POST", "/api/staff/ai/dictation", admin, { text: "Постоянный пациент, аллергия на анестезию, очень боится лечения" });
    const draft = res.json();
    expect(draft.source).toBe("rules");
    expect(draft.tags).toEqual(expect.arrayContaining(["аллергия", "постоянный", "боится лечения"]));
    expect((await call("POST", "/api/staff/ai/dictation", admin, { text: "x" })).statusCode).toBe(400);
  });

  it("вопросы к данным недоступны без ключа (503)", async () => {
    const admin = await as("admin@sergek.ai");
    expect((await call("POST", "/api/staff/ai/ask", admin, { question: "Какая выручка за неделю?" })).statusCode).toBe(503);
  });

  it("Claude: цикл с инструментами возвращает ответ, диктовка при сбое падает на правила", async () => {
    const calls: { body: { tools?: unknown; messages: { role: string; content: unknown }[] } }[] = [];
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_stats", input: { from: "2026-11-01", to: "2026-11-30" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Выручка: 100 ₸" }] },
    ];
    const fake = (async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, json: async () => replies.shift() };
    }) as unknown as typeof fetch;
    const ai = new ClaudeAi("sk-test", fake);
    const ran: unknown[] = [];
    const answer = await ai.ask("Выручка?", [{ name: "get_stats", description: "d", schema: {}, run: async (i) => (ran.push(i), { revenue: 100 }) }]);
    expect(answer).toBe("Выручка: 100 ₸");
    expect(ran).toEqual([{ from: "2026-11-01", to: "2026-11-30" }]);
    expect(JSON.stringify(calls[1]!.body.messages.at(-1))).toContain("tool_result");

    const broken = new ClaudeAi("sk-test", (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    expect((await broken.structureDictation("аллергия на анестезию", [])).source).toBe("rules");
    expect(new RuleBasedAi().canAsk).toBe(false);
  });
});

describe("Telegram: меню и ответы бота", () => {
  const OWNER = 5001, MASTER = 5002, CLIENT = 5003, STRANGER = 5999;
  const last = (chat: number) => sent.filter((m) => m.chat === chat).at(-1)!;
  const say = (chat: number, text: string) => handleUpdate(nctx, { update_id: 1, message: { chat: { id: chat }, text } });
  const link = async (cookie: string, url: string, chat: number) => {
    const code = (await call("POST", url, cookie, {})).json().url.split("start=")[1];
    await say(chat, `/start ${code}`);
  };

  beforeAll(async () => {
    await link(await as("owner@sergek.ai"), "/api/staff/telegram/link", OWNER);
    await link(await as("daniyar@sergek.ai"), "/api/staff/telegram/link", MASTER);
    await link(await clientLogin("+77018880001", "Меню Клиент"), "/api/my/telegram/link", CLIENT);
  });

  it("после привязки каждый получает приветствие и своё меню", () => {
    expect(sent.find((m) => m.chat === OWNER)!.menu).toEqual([["📊 Итоги дня", "🗓 Сегодня"], ["🗓 Завтра", "❓ Помощь"]]);
    expect(sent.find((m) => m.chat === MASTER)!.menu).toEqual([["🗓 Сегодня", "🗓 Завтра"], ["❓ Помощь"]]);
    expect(sent.find((m) => m.chat === CLIENT)!.menu).toEqual([["📅 Мои записи"], ["❓ Помощь"]]);
    expect(sent.find((m) => m.chat === OWNER)!.text).toMatch(/^✅ <b>Готово, .+!<\/b>\n\nТеперь я:\n• /);
  });

  it("незнакомому человеку бот объясняет, как подключиться, и убирает меню", async () => {
    await say(STRANGER, "привет");
    expect(last(STRANGER).text).toContain("Я бот Sergek Dent");
    expect(last(STRANGER).text).toContain("Сотрудник");
    expect(last(STRANGER).menu).toBe("remove");
  });

  it("кнопки меню владельца: итоги, записи салона по мастерам, завтра", async () => {
    await say(OWNER, "📊 Итоги дня");
    expect(last(OWNER).text).toMatch(/^📊 <b>Итоги дня<\/b> · /);
    expect(last(OWNER).text).toContain("💰 Выручка:");
    await say(OWNER, "🗓 Сегодня");
    expect(last(OWNER).text).toContain("<b>Записи клиники</b>");
    expect(last(OWNER).text).toContain("👨‍🦷 <b>");
    await say(OWNER, "🗓 Завтра");
    expect(last(OWNER).text).toContain("Записи на завтра");
  });

  it("мастер видит только своё расписание и не видит итоги", async () => {
    await say(MASTER, "🗓 Сегодня");
    expect(last(MASTER).text).toContain("Ваше расписание");
    expect(last(MASTER).text).not.toContain("Айдос");
    await say(MASTER, "🗓 Завтра");
    expect(last(MASTER).text).toContain("Расписание на завтра");
    await say(MASTER, "📊 Итоги дня");
    expect(last(MASTER).text).toContain("Недоступно");
  });

  it("клиент: «Мои записи» и справка; чужие кнопки не работают", async () => {
    await say(CLIENT, "📅 Мои записи");
    expect(last(CLIENT).text).toMatch(/Ваши ближайшие записи|Ближайших записей нет/);
    await say(CLIENT, "❓ Помощь");
    expect(last(CLIENT).text).toContain("Что я умею");
    await say(CLIENT, "📊 Итоги дня");
    expect(last(CLIENT).text).toContain("Недоступно");
  });

  it("непонятный текст — подсказка и меню, а не молчание", async () => {
    await say(OWNER, "абракадабра");
    expect(last(OWNER).text).toContain("Не понял");
    expect(last(OWNER).menu).toBeTruthy();
  });
});

describe("Telegram: оформление сообщений", () => {
  const view = {
    startsAt: new Date("2026-11-26T10:00:00+05:00"), endsAt: new Date("2026-11-26T10:45:00+05:00"),
    clientName: "<b>Хакер</b> & Ко", clientPhone: "+77011112233", services: "Стрижка <i>", masterName: "Данияр", priceTenge: 4500,
  };

  it("новая запись: заголовок жирным и по строке на каждый факт", () => {
    const lines = messages.bookedForStaff(view).split("\n");
    expect(lines[0]).toBe("🆕 <b>Новая запись</b>");
    expect(lines[1]).toBe("");
    expect(lines.slice(2).map((l) => [...l][0])).toEqual(["📅", "👤", "📞", "🦷", "👨", "💰"]);
    expect(lines[2]).toBe("📅 <b>Чт, 26 ноября · 10:00–10:45</b>");
    expect(lines.at(-1)).toMatch(/^💰 4\s500 ₸$/);
  });

  it("имена и услуги из базы экранируются: разметка не ломается", () => {
    const text = messages.bookedForStaff(view);
    expect(text).toContain("&lt;b&gt;Хакер&lt;/b&gt; &amp; Ко");
    expect(text).toContain("Стрижка &lt;i&gt;");
    expect(text).not.toContain("<b>Хакер");
  });

  it("напоминание отличает «завтра» и «через 2 часа» и зовёт нажать кнопку", () => {
    expect(messages.reminder(view, "24h")).toContain("Завтра, <b>10:00</b>");
    expect(messages.reminder(view, "2h")).toContain("Через 2 часа, <b>10:00</b>");
    expect(messages.reminder(view, "2h")).toMatch(/Подтвердите, пожалуйста 👇$/);
  });

  it("итоги дня и расписание читаются сверху вниз", () => {
    const day = new Date("2026-11-04T09:00:00+05:00");
    const lines = messages.daySummary(day, { visits: 5, revenue: 32000, noShow: 1, cancelled: 0, tomorrow: 8 }).split("\n");
    expect(lines[0]).toBe("📊 <b>Итоги дня</b> · Ср, 4 ноября");
    expect(lines.slice(2, 6).map((l) => l.replace(/\s/g, " "))).toEqual(["💰 Выручка: <b>32 000 ₸</b>", "✅ Визитов: <b>5</b>", "🚫 Неявок: 1", "❌ Отмен: 0"]);
    expect(lines.at(-1)).toBe("📆 Завтра записей: <b>8</b>");

    const rows = [{ startsAt: view.startsAt, endsAt: view.endsAt, clientName: "Аян", services: "Лечение кариеса" }];
    expect(messages.masterSchedule(day, "Ваше расписание", rows)).toContain("<b>10:00–10:45</b>  Аян\n      🦷 Лечение кариеса");
    expect(messages.masterSchedule(day, "Ваше расписание", [])).toContain("Записей нет");
  });

  it("сообщение на большом дне укладывается в лимит Telegram (4096)", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ startsAt: view.startsAt, endsAt: view.endsAt, clientName: `Клиент ${i}`, services: "Окрашивание, Лечение кариеса", masterName: `Мастер ${i % 6}` }));
    expect(messages.salonSchedule(view.startsAt, "Записи клиники", rows).length).toBeLessThan(4096);
  });
});
