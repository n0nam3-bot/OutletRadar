import { getDb } from "@/lib/db";
import { affiliateTemplatesConfigured } from "@/lib/affiliate-links";
import { feedCatalogIds } from "@/lib/feed-ingest";

/**
 * What is and is not set up, for the checklist on /admin/providers. Reports only whether something is
 * configured, never its value, so it is safe to screenshot.
 */
export type SetupItem = { id: string; label: string; ok: boolean; level: "required" | "recommended" | "optional"; hint: string };

const MIGRATIONS: Array<{ id: string; label: string; check: string; level: SetupItem["level"]; hint: string }> = [
  { id: "001", label: "Migration 001: search cache and usage tables", check: "retailer_search_cache", level: "required", hint: "Run db/schema.sql (or db/migrations/001_multi_retailer.sql) in the Neon SQL Editor." },
  { id: "002", label: "Migration 002: catalog, offers and sizes", check: "canonical_products", level: "required", hint: "Run db/migrations/002_catalog_inventory.sql." },
  { id: "003", label: "Migration 003: daily budget ledger", check: "retailer_api_usage_daily", level: "required", hint: "Run db/migrations/003_provider_budget_and_size_diagnostics.sql." },
  { id: "004", label: "Migration 004: refresh queue", check: "catalog_refresh_queue", level: "recommended", hint: "Run db/migrations/004_catalog_refresh_queue.sql so partial searches are completed later." },
  { id: "005", label: "Migration 005: outbound click counts", check: "offer_click_daily", level: "optional", hint: "Run db/migrations/005_offer_click_daily.sql to see which stores visitors click." },
  { id: "006", label: "Migration 006: feed ingestion state", check: "feed_ingest_state", level: "optional", hint: "Only needed for bulk feed ingestion: run db/migrations/006_feed_ingest_state.sql." },
  { id: "007", label: "Migration 007: search demand counts", check: "search_demand_daily", level: "recommended", hint: "Run db/migrations/007_search_demand_daily.sql so the warm-up can refresh popular searches first." },
];

const has = (...names: string[]) => names.every((name) => Boolean(process.env[name]?.trim()));

export async function getSetupStatus(): Promise<{ items: SetupItem[]; summary: { required: number; requiredOk: number; recommended: number; recommendedOk: number } }> {
  const items: SetupItem[] = [];
  const sql = getDb();
  items.push({ id: "database", label: "Database connection (DATABASE_URL)", ok: Boolean(sql), level: "required", hint: "Add your Neon pooled connection string as DATABASE_URL in Vercel and redeploy." });

  let tables = new Map<string, boolean>();
  let budgetFunction = false;
  if (sql) {
    try {
      const rows = await sql`
        SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
        FROM jsonb_array_elements_text(${JSON.stringify(MIGRATIONS.map((migration) => migration.check))}::jsonb) AS t(name)
      ` as Array<{ name: string; present: boolean }>;
      tables = new Map(rows.map((row) => [row.name, Boolean(row.present)]));
      const fn = await sql`SELECT to_regproc('reserve_retailer_api_budget') IS NOT NULL AS present` as Array<{ present: boolean }>;
      budgetFunction = Boolean(fn[0]?.present);
    } catch { /* leave everything unchecked */ }
  }
  for (const migration of MIGRATIONS) {
    const present = tables.get(migration.check) === true && (migration.id !== "003" || budgetFunction);
    items.push({ id: `migration-${migration.id}`, label: migration.label, ok: present, level: migration.level, hint: migration.hint });
  }

  items.push({ id: "cron-secret", label: "CRON_SECRET (admin page, cron jobs; 32+ characters)", ok: (process.env.CRON_SECRET?.trim().length ?? 0) >= 32, level: "required", hint: "Set CRON_SECRET to a random value of at least 32 characters in Vercel." });
  items.push({ id: "pckt", label: "PCKT_API_KEY: StockX, GOAT, Flight Club, Kicks Crew", ok: has("PCKT_API_KEY"), level: "required", hint: "Free account at pckt.sh; this is the marketplace catalog and size prices." });
  items.push({ id: "serpapi", label: "SERPAPI_API_KEY: Google Shopping merchants", ok: has("SERPAPI_API_KEY"), level: "recommended", hint: "Free account at serpapi.com adds retailers such as Foot Locker and Champs." });
  items.push({ id: "apish", label: "API_SH_KEY: Nike.com listings", ok: has("API_SH_KEY"), level: "optional", hint: "Adds Nike.com results for Nike and Jordan searches." });
  items.push({ id: "channel3", label: "CHANNEL3_API_KEY: other stores in Compare offers", ok: has("CHANNEL3_API_KEY"), level: "optional", hint: "Free account at trychannel3.com." });
  items.push({ id: "ebay", label: "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET: eBay in Compare offers", ok: has("EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"), level: "optional", hint: "Production keyset from developer.ebay.com." });
  items.push({ id: "impact", label: "IMPACT_ACCOUNT_SID and IMPACT_AUTH_TOKEN: affiliate partner stores", ok: has("IMPACT_ACCOUNT_SID", "IMPACT_AUTH_TOKEN"), level: "optional", hint: "From the Impact dashboard, Account Settings, API." });
  items.push({ id: "affiliate", label: "AFFILIATE_LINK_TEMPLATES: your tracking links for other stores", ok: affiliateTemplatesConfigured() > 0, level: "optional", hint: "JSON map of store host to the tracking-link template from your network's deep-link generator." });
  items.push({ id: "feed", label: "Bulk feed ingestion (FEED_INGEST_ENABLED and IMPACT_FEED_CATALOG_IDS)", ok: process.env.FEED_INGEST_ENABLED === "true" && feedCatalogIds().length > 0, level: "optional", hint: "Optional. Use Preview Impact feeds first, then set both variables." });
  items.push({ id: "site", label: "SITE_OPERATOR, CONTACT_EMAIL and SITE_URL: legal pages and sitemap", ok: has("SITE_OPERATOR") && has("CONTACT_EMAIL") && has("SITE_URL"), level: "recommended", hint: "Name yourself on the privacy and disclosure pages and enable the sitemap." });

  const count = (level: SetupItem["level"]) => items.filter((item) => item.level === level);
  return { items, summary: { required: count("required").length, requiredOk: count("required").filter((item) => item.ok).length, recommended: count("recommended").length, recommendedOk: count("recommended").filter((item) => item.ok).length } };
}
