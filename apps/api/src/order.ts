import type { Queryable } from "@salon/db";
import type { Ctx } from "./ctx";
import { isUuid, wholeNumber } from "./util";

/** Пока приём не закрыт (оплачен, отменён, неявка), материалы и записи осмотра можно менять. */
const OPEN = ["booked", "confirmed", "arrived", "in_progress", "ready"];

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Карта приёма: жалобы и осмотр врача, использованные материалы (пломбы, анестезия, коронки) и итог к оплате.
 * Внутренние имена в базе: таблица appointment_parts — это материалы, intake_notes — жалобы и осмотр.
 */
export function registerOrder(ctx: Ctx) {
  const { app, inSalon, guards } = ctx;
  const admin = { preHandler: guards.admins };
  const anyStaff = { preHandler: guards.anyStaff };

  /** Пересчитывает долю материалов в записи и общую сумму: услуги + материалы. */
  async function recalc(q: Queryable, appointmentId: string) {
    await q(
      `UPDATE appointments a SET
         price_tenge = a.price_tenge - a.parts_tenge + p.total,
         parts_tenge = p.total
        FROM (SELECT coalesce(sum(qty * price_tenge), 0)::int AS total FROM appointment_parts WHERE appointment_id = $1) p
       WHERE a.id = $1`, [appointmentId]);
  }

  const orderOf = async (q: Queryable, id: string) => {
    const a = (await q<{ status: string; price_tenge: number; parts_tenge: number; intake_notes: string }>(
      `SELECT status, price_tenge, parts_tenge, intake_notes FROM appointments WHERE id = $1`, [id])).rows[0];
    if (!a) return null;
    const items = (await q<{ id: string; name: string; qty: number; price_tenge: number }>(
      `SELECT id, name, qty, price_tenge FROM appointment_parts WHERE appointment_id = $1 ORDER BY created_at, id`, [id])).rows;
    return {
      status: a.status, totalTenge: a.price_tenge, materialsTenge: a.parts_tenge, servicesTenge: a.price_tenge - a.parts_tenge,
      examNotes: a.intake_notes,
      materials: items.map((p) => ({ id: p.id, name: p.name, qty: p.qty, priceTenge: p.price_tenge })),
    };
  };

  app.get<{ Params: { id: string } }>("/api/staff/appointments/:id/order", admin, (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.staff!.salonId, async (q) => (await orderOf(q, req.params.id)) ?? reply.code(404).send({ error: "not found" }));
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown; qty?: unknown; priceTenge?: unknown } }>("/api/staff/appointments/:id/materials", admin, async (req, reply) => {
    const name = text(req.body?.name, 80), qty = wholeNumber(req.body?.qty ?? 1, 1000), price = wholeNumber(req.body?.priceTenge);
    if (!isUuid(req.params.id) || name.length < 2 || !qty || price === null) return reply.code(400).send({ error: "name, qty (1-1000) and priceTenge are required" });
    const salonId = req.staff!.salonId;
    return inSalon(salonId, async (q) => {
      const a = (await q<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [req.params.id])).rows[0];
      if (!a) return reply.code(404).send({ error: "not found" });
      if (!OPEN.includes(a.status)) return reply.code(409).send({ error: `cannot change materials of a ${a.status} appointment` });
      await q(`INSERT INTO appointment_parts (salon_id, appointment_id, name, qty, price_tenge) VALUES ($1,$2,$3,$4,$5)`, [salonId, req.params.id, name, qty, price]);
      await recalc(q, req.params.id);
      return reply.code(201).send(await orderOf(q, req.params.id));
    });
  });

  app.delete<{ Params: { id: string; itemId: string } }>("/api/staff/appointments/:id/materials/:itemId", admin, async (req, reply) => {
    if (!isUuid(req.params.id) || !isUuid(req.params.itemId)) return reply.code(400).send({ error: "invalid id" });
    return inSalon(req.staff!.salonId, async (q) => {
      const a = (await q<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [req.params.id])).rows[0];
      if (!a) return reply.code(404).send({ error: "not found" });
      if (!OPEN.includes(a.status)) return reply.code(409).send({ error: `cannot change materials of a ${a.status} appointment` });
      const r = await q(`DELETE FROM appointment_parts WHERE id = $1 AND appointment_id = $2 RETURNING id`, [req.params.itemId, req.params.id]);
      if (!r.rows.length) return reply.code(404).send({ error: "not found" });
      await recalc(q, req.params.id);
      return orderOf(q, req.params.id);
    });
  });

  /** Жалобы пациента и осмотр врача. Врач правит только свои приёмы. */
  app.put<{ Params: { id: string }; Body: { notes?: unknown } }>("/api/staff/appointments/:id/exam", anyStaff, async (req, reply) => {
    if (!isUuid(req.params.id) || typeof req.body?.notes !== "string") return reply.code(400).send({ error: "notes is required" });
    const notes = text(req.body.notes, 2000);
    const staff = req.staff!;
    return inSalon(staff.salonId, async (q) => {
      const a = (await q<{ status: string }>(
        `SELECT status FROM appointments WHERE id = $1 ${staff.role === "master" ? "AND master_id = $2" : ""}`,
        staff.role === "master" ? [req.params.id, staff.masterId] : [req.params.id])).rows[0];
      if (!a) return reply.code(404).send({ error: "not found" });
      if (!OPEN.includes(a.status)) return reply.code(409).send({ error: `cannot change exam of a ${a.status} appointment` });
      await q(`UPDATE appointments SET intake_notes = $2 WHERE id = $1`, [req.params.id, notes]);
      return orderOf(q, req.params.id);
    });
  });
}
