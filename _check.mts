import { PGlite } from "@electric-sql/pglite";
const db = new PGlite("C:/Users/Orazaly/Documents/claude ai automation/crm сто/.data/pg");
await db.waitReady;
console.log((await db.query("select slug,name from salons")).rows, (await db.query("select count(*)::int n from users")).rows);
