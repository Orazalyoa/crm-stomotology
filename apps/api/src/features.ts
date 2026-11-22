import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "@salon/db";
import { computeAnalytics, periodBounds } from "./analytics";
import { listAppointments } from "./appointments";
import { almatyDateOf } from "./availability";
import type { Ctx } from "./ctx";
import { dayBounds } from "./notify";
import { otpauthUrl, generateSecret, verifyTotp } from "./totp";
import { isDate, isUuid, wholeNumber } from "./util";
import type { AiTool, FieldDef } from "./ai";

const METHODS = ["cash", "kaspi", "card", "transfer"] as const;
const FIELD_TYPES = ["text", "checkbox", "select", "money"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Номера зубов по FDI: 11–18, 21–28, 31–38, 41–48 (постоянные) и 51–55, 61–65, 71–75, 81–85 (молочные). */
const TOOTH_RE = /^([1-4][1-8]|[5-8][1-5])$/;

interface ToothInput { toothNo: string; diagnosis: string; notes: string }

/** Проверяет поля зуба. Возвращает очищенные значения или текст ошибки. */
function cleanTooth(b: Record<string, unknown>): ToothInput | string {
  const toothNo = str(typeof b.toothNo === "number" ? String(b.toothNo) : b.toothNo, 3);
  if (!TOOTH_RE.test(toothNo)) return "toothNo must be a FDI tooth number (11-48, 51-85)";
  const diagnosis = str(b.diagnosis, 120);
  if (diagnosis.length < 2) return "diagnosis is required";
  return { toothNo, diagnosis, notes: str(b.notes, 300) };
}

const isToothTaken = (e: unknown) => /teeth_client_id_tooth_no_key|duplicate key/.test(String(e));

/** Проверяет значения пользовательских полей по описанию полей карточки клиники. Возвращает очищенный объект или текст ошибки. */
function cleanCustom(input: unknown, defs: FieldDef[]): Record<string, unknown> | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "custom must be an object";
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const def = defs.find((d) => d.key === key);
    if (!def) return `unknown field ${key}`;
    if (value === null || value === "") continue; // пустое значение удаляет поле
    if (def.type === "text" && typeof value === "string") out[key] = value.slice(0, 200);
    else if (def.type === "checkbox" && typeof value === "boolean") out[key] = value;
    else if (def.type === "select" && typeof value === "string" && def.options.includes(value)) out[key] = value;
    else if (def.type === "money" && wholeNumber(value) !== null) out[key] = value;
    else return `invalid value for ${def.label}`;
  }
  return out;
}

export function registerFeatures(ctx: Ctx) {
  const { app, db, inSalon, guards, now } = ctx;
  const admin = { preHandler: guards.admins };
  const owner = { preHandler: guards.owner };
  const anyStaff = { preHandler: guards.anyStaff };

  const loadFields = (salonId: string) =>
    inSalon(salonId, async (q) =>
      (await q<FieldDef>(`SELECT key, label, type, options FROM custom_fields ORDER BY position, label`)).rows);

  /* ------------------------------ календарь дня ------------------------------ */

  app.get<{ Querystring: { date?: string } }>("/api/staff/day", admin, (req, reply) => {
    const date = req.query.date ?? almatyDateOf(now());
    if (!isDate(date)) return reply.code(400).send({ error: "date must be YYYY-MM-DD" });
    const [from, to] = dayBounds(date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    return inSalon(req.staff!.salonId, async (q) => {
      const masters = (await q<{ id: string; full_name: string }>(`SELECT id, full_name FROM masters WHERE active ORDER BY full_name`)).rows;
      const intervals = (await q<{ master_id: string; start_min: number; end_min: number }>(`SELECT master_id, start_min, end_min FROM schedule_intervals WHERE weekday = $1 ORDER BY start_min`, [weekday])).rows;
      const { items } = await listAppointments(q, { where: `starts_at >= $3 AND starts_at < $4 AND status NOT IN ('cancelled','no_show')`, params: [from, to], order: "ASC", limit: 500, offset: 0, now: now() });
      return {
        date,
        masters: masters.map((m) => ({ id: m.id, fullName: m.full_name, intervals: intervals.filter((i) => i.master_id === m.id).map((i) => ({ start: i.start_min, end: i.end_min })) })),
        appointments: items.map(({ id, status, startsAt, endsAt, masterId, clientName, clientPhone, services, priceTenge, toothName, toothDiagnosis }) => ({ id, status, startsAt, endsAt, masterId, clientName, clientPhone, services, priceTenge, toothName, toothDiagnosis })),
      };
    });
  });

  /* ------------------------------- клиенты ------------------------------- */

  app.get<{ Querystring: { q?: string; segment?: string } }>("/api/staff/clients", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) => {
      const term = `%${(req.query.q ?? "").trim()}%`;
      const { rows } = await q<{ id: string; full_name: string; phone: string; tags: string[]; visits: number; last_visit: Date | null; created_at: Date; teeth: string | null }>(
        `SELECT c.id, c.full_name, c.phone, c.tags, c.created_at,
                (SELECT string_agg(v.tooth_no || ' ' || v.diagnosis, ', ' ORDER BY v.tooth_no) FROM teeth v WHERE v.client_id = c.id) AS teeth,
                count(a.id) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid'))::int AS visits,
                max(a.starts_at) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid')) AS last_visit
           FROM clients c LEFT JOIN appointments a ON a.client_id = c.id
          WHERE c.full_name ILIKE $1 OR c.phone LIKE $1
             OR EXISTS (SELECT 1 FROM teeth v WHERE v.client_id = c.id AND (v.tooth_no ILIKE $1 OR v.diagnosis ILIKE $1))
          GROUP BY c.id ORDER BY c.full_name`,
        [term],
      );
      const t = now().getTime();
      return rows
        .filter((r) =>
          req.query.segment === "lapsed60" ? !!r.last_visit && t - r.last_visit.getTime() > 60 * 86_400_000
          : req.query.segment === "new" ? t - r.created_at.getTime() < 30 * 86_400_000
          : req.query.segment === "never" ? r.visits === 0 : true)
        .map((r) => ({ id: r.id, fullName: r.full_name, phone: r.phone, tags: r.tags, teeth: r.teeth, visits: r.visits, lastVisit: r.last_visit?.toISOString() ?? null }));
    }),
  );

  app.get<{ Params: { id: string } }>("/api/staff/clients/:id", admin, (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.staff!.salonId, async (q) => {
      const c = (await q<{ id: string; full_name: string; phone: string; tags: string[]; notes: string; custom: Record<string, unknown> }>(
        `SELECT id, full_name, phone, tags, notes, custom FROM clients WHERE id = $1`, [req.params.id])).rows[0];
      if (!c) return reply.code(404).send({ error: "not found" });
      const history = await listAppointments(q, { where: `client_id = $3`, params: [c.id], order: "DESC", limit: 50, offset: 0, now: now() });
      const spent = Number((await q<{ s: string | null }>(`SELECT sum(price_tenge) AS s FROM appointments WHERE client_id = $1 AND status = 'paid'`, [c.id])).rows[0]!.s ?? 0);
      const teeth = (await q(`SELECT id, tooth_no AS "toothNo", diagnosis, notes FROM teeth WHERE client_id = $1 ORDER BY tooth_no`, [c.id])).rows;
      return {
        id: c.id, fullName: c.full_name, phone: c.phone, tags: c.tags, notes: c.notes, custom: c.custom, teeth,
        spent, visits: history.items.filter((a) => ["arrived", "in_progress", "ready", "paid"].includes(a.status)).length,
        history: history.items.map(({ id, status, startsAt, masterName, services, priceTenge, toothName, toothDiagnosis }) => ({ id, status, startsAt, masterName, services, priceTenge, toothName, toothDiagnosis })),
      };
    });
  });

  app.patch<{ Params: { id: string }; Body: { fullName?: string; notes?: string; tags?: unknown; custom?: unknown } }>(
    "/api/staff/clients/:id", admin,
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
      const salonId = req.staff!.salonId;
      const b = req.body ?? {};
      const sets: string[] = [];
      const params: unknown[] = [req.params.id];
      const add = (col: string, value: unknown) => { params.push(value); sets.push(`${col} = $${params.length}`); };

      if (b.fullName !== undefined) { const n = str(b.fullName, 100); if (n.length < 2) return reply.code(400).send({ error: "name too short" }); add("full_name", n); }
      if (b.notes !== undefined) add("notes", str(b.notes, 2000));
      if (b.tags !== undefined) {
        if (!Array.isArray(b.tags)) return reply.code(400).send({ error: "tags must be an array" });
        add("tags", [...new Set(b.tags.map((t) => str(t, 30)).filter(Boolean))].slice(0, 10));
      }
      if (b.custom !== undefined) {
        const clean = cleanCustom(b.custom, await loadFields(salonId));
        if (typeof clean === "string") return reply.code(400).send({ error: clean });
        add("custom", JSON.stringify(clean));
      }
      if (!sets.length) return reply.code(400).send({ error: "nothing to update" });
      return inSalon(salonId, async (q) => {
        const res = await q(`UPDATE clients SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, params);
        return res.rows.length ? { ok: true } : reply.code(404).send({ error: "not found" });
      });
    },
  );

  /* ------------------------------- зубы пациента ------------------------------- */

  const TOOTH_COLS = `v.id, v.tooth_no AS "toothNo", v.diagnosis, v.notes`;

  app.get<{ Querystring: { q?: string; clientId?: string } }>("/api/staff/teeth", admin, (req, reply) => {
    if (req.query.clientId && !isUuid(req.query.clientId)) return reply.code(400).send({ error: "invalid clientId" });
    return inSalon(req.staff!.salonId, async (q) => {
      const term = `%${(req.query.q ?? "").trim()}%`;
      const { rows } = await q<Record<string, unknown> & { last_visit: Date | null }>(
        `SELECT ${TOOTH_COLS}, c.id AS "clientId", c.full_name AS "clientName", c.phone AS "clientPhone",
                count(a.id) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid'))::int AS visits,
                max(a.starts_at) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid')) AS last_visit
           FROM teeth v JOIN clients c ON c.id = v.client_id LEFT JOIN appointments a ON a.tooth_id = v.id
          WHERE (v.tooth_no ILIKE $1 OR v.diagnosis ILIKE $1 OR c.full_name ILIKE $1 OR c.phone LIKE $1)
            AND ($2::uuid IS NULL OR v.client_id = $2::uuid)
          GROUP BY v.id, c.id ORDER BY c.full_name, v.tooth_no`,
        [term, req.query.clientId ?? null],
      );
      return rows.map(({ last_visit, ...r }) => ({ ...r, lastVisit: last_visit?.toISOString() ?? null }));
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/api/staff/teeth", admin, async (req, reply) => {
    const b = req.body ?? {};
    if (!isUuid(b.clientId)) return reply.code(400).send({ error: "clientId is required" });
    const t = cleanTooth(b);
    if (typeof t === "string") return reply.code(400).send({ error: t });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      if (!(await q(`SELECT 1 FROM clients WHERE id = $1`, [b.clientId])).rows.length) return reply.code(404).send({ error: "client not found" });
      try {
        const { rows } = await q<{ id: string }>(
          `INSERT INTO teeth (salon_id, client_id, tooth_no, diagnosis, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [salonId, b.clientId, t.toothNo, t.diagnosis, t.notes]);
        return reply.code(201).send({ id: rows[0]!.id });
      } catch (e) {
        if (isToothTaken(e)) return reply.code(409).send({ error: "this tooth is already in the patient's chart" });
        throw e;
      }
    });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/staff/teeth/:id", admin, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    const t = cleanTooth(req.body ?? {});
    if (typeof t === "string") return reply.code(400).send({ error: t });
    return inSalon(req.staff!.salonId, async (q) => {
      try {
        const r = await q(`UPDATE teeth SET tooth_no = $2, diagnosis = $3, notes = $4 WHERE id = $1 RETURNING id`, [req.params.id, t.toothNo, t.diagnosis, t.notes]);
        return r.rows.length ? { ok: true } : reply.code(404).send({ error: "not found" });
      } catch (e) {
        if (isToothTaken(e)) return reply.code(409).send({ error: "this tooth is already in the patient's chart" });
        throw e;
      }
    });
  });

  app.delete<{ Params: { id: string } }>("/api/staff/teeth/:id", admin, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.staff!.salonId, async (q) => {
      const r = await q(`DELETE FROM teeth WHERE id = $1 RETURNING id`, [req.params.id]); // приёмы остаются, ссылка на зуб в них обнуляется
      return r.rows.length ? { ok: true } : reply.code(404).send({ error: "not found" });
    });
  });



  /* ---------------------- конструктор полей карточки ---------------------- */

  app.get("/api/staff/custom-fields", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) =>
      (await q(`SELECT id, key, label, type, options FROM custom_fields ORDER BY position, label`)).rows),
  );

  app.post<{ Body: { label?: string; type?: string; options?: unknown } }>("/api/staff/custom-fields", admin, async (req, reply) => {
    const label = str(req.body?.label, 60);
    const type = req.body?.type as (typeof FIELD_TYPES)[number];
    const options = Array.isArray(req.body?.options) ? req.body!.options.map((o) => str(o, 60)).filter(Boolean).slice(0, 30) : [];
    if (label.length < 2 || !FIELD_TYPES.includes(type)) return reply.code(400).send({ error: "label and valid type are required" });
    if (type === "select" && options.length < 2) return reply.code(400).send({ error: "select needs at least 2 options" });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      const { rows } = await q<{ id: string; key: string }>(
        `INSERT INTO custom_fields (salon_id, key, label, type, options, position)
         VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(position), 0) + 1 FROM custom_fields)) RETURNING id, key`,
        [salonId, `f${randomBytes(3).toString("hex")}`, label, type, type === "select" ? options : []],
      );
      return reply.code(201).send(rows[0]);
    });
  });

  app.delete<{ Params: { id: string } }>("/api/staff/custom-fields/:id", admin, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.staff!.salonId, async (q) => {
      const r = await q(`DELETE FROM custom_fields WHERE id = $1 RETURNING id`, [req.params.id]);
      return r.rows.length ? { ok: true } : reply.code(404).send({ error: "not found" });
    });
  });

  /* ------------------------------- услуги ------------------------------- */

  app.get("/api/staff/services/all", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) =>
      (await q(`SELECT id, name, duration_min AS "durationMin", price_tenge AS "priceTenge", active FROM services ORDER BY active DESC, name`)).rows),
  );

  app.post<{ Body: { name?: string; durationMin?: number; priceTenge?: number } }>("/api/staff/services", admin, async (req, reply) => {
    const name = str(req.body?.name, 80);
    const duration = wholeNumber(req.body?.durationMin, 600), price = wholeNumber(req.body?.priceTenge);
    if (name.length < 2 || !duration || price === null) return reply.code(400).send({ error: "name, durationMin (>0) and priceTenge are required" });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      const { rows } = await q<{ id: string }>(`INSERT INTO services (salon_id, name, duration_min, price_tenge) VALUES ($1,$2,$3,$4) RETURNING id`, [salonId, name, duration, price]);
      return reply.code(201).send({ id: rows[0]!.id });
    });
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; durationMin?: number; priceTenge?: number; active?: boolean } }>(
    "/api/staff/services/:id", admin,
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
      const b = req.body ?? {};
      const sets: string[] = [];
      const params: unknown[] = [req.params.id];
      const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
      if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) return reply.code(400).send({ error: "name too short" }); add("name", n); }
      if (b.durationMin !== undefined) { const d = wholeNumber(b.durationMin, 600); if (!d) return reply.code(400).send({ error: "invalid duration" }); add("duration_min", d); }
      if (b.priceTenge !== undefined) { const p = wholeNumber(b.priceTenge); if (p === null) return reply.code(400).send({ error: "invalid price" }); add("price_tenge", p); }
      if (b.active !== undefined) add("active", !!b.active);
      if (!sets.length) return reply.code(400).send({ error: "nothing to update" });
      return inSalon(req.staff!.salonId, async (q) => {
        const r = await q(`UPDATE services SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, params);
        return r.rows.length ? { ok: true } : reply.code(404).send({ error: "not found" });
      });
    },
  );

  /* ------------------------------- мастера ------------------------------- */

  app.get("/api/staff/masters/full", admin, (req) =>
    inSalon(req.staff!.salonId, async (q) => {
      const masters = (await q<{ id: string; full_name: string; email: string | null; active: boolean; commission_percent: number; day_rate_tenge: number }>(
        `SELECT id, full_name, email, active, commission_percent, day_rate_tenge FROM masters ORDER BY active DESC, full_name`)).rows;
      const sched = (await q<{ master_id: string; weekday: number; start_min: number; end_min: number }>(
        `SELECT master_id, weekday, start_min, end_min FROM schedule_intervals ORDER BY weekday, start_min`)).rows;
      const isOwner = req.staff!.role === "owner"; // ставки видит только владелец
      return masters.map((m) => ({
        id: m.id, fullName: m.full_name, email: m.email, active: m.active,
        ...(isOwner && { commissionPercent: m.commission_percent, dayRateTenge: m.day_rate_tenge }),
        schedule: sched.filter((s) => s.master_id === m.id).map((s) => ({ weekday: s.weekday, start: s.start_min, end: s.end_min })),
      }));
    }),
  );

  app.post<{ Body: { fullName?: string; email?: string; password?: string; commissionPercent?: number; dayRateTenge?: number } }>(
    "/api/staff/masters", owner,
    async (req, reply) => {
      const b = req.body ?? {};
      const fullName = str(b.fullName, 100), email = str(b.email, 120).toLowerCase(), password = String(b.password ?? "");
      const commission = b.commissionPercent === undefined ? 40 : wholeNumber(b.commissionPercent, 100);
      const dayRate = b.dayRateTenge === undefined ? 0 : wholeNumber(b.dayRateTenge);
      if (fullName.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8 || commission === null || dayRate === null) {
        return reply.code(400).send({ error: "fullName, valid email and password (8+ chars) are required" });
      }
      if ((await db.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])).rows.length) return reply.code(409).send({ error: "email already used" });

      const salonId = req.staff!.salonId;
      const masterId = await inSalon(salonId, async (q) => {
        const id = (await q<{ id: string }>(
          `INSERT INTO masters (salon_id, full_name, email, commission_percent, day_rate_tenge) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [salonId, fullName, email, commission, dayRate])).rows[0]!.id;
        // Пн–Сб 09:00–19:00 одной сменой: долгие процедуры (имплантация, коронки) не должны упираться в перерыв.
        for (let weekday = 1; weekday <= 6; weekday++) {
          await q(`INSERT INTO schedule_intervals (salon_id, master_id, weekday, start_min, end_min) VALUES ($1,$2,$3,$4,$5)`, [salonId, id, weekday, 540, 1140]);
        }
        return id;
      });
      await db.query(
        `INSERT INTO users (salon_id, email, password_hash, full_name, role, master_id) VALUES ($1,$2,$3,$4,'master',$5)`,
        [salonId, email, await hashPassword(password), fullName, masterId],
      );
      return reply.code(201).send({ id: masterId });
    },
  );

  app.patch<{ Params: { id: string }; Body: { active?: boolean; commissionPercent?: number; dayRateTenge?: number } }>(
    "/api/staff/masters/:id", owner,
    async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
      const b = req.body ?? {};
      const sets: string[] = [];
      const params: unknown[] = [req.params.id];
      const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
      if (b.commissionPercent !== undefined) { const c = wholeNumber(b.commissionPercent, 100); if (c === null) return reply.code(400).send({ error: "invalid percent" }); add("commission_percent", c); }
      if (b.dayRateTenge !== undefined) { const d = wholeNumber(b.dayRateTenge); if (d === null) return reply.code(400).send({ error: "invalid rate" }); add("day_rate_tenge", d); }
      if (b.active !== undefined) add("active", !!b.active);
      if (!sets.length) return reply.code(400).send({ error: "nothing to update" });
      const found = await inSalon(req.staff!.salonId, async (q) => (await q(`UPDATE masters SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, params)).rows.length > 0);
      if (!found) return reply.code(404).send({ error: "not found" });
      if (b.active !== undefined) await db.query(`UPDATE users SET active = $2 WHERE master_id = $1`, [req.params.id, !!b.active]); // уволенный не войдёт
      return { ok: true };
    },
  );

  app.put<{ Params: { id: string }; Body: { intervals?: { weekday: number; start: number; end: number }[] } }>(
    "/api/staff/masters/:id/schedule", admin,
    async (req, reply) => {
      const list = req.body?.intervals;
      if (!isUuid(req.params.id) || !Array.isArray(list) || list.length > 40) return reply.code(400).send({ error: "intervals[] required" });
      for (const i of list) {
        if (!Number.isInteger(i.weekday) || i.weekday < 1 || i.weekday > 7 || !Number.isInteger(i.start) || !Number.isInteger(i.end) || i.start < 0 || i.end > 1440 || i.start >= i.end) {
          return reply.code(400).send({ error: "invalid interval" });
        }
      }
      const sorted = [...list].sort((a, b) => a.weekday - b.weekday || a.start - b.start);
      if (sorted.some((a, k) => k > 0 && sorted[k - 1]!.weekday === a.weekday && sorted[k - 1]!.end > a.start)) return reply.code(400).send({ error: "intervals overlap" });

      const salonId = req.staff!.salonId;
      return inSalon(salonId, async (q) => {
        if (!(await q(`SELECT 1 FROM masters WHERE id = $1`, [req.params.id])).rows.length) return reply.code(404).send({ error: "not found" });
        await q(`DELETE FROM schedule_intervals WHERE master_id = $1`, [req.params.id]);
        for (const i of sorted) {
          await q(`INSERT INTO schedule_intervals (salon_id, master_id, weekday, start_min, end_min) VALUES ($1,$2,$3,$4,$5)`, [salonId, req.params.id, i.weekday, i.start, i.end]);
        }
        return { ok: true };
      });
    },
  );

  /* ---------------------------- касса и зарплата ---------------------------- */

  app.post<{ Params: { id: string }; Body: { method?: string; amount?: number } }>("/api/staff/appointments/:id/pay", admin, async (req, reply) => {
    const method = req.body?.method as (typeof METHODS)[number];
    if (!isUuid(req.params.id) || !METHODS.includes(method)) return reply.code(400).send({ error: "method must be cash, kaspi, card or transfer" });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      const a = (await q<{ status: string; price_tenge: number }>(`SELECT status, price_tenge FROM appointments WHERE id = $1`, [req.params.id])).rows[0];
      if (!a) return reply.code(404).send({ error: "not found" });
      if (!["booked", "confirmed", "arrived", "in_progress", "ready"].includes(a.status)) return reply.code(409).send({ error: `cannot pay a ${a.status} appointment` });
      const amount = req.body?.amount === undefined ? a.price_tenge : wholeNumber(req.body.amount);
      if (amount === null) return reply.code(400).send({ error: "invalid amount" });
      await q(`UPDATE appointments SET status = 'paid', price_tenge = $2 WHERE id = $1`, [req.params.id, amount]);
      await q(`INSERT INTO payments (salon_id, appointment_id, method, amount_tenge, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [salonId, req.params.id, method, amount, req.staff!.userId, now()]);
      return { id: req.params.id, status: "paid", amount };
    });
  });

  const period = (query: { from?: string; to?: string }) => {
    const today = almatyDateOf(now());
    const to = isDate(query.to) ? query.to : today;
    const from = isDate(query.from) ? query.from : `${to.slice(0, 8)}01`;
    return { from, to, bounds: periodBounds(from, to) };
  };

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/staff/cash", admin, (req, reply) => {
    const { from, to, bounds } = period(req.query);
    if (!bounds) return reply.code(400).send({ error: "invalid period" });
    return inSalon(req.staff!.salonId, async (q) => {
      const range = [bounds.start, bounds.end];
      const byMethod = (await q<{ method: string; amount: string; n: number }>(
        `SELECT method, sum(amount_tenge) AS amount, count(*)::int AS n FROM payments WHERE created_at >= $1 AND created_at < $2 GROUP BY method ORDER BY 2 DESC`, range))
        .rows.map((r) => ({ method: r.method, amount: Number(r.amount), count: r.n }));
      const payments = (await q<{ created_at: Date; method: string; amount_tenge: number; client_name: string; services: string }>(
        `SELECT p.created_at, p.method, p.amount_tenge, c.full_name AS client_name,
                coalesce((SELECT string_agg(s.name, ', ') FROM appointment_services x JOIN services s ON s.id = x.service_id WHERE x.appointment_id = a.id), '') AS services
           FROM payments p JOIN appointments a ON a.id = p.appointment_id JOIN clients c ON c.id = a.client_id
          WHERE p.created_at >= $1 AND p.created_at < $2 ORDER BY p.created_at DESC LIMIT 100`, range))
        .rows.map((r) => ({ createdAt: r.created_at.toISOString(), method: r.method, amount: r.amount_tenge, clientName: r.client_name, services: r.services }));
      return { from, to, total: byMethod.reduce((s, m) => s + m.amount, 0), byMethod, payments };
    });
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/staff/payroll", owner, (req, reply) => {
    const { from, to, bounds } = period(req.query);
    if (!bounds) return reply.code(400).send({ error: "invalid period" });
    return inSalon(req.staff!.salonId, async (q) => {
      const { rows } = await q<{ id: string; full_name: string; commission_percent: number; day_rate_tenge: number; visits: number; revenue: string; days: number }>(
        `SELECT m.id, m.full_name, m.commission_percent, m.day_rate_tenge,
                count(a.id) FILTER (WHERE a.status = 'paid')::int AS visits,
                coalesce(sum(a.price_tenge - a.parts_tenge) FILTER (WHERE a.status = 'paid'), 0) AS revenue,
                count(DISTINCT to_char(a.starts_at AT TIME ZONE 'Asia/Almaty', 'YYYY-MM-DD')) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid'))::int AS days
           FROM masters m LEFT JOIN appointments a ON a.master_id = m.id AND a.starts_at >= $1 AND a.starts_at < $2
          WHERE m.active GROUP BY m.id ORDER BY m.full_name`, [bounds.start, bounds.end]);
      const items = rows.map((r) => {
        const revenue = Number(r.revenue);
        const commission = Math.round((revenue * r.commission_percent) / 100);
        const rate = r.days * r.day_rate_tenge;
        return { masterId: r.id, name: r.full_name, visits: r.visits, revenue, commissionPercent: r.commission_percent, commission, workedDays: r.days, dayRate: r.day_rate_tenge, rate, total: commission + rate };
      });
      return { from, to, items, total: items.reduce((s, i) => s + i.total, 0) };
    });
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/staff/analytics", admin, async (req, reply) => {
    const { from, to } = period(req.query);
    const result = await inSalon(req.staff!.salonId, (q) => computeAnalytics(q, from, to));
    return result ? { from, to, ...result } : reply.code(400).send({ error: "invalid period" });
  });

  /* ------------------------------------ ИИ ------------------------------------ */

  app.get("/api/staff/ai/status", admin, () => ({ canAsk: ctx.ai.canAsk }));

  app.post<{ Body: { text?: string } }>("/api/staff/ai/dictation", admin, async (req, reply) => {
    const text = str(req.body?.text, 4000);
    if (text.length < 3) return reply.code(400).send({ error: "text is required" });
    const fields = await loadFields(req.staff!.salonId);
    return ctx.ai.structureDictation(text, fields); // только черновик: сохраняет человек (ADR-0003)
  });

  app.post<{ Body: { question?: string } }>("/api/staff/ai/ask", admin, async (req, reply) => {
    const question = str(req.body?.question, 500);
    if (question.length < 3) return reply.code(400).send({ error: "question is required" });
    if (!ctx.ai.canAsk) return reply.code(503).send({ error: "AI assistant is not configured: set ANTHROPIC_API_KEY on the server" });
    const salonId = req.staff!.salonId;
    // Инструменты только читают и работают строго в рамках клиники пользователя.
    const tools: AiTool[] = [
      {
        name: "get_stats", description: "Выручка, число визитов, средний чек, неявки, загрузка врачей, топ услуг за период (даты YYYY-MM-DD).",
        schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
        run: async (i) => (await inSalon(salonId, (q) => computeAnalytics(q, String(i.from), String(i.to)))) ?? { error: "invalid period" },
      },
      {
        name: "find_clients", description: "Поиск клиентов по имени или телефону: визиты, последний визит.",
        schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        run: async (i) => inSalon(salonId, async (q) =>
          (await q(`SELECT c.full_name AS name, c.phone, c.tags, count(a.id) FILTER (WHERE a.status IN ('arrived','in_progress','ready','paid'))::int AS visits, max(a.starts_at) AS last_visit
                      FROM clients c LEFT JOIN appointments a ON a.client_id = c.id WHERE c.full_name ILIKE $1 OR c.phone LIKE $1 GROUP BY c.id LIMIT 10`, [`%${String(i.query).slice(0, 50)}%`])).rows),
      },
      {
        name: "list_appointments", description: "Записи на конкретную дату (YYYY-MM-DD): время, пациент, зуб, услуги, врач, статус.",
        schema: { type: "object", properties: { date: { type: "string" } }, required: ["date"] },
        run: async (i) => {
          if (!isDate(i.date)) return { error: "invalid date" };
          const [from, to] = dayBounds(i.date);
          return inSalon(salonId, async (q) => (await listAppointments(q, { where: `starts_at >= $3 AND starts_at < $4`, params: [from, to], order: "ASC", limit: 100, offset: 0, now: now() })).items
            .map(({ startsAt, clientName, toothName, toothDiagnosis, services, masterName, status }) => ({ startsAt, clientName, tooth: `${toothName} ${toothDiagnosis}`.trim(), services, masterName, status })));
        },
      },
    ];
    try { return { answer: await ctx.ai.ask(question, tools) }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /* ---------------------------- двухфакторная защита ---------------------------- */

  app.post("/api/auth/2fa/setup", anyStaff, async (req, reply) => {
    const u = (await db.query<{ email: string; totp_enabled: boolean }>(`SELECT email, totp_enabled FROM users WHERE id = $1`, [req.staff!.userId])).rows[0]!;
    if (u.totp_enabled) return reply.code(409).send({ error: "2FA already enabled" });
    const secret = generateSecret();
    await db.query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [req.staff!.userId, secret]);
    return { secret, otpauthUrl: otpauthUrl(secret, u.email, "Sergek Dent") };
  });

  app.post<{ Body: { code?: string } }>("/api/auth/2fa/enable", anyStaff, async (req, reply) => {
    const u = (await db.query<{ totp_secret: string | null }>(`SELECT totp_secret FROM users WHERE id = $1`, [req.staff!.userId])).rows[0]!;
    if (!u.totp_secret || !verifyTotp(u.totp_secret, String(req.body?.code ?? ""), now())) return reply.code(400).send({ error: "invalid code" });
    await db.query(`UPDATE users SET totp_enabled = true WHERE id = $1`, [req.staff!.userId]);
    return { ok: true };
  });

  app.post<{ Body: { code?: string; password?: string } }>("/api/auth/2fa/disable", anyStaff, async (req, reply) => {
    const u = (await db.query<{ totp_secret: string | null; totp_enabled: boolean; password_hash: string }>(
      `SELECT totp_secret, totp_enabled, password_hash FROM users WHERE id = $1`, [req.staff!.userId])).rows[0]!;
    // Отключить защиту можно только зная и пароль, и текущий код.
    if (!u.totp_enabled || !u.totp_secret || !verifyTotp(u.totp_secret, String(req.body?.code ?? ""), now()) ||
        !(await verifyPassword(String(req.body?.password ?? ""), u.password_hash))) {
      return reply.code(400).send({ error: "invalid code or password" });
    }
    await db.query(`UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE id = $1`, [req.staff!.userId]);
    return { ok: true };
  });

  /* ------------------------------- Telegram ------------------------------- */

  const newCode = () => randomBytes(8).toString("hex");

  app.get("/api/staff/telegram", anyStaff, async (req) => {
    const linked = (await db.query(`SELECT 1 FROM telegram_links WHERE user_id = $1`, [req.staff!.userId])).rows.length > 0;
    return { enabled: !!ctx.telegram, linked, bot: ctx.telegram?.username ?? null };
  });

  app.post("/api/staff/telegram/link", anyStaff, async (req, reply) => {
    if (!ctx.telegram) return reply.code(503).send({ error: "Telegram bot is not configured" });
    const code = newCode();
    await db.query(`INSERT INTO telegram_codes (code, salon_id, kind, user_id, expires_at) VALUES ($1,$2,'user',$3,$4)`,
      [code, req.staff!.salonId, req.staff!.userId, new Date(now().getTime() + 15 * 60_000)]);
    return { url: `https://t.me/${ctx.telegram.username}?start=${code}` };
  });

  app.delete("/api/staff/telegram", anyStaff, async (req) => {
    await db.query(`DELETE FROM telegram_links WHERE user_id = $1`, [req.staff!.userId]);
    return { ok: true };
  });

  app.get("/api/my/telegram", { preHandler: guards.client }, async (req) => {
    const linked = (await db.query(`SELECT 1 FROM telegram_links WHERE client_id = $1`, [req.client!.clientId])).rows.length > 0;
    return { enabled: !!ctx.telegram, linked };
  });

  app.post("/api/my/telegram/link", { preHandler: guards.client }, async (req, reply) => {
    if (!ctx.telegram) return reply.code(503).send({ error: "Telegram bot is not configured" });
    const code = newCode();
    await db.query(`INSERT INTO telegram_codes (code, salon_id, kind, client_id, expires_at) VALUES ($1,$2,'client',$3,$4)`,
      [code, req.client!.salonId, req.client!.clientId, new Date(now().getTime() + 15 * 60_000)]);
    return { url: `https://t.me/${ctx.telegram.username}?start=${code}` };
  });
}
