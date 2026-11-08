import { neon } from "@neondatabase/serverless";

function createClient(connectionString: string) {
  return neon(connectionString);
}
type SqlClient = ReturnType<typeof createClient>;
let testClient: SqlClient | null = null;

/** Test hook: the test suite (tests/) installs an in-memory PostgreSQL client here. The app never calls it. */
export function setTestDatabase(client: unknown): void {
  testClient = client as SqlClient | null;
}

export function getDb() {
  if (testClient) return testClient;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  return createClient(connectionString);
}
