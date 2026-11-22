import type { Database } from "./client";

/**
 * Наполнение «как будто клиникой уже пользуются»: 40+ пациентов, история приёмов за 45 дней,
 * оплаты в кассе, материалы, жалобы и осмотр, ставки врачей. Применяется поверх seedDemo (см. showcase-run.ts).
 * Данные детерминированы: один и тот же `now` даёт одну и ту же клинику.
 */

const ALMATY_OFFSET = "+05:00";
const HISTORY_DAYS = 45;
const FUTURE_DAYS = 10;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Азамат", "Нурсултан", "Марат", "Бауыржан", "Алмас", "Динара", "Асель", "Санжар", "Олжас", "Искандер", "Канат", "Аян", "Мади", "Кайрат", "Расул", "Ильяс", "Темирлан", "Айгерим", "Жанар", "Гульмира", "Сауле", "Айжан", "Мереке", "Томирис", "Алия", "Камила", "Ерлан", "Дастан", "Багдат", "Нурлан"];
const FEMALE = new Set(["Динара", "Асель", "Айгерим", "Жанар", "Гульмира", "Сауле", "Айжан", "Мереке", "Томирис", "Алия", "Камила"]);
const LAST = ["Жумабаев", "Омаров", "Искаков", "Тлеуов", "Сатыбалдиев", "Сулейменов", "Мукашев", "Кенжебаев", "Рахимов", "Абдрахманов", "Мырзахметов", "Ермеков", "Жакупов", "Нургалиев", "Толеген", "Балгабаев", "Аубакиров", "Касенов", "Бекмуратов", "Серикбаев"];

const COMPLAINTS: Record<string, string[]> = {
  "Консультация стоматолога": ["Жалоб нет, профилактический осмотр.", "Чувствительность зубов к холодному. Назначен рентген.", "Кровоточивость дёсен при чистке. Рекомендована гигиена."],
  "Профессиональная гигиена": ["Налёт и зубной камень. Проведена ультразвуковая чистка, Air Flow, полировка."],
  "Рентген-снимок": ["Прицельный снимок. Патологии в периапикальных тканях не выявлено."],
  "Лечение кариеса": ["Боль от сладкого. Кариозная полость, препарирование, медикаментозная обработка.", "Жалоба на тёмное пятно. Среднего кариеса, лечение под анестезией."],
  "Пломбирование": ["Ставили пломбу, композит светового отверждения. Окклюзия проверена.", "Реставрация скола, цвет подобран по шкале VITA."],
  "Лечение пульпита": ["Ночная самопроизвольная боль. Депульпирование, обработка и пломбирование каналов.", "Острый пульпит. Анестезия, экстирпация пульпы, временная пломба."],
  "Удаление зуба": ["Зуб не подлежит лечению. Удаление под анестезией, швы не потребовались.", "Удаление зуба мудрости, осложнений нет. Даны рекомендации."],
  "Фторирование": ["Профилактика, нанесение фторлака. Не есть 2 часа."],
  "Отбеливание": ["Отбеливание в кабинете, цвет светлее на 4 тона."],
};

const MATERIALS: [string, number, number][] = [
  ["Анестезия Ультракаин", 1, 2500], ["Композит светового отверждения", 1, 4500], ["Штифт стекловолоконный", 1, 3800],
  ["Пломбировочный материал для каналов", 1, 3000], ["Коффердам", 1, 1500], ["Коронка циркониевая (заготовка)", 1, 25000],
  ["Шовный материал", 1, 1200],
];

const TAGS = [[], [], [], ["VIP"], ["Ребёнок"], ["Страх лечения"], ["Постоянный"], ["Ортодонтия"]];
const NOTES = ["", "", "", "Предпочитает утро.", "Просит напоминание за день.", "Боится уколов, лечить с седацией.", "Аллергия на лидокаин, использовать артикаин.", "Направлен по рекомендации."];

const TEETH_POOL = ["11", "12", "13", "14", "15", "16", "17", "18", "21", "22", "23", "24", "25", "26", "27", "28", "31", "32", "33", "34", "35", "36", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48"];
const DIAGNOSES = ["Кариес", "Глубокий кариес", "Пульпит", "Пломба", "Коронка", "Скол", "Периодонтит", "Имплант", "Удалён", "Клиновидный дефект"];

const EXTRA_SERVICES: [string, number, number][] = [
  ["Лечение десен", 45, 25000],
  ["Снятие зубного камня", 40, 14000],
  ["Реставрация зуба", 60, 28000],
];

const METHOD_WEIGHTS = [["kaspi", 0.45], ["card", 0.25], ["cash", 0.25], ["transfer", 0.05]] as const;

function almatyDate(now: Date, addDays: number): string {
  return new Date(now.getTime() + 5 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}
const isSunday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === 0;

export async function seedShowcase(db: Database, salonId: string, now = new Date()): Promise<{ appointments: number; payments: number; clients: number; revenue: number }> {
  const rand = rng(20261110);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
  const chance = (p: number) => rand() < p;

  return db.transaction(async (tx) => {
    // Чистим то, что наполнил seedDemo, сохраняя врачей, услуги и учётные записи.
    await tx.query(`DELETE FROM appointments WHERE salon_id = $1`, [salonId]); // каскадом: оплаты, услуги, материалы
    await tx.query(`DELETE FROM teeth WHERE salon_id = $1`, [salonId]);
    await tx.query(`DELETE FROM clients WHERE salon_id = $1`, [salonId]);

    for (const [name, duration, price] of EXTRA_SERVICES) {
      await tx.query(
        `INSERT INTO services (salon_id, name, duration_min, price_tenge)
         SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM services WHERE salon_id = $1 AND name = $2)`,
        [salonId, name, duration, price],
      );
    }
    const services = (await tx.query<{ id: string; name: string; duration_min: number; price_tenge: number }>(
      `SELECT id, name, duration_min, price_tenge FROM services WHERE salon_id = $1 AND active`, [salonId])).rows;
    const byName = new Map(services.map((s) => [s.name, s]));
    const toothServices = new Set(["Лечение кариеса", "Пломбирование", "Лечение пульпита", "Удаление зуба", "Керамическая коронка", "Установка импланта", "Реставрация зуба"]);
    // Частота услуг в обычном дне клиники.
    const weighted: [string, number][] = [
      ["Консультация стоматолога", 14], ["Профессиональная гигиена", 14], ["Рентген-снимок", 4], ["Лечение кариеса", 16], ["Пломбирование", 14],
      ["Лечение пульпита", 8], ["Удаление зуба", 6], ["Фторирование", 4], ["Отбеливание", 3], ["Керамическая коронка", 5],
      ["Установка импланта", 2], ["Установка брекетов", 1], ["Лечение десен", 5], ["Снятие зубного камня", 3], ["Реставрация зуба", 5],
    ];
    const bag = weighted.flatMap(([n, w]) => Array<string>(w).fill(n));

    const masters = (await tx.query<{ id: string }>(`SELECT id FROM masters WHERE salon_id = $1 ORDER BY full_name`, [salonId])).rows;
    // Разные схемы оплаты врачей: чтобы зарплата выглядела по-настоящему.
    const pay: [number, number][] = [[40, 0], [35, 5000], [45, 0], [30, 8000], [40, 3000], [50, 0]];
    for (const [i, m] of masters.entries()) {
      const [pct, rate] = pay[i % pay.length]!;
      await tx.query(`UPDATE masters SET commission_percent = $2, day_rate_tenge = $3 WHERE id = $1`, [m.id, pct, rate]);
    }

    // Пациенты: 44 человека, зубная карта у каждого.
    const clientCount = 44;
    const clients: { id: string; teeth: string[] }[] = [];
    const usedNames = new Set<string>();
    for (let i = 0; i < clientCount; i++) {
      let name: string;
      do {
        const f = pick(FIRST);
        const female = FEMALE.has(f);
        const l = pick(LAST);
        name = `${f} ${female ? l + "а" : l}`;
      } while (usedNames.has(name));
      usedNames.add(name);
      const phone = `+7${pick(["701", "702", "705", "707", "747", "775", "777"])}${String(1000000 + Math.floor(rand() * 8999999))}`;
      const created = new Date(now.getTime() - Math.floor(rand() * 200) * 86_400_000);
      const r = await tx.query<{ id: string }>(
        `INSERT INTO clients (salon_id, full_name, phone, tags, notes, custom, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (salon_id, phone) DO NOTHING RETURNING id`,
        [salonId, name, phone, pick(TAGS), pick(NOTES),
          JSON.stringify({ allergy: chance(0.2) ? pick(["Лидокаин", "Пенициллин", "Латекс"]) : "", chronic: chance(0.15) ? pick(["Гипертония", "Диабет 2 типа", "Астма"]) : "", pregnant: false }),
          created],
      );
      if (!r.rows[0]) { i--; continue; }
      const teeth: string[] = [];
      const picked = new Set<string>();
      for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
        const no = pick(TEETH_POOL);
        if (picked.has(no)) continue;
        picked.add(no);
        const t = await tx.query<{ id: string }>(
          `INSERT INTO teeth (salon_id, client_id, tooth_no, diagnosis) VALUES ($1,$2,$3,$4) RETURNING id`,
          [salonId, r.rows[0].id, no, pick(DIAGNOSES)]);
        teeth.push(t.rows[0]!.id);
      }
      clients.push({ id: r.rows[0].id, teeth });
    }

    let appts = 0, payments = 0, revenue = 0;
    for (let day = -HISTORY_DAYS; day <= FUTURE_DAYS; day++) {
      const date = almatyDate(now, day);
      if (isSunday(date)) continue; // график врачей Пн–Сб
      const saturday = new Date(`${date}T12:00:00Z`).getUTCDay() === 6;
      for (const [mi, m] of masters.entries()) {
        // Загрузка врача: в будни плотнее, в будущем — свободнее (запись ещё идёт).
        const fill = (saturday ? 0.55 : 0.78) * (day > 0 ? Math.max(0.25, 0.8 - day * 0.07) : 1) * (0.85 + (mi % 3) * 0.08);
        let cursor = 540 + Math.floor(rand() * 3) * 15;
        while (cursor < 1140) {
          if (!chance(fill)) { cursor += 30 + Math.floor(rand() * 3) * 15; continue; }
          const chosen = [byName.get(pick(bag))!];
          if (chance(0.18)) {
            const extra = byName.get(pick(["Рентген-снимок", "Консультация стоматолога", "Фторирование"]))!;
            if (!chosen.includes(extra)) chosen.push(extra);
          }
          const duration = chosen.reduce((s, c) => s + c.duration_min, 0);
          if (cursor + duration > 1140) { cursor += 30; continue; }
          const start = new Date(`${date}T${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}:00${ALMATY_OFFSET}`);
          const end = new Date(start.getTime() + duration * 60_000);
          cursor += duration + 10 + Math.floor(rand() * 3) * 5;

          const client = pick(clients);
          const servicesTotal = chosen.reduce((s, c) => s + c.price_tenge, 0);
          const parts: [string, number, number][] = [];
          if (chosen.some((c) => toothServices.has(c.name)) && chance(0.7)) {
            parts.push(pick(MATERIALS));
            if (chance(0.4)) parts.push(pick(MATERIALS));
          }
          const partsTotal = parts.reduce((s, [, q, p]) => s + q * p, 0);

          let status: string;
          if (end <= now) {
            const r = rand();
            status = r < 0.06 ? "no_show" : r < 0.13 ? "cancelled" : "paid";
          } else if (start <= now) status = chance(0.5) ? "in_progress" : "arrived";
          else status = chance(0.08) ? "cancelled" : chance(day <= 1 ? 0.8 : 0.4) ? "confirmed" : "booked";

          const done = status === "paid" || status === "in_progress";
          const toothId = chosen.some((c) => toothServices.has(c.name)) && client.teeth.length ? pick(client.teeth) : null;
          const total = servicesTotal + (status === "paid" ? partsTotal : 0);
          const notes = done ? pick(COMPLAINTS[chosen[0]!.name] ?? ["Осмотр, рекомендации даны."]) : "";
          const a = await tx.query<{ id: string }>(
            `INSERT INTO appointments (salon_id, master_id, client_id, tooth_id, starts_at, ends_at, status, price_tenge, parts_tenge, intake_notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [salonId, m.id, client.id, toothId, start, end, status, total, status === "paid" ? partsTotal : 0, notes,
              new Date(Math.min(start.getTime(), now.getTime()) - (1 + Math.floor(rand() * 5)) * 86_400_000)],
          );
          const id = a.rows[0]!.id;
          appts++;
          for (const c of chosen) {
            await tx.query(`INSERT INTO appointment_services (salon_id, appointment_id, service_id, price_tenge) VALUES ($1,$2,$3,$4)`, [salonId, id, c.id, c.price_tenge]);
          }
          if (status === "paid") {
            for (const [name, qty, price] of parts) {
              await tx.query(`INSERT INTO appointment_parts (salon_id, appointment_id, name, qty, price_tenge) VALUES ($1,$2,$3,$4,$5)`, [salonId, id, name, qty, price]);
            }
            let r = rand(), method = "kaspi";
            for (const [mth, w] of METHOD_WEIGHTS) { if ((r -= w) < 0) { method = mth; break; } }
            await tx.query(`INSERT INTO payments (salon_id, appointment_id, method, amount_tenge, created_at) VALUES ($1,$2,$3,$4,$5)`, [salonId, id, method, total, end]);
            payments++; revenue += total;
          }
        }
      }
    }
    return { appointments: appts, payments, clients: clients.length, revenue };
  });
}
