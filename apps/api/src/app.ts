import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { verifyPassword, withSalon, type Database, type Queryable } from "@salon/db";
import { listAppointments } from "./appointments";
import { almatyDateOf, freeStartMinutes, serviceTotals, slotsToIso } from "./availability";
import { bookAppointment } from "./booking";
import { RateLimiter } from "./ratelimit";
import {
  CLIENT_COOKIE, CLIENT_TTL_SEC, STAFF_COOKIE, STAFF_TTL_SEC,
  clearCookie, parseCookies, setCookie, signSession, verifySession,
  type ClientSession, type StaffRole, type StaffSession,
} from "./session";
import { CANCEL_MIN_HOURS, MASTER_STATUSES, canTransition, isStatus } from "./status";
import { RuleBasedAi, type Ai } from "./ai";
import type { Ctx, SmsSender } from "./ctx";
import { registerFeatures } from "./features";
import { registerOrder } from "./order";
import { notifyBooked, notifyCancelled } from "./notify";
import type { TelegramClient } from "./telegram";
import { verifyTotp } from "./totp";
import { isDate, isUuid, normalizePhone } from "./util";

export { normalizePhone };
export type { SmsSender };

export interface AppOptions {
  db: Database;
  /** Ключ подписи сессий. */
  secret: string;
  now?: () => Date;
  /** Доставка SMS. Провайдер ещё не выбран, поэтому по умолчанию код пишется в консоль (только для разработки). */
  sms?: SmsSender;
  /** Telegram-бот для уведомлений; без него уведомления выключены. */
  telegram?: TelegramClient | null;
  ai?: Ai;
  /** Ставит флаг Secure на cookie; включать за HTTPS. */
  secureCookies?: boolean;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PAGES = {
  login: join(root, "auth", "login.html"),
  admin: join(root, "admin", "index.html"),
  adminMobile: join(root, "admin", "mobile.html"),
  master: join(root, "master", "index.html"),
  client: join(root, "client", "index.html"),
} as const;
const ASSETS: Record<string, string> = {
  "ui.css": "text/css; charset=utf-8",
  "common.js": "text/javascript; charset=utf-8",
  "booking-dialog.js": "text/javascript; charset=utf-8",
  "i18n.js": "text/javascript; charset=utf-8",
};

// Хеш для выравнивания времени ответа, когда email не найден (иначе по скорости можно перебирать адреса).
const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

const TABS = {
  upcoming: { where: `starts_at >= $1 AND status IN ('booked','confirmed')`, order: "ASC" },
  cancelled: { where: `status = 'cancelled'`, order: "DESC" },
  all: { where: undefined, order: "DESC" },
} as const;

export function buildApp(opts: AppOptions): FastifyInstance {
  const { db, secret, secureCookies = false } = opts;
  const now = opts.now ?? (() => new Date());
  const sms: SmsSender = opts.sms ?? { send: async (phone, text) => void console.log(`[SMS dev] ${phone}: ${text}`) };
  const telegram = opts.telegram ?? null;
  const ai = opts.ai ?? new RuleBasedAi();
  const logFail = (what: string) => (e: Error) => console.error(`[${what}]`, e.message);

  const app = Fastify();
  app.decorateRequest("staff", null);
  app.decorateRequest("client", null);

  const loginLimiter = new RateLimiter(5, 15 * 60_000);
  const otpCooldown = new RateLimiter(1, 60_000);
  const otpHourly = new RateLimiter(5, 3600_000);

  const inSalon = <T>(salonId: string, run: (q: Queryable) => Promise<T>) => withSalon(db, salonId, run);
  const hash = (...parts: string[]) => createHash("sha256").update([secret, ...parts].join("|")).digest("hex");

  /* ----------------------------- сессии и защита ----------------------------- */

  app.addHook("onRequest", async (req) => {
    const cookies = parseCookies(req.headers.cookie);
    const staff = verifySession(cookies[STAFF_COOKIE], secret, now());
    if (staff?.kind === "staff") {
      // Проверяем у владельца БД: деактивированный сотрудник теряет доступ сразу, не дожидаясь конца сессии.
      const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND active`, [staff.userId]);
      if (rows.length) req.staff = staff;
    }
    const client = verifySession(cookies[CLIENT_COOKIE], secret, now());
    if (client?.kind === "client") req.client = client;
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com; connect-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  /** Защита API: 401 без сессии, 403 при чужой роли. */
  const staffOnly = (...roles: StaffRole[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.staff) return reply.code(401).send({ error: "unauthorized" });
    if (!roles.includes(req.staff.role)) return reply.code(403).send({ error: "forbidden" });
  };
  const clientOnly = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.client) return reply.code(401).send({ error: "unauthorized" });
  };
  const ADMINS: StaffRole[] = ["owner", "admin"];

  /** Страницы чужим ролям не просто закрыты, а «не существуют» (404). */
  const page = (file: string, allowed: (req: FastifyRequest) => boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!allowed(req)) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    return reply.type("text/html; charset=utf-8").send(readFileSync(file, "utf8"));
  };
  const isAdmin = (req: FastifyRequest) => !!req.staff && ADMINS.includes(req.staff.role);

  /* --------------------------------- страницы -------------------------------- */

  app.get("/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(`<!doctype html><meta charset="utf-8"><title>Sergek Dent</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#fff"><b style="letter-spacing:.1em">SERGEK DENT</b>`),
  );
  app.get("/login", page(PAGES.login, () => true));
  app.get("/admin", page(PAGES.admin, isAdmin));
  app.get("/admin/m", page(PAGES.adminMobile, isAdmin));
  // Скрипты разделов админки отдаются только администраторам.
  app.get("/admin/pages.js", async (req, reply) =>
    isAdmin(req)
      ? reply.type("text/javascript; charset=utf-8").send(readFileSync(join(root, "admin", "pages.js"), "utf8"))
      : reply.code(404).type("text/plain; charset=utf-8").send("Not found"),
  );
  app.get("/master", page(PAGES.master, (req) => req.staff?.role === "master"));
  app.get("/b/:slug", page(PAGES.client, () => true));
  app.get("/b/:slug/my", page(PAGES.client, () => true));

  app.get<{ Params: { file: string } }>("/assets/:file", async (req, reply) => {
    const type = ASSETS[req.params.file];
    if (!type) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    return reply.type(type).send(readFileSync(join(root, "shared", req.params.file), "utf8"));
  });

  /* ------------------------------ вход персонала ----------------------------- */

  app.post<{ Body: { email?: string; password?: string; code?: string } }>("/api/auth/login", async (req, reply) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const key = `${req.ip}|${email}`;
    if (loginLimiter.blocked(key, now())) return reply.code(429).send({ error: "too many attempts, try later" });

    const { rows } = await db.query<{
      id: string; salon_id: string; password_hash: string; full_name: string; role: StaffRole; master_id: string | null;
      totp_secret: string | null; totp_enabled: boolean;
    }>(`SELECT id, salon_id, password_hash, full_name, role, master_id, totp_secret, totp_enabled FROM users WHERE lower(email) = $1 AND active`, [email]);
    const user = rows[0];
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid) {
      loginLimiter.hit(key, now());
      return reply.code(401).send({ error: "invalid email or password" });
    }
    // Второй фактор: пароль верен, но нужен код из приложения-аутентификатора.
    if (user.totp_enabled && user.totp_secret) {
      const code = String(req.body?.code ?? "");
      if (!code) return reply.code(401).send({ error: "code required", needCode: true });
      if (!verifyTotp(user.totp_secret, code, now())) {
        loginLimiter.hit(key, now());
        return reply.code(401).send({ error: "invalid code", needCode: true });
      }
    }
    loginLimiter.reset(key);

    const session: StaffSession = {
      kind: "staff", salonId: user.salon_id, userId: user.id, role: user.role,
      masterId: user.master_id, name: user.full_name, exp: Math.floor(now().getTime() / 1000) + STAFF_TTL_SEC,
    };
    reply.header("Set-Cookie", setCookie(STAFF_COOKIE, signSession(session, secret), STAFF_TTL_SEC, secureCookies));
    return { role: user.role, name: user.full_name, redirect: user.role === "master" ? "/master" : "/admin" };
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.header("Set-Cookie", clearCookie(STAFF_COOKIE, secureCookies));
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: staffOnly("owner", "admin", "master") }, async (req) => ({
    name: req.staff!.name,
    role: req.staff!.role,
    twoFactor: (await db.query<{ totp_enabled: boolean }>(`SELECT totp_enabled FROM users WHERE id = $1`, [req.staff!.userId])).rows[0]?.totp_enabled ?? false,
    salonSlug: (await db.query<{ slug: string }>(`SELECT slug FROM salons WHERE id = $1`, [req.staff!.salonId])).rows[0]?.slug,
  }));

  /* ------------------------------ вход клиента ------------------------------- */

  const salonBySlug = async (slug: unknown) =>
    typeof slug === "string"
      ? (await db.query<{ id: string; name: string }>(`SELECT id, name FROM salons WHERE slug = $1`, [slug])).rows[0]
      : undefined;

  app.post<{ Body: { slug?: string; phone?: string } }>("/api/auth/client/request-otp", async (req, reply) => {
    const salon = await salonBySlug(req.body?.slug);
    const phone = normalizePhone(req.body?.phone);
    if (!salon) return reply.code(404).send({ error: "clinic not found" });
    if (!phone) return reply.code(400).send({ error: "invalid phone" });

    const key = `${salon.id}|${phone}`;
    if (!otpCooldown.hit(key, now()) || !otpHourly.hit(key, now())) {
      return reply.code(429).send({ error: "code was sent recently, try later" });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.query(`DELETE FROM client_otps WHERE salon_id = $1 AND phone = $2`, [salon.id, phone]);
    await db.query(
      `INSERT INTO client_otps (salon_id, phone, code_hash, expires_at) VALUES ($1,$2,$3,$4)`,
      [salon.id, phone, hash(salon.id, phone, code), new Date(now().getTime() + 5 * 60_000)],
    );
    await sms.send(phone, `Sergek Dent: код входа ${code}. Никому не сообщайте его.`);
    // Одинаковый ответ для известных и неизвестных номеров — нельзя выяснить, кто лечится в клинике.
    return { ok: true };
  });

  app.post<{ Body: { slug?: string; phone?: string; code?: string; fullName?: string } }>(
    "/api/auth/client/verify",
    async (req, reply) => {
      const salon = await salonBySlug(req.body?.slug);
      const phone = normalizePhone(req.body?.phone);
      const code = String(req.body?.code ?? "");
      if (!salon || !phone) return reply.code(400).send({ error: "invalid request" });

      const { rows } = await db.query<{ id: string; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM client_otps
          WHERE salon_id = $1 AND phone = $2 AND expires_at > $3 ORDER BY created_at DESC LIMIT 1`,
        [salon.id, phone, now()],
      );
      const otp = rows[0];
      const expected = Buffer.from(otp?.code_hash ?? "0".repeat(64));
      const given = Buffer.from(hash(salon.id, phone, code));
      const ok = !!otp && otp.attempts < 5 && expected.length === given.length && timingSafeEqual(expected, given);
      if (!ok) {
        if (otp) await db.query(`UPDATE client_otps SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
        return reply.code(401).send({ error: "invalid or expired code" });
      }
      await db.query(`DELETE FROM client_otps WHERE salon_id = $1 AND phone = $2`, [salon.id, phone]);

      const fullName = String(req.body?.fullName ?? "").trim();
      const client = await inSalon(salon.id, async (q) => {
        const found = (await q<{ id: string; full_name: string }>(`SELECT id, full_name FROM clients WHERE phone = $1`, [phone])).rows[0];
        if (found) return { id: found.id, name: found.full_name };
        if (fullName.length < 2) return null;
        const created = await q<{ id: string }>(
          `INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
          [salon.id, fullName.slice(0, 100), phone],
        );
        return { id: created.rows[0]!.id, name: fullName };
      });
      if (!client) return reply.code(400).send({ error: "name is required for a new client" });

      const session: ClientSession = {
        kind: "client", salonId: salon.id, clientId: client.id, name: client.name,
        exp: Math.floor(now().getTime() / 1000) + CLIENT_TTL_SEC,
      };
      reply.header("Set-Cookie", setCookie(CLIENT_COOKIE, signSession(session, secret), CLIENT_TTL_SEC, secureCookies));
      return { ok: true, fullName: client.name };
    },
  );

  app.post("/api/auth/client/logout", async (_req, reply) => {
    reply.header("Set-Cookie", clearCookie(CLIENT_COOKIE, secureCookies));
    return { ok: true };
  });

  /* ------------------------------- общие запросы ------------------------------ */

  async function slotsFor(q: Queryable, query: { masterId?: string; date?: string; serviceIds?: string }) {
    const serviceIds = (query.serviceIds ?? "").split(",").filter(Boolean);
    if (!isUuid(query.masterId) || !isDate(query.date) || !serviceIds.length || !serviceIds.every(isUuid)) return null;
    const totals = await serviceTotals(q, query.masterId, serviceIds);
    if (!totals) return null;
    const minutes = await freeStartMinutes(q, { masterId: query.masterId, date: query.date, durationMin: totals.durationMin, now: now() });
    return { slots: slotsToIso(query.date, minutes), durationMin: totals.durationMin, priceTenge: totals.priceTenge };
  }

  const bookingBody = (body: { masterId?: string; clientId?: string; toothId?: string; serviceIds?: string[]; startsAt?: string } | undefined) => {
    const startsAt = new Date(body?.startsAt ?? "");
    if (!isUuid(body?.masterId) || !Array.isArray(body?.serviceIds) || !body.serviceIds.length ||
        !body.serviceIds.every(isUuid) || Number.isNaN(startsAt.getTime())) return null;
    if (body.toothId !== undefined && body.toothId !== null && !isUuid(body.toothId)) return null;
    return { masterId: body.masterId, serviceIds: body.serviceIds, startsAt, clientId: body.clientId, toothId: body.toothId ?? null };
  };

  const noticeCtx = { db, now, sms, telegram };

  const sendBooking = (reply: FastifyReply, r: Awaited<ReturnType<typeof bookAppointment>>, salonId: string) => {
    if (!r.ok) {
      return reply.code(r.reason === "unknown" ? 400 : 409).send({ error: r.reason === "unknown" ? "unknown doctor, patient, tooth or service" : "time slot is not available" });
    }
    // Уведомления идут в фоне: сбой Telegram не должен ломать запись.
    void notifyBooked(noticeCtx, salonId, r.id).catch(logFail("notify"));
    return reply.code(201).send({ id: r.id, status: r.status, priceTenge: r.priceTenge });
  };

  /* --------------------------- API персонала (владелец, админ) --------------------------- */

  const admin = { preHandler: staffOnly(...ADMINS) };

  app.get("/api/staff/dashboard", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) => {
      const { rows } = await q<Record<string, number>>(
        `SELECT (SELECT count(*) FROM clients)::int  AS clients,
                (SELECT count(*) FROM services WHERE active)::int AS services,
                (SELECT count(*) FROM masters WHERE active)::int  AS masters,
                (SELECT count(*) FROM teeth)::int AS teeth,
                (SELECT count(*) FROM appointments WHERE status = 'in_progress')::int AS "inProgress",
                (SELECT count(*) FROM appointments
                  WHERE status NOT IN ('cancelled','no_show')
                    AND starts_at >= $1::timestamptz
                    AND starts_at <  $1::timestamptz + interval '1 day')::int AS "appointmentsToday"`,
        [`${almatyDateOf(now())}T00:00:00+05:00`],
      );
      return rows[0];
    }),
  );

  app.get<{ Querystring: { tab?: string; status?: string; q?: string; page?: string; pageSize?: string } }>(
    "/api/staff/appointments", admin,
    (req, reply) => {
      const tab = (req.query.tab ?? "upcoming") as keyof typeof TABS;
      if (!(tab in TABS)) return reply.code(400).send({ error: "unknown tab" });
      const status = req.query.status;
      if (status && !isStatus(status)) return reply.code(400).send({ error: "unknown status" });
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
      const pageNo = Math.max(1, Number(req.query.page) || 1);
      return inSalon(req.staff!.salonId, (q) =>
        listAppointments(q, {
          // Вкладка и статус складываются через И; статус передаётся параметром, а не склеивается в SQL.
          where: [TABS[tab].where, status ? `status = $3` : undefined].filter(Boolean).join(" AND ") || undefined,
          params: status ? [status] : undefined,
          order: TABS[tab].order, search: req.query.q,
          limit: pageSize, offset: (pageNo - 1) * pageSize, now: now(),
        }),
      );
    },
  );

  app.get("/api/staff/masters", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) => (await q(`SELECT id, full_name AS "fullName" FROM masters WHERE active ORDER BY full_name`)).rows),
  );
  app.get("/api/staff/services", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) =>
      (await q(`SELECT id, name, duration_min AS "durationMin", price_tenge AS "priceTenge" FROM services WHERE active ORDER BY name`)).rows),
  );
  app.post<{ Body: { fullName?: string; phone?: string } }>("/api/staff/clients", admin, async (req, reply) => {
    const fullName = String(req.body?.fullName ?? "").trim();
    const phone = normalizePhone(req.body?.phone);
    if (fullName.length < 2 || !phone) return reply.code(400).send({ error: "name and a valid +7 phone are required" });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      const dup = await q(`SELECT 1 FROM clients WHERE phone = $1`, [phone]);
      if (dup.rows.length) return reply.code(409).send({ error: "client with this phone already exists" });
      const { rows } = await q<{ id: string }>(
        `INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
        [salonId, fullName.slice(0, 100), phone],
      );
      return reply.code(201).send({ id: rows[0]!.id });
    });
  });

  app.get<{ Querystring: { masterId?: string; date?: string; serviceIds?: string } }>("/api/staff/slots", admin, async (req, reply) => {
    const result = await inSalon(req.staff!.salonId, (q) => slotsFor(q, req.query));
    return result ?? reply.code(400).send({ error: "masterId, date (YYYY-MM-DD) and serviceIds are required" });
  });

  app.post<{ Body: { masterId?: string; clientId?: string; toothId?: string; serviceIds?: string[]; startsAt?: string } }>(
    "/api/staff/appointments", admin,
    async (req, reply) => {
      const b = bookingBody(req.body);
      if (!b || !isUuid(b.clientId)) return reply.code(400).send({ error: "masterId, clientId, serviceIds[] and startsAt are required" });
      const salonId = req.staff!.salonId;
      return sendBooking(reply, await inSalon(salonId, (q) => bookAppointment(q, { salonId, ...b, clientId: b.clientId!, now: now() })), salonId);
    },
  );

  app.patch<{ Params: { id: string }; Body: { status?: string } }>("/api/staff/appointments/:id", admin, async (req, reply) => {    const to = req.body?.status;
    if (!isUuid(req.params.id) || !isStatus(to)) return reply.code(400).send({ error: "invalid request" });
    // Оплата проходит через кассу (POST …/pay), чтобы не было «оплачено» без платежа.
    if (to === "paid") return reply.code(400).send({ error: "use POST /api/staff/appointments/:id/pay" });
    const result = await changeStatus(req.staff!.salonId, req.params.id, to, null, reply);
    if (to === "cancelled" && !reply.sent && (result as { status?: string })?.status === "cancelled") {
      void notifyCancelled(noticeCtx, req.staff!.salonId, req.params.id, false).catch(logFail("notify"));
    }
    return result;
  });

  async function changeStatus(salonId: string, id: string, to: string, masterId: string | null, reply: FastifyReply) {
    return inSalon(salonId, async (q) => {
      const { rows } = await q<{ status: string }>(
        `SELECT status FROM appointments WHERE id = $1 ${masterId ? "AND master_id = $2" : ""}`,
        masterId ? [id, masterId] : [id],
      );
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      if (!isStatus(to) || !isStatus(rows[0].status) || !canTransition(rows[0].status, to)) {
        return reply.code(409).send({ error: `cannot change ${rows[0].status} to ${to}` });
      }
      await q(`UPDATE appointments SET status = $2 WHERE id = $1`, [id, to]);
      return { id, status: to };
    });
  }

  /* ------------------------------------ мастер ------------------------------------ */

  const masterOnly = { preHandler: staffOnly("master") };

  app.get("/api/master/me", masterOnly, (req) => ({ name: req.staff!.name }));

  app.get<{ Querystring: { date?: string } }>("/api/master/appointments", masterOnly, (req, reply) => {
    const date = req.query.date ?? almatyDateOf(now());
    if (!isDate(date)) return reply.code(400).send({ error: "date must be YYYY-MM-DD" });
    const start = new Date(`${date}T00:00:00+05:00`);
    // Фильтр по master_id берётся из подписанной сессии, а не из запроса: чужое расписание не запросить.
    return inSalon(req.staff!.salonId, (q) =>
      listAppointments(q, {
        where: `master_id = $3 AND starts_at >= $4 AND starts_at < $5`,
        params: [req.staff!.masterId, start, new Date(start.getTime() + 86_400_000)],
        order: "ASC", limit: 200, offset: 0, now: now(),
      }),
    );
  });

  app.patch<{ Params: { id: string }; Body: { status?: string } }>("/api/master/appointments/:id", masterOnly, async (req, reply) => {
    const to = req.body?.status;
    if (!isUuid(req.params.id) || !isStatus(to) || !MASTER_STATUSES.includes(to)) {
      return reply.code(400).send({ error: "master can only mark arrived or no_show" });
    }
    return changeStatus(req.staff!.salonId, req.params.id, to, req.staff!.masterId, reply);
  });

  /* -------------------------- публичная запись и кабинет клиента -------------------------- */

  app.get<{ Params: { slug: string } }>("/api/public/:slug", async (req, reply) => {
    const salon = await salonBySlug(req.params.slug);
    if (!salon) return reply.code(404).send({ error: "clinic not found" });
    return inSalon(salon.id, async (q) => ({
      name: salon.name,
      services: (await q(`SELECT id, name, duration_min AS "durationMin", price_tenge AS "priceTenge" FROM services WHERE active ORDER BY name`)).rows,
      masters: (await q(`SELECT id, full_name AS "fullName" FROM masters WHERE active ORDER BY full_name`)).rows,
    }));
  });

  app.get<{ Params: { slug: string }; Querystring: { masterId?: string; date?: string; serviceIds?: string } }>(
    "/api/public/:slug/slots",
    async (req, reply) => {
      const salon = await salonBySlug(req.params.slug);
      if (!salon) return reply.code(404).send({ error: "clinic not found" });
      const result = await inSalon(salon.id, (q) => slotsFor(q, req.query));
      return result ?? reply.code(400).send({ error: "masterId, date and serviceIds are required" });
    },
  );

  app.post<{ Params: { slug: string }; Body: { masterId?: string; toothId?: string; serviceIds?: string[]; startsAt?: string } }>(
    "/api/public/:slug/book",
    async (req, reply) => {
      const salon = await salonBySlug(req.params.slug);
      if (!salon) return reply.code(404).send({ error: "clinic not found" });
      // Клиент записывает только себя, и только в ту клинику, где он вошёл.
      if (!req.client || req.client.salonId !== salon.id) return reply.code(401).send({ error: "unauthorized" });
      const b = bookingBody(req.body);
      if (!b) return reply.code(400).send({ error: "masterId, serviceIds[] and startsAt are required" });
      const clientId = req.client.clientId;
      return sendBooking(reply, await inSalon(salon.id, (q) => bookAppointment(q, { salonId: salon.id, ...b, clientId, now: now() })), salon.id);
    },
  );

  const mine = { preHandler: clientOnly };

  app.get("/api/my/me", mine, (req) => ({ fullName: req.client!.name }));

  app.get("/api/my/appointments", mine, (req) =>
    inSalon(req.client!.salonId, (q) =>
      listAppointments(q, {
        where: `client_id = $3`, params: [req.client!.clientId], order: "DESC", limit: 100, offset: 0, now: now(),
      }).then(({ items }) => ({
        // Клиенту не нужны телефоны и почта сотрудников.
        items: items.map(({ id, status, startsAt, endsAt, priceTenge, masterName, services, toothName, toothDiagnosis }) => ({ id, status, startsAt, endsAt, priceTenge, masterName, services, toothName, toothDiagnosis })),
      })),
    ),
  );

  app.post<{ Params: { id: string } }>("/api/my/appointments/:id/cancel", mine, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.client!.salonId, async (q) => {
      const { rows } = await q<{ status: string; starts_at: Date }>(
        `SELECT status, starts_at FROM appointments WHERE id = $1 AND client_id = $2`,
        [req.params.id, req.client!.clientId],
      );
      const a = rows[0];
      if (!a) return reply.code(404).send({ error: "not found" });
      if (!["booked", "confirmed"].includes(a.status)) return reply.code(409).send({ error: "appointment cannot be cancelled" });
      if (a.starts_at.getTime() - now().getTime() < CANCEL_MIN_HOURS * 3600_000) {
        return reply.code(409).send({ error: `cancellation closes ${CANCEL_MIN_HOURS} hours before the visit, please call the clinic` });
      }
      await q(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
      void notifyCancelled(noticeCtx, req.client!.salonId, req.params.id, true).catch(logFail("notify"));
      return { id: req.params.id, status: "cancelled" };
    });
  });

  const ctx: Ctx = {
    app, db, secret, now, sms, telegram, ai, inSalon,
    guards: {
      admins: staffOnly(...ADMINS),
      owner: staffOnly("owner"),
      anyStaff: staffOnly("owner", "admin", "master"),
      client: clientOnly,
    },
  };
  registerFeatures(ctx);
  registerOrder(ctx);

  return app;
}
