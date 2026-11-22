import type { Queryable } from "@salon/db";
import { almatyDateOf, freeStartMinutes, serviceTotals } from "./availability";

export type BookingResult =
  | { ok: true; id: string; status: string; priceTenge: number }
  | { ok: false; reason: "unknown" | "unavailable" };

/** Ошибка исключающего ограничения Postgres: время уже занято. */
const isOverlap = (e: unknown) =>
  (e as { code?: string }).code === "23P01" || /exclusion|conflicting key/.test(String(e));

/**
 * Создаёт запись. Все справочники читаются через q, то есть внутри RLS клиники:
 * чужой врач, пациент, зуб или услуга выглядят как «unknown».
 * Зуб необязателен, но если указан — должен принадлежать этому клиенту.
 */
export async function bookAppointment(
  q: Queryable,
  input: { salonId: string; masterId: string; clientId: string; toothId?: string | null; serviceIds: string[]; startsAt: Date; now: Date },
): Promise<BookingResult> {
  const { salonId, masterId, clientId, toothId = null, serviceIds, startsAt, now } = input;

  const known = await q(
    `SELECT (SELECT count(*) FROM clients WHERE id = $1) AS c, (SELECT count(*) FROM masters WHERE id = $2 AND active) AS m,
            (SELECT count(*) FROM teeth WHERE id = $3 AND client_id = $1) AS v`,
    [clientId, masterId, toothId],
  );
  const row = known.rows[0] as { c: string | number; m: string | number; v: string | number };
  if (Number(row.c) !== 1 || Number(row.m) !== 1 || (toothId && Number(row.v) !== 1)) return { ok: false, reason: "unknown" };

  const totals = await serviceTotals(q, masterId, serviceIds);
  if (!totals) return { ok: false, reason: "unknown" };

  // Время должно быть свободным слотом мастера: рабочие часы, перерывы, чужие записи.
  const date = almatyDateOf(startsAt);
  const startMin = Math.round((startsAt.getTime() - new Date(`${date}T00:00:00+05:00`).getTime()) / 60_000);
  const free = await freeStartMinutes(q, { masterId, date, durationMin: totals.durationMin, stepMin: 5, now });
  if (!free.includes(startMin)) return { ok: false, reason: "unavailable" };

  try {
    const end = new Date(startsAt.getTime() + totals.durationMin * 60_000);
    const { rows } = await q<{ id: string; status: string }>(
      `INSERT INTO appointments (salon_id, master_id, client_id, tooth_id, starts_at, ends_at, price_tenge)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`,
      [salonId, masterId, clientId, toothId, startsAt, end, totals.priceTenge],
    );
    for (const line of totals.lines) {
      await q(
        `INSERT INTO appointment_services (salon_id, appointment_id, service_id, price_tenge) VALUES ($1,$2,$3,$4)`,
        [salonId, rows[0]!.id, line.serviceId, line.priceTenge],
      );
    }
    return { ok: true, id: rows[0]!.id, status: rows[0]!.status, priceTenge: totals.priceTenge };
  } catch (e) {
    if (isOverlap(e)) return { ok: false, reason: "unavailable" };
    throw e;
  }
}
