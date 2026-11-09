/**
 * Details shown on the legal pages. All optional: set them in Vercel so the pages name you.
 *   SITE_OPERATOR  your name or business name, shown as the operator of the site
 *   CONTACT_EMAIL  an address visitors can write to (privacy questions, removal requests)
 *   SITE_URL       the public address of the site, for robots.txt and the sitemap (for example https://outlet-radar.vercel.app)
 */
export const LEGAL_LAST_UPDATED = "8 November 2026";

export function siteOperator(): string | null {
  return process.env.SITE_OPERATOR?.trim() || null;
}
export function contactEmail(): string | null {
  const value = process.env.CONTACT_EMAIL?.trim();
  return value && /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(value) ? value : null;
}
export function siteUrl(): string | null {
  const value = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  return value && /^https?:\/\/[^\s/]+$/i.test(value) ? value : null;
}
