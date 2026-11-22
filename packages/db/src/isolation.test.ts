import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { migrate } from "./migrate";

const SALON_A = "00000000-0000-0000-0000-00000000000a";
const SALON_B = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;

/** Выполняет запросы от имени приложения (не суперпользователя) в контексте одного салона. */
async function asSalon<T>(salonId: string, run: (q: PGlite["query"]) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE app_user`);
    await tx.query(`SELECT set_config('app.salon_id', $1, true)`, [salonId]);
    return run(tx.query.bind(tx));
  });
}

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await migrate(db);
  await db.query(`INSERT INTO salons (id, name, slug) VALUES ($1,'A','a'), ($2,'B','b')`, [
    SALON_A,
    SALON_B,
  ]);
  await db.query(
    `INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,'Айгуль','+77011111111'), ($2,'Данияр','+77022222222')`,
    [SALON_A, SALON_B],
  );
});

describe("tenant isolation (ADR-0001)", () => {
  it("shows a salon only its own clients", async () => {
    const res = await asSalon(SALON_A, (q) => q(`SELECT full_name FROM clients`));
    expect(res.rows).toEqual([{ full_name: "Айгуль" }]);
  });

  it("returns nothing when no salon context is set", async () => {
    const res = await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE app_user`);
      return tx.query(`SELECT * FROM clients`);
    });
    expect(res.rows).toEqual([]);
  });

  it("forbids writing a row into another salon", async () => {
    await expect(
      asSalon(SALON_A, (q) =>
        q(`INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,'Чужой','+77033333333')`, [
          SALON_B,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("allows the same phone in two salons but not twice in one", async () => {
    await asSalon(SALON_B, (q) =>
      q(`INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,'Айгуль B','+77011111111')`, [
        SALON_B,
      ]),
    );
    await expect(
      asSalon(SALON_A, (q) =>
        q(`INSERT INTO clients (salon_id, full_name, phone) VALUES ($1,'Дубль','+77011111111')`, [
          SALON_A,
        ]),
      ),
    ).rejects.toThrow(/unique/);
  });
});
