/**
 * Details shown on the legal pages. All optional: set them in Vercel so the pages name you.
 *   SITE_OPERATOR  your name or business name, shown as the operator of the site
 *   CONTACT_EMAIL  an address visitors can write to (privacy questions, removal requests)
 *   SITE_URL       the public address of the site, for robots.txt and the sitemap (for example https://outlet-radar.vercel.app)
 *   TIP_URL        where visitors can leave an optional tip. Defaults to the owner's Streamlabs tip page; set it to another
 *                  https address to change it, or to "off" to hide every tip link.
 */
export const LEGAL_LAST_UPDATED = "11 November 2026";

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

const DEFAULT_TIP_URL = "https://streamlabs.com/artofreyes/tip";

/** The optional tip page (voluntary tips are processed entirely by the tip service, never by this site). */
export function tipUrl(): string | null {
  const raw = process.env.TIP_URL?.trim();
  if (raw && raw.toLowerCase() === "off") return null;
  const value = raw || DEFAULT_TIP_URL;
  if (value.length > 300 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch { return null; }
}
