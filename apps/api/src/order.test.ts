import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { DEMO_PASSWORD, openDb, seedDemo, withSalon } from "@salon/db";
import { buildApp } from "./app";

// «Сейчас» зафиксировано: среда 2026-11-04 09:00 по Алматы.
const NOW = new Date("2026-11-04T09:00:00+05:00");

let app: FastifyInstance;
let admin: string;
let owner: string;
let daniyar: string;
let aidos: string;
const ids = {} as Record<"daniyar" | "caries" | "client", string>;

const cookieOf = (res: LightMyRequestResponse, name: string) =>
  [res.headers["set-cookie"]].flat().find((c) => c?.startsWith(`${name}=`))?.split(";")[0] as string;
const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(payload !== undefined && { payload: payload as object }) });
const login = async (email: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: DEMO_PASSWORD } }), "sid_staff");

let hour = 9;
/** Новый приём на свободный час в будущем. */
async function bookVisit(): Promise<{ id: string; price: number }> {
  const startsAt = `2026-11-20T${String(hour++).padStart(2, "0")}:00:00+05:00`;
  const res = await call("POST", "/api/staff/appointments", admin, { masterId: ids.daniyar, clientId: ids.client, serviceIds: [ids.caries], startsAt });
  expect(res.statusCode).toBe(201);
  return { id: res.json().id, price: res.json().priceTenge };
}

beforeAll(async () => {
  const db = await openDb();
  const salonId = await seedDemo(db, NOW);
  app = buildApp({ db, secret: "test-secret-test-secret-test-secret", now: () => NOW, sms: { send: async () => {} } });
  await withSalon(db, salonId, async (q) => {
    ids.daniyar = (await q<{ id: string }>(`SELECT id FROM masters WHERE full_name LIKE 'Данияр%'`)).rows[0]!.id;
    ids.caries = (await q<{ id: string }>(`SELECT id FROM services WHERE name = 'Лечение кариеса'`)).rows[0]!.id;
    ids.client = (await q<{ id: string }>(`SELECT id FROM clients ORDER BY full_name LIMIT 1`)).rows[0]!.id;
  });
  [admin, owner, daniyar, aidos] = await Promise.all(
    ["admin@sergek.ai", "owner@sergek.ai", "daniyar@sergek.ai", "aidos@sergek.ai"].map(login),
  );
});

describe("карта приёма: материалы", () => {
  it("материалы увеличивают сумму приёма, удаление возвращает её обратно", async () => {
    const { id, price } = await bookVisit();
    const added = await call("POST", `/api/staff/appointments/${id}/materials`, admin, { name: "Анестетик (карпула)", qty: 2, priceTenge: 1500 });
    expect(added.statusCode).toBe(201);
    await call("POST", `/api/staff/appointments/${id}/materials`, admin, { name: "Пломбировочный материал", qty: 1, priceTenge: 8000 });

    const order = (await call("GET", `/api/staff/appointments/${id}/order`, admin)).json();
    expect(order.materialsTenge).toBe(3000 + 8000);
    expect(order.servicesTenge).toBe(price);
    expect(order.totalTenge).toBe(price + 11000);
    expect(order.materials.map((p: { name: string }) => p.name)).toEqual(["Анестетик (карпула)", "Пломбировочный материал"]);

    const after = await call("DELETE", `/api/staff/appointments/${id}/materials/${order.materials[1].id}`, admin);
    expect(after.json().totalTenge).toBe(price + 3000);
    expect((await call("DELETE", `/api/staff/appointments/${id}/materials/${order.materials[1].id}`, admin)).statusCode).toBe(404);
  });

  it("оплата берёт сумму с материалами, а процент врача считается только с услуг", async () => {
    const { id, price } = await bookVisit();
    await call("POST", `/api/staff/appointments/${id}/materials`, admin, { name: "Керамический винир", qty: 2, priceTenge: 10000 });
    const pay = await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "cash" });
    expect(pay.json().amount).toBe(price + 20000);

    // После оплаты материалы уже не меняются.
    expect((await call("POST", `/api/staff/appointments/${id}/materials`, admin, { name: "Штифт", qty: 1, priceTenge: 1000 })).statusCode).toBe(409);

    const payroll = (await call("GET", "/api/staff/payroll?from=2026-11-20&to=2026-11-20", owner)).json();
    const row = payroll.items.find((i: { masterId: string }) => i.masterId === ids.daniyar);
    expect(row.revenue).toBe(price);
  });

  it("проверяет вход и права", async () => {
    const { id } = await bookVisit();
    const bad = (body: object) => call("POST", `/api/staff/appointments/${id}/materials`, admin, body);
    expect((await bad({ name: "x", qty: 1, priceTenge: 100 })).statusCode).toBe(400);
    expect((await bad({ name: "Штифт", qty: 0, priceTenge: 100 })).statusCode).toBe(400);
    expect((await bad({ name: "Штифт", qty: 1, priceTenge: -5 })).statusCode).toBe(400);
    expect((await bad({ name: "Штифт", qty: 1.5, priceTenge: 100 })).statusCode).toBe(400);
    expect((await call("POST", `/api/staff/appointments/${id}/materials`, daniyar, { name: "Штифт", qty: 1, priceTenge: 100 })).statusCode).toBe(403);
    expect((await call("GET", "/api/staff/appointments/00000000-0000-4000-8000-000000000000/order", admin)).statusCode).toBe(404);
  });
});

describe("карта приёма: жалобы и осмотр", () => {
  it("осмотр сохраняется и виден в списке приёмов", async () => {
    const { id } = await bookVisit();
    const res = await call("PUT", `/api/staff/appointments/${id}/exam`, admin, { notes: "Боль от холодного в зубе 26. Кариес дентина." });
    expect(res.statusCode).toBe(200);
    expect(res.json().examNotes).toBe("Боль от холодного в зубе 26. Кариес дентина.");
    const order = (await call("GET", `/api/staff/appointments/${id}/order`, admin)).json();
    expect(order.examNotes).toContain("Кариес дентина");
  });

  it("требует текст заметки", async () => {
    const { id } = await bookVisit();
    expect((await call("PUT", `/api/staff/appointments/${id}/exam`, admin, {})).statusCode).toBe(400);
  });

  it("врач правит только свои приёмы", async () => {
    const { id } = await bookVisit();
    expect((await call("PUT", `/api/staff/appointments/${id}/exam`, daniyar, { notes: "Осмотр без особенностей" })).statusCode).toBe(200);
    expect((await call("PUT", `/api/staff/appointments/${id}/exam`, aidos, { notes: "чужой пациент" })).statusCode).toBe(404);
  });

  it("закрытый приём не редактируется", async () => {
    const { id } = await bookVisit();
    await call("POST", `/api/staff/appointments/${id}/pay`, admin, { method: "card" });
    expect((await call("PUT", `/api/staff/appointments/${id}/exam`, admin, { notes: "поздно" })).statusCode).toBe(409);
  });
});
