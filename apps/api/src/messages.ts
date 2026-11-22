/**
 * Тексты Telegram-бота. Все сообщения в формате HTML (parse_mode=HTML):
 * заголовок жирным, данные строками с иконками, разделитель между блоками.
 * Любой текст из базы (имена, услуги) экранируется: символ «<» в имени клиента не должен ломать сообщение.
 */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b = (s: string) => `<b>${esc(s)}</b>`;
const LINE = "┈┈┈┈┈┈┈┈┈┈┈┈";

const TZ = { timeZone: "Asia/Almaty" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const hm = (d: Date) => new Intl.DateTimeFormat("ru-RU", { ...TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const dayMonth = (d: Date) => new Intl.DateTimeFormat("ru-RU", { ...TZ, day: "numeric", month: "long" }).format(d);
const weekdayShort = (d: Date) => cap(new Intl.DateTimeFormat("ru-RU", { ...TZ, weekday: "short" }).format(d));
/** «Пн, 26 октября» */
export const dateLabel = (d: Date) => `${weekdayShort(d)}, ${dayMonth(d)}`;
export const money = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export interface ApptView {
  startsAt: Date;
  endsAt: Date;
  clientName: string;
  clientPhone: string;
  services: string;
  masterName: string;
  priceTenge: number;
  /** «зуб 36 · Кариес»; пусто, если зуб не указан. */
  tooth?: string;
}

export type Role = "owner" | "admin" | "master" | "client";

/* ------------------------- меню (кнопки под полем ввода) ------------------------- */

export const BTN = {
  today: "🗓 Сегодня", tomorrow: "🗓 Завтра", summary: "📊 Итоги дня",
  mine: "📅 Мои записи", help: "❓ Помощь",
} as const;

export const MENU: Record<Role, string[][]> = {
  master: [[BTN.today, BTN.tomorrow], [BTN.help]],
  admin: [[BTN.summary, BTN.today], [BTN.tomorrow, BTN.help]],
  owner: [[BTN.summary, BTN.today], [BTN.tomorrow, BTN.help]],
  client: [[BTN.mine], [BTN.help]],
};

/* ------------------------------- уведомления ------------------------------- */

const detailLines = (a: ApptView, who: "client" | "staff") => [
  `📅 ${b(`${dateLabel(a.startsAt)} · ${hm(a.startsAt)}–${hm(a.endsAt)}`)}`,
  ...(who === "staff" ? [`👤 ${esc(a.clientName)}`, `📞 ${esc(a.clientPhone)}`] : []),
  ...(a.tooth ? [`🦷 ${esc(a.tooth)}`] : []),
  `🦷 ${esc(a.services)}`,
  `👨‍🦷 Врач: ${esc(a.masterName)}`,
  `💰 ${money(a.priceTenge)}`,
];

export const bookedForStaff = (a: ApptView) => ["🆕 " + b("Новая запись"), "", ...detailLines(a, "staff")].join("\n");

export const bookedForClient = (a: ApptView) =>
  ["✅ " + b("Вы записаны"), "", ...detailLines(a, "client"), "", LINE, "Напомню о визите заранее 🔔"].join("\n");

export const cancelledForStaff = (a: ApptView, byClient: boolean) =>
  ["❌ " + b(byClient ? "Клиент отменил запись" : "Запись отменена"), "", ...detailLines(a, "staff"), "", LINE, "Время снова свободно"].join("\n");

export const reminder = (a: ApptView, kind: "24h" | "2h") =>
  [
    "⏰ " + b("Напоминание о визите"),
    "",
    kind === "24h" ? `Завтра, ${b(hm(a.startsAt))}` : `Через 2 часа, ${b(hm(a.startsAt))}`,
    "",
    ...detailLines(a, "client"),
    "",
    LINE,
    "Подтвердите, пожалуйста 👇",
  ].join("\n");

export const confirmedCard = (a: ApptView) =>
  ["✅ " + b("Запись подтверждена"), "", ...detailLines(a, "client"), "", LINE, "Ждём вас!"].join("\n");

export const cancelledCard = (a: ApptView) =>
  ["❌ " + b("Запись отменена"), "", ...detailLines(a, "client"), "", LINE, "Будем рады видеть вас в другой раз"].join("\n");

export const tooLateToCancel = (hours: number) =>
  ["⚠️ " + b("Отмена уже недоступна"), "", `Отменить можно не позже чем за ${hours} ч до визита.`, "Пожалуйста, позвоните на СТО 📞"].join("\n");

/* --------------------------------- сводки --------------------------------- */

export interface DayStats { visits: number; revenue: number; noShow: number; cancelled: number; tomorrow: number }

export const daySummary = (date: Date, s: DayStats) =>
  [
    `📊 ${b("Итоги дня")} · ${esc(dateLabel(date))}`,
    "",
    `💰 Выручка: ${b(money(s.revenue))}`,
    `✅ Визитов: ${b(String(s.visits))}`,
    `🚫 Неявок: ${s.noShow}`,
    `❌ Отмен: ${s.cancelled}`,
    "",
    LINE,
    `📆 Завтра записей: ${b(String(s.tomorrow))}`,
  ].join("\n");

export interface ScheduleRow { startsAt: Date; endsAt: Date; clientName: string; services: string; masterName?: string }

const row = (r: ScheduleRow) => [`${b(`${hm(r.startsAt)}–${hm(r.endsAt)}`)}  ${esc(r.clientName)}`, `      🦷 ${esc(r.services)}`].join("\n");

/** Расписание одного врача. */
export const masterSchedule = (date: Date, title: string, rows: ScheduleRow[]) =>
  rows.length
    ? [`🗓 ${b(title)} · ${esc(dateLabel(date))}`, "", rows.map(row).join("\n\n"), "", LINE, `Всего записей: ${b(String(rows.length))}`].join("\n")
    : [`🗓 ${b(title)} · ${esc(dateLabel(date))}`, "", "Записей нет — можно отдохнуть 🌿"].join("\n");

/** Расписание всей клиники по врачам (для владельца и администратора). */
export const salonSchedule = (date: Date, title: string, rows: ScheduleRow[]) => {
  if (!rows.length) return [`📆 ${b(title)} · ${esc(dateLabel(date))}`, "", "Записей нет"].join("\n");
  const byMaster = new Map<string, ScheduleRow[]>();
  for (const r of rows) byMaster.set(r.masterName ?? "", [...(byMaster.get(r.masterName ?? "") ?? []), r]);
  const blocks = [...byMaster].map(([m, list]) => [`👨‍🦷 ${b(m)}`, ...list.map((r) => `${hm(r.startsAt)}–${hm(r.endsAt)} · ${esc(r.clientName)}\n      🦷 ${esc(r.services)}`)].join("\n"));
  return [`📆 ${b(title)} · ${esc(dateLabel(date))}`, "", blocks.join("\n\n"), "", LINE, `Всего записей: ${b(String(rows.length))}`].join("\n");
};

export interface UpcomingRow { startsAt: Date; services: string; masterName: string }

export const clientUpcoming = (rows: UpcomingRow[]) =>
  rows.length
    ? ["📅 " + b("Ваши ближайшие записи"), "", rows.map((r) => [`${b(`${dateLabel(r.startsAt)} · ${hm(r.startsAt)}`)}`, `🦷 ${esc(r.services)}`, `👨‍🦷 ${esc(r.masterName)}`].join("\n")).join("\n\n")].join("\n")
    : ["📅 " + b("Ближайших записей нет"), "", "Записаться можно на странице онлайн-записи клиники."].join("\n");

/* ------------------------- знакомство, справка, ошибки ------------------------- */

const WHAT_I_SEND: Record<Role, string[]> = {
  client: ["• напоминаю о записях", "• даю подтвердить или отменить визит одной кнопкой"],
  master: ["• сообщаю о новых записях и отменах", "• утром присылаю расписание на день"],
  admin: ["• сообщаю о новых записях и отменах", "• вечером присылаю итоги дня"],
  owner: ["• сообщаю о новых записях и отменах", "• вечером присылаю итоги дня"],
};

export const linked = (name: string, role: Role) =>
  [`✅ ${b(`Готово, ${name}!`)}`, "", "Теперь я:", ...WHAT_I_SEND[role], "", "Меню — кнопки внизу 👇"].join("\n");

export const help = (role: Role) => {
  const commands: Record<Role, string[]> = {
    client: [`${b(BTN.mine)} — ваши ближайшие записи`],
    master: [`${b(BTN.today)} — ваши записи на сегодня`, `${b(BTN.tomorrow)} — записи на завтра`],
    admin: [`${b(BTN.summary)} — выручка, визиты, неявки`, `${b(BTN.today)} — записи клиники на сегодня`, `${b(BTN.tomorrow)} — записи на завтра`],
    owner: [`${b(BTN.summary)} — выручка, визиты, неявки`, `${b(BTN.today)} — записи клиники на сегодня`, `${b(BTN.tomorrow)} — записи на завтра`],
  };
  return ["❓ " + b("Что я умею"), "", ...commands[role], "", "🔔 Сам напишу, когда:", ...WHAT_I_SEND[role], "", LINE, "/stop — отключить уведомления"].join("\n");
};

export const notConnected = () =>
  [
    "👋 " + b("Я бот Sergek Dent"),
    "",
    "Чтобы подключиться, откройте ссылку:",
    "",
    "👨‍🦷 " + b("Сотрудник") + " — в CRM: Настройки → «Подключить Telegram»",
    "👤 " + b("Клиент") + " — на странице записи: Мои записи → «Подключить Telegram»",
  ].join("\n");

export const linkExpired = () =>
  ["⚠️ " + b("Ссылка устарела"), "", "Она действует 15 минут и работает один раз.", "Создайте новую в CRM или в кабинете записи."].join("\n");

export const unknownCommand = () => ["🤔 " + b("Не понял"), "", "Выберите действие в меню ниже 👇"].join("\n");

export const stopped = () => ["🔕 " + b("Уведомления отключены"), "", "Чтобы подключить снова, откройте ссылку из CRM или кабинета записи."].join("\n");

export const summaryForbidden = () => ["🔒 " + b("Недоступно"), "", "Итоги дня видят владелец и администратор."].join("\n");

export const noAppointment = () => "⚠️ Эта запись уже недоступна";
