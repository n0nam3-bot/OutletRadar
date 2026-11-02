import { neon } from "@neondatabase/serverless";

export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  return neon(connectionString);
}
