/** За сколько часов до визита клиент ещё может отменить запись сам. */
export const CANCEL_MIN_HOURS = 2;

export const STATUSES = ["booked", "confirmed", "arrived", "in_progress", "ready", "paid", "cancelled", "no_show"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Допустимые переходы статуса записи (пришёл = arrived, на приёме = in_progress, приём завершён = ready):
 * записан → подтверждён → принят → в работе → готов → оплачен. paid / cancelled / no_show — конечные.
 */
const NEXT: Record<Status, readonly Status[]> = {
  booked: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["in_progress", "paid", "no_show"],
  in_progress: ["ready", "paid"],
  ready: ["paid"],
  paid: [],
  cancelled: [],
  no_show: [],
};

export const isStatus = (s: unknown): s is Status => STATUSES.includes(s as Status);
export const canTransition = (from: Status, to: Status) => NEXT[from].includes(to);

/** Что может ставить врач: приход пациента, начало приёма, завершение и неявку. Оплата — только в кассе. */
export const MASTER_STATUSES: readonly Status[] = ["arrived", "in_progress", "ready", "no_show"];
