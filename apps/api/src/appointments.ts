import type { Queryable } from "@salon/db";

export interface AppointmentRow {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  priceTenge: number;
  masterId: string;
  masterName: string;
  masterEmail: string | null;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientVisits: number;
  services: string;
  toothId: string | null;
  /** «Зуб 36», пусто если зуб не указан. */
  toothName: string;
  toothDiagnosis: string;
  /** Жалобы пациента и результат осмотра. */
  examNotes: string;
}

interface Filter {
  /** SQL-условие по колонкам base; параметры нумеруются с $3. */
  where?: string;
  params?: unknown[];
  search?: string;
  order: "ASC" | "DESC";
  limit: number;
  offset: number;
  /** Параметр $1 — момент «сейчас», нужен условиям по времени. */
  now: Date;
}

/** Единый запрос записей с врачом, пациентом, зубом и услугами; фильтры задают права (врач, пациент). */
export async function listAppointments(q: Queryable, f: Filter): Promise<{ total: number; items: AppointmentRow[] }> {
  const extra = f.params ?? [];
  const limitIdx = 3 + extra.length;
  const { rows } = await q<Record<string, unknown> & { total: number }>(
    `WITH base AS (
       SELECT a.id, a.status, a.starts_at, a.ends_at, a.price_tenge, a.intake_notes,
              m.id AS master_id, m.full_name AS master_name, m.email AS master_email,
              c.id AS client_id, c.full_name AS client_name, c.phone AS client_phone,
              v.id AS tooth_id, coalesce('Зуб ' || v.tooth_no, '') AS tooth_name, coalesce(v.diagnosis, '') AS tooth_diagnosis,
              (SELECT count(*) FROM appointments x WHERE x.client_id = c.id)::int AS client_visits,
              coalesce((SELECT string_agg(s.name, ', ' ORDER BY s.name)
                          FROM appointment_services aps JOIN services s ON s.id = aps.service_id
                         WHERE aps.appointment_id = a.id), '') AS services
         FROM appointments a
         JOIN masters m ON m.id = a.master_id
         JOIN clients c ON c.id = a.client_id
         LEFT JOIN teeth v ON v.id = a.tooth_id)
     SELECT *, count(*) OVER ()::int AS total FROM base
      WHERE $1::timestamptz IS NOT NULL -- фиксирует тип $1 даже если условие его не использует
        AND (master_name ILIKE $2 OR client_name ILIKE $2 OR services ILIKE $2
             OR tooth_name ILIKE $2 OR tooth_diagnosis ILIKE $2 OR client_phone ILIKE $2)
        ${f.where ? `AND ${f.where}` : ""}
      ORDER BY starts_at ${f.order}
      LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
    [f.now, `%${(f.search ?? "").trim()}%`, ...extra, f.limit, f.offset],
  );
  return {
    total: rows[0]?.total ?? 0,
    items: rows.map((r) => ({
      id: r.id as string,
      status: r.status as string,
      startsAt: (r.starts_at as Date).toISOString(),
      endsAt: (r.ends_at as Date).toISOString(),
      priceTenge: r.price_tenge as number,
      masterId: r.master_id as string,
      masterName: r.master_name as string,
      masterEmail: r.master_email as string | null,
      clientId: r.client_id as string,
      clientName: r.client_name as string,
      clientPhone: r.client_phone as string,
      clientVisits: r.client_visits as number,
      services: r.services as string,
      toothId: r.tooth_id as string | null,
      toothName: r.tooth_name as string,
      toothDiagnosis: r.tooth_diagnosis as string,
      examNotes: r.intake_notes as string,
    })),
  };
}
