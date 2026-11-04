import type { MarketplaceSizeQuote } from "@/lib/types";

export type AudienceKey = "all" | "men" | "women" | "kids" | "unisex";
export type SizeSystemKey = "men" | "women" | "youth" | "unisex" | "unknown";

const YOUTH_WORDS = /\b(?:big\s*kids?|grade\s*school|gs|little\s*kids?|preschool|pre\s*school|ps|toddler|infant|youth|kids?|boys?|girls?)\b/i;
const YOUTH_SIZE = /(?:^|\s)\d+(?:\.\d+)?\s*y(?:\s|$)/i;
const MEN_WORDS = /\b(?:men|mens|male)\b/i;
const WOMEN_WORDS = /\b(?:women|womens|female)\b/i;
const UNISEX_WORDS = /\bunisex\b/i;

function clean(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[’']/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

export function normalizeAudience(value: unknown): Exclude<AudienceKey, "all"> | "unknown" {
  const text = clean(value);
  if (!text || /^(?:unknown|n\/a|not provided|unspecified)$/.test(text)) return "unknown";
  if (YOUTH_WORDS.test(text) || YOUTH_SIZE.test(text)) return "kids";
  const men = MEN_WORDS.test(text);
  const women = WOMEN_WORDS.test(text);
  if ((men && women) || UNISEX_WORDS.test(text)) return "unisex";
  if (women) return "women";
  if (men) return "men";
  return "unknown";
}

/** Infer the audience for a seller's specific listing. Youth markers override
 * generic provider labels because a GS/PS variant must never enter adult offers. */
export function inferListingAudience(
  metadata?: unknown,
  title?: unknown,
  sizes: string[] = [],
): Exclude<AudienceKey, "all"> | "unknown" {
  const metadataText = clean(metadata);
  const titleText = clean(title);
  const combined = `${metadataText} ${titleText}`.trim();
  if (YOUTH_WORDS.test(combined) || sizes.some((size) => YOUTH_WORDS.test(clean(size)) || YOUTH_SIZE.test(clean(size)))) return "kids";
  const metadataAudience = normalizeAudience(metadataText);
  if (metadataAudience !== "unknown") return metadataAudience;
  return normalizeAudience(titleText);
}

/** Resolve the sizing scale without assuming that an unlabeled numeric size is
 * adult. Explicit Y/GS/PS labels always win over an adult fallback. */
export function inferSizeSystem(
  explicitSystem?: unknown,
  label?: unknown,
  fallbackAudience?: unknown,
): SizeSystemKey {
  const explicit = clean(explicitSystem);
  const sizeLabel = clean(label);
  const combined = `${explicit} ${sizeLabel}`.trim();

  if (YOUTH_WORDS.test(combined) || YOUTH_SIZE.test(sizeLabel)) return "youth";

  const hasMen = MEN_WORDS.test(explicit) || MEN_WORDS.test(sizeLabel) || /\b(?:us\s*)?m\b/i.test(explicit) || /(?:^|\s)m\s*\d+(?:\.\d+)?(?:\s|$)/i.test(sizeLabel) || /\d+(?:\.\d+)?\s*m(?:\s|$)/i.test(sizeLabel);
  const hasWomen = WOMEN_WORDS.test(explicit) || WOMEN_WORDS.test(sizeLabel) || /\b(?:us\s*)?w\b/i.test(explicit) || /(?:^|\s)w\s*\d+(?:\.\d+)?(?:\s|$)/i.test(sizeLabel) || /\d+(?:\.\d+)?\s*w(?:\s|$)/i.test(sizeLabel);
  if (hasMen && hasWomen) return "unisex";
  if (UNISEX_WORDS.test(explicit)) return "unisex";
  if (hasWomen) return "women";
  if (hasMen) return "men";

  const fallback = normalizeAudience(fallbackAudience);
  if (fallback === "men" || fallback === "women" || fallback === "kids" || fallback === "unisex") {
    return fallback === "kids" ? "youth" : fallback;
  }
  return "unknown";
}

export function isOfferAllowedForAudience(
  requestedAudience: unknown,
  listingMetadata?: unknown,
  listingTitle?: unknown,
  sizes: string[] = [],
): boolean {
  const requested = clean(requestedAudience) as AudienceKey;
  if (!requested || requested === "all") return true;
  const detected = inferListingAudience(listingMetadata, listingTitle, sizes);

  // Missing seller audience metadata does not hide the offer, but its numeric
  // size quotes remain hidden unless their sizing system is explicitly known.
  if (requested === "men") return detected !== "kids" && detected !== "women";
  if (requested === "women") return detected !== "kids" && detected !== "men";
  if (requested === "kids") return detected === "kids";
  if (requested === "unisex") return detected === "unisex";
  return true;
}

export function filterSizeQuotesForAudience<T extends MarketplaceSizeQuote>(
  quotes: T[],
  requestedAudience: unknown,
): T[] {
  const requested = clean(requestedAudience) as AudienceKey;
  if (!requested || requested === "all") return quotes;

  return quotes.filter((quote) => {
    const system = inferSizeSystem(quote.sizeSystem, quote.label);
    if (requested === "men") return system === "men" || system === "unisex";
    if (requested === "women") return system === "women" || system === "unisex";
    if (requested === "kids") return system === "youth";
    if (requested === "unisex") return system === "men" || system === "women" || system === "unisex";
    return true;
  });
}


export function filterOfferSizeLabels(
  sizes: string[] | undefined,
  requestedAudience: unknown,
  listingAudience?: unknown,
): string[] | undefined {
  if (!sizes?.length) return sizes;
  const requested = clean(requestedAudience) as AudienceKey;
  if (!requested || requested === "all") return sizes;
  return sizes.filter((label) => {
    const system = inferSizeSystem(undefined, label, listingAudience);
    if (requested === "men") return system === "men" || system === "unisex";
    if (requested === "women") return system === "women" || system === "unisex";
    if (requested === "kids") return system === "youth";
    if (requested === "unisex") return system === "men" || system === "women" || system === "unisex";
    return true;
  });
}
