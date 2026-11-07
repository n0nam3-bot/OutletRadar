import { getDb } from "@/lib/db";
import { canonicalQuery } from "@/lib/query-normalize";

/**
 * Anonymous search demand: how often each search was run, and how often it found nothing. It decides
 * which searches the daily warm-up refreshes first, so free-tier provider credits go to what visitors
 * actually look for. Only the lowercase search words and filters are kept (no IP, cookie or user agent),
 * rows older than 60 days are deleted, and anything that looks like an e-mail address or phone number is
 * ignored. If migration 007 has not been applied, every function fails soft.
 */
export const CATEGORIES = new Set(["sneakers", "apparel", "accessories", "all"]);
const GENDERS = new Set(["all", "men", "women", "kids", "unisex"]);
// Anonymous endpoint: cap distinct rows per day so it cannot be used to fill the database.
const MAX_ROWS_PER_DAY = 5000;

export type LoggedSearch = { category: string; brand: string; gender: string; releaseYear: number; query: string };

export function normalizeLoggedSearch(input: Record<string, unknown>): LoggedSearch | null {
  const category = String(input.category ?? "").toLowerCase();
  const brand = String(input.brand ?? "all").toLowerCase().trim();
  const gender = String(input.gender ?? "all").toLowerCase();
  const yearRaw = String(input.releaseYear ?? "").trim();
  const query = canonicalQuery(String(input.q ?? "")).toLowerCase();
  if (!CATEGORIES.has(category) || !GENDERS.has(gender) || !/^[a-z0-9 ]{1,32}$/.test(brand)) return null;
  if (yearRaw && !/^(?:19|20)\d{2}$/.test(yearRaw)) return null;
  if (query.length < 2 || /@/.test(query) || /\d{7,}/.test(query.replace(/[\s().-]/g, ""))) return null;
  return { category, brand, gender, releaseYear: yearRaw ? Number(yearRaw) : 0, query };
}

export async function recordSearch(search: LoggedSearch, results: number): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try {
    const existing = await sql`
      SELECT 1 FROM search_demand_daily
      WHERE search_day = CURRENT_DATE AND category = ${search.category} AND brand = ${search.brand} AND gender = ${search.gender}
        AND release_year = ${search.releaseYear} AND query_text = ${search.query}
      LIMIT 1
    ` as Array<unknown>;
    if (!existing.length) {
      const today = await sql`SELECT COUNT(*)::int AS n FROM search_demand_daily WHERE search_day = CURRENT_DATE` as Array<{ n: number }>;
      if (Number(today[0]?.n ?? 0) >= MAX_ROWS_PER_DAY) return;
    }
    const empty = results <= 0 ? 1 : 0;
    await sql`
      INSERT INTO search_demand_daily (category, brand, gender, release_year, query_text, empty_results)
      VALUES (${search.category}, ${search.brand}, ${search.gender}, ${search.releaseYear}, ${search.query}, ${empty})
      ON CONFLICT (search_day, category, brand, gender, release_year, query_text)
      DO UPDATE SET searches = search_demand_daily.searches + 1, empty_results = search_demand_daily.empty_results + ${empty}
    `;
  } catch { /* analytics must never affect shoppers */ }
}

export type DemandRow = { query: string; category: string; brand: string; gender: string; releaseYear: number; searches: number; emptyResults: number };

type RawDemand = { query_text: string; category: string; brand: string; gender: string; release_year: number; searches: number; empty_results: number };
const toRow = (row: RawDemand): DemandRow => ({ query: row.query_text, category: row.category, brand: row.brand, gender: row.gender, releaseYear: Number(row.release_year), searches: Number(row.searches), emptyResults: Number(row.empty_results) });

/** Most-searched filters over the last 7 days (summed across days), at least `minSearches` times. */
export async function topSearches(limit = 15, minSearches = 1): Promise<DemandRow[]> {
  const sql = getDb();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT query_text, category, brand, gender, release_year, SUM(searches)::int AS searches, SUM(empty_results)::int AS empty_results
      FROM search_demand_daily WHERE search_day >= CURRENT_DATE - 6
      GROUP BY query_text, category, brand, gender, release_year
      HAVING SUM(searches) >= ${Math.max(1, minSearches)}
      ORDER BY SUM(searches) DESC, query_text ASC
      LIMIT ${Math.max(1, Math.min(200, limit))}
    ` as RawDemand[];
    return rows.map(toRow);
  } catch { return []; }
}

/** Searches that found nothing at least once in the last 7 days, most often first: what to load next. */
export async function emptySearches(limit = 15): Promise<DemandRow[]> {
  const sql = getDb();
  if (!sql) return [];
  try {
    const rows = await sql`
      SELECT query_text, category, brand, gender, release_year, SUM(searches)::int AS searches, SUM(empty_results)::int AS empty_results
      FROM search_demand_daily WHERE search_day >= CURRENT_DATE - 6
      GROUP BY query_text, category, brand, gender, release_year
      HAVING SUM(empty_results) > 0
      ORDER BY SUM(empty_results) DESC, query_text ASC
      LIMIT ${Math.max(1, Math.min(50, limit))}
    ` as RawDemand[];
    return rows.map(toRow);
  } catch { return []; }
}

export async function demandTableAvailable(): Promise<{ available: boolean; searches7d: number }> {
  const sql = getDb();
  if (!sql) return { available: false, searches7d: 0 };
  try {
    const rows = await sql`SELECT COALESCE(SUM(searches), 0)::int AS n FROM search_demand_daily WHERE search_day >= CURRENT_DATE - 6` as Array<{ n: number }>;
    return { available: true, searches7d: Number(rows[0]?.n ?? 0) };
  } catch { return { available: false, searches7d: 0 }; }
}

export async function pruneSearchDemand(): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  try { await sql`DELETE FROM search_demand_daily WHERE search_day < CURRENT_DATE - 60`; } catch { /* best-effort */ }
}
