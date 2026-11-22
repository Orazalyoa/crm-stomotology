/** Интервал в минутах от полуночи в часовом поясе клиники; конец не включается. */
export interface Interval {
  start: number;
  end: number;
}

export interface SlotQuery {
  /** Рабочие интервалы мастера за день (перерывы — это просветы между ними). */
  working: Interval[];
  /** Занятые интервалы: существующие записи, блокировки. */
  busy: Interval[];
  /** Суммарная длительность выбранных услуг. */
  durationMin: number;
  /** Шаг сетки стартовых времён. */
  stepMin: number;
  /** Пауза после каждой записи (уборка, подготовка). */
  bufferMin?: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Возвращает стартовые времена, в которые услуга целиком помещается в свободное время. */
export function computeSlots(query: SlotQuery): number[] {
  const { working, busy, durationMin, stepMin, bufferMin = 0 } = query;
  if (durationMin <= 0 || stepMin <= 0) {
    throw new RangeError("durationMin and stepMin must be positive");
  }

  const blocked = busy.map((b) => ({ start: b.start, end: b.end + bufferMin }));
  const slots: number[] = [];

  for (const interval of [...working].sort((a, b) => a.start - b.start)) {
    for (let start = interval.start; start + durationMin <= interval.end; start += stepMin) {
      const candidate = { start, end: start + durationMin };
      if (!blocked.some((b) => overlaps(candidate, b))) slots.push(start);
    }
  }
  return slots;
}
