import type { Database } from "./client";
import { hashPassword } from "./password";

/** Пароль всех демо-пользователей. Только для разработки: в продакшене демо-клиника не создаётся. */
export const DEMO_PASSWORD = "Sergek2026!";

const MASTERS = [
  ["Данияр Сериков", "daniyar@sergek.ai"],
  ["Айдос Нурланов", "aidos@sergek.ai"],
  ["Арман Касымов", "arman@sergek.ai"],
  ["Ержан Бекетов", "erzhan@sergek.ai"],
  ["Тимур Оспанов", "timur@sergek.ai"],
  ["Руслан Ахметов", "ruslan@sergek.ai"],
] as const;

// [название, минуты, цена в тенге, лечится ли конкретный зуб]. Первые девять — на них строятся демо-записи.
const SERVICES = [
  ["Консультация стоматолога", 30, 5000, false],
  ["Профессиональная гигиена", 60, 18000, false],
  ["Рентген-снимок", 15, 3000, false],
  ["Лечение кариеса", 60, 20000, true],
  ["Пломбирование", 50, 15000, true],
  ["Лечение пульпита", 90, 35000, true],
  ["Удаление зуба", 40, 12000, true],
  ["Фторирование", 20, 6000, false],
  ["Отбеливание", 90, 70000, false],
  ["Керамическая коронка", 180, 90000, true],
  ["Установка импланта", 120, 250000, true],
  ["Установка брекетов", 120, 200000, false],
] as const;
const SHORT_SERVICES = 9;

const CLIENT_NAMES = [
  "Азамат Жумабаев", "Нурсултан Омаров", "Марат Искаков", "Бауыржан Тлеуов",
  "Алмас Сатыбалдиев", "Динара Сулейменова", "Асель Мукашева", "Санжар Кенжебаев",
  "Олжас Рахимов", "Искандер Абдрахманов", "Канат Мырзахметов", "Аян Ермеков",
  "Мади Жакупов", "Кайрат Нургалиев", "Расул Толеген", "Ильяс Балгабаев", "Темирлан Аубакиров",
];

// Диагнозы для зубной карты демо-пациентов: [номер зуба по FDI, диагноз]
const TEETH = [
  [["36", "Кариес"], ["46", "Пломба"]], [["16", "Пульпит"]], [["21", "Скол"], ["11", "Коронка"]], [["26", "Глубокий кариес"]],
  [["47", "Удалён"], ["37", "Кариес"]], [["14", "Пломба"]], [["24", "Кариес"], ["25", "Кариес"]], [["12", "Имплант"]],
  [["35", "Пульпит"]], [["17", "Кариес"]], [["45", "Пломба"], ["36", "Пломба"]], [["22", "Скол"]],
  [["13", "Коронка"]], [["48", "Дистопирован"]], [["34", "Кариес"]], [["27", "Периодонтит"]], [["33", "Клиновидный дефект"]],
] as const;

const ALMATY_OFFSET = "+05:00"; // Казахстан без перехода на летнее время

/** Календарная дата в Алматы (YYYY-MM-DD) со смещением в днях. */
function almatyDate(now: Date, addDays: number): string {
  return new Date(now.getTime() + 5 * 3600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Наполняет демо-клинику: врачи, услуги, графики, пациенты с зубной картой и записи вокруг `now`.
 * Возвращает id клиники (в базе — salon_id).
 */
export async function seedDemo(db: Database, now = new Date()): Promise<string> {
  const salon = await db.query<{ id: string }>(
    `INSERT INTO salons (name, slug) VALUES ('Sergek Dent', 'demo') RETURNING id`,
  );
  const salonId = salon.rows[0]!.id;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [email, name, role] of [
    ["owner@sergek.ai", "Алия Нурбекова", "owner"],
    ["admin@sergek.ai", "Мадина Сатпаева", "admin"],
  ] as const) {
    await db.query(
      `INSERT INTO users (salon_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`,
      [salonId, email, passwordHash, name, role],
    );
  }

  const masterIds: string[] = [];
  for (const [name, email] of MASTERS) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO masters (salon_id, full_name, email) VALUES ($1,$2,$3) RETURNING id`,
      [salonId, name, email],
    );
    masterIds.push(r.rows[0]!.id);
    await db.query(
      `INSERT INTO users (salon_id, email, password_hash, full_name, role, master_id)
       VALUES ($1,$2,$3,$4,'master',$5)`,
      [salonId, email, passwordHash, name, r.rows[0]!.id],
    );
    // Пн–Сб 09:00–19:00 одной сменой: долгие процедуры (имплантация, коронки) не должны упираться в перерыв.
    for (let weekday = 1; weekday <= 6; weekday++) {
      await db.query(
        `INSERT INTO schedule_intervals (salon_id, master_id, weekday, start_min, end_min)
         VALUES ($1,$2,$3,$4,$5)`,
        [salonId, r.rows[0]!.id, weekday, 540, 1140],
      );
    }
  }

  const services: { id: string; duration: number; price: number; tooth: boolean }[] = [];
  for (const [name, duration, price, tooth] of SERVICES) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO services (salon_id, name, duration_min, price_tenge) VALUES ($1,$2,$3,$4) RETURNING id`,
      [salonId, name, duration, price],
    );
    services.push({ id: r.rows[0]!.id, duration, price, tooth });
  }

  const clientIds: string[] = [];
  for (const [i, name] of CLIENT_NAMES.entries()) {
    const phone = `+7701${String(1000000 + i * 7919).slice(0, 7)}`;
    const r = await db.query<{ id: string }>(
      `INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
      [salonId, name, phone],
    );
    clientIds.push(r.rows[0]!.id);
  }

  // Зубная карта: у каждого пациента отмечены 1–2 зуба.
  const teethIds: string[][] = [];
  for (const [i, id] of clientIds.entries()) {
    const ids: string[] = [];
    for (const [toothNo, diagnosis] of TEETH[i % TEETH.length]!) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO teeth (salon_id, client_id, tooth_no, diagnosis) VALUES ($1,$2,$3,$4) RETURNING id`,
        [salonId, id, toothNo, diagnosis],
      );
      ids.push(r.rows[0]!.id);
    }
    teethIds.push(ids);
  }

  // Поля карточки пациента: то, что врач обязан знать до начала лечения.
  for (const [pos, [key, label, type]] of ([["allergy", "Аллергии", "text"], ["chronic", "Хронические заболевания", "text"], ["pregnant", "Беременность", "checkbox"]] as const).entries()) {
    await db.query(`INSERT INTO custom_fields (salon_id, key, label, type, position) VALUES ($1,$2,$3,$4,$5)`, [salonId, key, label, type, pos]);
  }

  // Каждый врач получает по две записи в день (11:00 и 16:00), сутки от -2 до +5.
  let n = 0;
  for (let day = -2; day <= 5; day++) {
    const date = almatyDate(now, day);
    for (const [m, masterId] of masterIds.entries()) {
      for (const hour of [11, 16]) {
        n++;
        const service = services[n % SHORT_SERVICES]!;
        const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00${ALMATY_OFFSET}`);
        const end = new Date(start.getTime() + service.duration * 60_000);
        // Прошлое — оплачено или неявка; сегодня — по часам: уже закончено, в работе или ещё впереди.
        const status = end <= now
          ? n % 9 === 0 ? "no_show" : "paid"
          : start <= now ? (n % 2 ? "in_progress" : "ready")
          : n % 7 === 0 ? "cancelled" : n % 2 === 0 ? "confirmed" : "booked";
        const clientIdx = (n + m) % clientIds.length;
        const a = await db.query<{ id: string }>(
          `INSERT INTO appointments (salon_id, master_id, client_id, tooth_id, starts_at, ends_at, status, price_tenge)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [salonId, masterId, clientIds[clientIdx], service.tooth ? teethIds[clientIdx]![0]! : null, start, end, status, service.price],
        );
        await db.query(
          `INSERT INTO appointment_services (salon_id, appointment_id, service_id, price_tenge)
           VALUES ($1,$2,$3,$4)`,
          [salonId, a.rows[0]!.id, service.id, service.price],
        );
        if (status === "paid") {
          await db.query(
            `INSERT INTO payments (salon_id, appointment_id, method, amount_tenge, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [salonId, a.rows[0]!.id, (["cash", "kaspi", "card"] as const)[n % 3], service.price, end],
          );
        }
      }
    }
  }
  return salonId;
}
