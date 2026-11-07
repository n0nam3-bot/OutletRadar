/**
 * Expands common sneaker shorthand before a query is used for cache identity,
 * database matching or provider requests. "aj1", "AJ 1" and "air jordan 1" then
 * share one cache entry instead of each spending provider credits.
 *
 * Keep this list conservative: an expansion must never change what a query means.
 */
const ALIASES: Array<[RegExp, string]> = [
  [/\baj\s?(\d{1,2})\b/gi, "air jordan $1"],
  [/\baf\s?1\b/gi, "air force 1"],
  [/\bam\s?(\d{1,3})\b/gi, "air max $1"],
  [/\bnb\b/gi, "new balance"],
  [/\bjordans\b/gi, "jordan"],
  [/\bdunks\b/gi, "dunk"],
  [/\byeezys\b/gi, "yeezy"],
  [/\byzy\b/gi, "yeezy"],
  [/\bchucks\b/gi, "chuck taylor"],
  [/\bsambas\b/gi, "samba"],
  [/\bgazelles\b/gi, "gazelle"],
];

export function canonicalQuery(raw: string): string {
  let value = raw.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of ALIASES) value = value.replace(pattern, replacement);
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Query as sent to /api/catalog: shorthand expanded and lowercased, so "AJ1", "aj 1" and "Air Jordan 1"
 * produce one URL and the CDN can serve them all from one cached response. */
export function urlQuery(raw: string): string {
  return canonicalQuery(raw).toLowerCase();
}
