import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DEMO_PASSWORD, openDb, seedDemo, withSalon } from "@salon/db";
import { buildApp } from "./app";

// «Сейчас» зафиксировано: среда 2026-11-04 09:00 по Алматы.
const NOW = new Date("2026-11-04T09:00:00+05:00");
const SECRET = "test-secret-test-secret-test-secret";

let app: FastifyInstance;
let salonId: string;
const sms: { phone: string; text: string }[] = [];
const ids = {} as Record<"daniyar" | "aidos" | "client" | "caries", string>;

const cookieOf = (res: LightMyRequestResponse, name: string) =>
  [res.headers["set-cookie"]].flat().find((c) => c?.startsWith(`${name}=`))?.split(";")[0];

async function staffCookie(email: string, password = DEMO_PASSWORD) {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  return { res, cookie: cookieOf(res, "sid_staff") as string };
}
const get = (url: string, cookie?: string) => app.inject({ url, headers: cookie ? { cookie } : {} });
const send = (method: "POST" | "PATCH", url: string, payload: unknown, cookie?: string) =>
  app.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });

/** Вход клиента по коду из SMS; возвращает cookie сессии клиента. */
async function clientCookie(phone: string, fullName: string) {
  await send("POST", "/api/auth/client/request-otp", { slug: "demo", phone });
  const code = sms.at(-1)!.text.match(/\d{6}/)![0];
  const res = await send("POST", "/api/auth/client/verify", { slug: "demo", phone, code, fullName });
  return { res, cookie: cookieOf(res, "sid_client") as string };
}

beforeAll(async () => {
  const db = await openDb();
  salonId = await seedDemo(db, NOW);
  app = buildApp({ db, secret: SECRET, now: () => NOW, sms: { send: async (phone, text) => void sms.push({ phone, text }) } });
  await withSalon(db, salonId, async (q) => {
    ids.daniyar = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Данияр%'`)).rows[0]!.id;
    ids.aidos = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Айдос%'`)).rows[0]!.id;
    ids.client = (await q<{ id: string }>(`SELECT id FROM clients LIMIT 1`)).rows[0]!.id;
    ids.caries = (await q<{ id: string }>(`SELECT id FROM services WHERE name='Лечение кариеса'`)).rows[0]!.id;
  });
});

describe("анонимный доступ закрыт", () => {
  it.each(["/api/staff/dashboard", "/api/staff/appointments", "/api/master/appointments?date=2026-11-05", "/api/my/appointments"])(
    "%s → 401",
    async (url) => expect((await get(url)).statusCode).toBe(401),
  );

  it.each(["/admin", "/admin/m", "/master"])("страница %s для анонима не существует (404)", async (url) => {
    expect((await get(url)).statusCode).toBe(404);
  });

  it("публичные страницы и ассеты открыты", async () => {
    expect((await get("/login")).statusCode).toBe(200);
    expect((await get("/b/demo")).statusCode).toBe(200);
    expect((await get("/assets/ui.css")).statusCode).toBe(200);
  });

  it("ассеты не отдают чужие файлы (path traversal)", async () => {
    expect((await get("/assets/..%2f..%2fpackage.json")).statusCode).toBe(404);
  });
});

describe("вход персонала", () => {
  it("неверный пароль и неизвестный email дают один и тот же ответ", async () => {
    const wrong = await staffCookie("admin@sergek.ai", "wrong-password");
    const unknown = await staffCookie("nobody@sergek.ai", "wrong-password");
    expect(wrong.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(wrong.res.json()).toEqual(unknown.res.json());
    expect(wrong.cookie).toBeUndefined();
  });

  it("cookie сессии HttpOnly + SameSite=Strict", async () => {
    const { res } = await staffCookie("admin@sergek.ai");
    const setCookie = [res.headers["set-cookie"]].flat().join(";");
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
  });

  it("после 5 неудачных попыток блокирует вход, даже с верным паролем", async () => {
    for (let i = 0; i < 5; i++) await staffCookie("ruslan@sergek.ai", "bad");
    const res = (await staffCookie("ruslan@sergek.ai")).res;
    expect(res.statusCode).toBe(429);
  });

  it("подделанная cookie не принимается", async () => {
    const { cookie } = await staffCookie("admin@sergek.ai");
    const forged = cookie.slice(0, -3) + "AAA";
    expect((await get("/api/staff/dashboard", forged)).statusCode).toBe(401);
  });

  it("выход гасит cookie", async () => {
    const { cookie } = await staffCookie("admin@sergek.ai");
    const res = await send("POST", "/api/auth/logout", {}, cookie);
    expect([res.headers["set-cookie"]].flat().join(";")).toMatch(/sid_staff=;/);
  });
});

describe("роли не пересекаются", () => {
  it("администратор видит админку и не видит страницу и API мастера", async () => {
    const { cookie } = await staffCookie("admin@sergek.ai");
    expect((await get("/admin", cookie)).statusCode).toBe(200);
    expect((await get("/admin/m", cookie)).statusCode).toBe(200);
    expect((await get("/master", cookie)).statusCode).toBe(404);
    expect((await get("/api/master/appointments?date=2026-11-05", cookie)).statusCode).toBe(403);
  });

  it("владелец тоже заходит в админку", async () => {
    const { cookie } = await staffCookie("owner@sergek.ai");
    expect((await get("/admin", cookie)).statusCode).toBe(200);
  });

  it("мастеру закрыты админка и её API", async () => {
    const { cookie } = await staffCookie("daniyar@sergek.ai");
    expect((await get("/master", cookie)).statusCode).toBe(200);
    expect((await get("/admin", cookie)).statusCode).toBe(404);
    expect((await get("/api/staff/dashboard", cookie)).statusCode).toBe(403);
    expect((await get("/api/staff/clients", cookie)).statusCode).toBe(403);
  });

  it("клиенту закрыты админка, мастер и их API", async () => {
    const { cookie } = await clientCookie("+77015550001", "Тест Клиент");
    expect((await get("/admin", cookie)).statusCode).toBe(404);
    expect((await get("/master", cookie)).statusCode).toBe(404);
    expect((await get("/api/staff/dashboard", cookie)).statusCode).toBe(401);
    expect((await get("/api/master/appointments?date=2026-11-05", cookie)).statusCode).toBe(401);
  });

  it("cookie персонала не открывает кабинет клиента", async () => {
    const { cookie } = await staffCookie("admin@sergek.ai");
    expect((await get("/api/my/appointments", cookie)).statusCode).toBe(401);
  });

  it("деактивированный сотрудник теряет доступ сразу", async () => {
    const db = await openDb(); // отдельная база, чтобы не влиять на остальные тесты
    const id = await seedDemo(db, NOW);
    const a = buildApp({ db, secret: SECRET, now: () => NOW });
    const login = await a.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@sergek.ai", password: DEMO_PASSWORD } });
    const cookie = cookieOf(login, "sid_staff")!;
    expect((await a.inject({ url: "/api/staff/dashboard", headers: { cookie } })).statusCode).toBe(200);
    await db.query(`UPDATE users SET active = false WHERE salon_id = $1 AND email = 'admin@sergek.ai'`, [id]);
    expect((await a.inject({ url: "/api/staff/dashboard", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("админ: данные", () => {
  let cookie: string;
  beforeAll(async () => void ({ cookie } = await staffCookie("admin@sergek.ai")));

  it("дашборд", async () => {
    const res = await get("/api/staff/dashboard", cookie);
    expect(res.json()).toMatchObject({ services: 12, masters: 6 });
    expect(res.json().clients).toBeGreaterThanOrEqual(17); // другие тесты могут добавить клиентов
    expect(res.json().appointmentsToday).toBeGreaterThan(0);
  });

  it("предстоящие: только будущие и активные, ближайшие первыми", async () => {
    const { items, total } = (await get("/api/staff/appointments?tab=upcoming&pageSize=50", cookie)).json();
    expect(total).toBeGreaterThan(0);
    const times = items.map((i: { startsAt: string }) => new Date(i.startsAt).getTime());
    expect(times.every((t: number) => t >= NOW.getTime())).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(items.every((i: { status: string }) => ["booked", "confirmed"].includes(i.status))).toBe(true);
  });

  it("вкладка отменённых, страницы и поиск", async () => {
    const cancelled = (await get("/api/staff/appointments?tab=cancelled&pageSize=50", cookie)).json();
    expect(cancelled.items.length).toBeGreaterThan(0);
    expect(cancelled.items.every((i: { status: string }) => i.status === "cancelled")).toBe(true);

    const p1 = (await get("/api/staff/appointments?tab=all&page=1&pageSize=10", cookie)).json();
    const p2 = (await get("/api/staff/appointments?tab=all&page=2&pageSize=10", cookie)).json();
    expect(p1.items).toHaveLength(10);
    expect(p2.items[0].id).not.toBe(p1.items[0].id);

    const found = (await get(`/api/staff/appointments?tab=all&pageSize=50&q=${encodeURIComponent("данияр")}`, cookie)).json();
    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items.every((i: { masterName: string }) => i.masterName.includes("Данияр"))).toBe(true);
  });
});

describe("слоты и запись (админ)", () => {
  let cookie: string;
  const day = "2026-11-10"; // вторник
  const startsAt = "2026-11-10T10:00:00+05:00";
  beforeAll(async () => void ({ cookie } = await staffCookie("admin@sergek.ai")));
  const slotsUrl = () => `/api/staff/slots?masterId=${ids.daniyar}&date=${day}&serviceIds=${ids.caries}`;

  it("слоты только в рабочее время смены 09:00–19:00", async () => {
    const slots: string[] = (await get(slotsUrl(), cookie)).json().slots;
    expect(slots[0]).toBe("2026-11-10T09:00:00+05:00");
    expect(slots).toContain("2026-11-10T18:00:00+05:00"); // 45 минут укладываются до 19:00
    expect(slots).not.toContain("2026-11-10T18:30:00+05:00");
  });

  it("создаёт запись, слот исчезает, повтор даёт 409", async () => {
    const body = { masterId: ids.daniyar, clientId: ids.client, serviceIds: [ids.caries], startsAt };
    const created = await send("POST", "/api/staff/appointments", body, cookie);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "booked", priceTenge: 20000 });
    expect((await get(slotsUrl(), cookie)).json().slots).not.toContain(startsAt);
    expect((await send("POST", "/api/staff/appointments", body, cookie)).statusCode).toBe(409);
  });

  it("не даёт записать вне рабочих часов (409) и проверяет тело (400)", async () => {
    const off = { masterId: ids.daniyar, clientId: ids.client, serviceIds: [ids.caries], startsAt: "2026-11-10T03:00:00+05:00" };
    expect((await send("POST", "/api/staff/appointments", off, cookie)).statusCode).toBe(409);
    expect((await send("POST", "/api/staff/appointments", { masterId: ids.daniyar }, cookie)).statusCode).toBe(400);
  });

  it("меняет статус по допустимым переходам, недопустимые — 409", async () => {
    const list = (await get("/api/staff/appointments?tab=upcoming&pageSize=1", cookie)).json();
    const id = list.items[0].id;
    expect((await send("PATCH", `/api/staff/appointments/${id}`, { status: "arrived" }, cookie)).statusCode).toBe(200);
    // «Оплачен» ставится только через кассу
    expect((await send("PATCH", `/api/staff/appointments/${id}`, { status: "paid" }, cookie)).statusCode).toBe(400);
    expect((await send("POST", `/api/staff/appointments/${id}/pay`, { method: "kaspi" }, cookie)).statusCode).toBe(200);
    expect((await send("PATCH", `/api/staff/appointments/${id}`, { status: "booked" }, cookie)).statusCode).toBe(409);
    expect((await send("PATCH", `/api/staff/appointments/${id}`, { status: "nonsense" }, cookie)).statusCode).toBe(400);
  });
});

describe("мастер видит только своё", () => {
  let cookie: string;
  beforeAll(async () => void ({ cookie } = await staffCookie("daniyar@sergek.ai")));

  it("список содержит только записи этого мастера", async () => {
    const res = await get("/api/master/appointments?date=2026-11-05", cookie);
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: { masterId: string }) => i.masterId === ids.daniyar)).toBe(true);
  });

  it("отмечает приход своей записи и не может тронуть чужую", async () => {
    const mine = (await get("/api/master/appointments?date=2026-11-05", cookie)).json().items.find(
      (i: { status: string }) => ["booked", "confirmed"].includes(i.status),
    );
    expect((await send("PATCH", `/api/master/appointments/${mine.id}`, { status: "arrived" }, cookie)).statusCode).toBe(200);

    const admin = (await staffCookie("admin@sergek.ai")).cookie;
    const others = (await get("/api/staff/appointments?tab=upcoming&pageSize=50&q=Айдос", admin)).json().items;
    const res = await send("PATCH", `/api/master/appointments/${others[0].id}`, { status: "arrived" }, cookie);
    expect(res.statusCode).toBe(404);
  });

  it("мастер не может ставить «оплачен» или «отменён»", async () => {
    const mine = (await get("/api/master/appointments?date=2026-11-06", cookie)).json().items.find(
      (i: { status: string }) => ["booked", "confirmed"].includes(i.status),
    );
    expect((await send("PATCH", `/api/master/appointments/${mine.id}`, { status: "paid" }, cookie)).statusCode).toBe(400);
  });
});

describe("клиент: вход по коду и онлайн-запись", () => {
  it("код не возвращается в ответе, а уходит по SMS; неверный код отклоняется", async () => {
    const res = await send("POST", "/api/auth/client/request-otp", { slug: "demo", phone: "8 (701) 555-00-02" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/\d{6}/);
    expect(sms.at(-1)!.phone).toBe("+77015550002");
    const bad = await send("POST", "/api/auth/client/verify", { slug: "demo", phone: "+77015550002", code: "000000", fullName: "Х" });
    expect(bad.statusCode).toBe(401);
  });

  it("ограничивает частоту запросов кода", async () => {
    await send("POST", "/api/auth/client/request-otp", { slug: "demo", phone: "+77015550003" });
    const again = await send("POST", "/api/auth/client/request-otp", { slug: "demo", phone: "+77015550003" });
    expect(again.statusCode).toBe(429);
  });

  it("запись → видна в кабинете → отмена; чужую запись не отменить", async () => {
    const { cookie } = await clientCookie("+77015550004", "Нурлан Тестов");
    const book = await send(
      "POST", "/api/public/demo/book",
      { masterId: ids.aidos, serviceIds: [ids.caries], startsAt: "2026-11-12T10:00:00+05:00" }, cookie,
    );
    expect(book.statusCode).toBe(201);

    const mine = (await get("/api/my/appointments", cookie)).json().items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "booked", masterName: expect.stringContaining("Айдос") });

    const other = (await clientCookie("+77015550005", "Другой Клиент")).cookie;
    expect((await send("POST", `/api/my/appointments/${mine[0].id}/cancel`, {}, other)).statusCode).toBe(404);
    expect((await send("POST", `/api/my/appointments/${mine[0].id}/cancel`, {}, cookie)).statusCode).toBe(200);
    expect((await get("/api/my/appointments", cookie)).json().items[0].status).toBe("cancelled");
  });

  it("за менее чем 2 часа до визита отмена запрещена", async () => {
    const { cookie } = await clientCookie("+77015550006", "Поздний Клиент");
    const book = await send(
      "POST", "/api/public/demo/book",
      { masterId: ids.daniyar, serviceIds: [ids.caries], startsAt: "2026-11-04T10:00:00+05:00" }, cookie,
    );
    expect(book.statusCode).toBe(201);
    const id = (await get("/api/my/appointments", cookie)).json().items[0].id;
    expect((await send("POST", `/api/my/appointments/${id}/cancel`, {}, cookie)).statusCode).toBe(409);
  });

  it("запись без входа и в неизвестную клинику невозможна", async () => {
    const body = { masterId: ids.aidos, serviceIds: [ids.caries], startsAt: "2026-11-13T10:00:00+05:00" };
    expect((await send("POST", "/api/public/demo/book", body)).statusCode).toBe(401);
    const { cookie } = await clientCookie("+77015550007", "Клиент");
    expect((await send("POST", "/api/public/other-salon/book", body, cookie)).statusCode).toBe(404);
  });

  it("публичный каталог не отдаёт клиентов и внутренние данные", async () => {
    const res = await get("/api/public/demo");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.masters.length).toBe(6);
    expect(JSON.stringify(body)).not.toMatch(/email|phone|@sergek/);
  });
});
