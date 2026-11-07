/**
 * Shoe-size parsing and matching. US sizes only: UK/EU/CM labels are ignored because they cannot be
 * compared without a per-brand chart. A size is never guessed: when a label does not say whether it
 * is men's, women's or youth, the match is reported as "assumed" and only for a men's query.
 */
export type SizeSystem = "men" | "women" | "youth";
export type SizeKind = "exact" | "converted" | "assumed";
export type ParsedSize = { system: SizeSystem | null; value: number };
export type SizeQuery = { system: SizeSystem; value: number; explicit: boolean };

/** Women's size = men's size + offset, for brands whose published charts use one fixed offset.
 * Brands not listed here (for example Converse, ASICS, Vans) are never converted. */
const WOMENS_OFFSET: Record<string, number> = { nike: 1.5, jordan: 1.5, newbalance: 1.5, adidas: 1 };

export function womensOffset(brand: string): number | null {
  return WOMENS_OFFSET[brand.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

const MEN = /\b(?:men|mens|men['’]s)\b|\bm\s*\d|\d\s*m\b/;
const WOMEN = /\b(?:women|womens|women['’]s)\b|\bw\s*\d|\d\s*w\b/;
const YOUTH = /\b(?:youth|kids?|big\s*kids?|gs)\b|\by\s*\d|\d\s*y\b/;

export function parseSizeLabel(label: string, fallback: SizeSystem | null = null): ParsedSize[] {
  const text = String(label).toLowerCase().replace(/½/g, ".5").replace(/(\d)\s+1\/2\b/g, "$1.5").trim();
  if (!text || !/\d/.test(text)) return [];
  if (/\b(?:uk|eu|cm|mm|jp|fr|it|cn|kr)\b/.test(text)) return [];
  const out: ParsedSize[] = [];
  for (const part of text.split(/\s*[\/|,]\s*/)) {
    const numbers = [...part.matchAll(/(\d{1,2}(?:\.\d+)?)/g)];
    if (numbers.length !== 1) continue;
    const value = Number(numbers[0][1]);
    if (!(value >= 1 && value <= 20)) continue;
    if (/\d\s*c\b/.test(part)) continue; // toddler/child "C" sizes are a separate scale
    const flags = [MEN.test(part) ? "men" : "", WOMEN.test(part) ? "women" : "", YOUTH.test(part) ? "youth" : ""].filter(Boolean) as SizeSystem[];
    if (flags.length > 1) continue;
    out.push({ system: flags[0] ?? fallback, value });
  }
  return out;
}

export function parseSizeQuery(input: string, defaultSystem: SizeSystem): SizeQuery | null {
  const parsed = parseSizeLabel(input, null);
  if (parsed.length !== 1) return null;
  return { system: parsed[0].system ?? defaultSystem, value: parsed[0].value, explicit: parsed[0].system !== null };
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

function compare(entry: ParsedSize, query: SizeQuery, brand: string): SizeKind | null {
  if (entry.system === null) return query.system === "men" && same(entry.value, query.value) ? "assumed" : null;
  if (entry.system === query.system) return same(entry.value, query.value) ? "exact" : null;
  const offset = womensOffset(brand);
  if (offset === null) return null;
  if (entry.system === "men" && query.system === "women") return same(entry.value + offset, query.value) ? "converted" : null;
  if (entry.system === "women" && query.system === "men") return same(entry.value - offset, query.value) ? "converted" : null;
  return null; // youth sizes are never converted
}

/** How a listed size label relates to the requested size, or null if it does not match. */
export function matchSizeLabel(label: string, query: SizeQuery, brand: string, fallback: SizeSystem | null = null): SizeKind | null {
  let best: SizeKind | null = null;
  for (const entry of parseSizeLabel(label, fallback)) {
    const kind = compare(entry, query, brand);
    if (kind === "exact") return "exact";
    if (kind && (best === null || (best === "assumed" && kind === "converted"))) best = kind;
  }
  return best;
}

export const SIZE_KIND_RANK: Record<SizeKind, number> = { exact: 0, converted: 1, assumed: 2 };
