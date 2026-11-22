import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DEMO_PASSWORD, openDb, seedDemo, withSalon } from "@salon/db";
import { buildApp } from "./app";

// «Сейчас» зафиксировано: среда 2026-11-04 09:00 по Алматы.
const NOW = new Date("2026-11-04T09:00:00+05:00");
const sms: { phone: string; text: string }[] = [];

let app: FastifyInstance;
let admin: string;
let doctor: string;
const ids = {} as Record<"daniyar" | "caries" | "clientA" | "clientB", string>;

const cookieOf = (res: LightMyRequestResponse, name: string) =>
  [res.headers["set-cookie"]].flat().find((c) => c?.startsWith(`${name}=`))?.split(";")[0] as string;
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(payload !== undefined && { payload: payload as object }) });
const login = async (email: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: DEMO_PASSWORD } }), "sid_staff");

const book = (cookie: string, body: object) => call("POST", "/api/staff/appointments", cookie, { masterId: ids.daniyar, serviceIds: [ids.caries], ...body });

beforeAll(async () => {
  const db = await openDb();
  const salonId = await seedDemo(db, NOW);
  app = buildApp({ db, secret: "test-secret-test-secret-test-secret", now: () => NOW, sms: { send: async (phone, text) => void sms.push({ phone, text }) } });
  await withSalon(db, salonId, async (q) => {
    ids.daniyar = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Данияр%'`)).rows[0]!.id;
    ids.caries = (await q<{ id: string }>(`SELECT id FROM services WHERE name = 'Лечение кариеса'`)).rows[0]!.id;
  });
  admin = await login("admin@sergek.ai");
  doctor = await login("daniyar@sergek.ai");
  // Новые пациенты с пустой зубной картой — тесты не зависят от демо-данных.
  const newClient = async (fullName: string, phone: string) => (await call("POST", "/api/staff/clients", admin, { fullName, phone })).json().id as string;
  ids.clientA = await newClient("Тест Пациентов Первый", "+77015550011");
  ids.clientB = await newClient("Тест Пациентов Второй", "+77015550012");
});

describe("зубная карта пациента", () => {
  it("демо-данные: у пациентов есть зубы, поиск работает по номеру зуба и диагнозу", async () => {
    const all = (await call("GET", "/api/staff/teeth", admin)).json();
    expect(all.length).toBeGreaterThanOrEqual(17);
    const byDiagnosis = (await call("GET", "/api/staff/teeth?q=" + encodeURIComponent("кариес"), admin)).json();
    expect(byDiagnosis.length).toBeGreaterThan(0);
    expect(byDiagnosis.every((t: { diagnosis: string }) => /кариес/i.test(t.diagnosis))).toBe(true);
  });

  it("добавляет зуб по FDI; дубль, чужая нумерация и пустой диагноз отклоняются", async () => {
    const created = await call("POST", "/api/staff/teeth", admin, { clientId: ids.clientA, toothNo: "36", diagnosis: "Кариес", notes: "жевательная поверхность" });
    expect(created.statusCode).toBe(201);
    const card = (await call("GET", `/api/staff/clients/${ids.clientA}`, admin)).json();
    expect(card.teeth).toEqual([expect.objectContaining({ toothNo: "36", diagnosis: "Кариес", notes: "жевательная поверхность" })]);

    const post = (body: object) => call("POST", "/api/staff/teeth", admin, { clientId: ids.clientA, ...body });
    expect((await post({ toothNo: "36", diagnosis: "Пульпит" })).statusCode).toBe(409); // зуб уже в карте
    expect((await post({ toothNo: "19", diagnosis: "Кариес" })).statusCode).toBe(400);   // такого зуба нет
    expect((await post({ toothNo: "49", diagnosis: "Кариес" })).statusCode).toBe(400);
    expect((await post({ toothNo: "55", diagnosis: "Кариес" })).statusCode).toBe(201);   // молочный
    expect((await post({ toothNo: "11", diagnosis: " " })).statusCode).toBe(400);
    // Тот же номер у другого пациента — это другой зуб.
    expect((await call("POST", "/api/staff/teeth", admin, { clientId: ids.clientB, toothNo: "36", diagnosis: "Пломба" })).statusCode).toBe(201);
  });

  it("список пациентов показывает зубы и находит пациента по диагнозу", async () => {
    const list = (await call("GET", `/api/staff/clients?q=${encodeURIComponent("Пломба")}`, admin)).json();
    expect(list.some((c: { id: string }) => c.id === ids.clientB)).toBe(true);
    const row = (await call("GET", "/api/staff/clients", admin)).json().find((c: { id: string }) => c.id === ids.clientB);
    expect(row.teeth).toContain("36 Пломба");
  });

  it("обновляет диагноз; врачу список зубов закрыт", async () => {
    const id = (await call("GET", `/api/staff/teeth?clientId=${ids.clientA}`, admin)).json().find((t: { toothNo: string }) => t.toothNo === "36").id;
    const patch = await call("PATCH", `/api/staff/teeth/${id}`, admin, { toothNo: "36", diagnosis: "Пломба", notes: "Filtek, 2026-11-04" });
    expect(patch.statusCode).toBe(200);
    expect((await call("GET", `/api/staff/teeth?clientId=${ids.clientA}`, admin)).json().find((t: { id: string }) => t.id === id).diagnosis).toBe("Пломба");
    expect((await call("GET", "/api/staff/teeth", doctor)).statusCode).toBe(403);
  });
});

describe("приём с привязкой к зубу и стадии", () => {
  let toothA: string;
  let toothB: string;
  beforeAll(async () => {
    toothA = (await call("POST", "/api/staff/teeth", admin, { clientId: ids.clientA, toothNo: "26", diagnosis: "Пульпит" })).json().id;
    toothB = (await call("POST", "/api/staff/teeth", admin, { clientId: ids.clientB, toothNo: "46", diagnosis: "Кариес" })).json().id;
  });

  it("зуб другого пациента не принимается; свой виден в списке и находится поиском", async () => {
    const day = "2026-11-18";
    expect((await book(admin, { clientId: ids.clientA, toothId: toothB, startsAt: `${day}T09:00:00+05:00` })).statusCode).toBe(400);

    const ok = await book(admin, { clientId: ids.clientA, toothId: toothA, startsAt: `${day}T09:00:00+05:00` });
    expect(ok.statusCode).toBe(201);
    const found = (await call("GET", "/api/staff/appointments?tab=all&q=" + encodeURIComponent("Тест Пациентов Первый"), admin)).json();
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({ toothId: toothA, toothName: "Зуб 26", toothDiagnosis: "Пульпит" });
    // Поиск по диагнозу находит приём без привязки к имени пациента.
    const byDiagnosis = (await call("GET", "/api/staff/appointments?tab=all&q=" + encodeURIComponent("Пульпит"), admin)).json();
    expect(byDiagnosis.items.map((x: { id: string }) => x.id)).toContain(ok.json().id);
  });

  it("приём без зуба (консультация, гигиена) допустим", async () => {
    const res = await book(admin, { clientId: ids.clientA, startsAt: "2026-11-18T12:00:00+05:00" });
    expect(res.statusCode).toBe(201);
    const history = (await call("GET", `/api/staff/clients/${ids.clientA}`, admin)).json().history;
    expect(history.find((h: { id: string }) => h.id === res.json().id)).toMatchObject({ toothName: "", toothDiagnosis: "" });
  });

  it("стадии: записан → пришёл → на приёме → завершён → оплачен; пропускать нельзя", async () => {
    const id = (await book(admin, { clientId: ids.clientA, toothId: toothA, startsAt: "2026-11-19T09:00:00+05:00" })).json().id;
    const setStatus = (status: string) => call("PATCH", `/api/staff/appointments/${id}`, admin, { status });

    expect((await setStatus("in_progress")).statusCode).toBe(409); // сначала пациент должен прийти
    expect((await setStatus("arrived")).statusCode).toBe(200);
    expect((await setStatus("ready")).statusCode).toBe(409); // сначала приём
    expect((await setStatus("in_progress")).statusCode).toBe(200);
    expect((await call("GET", "/api/staff/appointments?tab=all&status=in_progress", admin)).json().items.map((a: { id: string }) => a.id)).toContain(id);
    expect((await setStatus("ready")).statusCode).toBe(200);

    const pay = await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "card" });
    expect(pay.json()).toMatchObject({ status: "paid", amount: 20000 });
  });

  it("врач отмечает приём, но не оплату; неизвестный статус в фильтре — 400", async () => {
    const id = (await book(admin, { clientId: ids.clientB, toothId: toothB, startsAt: "2026-11-20T09:00:00+05:00" })).json().id;
    const asDoctor = (status: string) => call("PATCH", `/api/master/appointments/${id}`, doctor, { status });
    expect((await asDoctor("arrived")).statusCode).toBe(200);
    expect((await asDoctor("in_progress")).statusCode).toBe(200);
    expect((await asDoctor("ready")).statusCode).toBe(200);
    expect((await asDoctor("paid")).statusCode).toBe(400);
    expect((await call("GET", "/api/staff/appointments?status=teleported", admin)).statusCode).toBe(400);
  });

  it("удаление зуба из карты не удаляет приёмы", async () => {
    const tooth = (await call("POST", "/api/staff/teeth", admin, { clientId: ids.clientB, toothNo: "17", diagnosis: "Кариес" })).json().id;
    const id = (await book(admin, { clientId: ids.clientB, toothId: tooth, startsAt: "2026-11-21T09:00:00+05:00" })).json().id;
    expect((await call("DELETE", `/api/staff/teeth/${tooth}`, admin)).statusCode).toBe(200);
    const items = (await call("GET", "/api/staff/appointments?tab=all", admin)).json().items;
    expect(items.find((a: { id: string }) => a.id === id)).toMatchObject({ toothId: null, toothName: "" });
  });
});

describe("онлайн-запись пациента", () => {
  it("пациент записывается онлайн без выбора зуба; зуб другого пациента не принимается", async () => {
    const phone = "+77015550123";
    await app.inject({ method: "POST", url: "/api/auth/client/request-otp", payload: { slug: "demo", phone } });
    const code = sms.at(-1)!.text.match(/\d{6}/)![0];
    const cookie = cookieOf(await app.inject({ method: "POST", url: "/api/auth/client/verify", payload: { slug: "demo", phone, code, fullName: "Новый Пациент" } }), "sid_client");

    const body = { masterId: ids.daniyar, serviceIds: [ids.caries], startsAt: "2026-11-24T09:00:00+05:00" };
    const foreign = (await call("GET", `/api/staff/teeth?clientId=${ids.clientA}`, admin)).json()[0].id;
    expect((await call("POST", "/api/public/demo/book", cookie, { ...body, toothId: foreign })).statusCode).toBe(400);
    expect((await call("POST", "/api/public/demo/book", cookie, body)).statusCode).toBe(201);
    expect((await call("GET", "/api/my/appointments", cookie)).json().items).toHaveLength(1);
  });

  it("зубная карта через клиентский API больше не отдаётся", async () => {
    expect((await app.inject({ url: "/api/my/teeth" })).statusCode).toBe(404);
  });
});
