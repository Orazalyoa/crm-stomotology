import type { Queryable } from "@salon/db";

const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 366;

/** Период [from, to] включительно по датам Алматы → границы времени. Null при неверных данных. */
export function periodBounds(from: string, to: string): { start: Date; end: Date; days: string[] } | null {
  const start = new Date(`${from}T00:00:00+05:00`);
  const end = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + DAY);
  const n = Math.round((end.getTime() - start.getTime()) / DAY);
  if (Number.isNaN(n) || n < 1 || n > MAX_RANGE_DAYS) return null;
  return { start, end, days: Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * DAY + 5 * 3600_000).toISOString().slice(0, 10)) };
}

export interface Analytics {
  revenue: number;
  visits: number;
  avgCheck: number;
  noShowRate: number;
  cancelled: number;
  newClients: number;
  returningShare: number;
  byMethod: { method: string; amount: number }[];
  byMaster: { masterId: string; name: string; visits: number; revenue: number; loadPercent: number }[];
  topServices: { name: string; count: number; revenue: number }[];
  byDay: { date: string; revenue: number }[];
  byStatus: { status: string; count: number }[];
}

export async function computeAnalytics(q: Queryable, from: string, to: string): Promise<Analytics | null> {
  const p = periodBounds(from, to);
  if (!p) return null;
  const range = [p.start, p.end];

  const totals = (await q<{ revenue: string | null }>(`SELECT sum(amount_tenge) AS revenue FROM payments WHERE created_at >= $1 AND created_at < $2`, range)).rows[0]!;
  const appts = (await q<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE status = 'paid')::int AS visits,
            count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
            count(*) FILTER (WHERE status IN ('arrived','in_progress','ready','paid'))::int AS came,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM appointments WHERE starts_at >= $1 AND starts_at < $2`, range)).rows[0]!;
  const newClients = Number((await q<{ n: string }>(`SELECT count(*) AS n FROM clients WHERE created_at >= $1 AND created_at < $2`, range)).rows[0]!.n);
  const ret = (await q<{ total: number; again: number }>(
    `WITH came AS (SELECT DISTINCT client_id FROM appointments WHERE status IN ('arrived','in_progress','ready','paid') AND starts_at >= $1 AND starts_at < $2)
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE (SELECT count(*) FROM appointments x WHERE x.client_id = came.client_id AND x.status IN ('arrived','in_progress','ready','paid')) >= 2)::int AS again
       FROM came`, range)).rows[0]!;

  const revenue = Number(totals.revenue ?? 0);
  const finished = appts.no_show! + appts.came!;

  const byMethod = (await q<{ method: string; amount: string }>(
    `SELECT method, sum(amount_tenge) AS amount FROM payments WHERE created_at >= $1 AND created_at < $2 GROUP BY method ORDER BY 2 DESC`, range))
    .rows.map((r) => ({ method: r.method, amount: Number(r.amount) }));

  // Загрузка врача: занятые минуты / рабочие минуты по графику за период.
  const masters = (await q<{ id: string; full_name: string }>(`SELECT id, full_name FROM masters WHERE active ORDER BY full_name`)).rows;
  const schedule = (await q<{ master_id: string; weekday: number; start_min: number; end_min: number }>(`SELECT master_id, weekday, start_min, end_min FROM schedule_intervals`)).rows;
  const perMaster = (await q<{ master_id: string; visits: number; revenue: string | null; busy: string | null }>(
    `SELECT master_id,
            count(*) FILTER (WHERE status IN ('arrived','in_progress','ready','paid'))::int AS visits,
            sum(price_tenge) FILTER (WHERE status = 'paid') AS revenue,
            sum(extract(epoch FROM ends_at - starts_at) / 60) FILTER (WHERE status NOT IN ('cancelled','no_show')) AS busy
       FROM appointments WHERE starts_at >= $1 AND starts_at < $2 GROUP BY master_id`, range)).rows;
  const weekdays = p.days.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay() || 7);
  const byMaster = masters.map((m) => {
    const work = weekdays.reduce((sum, wd) => sum + schedule.filter((s) => s.master_id === m.id && s.weekday === wd).reduce((a, s) => a + (s.end_min - s.start_min), 0), 0);
    const row = perMaster.find((r) => r.master_id === m.id);
    return {
      masterId: m.id, name: m.full_name, visits: row?.visits ?? 0, revenue: Number(row?.revenue ?? 0),
      loadPercent: work ? Math.min(100, Math.round((Number(row?.busy ?? 0) / work) * 100)) : 0,
    };
  });

  const topServices = (await q<{ name: string; n: number; revenue: string }>(
    `SELECT s.name, count(*)::int AS n, sum(x.price_tenge) AS revenue
       FROM appointment_services x JOIN appointments a ON a.id = x.appointment_id JOIN services s ON s.id = x.service_id
      WHERE a.status = 'paid' AND a.starts_at >= $1 AND a.starts_at < $2 GROUP BY s.name ORDER BY 3 DESC LIMIT 5`, range))
    .rows.map((r) => ({ name: r.name, count: r.n, revenue: Number(r.revenue) }));

  const dayRows = (await q<{ d: string; revenue: string }>(
    `SELECT to_char(created_at AT TIME ZONE 'Asia/Almaty', 'YYYY-MM-DD') AS d, sum(amount_tenge) AS revenue
       FROM payments WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`, range)).rows;
  const byDay = p.days.map((date) => ({ date, revenue: Number(dayRows.find((r) => r.d === date)?.revenue ?? 0) }));

  const byStatus = (await q<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM appointments WHERE starts_at >= $1 AND starts_at < $2 GROUP BY status ORDER BY 2 DESC`, range))
    .rows.map((r) => ({ status: r.status, count: r.n }));

  return {
    revenue, visits: appts.visits!, avgCheck: appts.visits ? Math.round(revenue / appts.visits) : 0,
    noShowRate: finished ? Math.round((appts.no_show! / finished) * 100) : 0, cancelled: appts.cancelled!,
    newClients, returningShare: ret.total ? Math.round((ret.again / ret.total) * 100) : 0,
    byMethod, byMaster, topServices, byDay, byStatus,
  };
}
