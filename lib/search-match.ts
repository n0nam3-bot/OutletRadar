import type { NikeProduct } from "./types";

const IGNORED_TERMS = new Set([
  "nike", "the", "and", "for", "with", "men", "mens", "women", "womens",
  "kids", "kid", "youth", "unisex", "size", "shoe", "shoes", "sneaker", "sneakers",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    // Keep model numbers as whole tokens: 1 must never match 14 or 1.5.
    .match(/[a-z]+|\d+(?:\.\d+)?[a-z]?/g) ?? [];
}

/**
 * Strict token matching for product discovery. Unlike substring matching, a numeric
 * model token is exact: "Air Jordan 1" cannot match "Air Jordan 14".
 */
export function relevantToQuery(
  product: Pick<NikeProduct, "title" | "subtitle" | "styleCode">,
  query: string,
): boolean {
  const queryTokens = [...new Set(tokens(query).filter((token) => !IGNORED_TERMS.has(token)))];
  if (!queryTokens.length) return true;

  const descriptionTokens = new Set(tokens(`${product.title} ${product.subtitle ?? ""}`));
  if (queryTokens.every((token) => descriptionTokens.has(token))) return true;

  // Style-code matching is allowed for code-shaped queries (for example DZ5485-612),
  // but never let digits in an unrelated SKU make "Jordan 1" match "Jordan 14".
  const looksLikeStyleCode = /[a-z]{2,}\d{2,}/i.test(query.replace(/\s+/g, ""));
  if (!looksLikeStyleCode) return false;
  const codeTokens = new Set(tokens(product.styleCode ?? ""));
  return queryTokens.every((token) => codeTokens.has(token));
}
