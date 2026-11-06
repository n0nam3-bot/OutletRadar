/**
 * Retailers the owner expects to see in results. Used only by the admin
 * "Retailer coverage" report to compare what has actually been stored in
 * `retailer_offers` against this list. It does not filter or change search
 * results. Channel3 offers are intentionally not saved to the catalog (see lib/channel3.ts),
 * so retailers that arrive only through Channel3 appear in Compare offers but not in this report.
 * `patterns` are matched (case-insensitively) against the seller name
 * the provider returned.
 */
export type RetailerTarget = { name: string; patterns: RegExp[]; via: string };

export const RETAILER_TARGETS: RetailerTarget[] = [
  { name: "StockX", patterns: [/stockx/i], via: "PCKT" },
  { name: "GOAT", patterns: [/^goat$/i, /\bgoat\b/i], via: "PCKT" },
  { name: "Flight Club", patterns: [/flight\s?club/i], via: "PCKT" },
  { name: "Kicks Crew", patterns: [/kicks\s?crew/i], via: "PCKT" },
  { name: "Nike", patterns: [/^nike(\.com)?$/i, /\bnike\b.*(store|\.com)/i], via: "API.SH (Nike.com)" },
  { name: "Foot Locker", patterns: [/foot\s?locker/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "JD Sports", patterns: [/\bjd\s?sports\b/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Jimmy Jazz", patterns: [/jimmy\s?jazz/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Champs Sports", patterns: [/champs/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Finish Line", patterns: [/finish\s?line/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Snipes USA", patterns: [/snipes/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Macy's", patterns: [/macy/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "Bloomingdale's", patterns: [/bloomingdale/i], via: "Google Shopping; Compare adds Channel3" },
  { name: "eBay", patterns: [/ebay/i], via: "Google Shopping; Compare adds Channel3" },
];

export type RetailerCoverageRow = { retailer: string; source: string; offers: number; products: number; lastSeenAt: string | null };

export function summarizeCoverage(rows: RetailerCoverageRow[]) {
  const claimed = new Set<number>();
  const targets = RETAILER_TARGETS.map((target) => {
    const matches = rows.filter((row, index) => {
      const hit = target.patterns.some((pattern) => pattern.test(row.retailer));
      if (hit) claimed.add(index);
      return hit;
    });
    const last = matches.map((row) => row.lastSeenAt).filter(Boolean).sort().pop() ?? null;
    return {
      name: target.name,
      via: target.via,
      seen: matches.length > 0,
      offers: matches.reduce((sum, row) => sum + row.offers, 0),
      products: matches.reduce((sum, row) => sum + row.products, 0),
      lastSeenAt: last,
      sellerNames: [...new Set(matches.map((row) => row.retailer))].slice(0, 4),
    };
  });
  const other = rows.filter((_, index) => !claimed.has(index)).slice(0, 40);
  return { targets, other };
}
