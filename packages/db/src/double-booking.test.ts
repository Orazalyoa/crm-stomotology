import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrate } from "./migrate";

const SALON = "00000000-0000-0000-0000-00000000000a";
let db: PGlite;
let masterId: string;
let clientId: string;

const book = (start: string, end: string, status = "booked") =>
  db.query(
    `INSERT INTO appointments (salon_id, master_id, client_id, starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [SALON, masterId, clientId, start, end, status],
  );

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await migrate(db);
  await db.query(`INSERT INTO salons (id, name, slug) VALUES ($1,'A','a')`, [SALON]);
  masterId = (
    await db.query<{ id: string }>(
      `INSERT INTO masters (salon_id, full_name) VALUES ($1,'Мастер') RETURNING id`,
      [SALON],
    )
  ).rows[0]!.id;
  clientId = (
    await db.query<{ id: string }>(
      `INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,'Клиент','+77011111111') RETURNING id`,
      [SALON],
    )
  ).rows[0]!.id;
});

describe("double booking", () => {
  it("rejects an overlapping appointment for the same master", async () => {
    await book("2026-11-01T10:00:00+05", "2026-11-01T11:00:00+05");
    await expect(book("2026-11-01T10:30:00+05", "2026-11-01T11:30:00+05")).rejects.toThrow(
      /conflicting key|exclusion/,
    );
  });

  it("allows back-to-back appointments", async () => {
    await book("2026-11-02T10:00:00+05", "2026-11-02T11:00:00+05");
    await book("2026-11-02T11:00:00+05", "2026-11-02T12:00:00+05");
  });

  it("frees the time once an appointment is cancelled", async () => {
    await book("2026-11-03T10:00:00+05", "2026-11-03T11:00:00+05", "cancelled");
    await book("2026-11-03T10:00:00+05", "2026-11-03T11:00:00+05");
  });
});
