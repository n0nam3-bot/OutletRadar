import { PGlite } from "@electric-sql/pglite";
import { setTestDatabase } from "../lib/db.ts";

/**
 * An in-memory PostgreSQL (PGlite) behind the same tagged-template interface as the Neon client, so the
 * real application code runs unchanged against a real SQL engine. No network and no Neon account needed.
 */
export async function createTestDatabase(): Promise<PGlite> {
  const pg = new PGlite();
  setTestDatabase(async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    let text = "";
    strings.forEach((part, index) => { text += part + (index < values.length ? `$${index + 1}` : ""); });
    const result = await pg.query(text, values as unknown[]);
    return result.rows;
  });
  return pg;
}
