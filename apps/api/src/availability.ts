import type { Queryable } from "@salon/db";
import { computeSlots } from "@salon/scheduling";

/** Казахстан живёт по UTC+5 без перехода на летнее время. */
const ALMATY_OFFSET = "+05:00";
const SLOT_STEP_MIN = 30;

export interface ServiceTotals {
  durationMin: number;
  priceTenge: number;
  lines: { serviceId: string; priceTenge: number }[];
}

/** Длительность и цена набора услуг у конкретного мастера (его индивидуальные значения важнее базовых). */
export async function serviceTotals(
  q: Queryable,
  masterId: string,
  serviceIds: string[],
): Promise<ServiceTotals | null> {
  const unique = [...new Set(serviceIds)];
  if (unique.length === 0) return null;
  const { rows } = await q<{ id: string; duration: number; price: number }>(
    `SELECT s.id,
            coalesce(ms.duration_min, s.duration_min) AS duration,
            coalesce(ms.price_tenge, s.price_tenge)   AS price
       FROM services s
       LEFT JOIN master_services ms ON ms.service_id = s.id AND ms.master_id = $1
      WHERE s.id = ANY($2::uuid[]) AND s.active`,
    [masterId, unique],
  );
  if (rows.length !== unique.length) return null;
  return {
    durationMin: rows.reduce((sum, r) => sum + r.duration, 0),
    priceTenge: rows.reduce((sum, r) => sum + r.price, 0),
    lines: rows.map((r) => ({ serviceId: r.id, priceTenge: r.price })),
  };
}

/** Календарная дата YYYY-MM-DD в Алматы для момента времени. */
export function almatyDateOf(instant: Date): string {
  return new Date(instant.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

const dayStart = (date: string) => new Date(`${date}T00:00:00${ALMATY_OFFSET}`);

/** Минуты от полуночи Алматы → строка с часовым поясом. */
function minutesToIso(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00${ALMATY_OFFSET}`;
}

/** Свободные старты (в минутах от полуночи) мастера на дату под услугу заданной длительности. */
export async function freeStartMinutes(
  q: Queryable,
  opts: { masterId: string; date: string; durationMin: number; stepMin?: number; now: Date },
): Promise<number[]> {
  const { masterId, date, durationMin, now, stepMin = SLOT_STEP_MIN } = opts;
  const start = dayStart(date);
  const end = new Date(start.getTime() + 86_400_000);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7; // 1=пн … 7=вс

  const working = await q<{ start_min: number; end_min: number }>(
    `SELECT start_min, end_min FROM schedule_intervals WHERE master_id = $1 AND weekday = $2`,
    [masterId, weekday],
  );
  const booked = await q<{ starts_at: Date; ends_at: Date }>(
    `SELECT starts_at, ends_at FROM appointments
      WHERE master_id = $1 AND status NOT IN ('cancelled','no_show')
        AND starts_at < $3 AND ends_at > $2`,
    [masterId, start, end],
  );
  const toMin = (d: Date) => Math.round((d.getTime() - start.getTime()) / 60_000);

  const starts = computeSlots({
    working: working.rows.map((r) => ({ start: r.start_min, end: r.end_min })),
    busy: booked.rows.map((r) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) })),
    durationMin,
    stepMin,
  });
  // Прошедшее время не предлагаем.
  return starts.filter((m) => start.getTime() + m * 60_000 >= now.getTime());
}

export const slotsToIso = (date: string, minutes: number[]) =>
  minutes.map((m) => minutesToIso(date, m));
