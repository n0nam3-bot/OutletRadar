import type { CatalogBrowseProduct, MarketplaceSizeQuote } from "@/lib/types";
import { matchSizeLabel, parseSizeQuery, SIZE_KIND_RANK, type SizeKind, type SizeSystem } from "@/lib/size-match";

export function catalogAudience(product: CatalogBrowseProduct): string {
  const text = `${product.title} ${product.brand}`.toLowerCase();
  const hasYouthSize = [...(product.sizes ?? []), ...(product.listings ?? []).flatMap((listing) => listing.sizes ?? [])]
    .some((size) => /\d+(?:\.\d+)?\s*y\b/i.test(size));
  if (hasYouthSize || /\b(big kids?|grade school|gs|little kids?|preschool|ps|toddler|infant|youth|kids?|boys?|girls?)\b/.test(text)) return "kids";
  const hasMen = /\b(men|mens|male)\b/.test(text);
  const hasWomen = /\b(women|womens|female)\b/.test(text);
  if (hasMen && hasWomen) return "unisex";
  if (hasMen) return "men";
  if (hasWomen) return "women";
  return (product.gender ?? "Unknown").toLowerCase();
}

function normalizedCatalogSize(value: string): string {
  return value.toLowerCase().replace(/\b(us|uk|eu|men|mens|women|womens|size)\b/g, " ").replace(/(\d)\s*(y)\b/g, "$1$2").replace(/\s+/g, " ").trim();
}

export function catalogColorsOf(product: CatalogBrowseProduct): string[] {
  const explicit = [product.color ?? "", ...(product.colors ?? []), ...(product.listings ?? []).map((listing) => listing.color ?? "")];
  const title = ` ${product.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ")} `;
  const inferred = Object.entries(COLOR_FAMILIES).flatMap(([family, aliases]) => {
    const terms = [family, ...aliases];
    return terms.some((term) => title.includes(` ${term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `)) ? [family] : [];
  });
  return [...new Set([...explicit, ...inferred].map((value) => value.trim()).filter(Boolean))];
}

function catalogSizeMatches(candidate: string, requested: string): boolean {
  const target = normalizedCatalogSize(requested);
  const value = normalizedCatalogSize(candidate);
  if (!target || !value) return false;
  if (value === target) return true;
  const targetToken = target.match(/\d+(?:\.\d+)?y?/i)?.[0];
  if (targetToken) {
    const candidateTokens = value.match(/\d+(?:\.\d+)?y?/gi) ?? [];
    return candidateTokens.some((token) => token.toLowerCase() === targetToken.toLowerCase());
  }
  return value.includes(target);
}

function catalogListedSizeMatches(candidate: string, requested: string, gender: string): boolean {
  if (!catalogSizeMatches(candidate, requested)) return false;
  const label = candidate.toLowerCase();
  const targetNumber = normalizedCatalogSize(requested).match(/\d+(?:\.\d+)?/)?.[0];
  if (!targetNumber) return true;
  const allowed = (system: string) => gender === "all" || gender === "unisex" ||
    (gender === "men" && system === "m") ||
    (gender === "women" && system === "w") ||
    (gender === "kids" && system === "y");
  // Combined labels can use either M 11.5 / W 13 or 11.5 M / 13 W.
  const prefixed = [...label.matchAll(/\b([mwy])\s*(\d+(?:\.\d+)?)/g)];
  const suffixed = [...label.matchAll(/(\d+(?:\.\d+)?)\s*([mwy])\b/g)];
  const typed = [
    ...prefixed.map((match) => ({ system: match[1], number: match[2] })),
    ...suffixed.map((match) => ({ system: match[2], number: match[1] })),
  ];
  if (typed.length) return typed.some((entry) => entry.number === targetNumber && allowed(entry.system));
  const youthSuffix = /\b\d+(?:\.\d+)?\s*y\b/i.test(label);
  if (youthSuffix && (gender === "men" || gender === "women")) return false;
  if (gender === "men" && /\b(?:women|womens)\b/i.test(label)) return false;
  if (gender === "women" && /\b(?:men|mens)\b/i.test(label)) return false;
  return true;
}

const COLOR_FAMILIES: Record<string, string[]> = {
  black: ["black", "triple black", "blackout", "bred"],
  white: ["white", "off white", "off-white", "sail", "ivory", "cream", "chalk", "summit white"],
  gray: ["gray", "grey", "cement", "wolf grey", "cool grey", "light smoke grey", "dark smoke grey", "anthracite"],
  red: ["red", "fire red", "university red", "varsity red", "crimson", "scarlet", "cherry", "cardinal", "infrared", "bred"],
  blue: ["blue", "royal blue", "navy", "midnight navy", "university blue", "unc blue", "obsidian", "cobalt"],
  green: ["green", "pine green", "olive", "mint", "malachite", "jade", "sequoia"],
  brown: ["brown", "mocha", "chocolate", "cacao", "coffee", "baroque brown"],
  tan: ["tan", "beige", "khaki", "wheat", "sand", "taupe"],
  pink: ["pink", "rose", "blush", "coral", "magenta"],
  purple: ["purple", "violet", "lilac", "lavender"],
  orange: ["orange", "safety orange", "bright mandarin"],
  yellow: ["yellow", "maize", "golden yellow", "mustard"],
};

function colorMatches(candidate: string, requested: string): boolean {
  const source = ` ${candidate.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const target = requested.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  if (!target) return true;
  const family = Object.entries(COLOR_FAMILIES).find(([key, aliases]) => key === target || aliases.includes(target));
  const terms = family ? [family[0], ...family[1]] : [target];
  return terms.some((term) => source.includes(` ${term.replace(/[^a-z0-9]+/g, " ").trim()} `));
}

export type CatalogFilters = { gender: string; releaseYear: string; size: string; sizeSystem: SizeSystem; color: string; minPrice: string; maxPrice: string; saleOnly: boolean };

/** What the shopper's size request matched on one product. */
export type SizeEvidence = {
  state: "verified" | "listed";   // verified = a marketplace has an active ask/availability for this size
  label: string;                  // the size label as the source wrote it
  kind: SizeKind;                 // exact, converted between men's/women's, or assumed (system not stated)
  price?: number; currency?: string; source?: string; retailer?: string;
};
export type CatalogFilterEvaluation = { keep: boolean; unknown: string[]; matched: number; size?: SizeEvidence };

function audienceSystem(audience: string): SizeSystem | null {
  return audience === "men" ? "men" : audience === "women" ? "women" : audience === "kids" ? "youth" : null;
}
function quoteSystem(value: string | undefined): SizeSystem | null {
  return value === "men" || value === "women" || value === "youth" ? value : null;
}
function betterEvidence(current: SizeEvidence | undefined, next: SizeEvidence): SizeEvidence {
  if (!current) return next;
  if (SIZE_KIND_RANK[next.kind] !== SIZE_KIND_RANK[current.kind]) return SIZE_KIND_RANK[next.kind] < SIZE_KIND_RANK[current.kind] ? next : current;
  return (next.price ?? Infinity) < (current.price ?? Infinity) ? next : current;
}

export function catalogFilterEvaluation(
  product: CatalogBrowseProduct,
  filters: CatalogFilters,
  extraQuotes: MarketplaceSizeQuote[] = [],
): CatalogFilterEvaluation {
  const unknown: string[] = [];
  let matched = 0;
  let size: SizeEvidence | undefined;
  const audience = catalogAudience(product);
  if (filters.gender !== "all") {
    if (!audience || audience === "unknown") { unknown.push("audience"); return { keep: false, unknown, matched }; }
    if (audience === filters.gender || ((filters.gender === "men" || filters.gender === "women") && audience === "unisex")) matched++;
    else return { keep: false, unknown, matched };
  }

  if (filters.releaseYear.trim()) {
    const requestedYear = Number(filters.releaseYear);
    const year = product.releaseYear ?? Number(product.title.match(/\b(?:19|20)\d{2}\b/)?.[0]);
    if (!year) { unknown.push("release year"); return { keep: false, unknown, matched }; }
    if (year !== requestedYear) return { keep: false, unknown, matched };
    matched++;
  }

  if (filters.size.trim()) {
    const listedLabels = [
      ...(product.sizes ?? []),
      ...(product.listings ?? []).flatMap((listing) => listing.sizes ?? []),
    ];
    const quotes = [...(product.sizeQuotes ?? []), ...extraQuotes];
    const query = parseSizeQuery(filters.size, filters.sizeSystem);
    if (query) {
      // Shoe sizes: compare by size system. A women's 10 is not a men's 10; conversion happens only
      // for brands with a published fixed offset (see lib/size-match.ts) and is labelled as converted.
      let verified: SizeEvidence | undefined;
      let listed: SizeEvidence | undefined;
      for (const quote of quotes) {
        const kind = matchSizeLabel(quote.label, query, product.brand, quoteSystem(quote.sizeSystem));
        if (!kind || quote.available === false) continue;
        const evidence: SizeEvidence = { state: quote.available === true ? "verified" : "listed", label: quote.label, kind, price: quote.price, currency: quote.currency, source: quote.source, retailer: quote.retailer };
        if (quote.available === true) verified = betterEvidence(verified, evidence); else listed = betterEvidence(listed, evidence);
      }
      for (const label of listedLabels) {
        const kind = matchSizeLabel(label, query, product.brand, audienceSystem(audience));
        if (kind) listed = betterEvidence(listed, { state: "listed", label, kind });
      }
      size = verified ?? listed;
      if (!size) {
        // No size data at all means "cannot tell"; data that excludes the size (sold out, other sizes) means "no".
        if (!quotes.length && !listedLabels.length) unknown.push("size list");
        return { keep: false, unknown, matched };
      }
      matched++;
    } else {
      // Non-numeric sizes such as S, M, L, XL (apparel).
      const quoteMatch = quotes.some((quote) => catalogSizeMatches(quote.label, filters.size) && quote.available !== false);
      const listedMatch = listedLabels.some((label) => catalogListedSizeMatches(label, filters.size, filters.gender));
      if (quoteMatch || listedMatch) matched++;
      else {
        if (!quotes.length && !listedLabels.length) unknown.push("size list");
        return { keep: false, unknown, matched };
      }
    }
  }

  if (filters.color.trim()) {
    const candidates = catalogColorsOf(product);
    if (candidates.some((color) => colorMatches(color, filters.color))) matched++;
    else {
      if (!candidates.length) unknown.push("colorway");
      return { keep: false, unknown, matched };
    }
  }

  // With a size selected and a verified price for that size, the price filter applies to that size's
  // price, not to the cheapest listing of any size.
  const sizePrice = size?.state === "verified" && typeof size.price === "number" ? size.price : undefined;
  const prices = sizePrice !== undefined ? [sizePrice] : [...new Set([
    ...(typeof product.price === "number" ? [product.price] : []),
    ...(product.listings ?? []).flatMap((listing) => typeof listing.price === "number" ? [listing.price] : []),
  ])];
  const min = filters.minPrice.trim() ? Number(filters.minPrice) : undefined;
  const max = filters.maxPrice.trim() ? Number(filters.maxPrice) : undefined;
  const hasPriceFilter = (min !== undefined && Number.isFinite(min)) || (max !== undefined && Number.isFinite(max));
  if (hasPriceFilter) {
    if (!prices.length) { unknown.push("price"); return { keep: false, unknown, matched }; }
    if (prices.some((price) => (min === undefined || !Number.isFinite(min) || price >= min) && (max === undefined || !Number.isFinite(max) || price <= max))) matched++;
    else return { keep: false, unknown, matched };
  }

  if (filters.saleOnly) {
    const saleSignals: boolean[] = [];
    if (typeof product.onSale === "boolean") saleSignals.push(product.onSale);
    for (const listing of product.listings ?? []) {
      if (typeof listing.onSale === "boolean") saleSignals.push(listing.onSale);
      if (typeof listing.price === "number" && typeof listing.originalPrice === "number") saleSignals.push(listing.originalPrice > listing.price);
    }
    if (typeof product.price === "number" && typeof product.originalPrice === "number") saleSignals.push(product.originalPrice > product.price);
    if (!saleSignals.length) { unknown.push("sale status"); return { keep: false, unknown, matched }; }
    if (saleSignals.some(Boolean)) matched++;
    else return { keep: false, unknown, matched };
  }

  return { keep: true, unknown, matched, size };
}
