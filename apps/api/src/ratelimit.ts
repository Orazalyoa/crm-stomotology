/** Простой счётчик попыток в памяти процесса: окно сбрасывается по времени. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Учитывает попытку; false — лимит исчерпан. */
  hit(key: string, now: Date): boolean {
    const t = now.getTime();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  /** Заблокирован ли ключ, не расходуя попытку. */
  blocked(key: string, now: Date): boolean {
    const entry = this.hits.get(key);
    return !!entry && entry.resetAt > now.getTime() && entry.count >= this.limit;
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
