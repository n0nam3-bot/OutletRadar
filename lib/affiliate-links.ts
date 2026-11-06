/**
 * Affiliate link templates. Lets the owner turn plain store links into tracking links for the
 * affiliate programs they have joined (Impact, Rakuten, CJ, Awin, ...), without code changes.
 *
 * Set AFFILIATE_LINK_TEMPLATES in Vercel to a JSON object that maps a store's website host to
 * the tracking-link template from the network's deep-link generator, with {url} where the
 * product link goes, for example:
 *
 *   {"goat.com":"https://goat.sjv.io/c/1111/2222/3333?u={url}",
 *    "footlocker.com":"https://www.awin1.com/cread.php?awinmid=1234&awinaffid=5678&ued={url}"}
 *
 * {url} is replaced with the URL-encoded product link and {rawurl} with the unencoded one.
 * Hosts match the store's domain and its subdomains (www.footlocker.com matches footlocker.com).
 * Links that already carry an affiliate tag (Impact and eBay Partner Network results) are left alone.
 * Wrapping happens only when an offer is returned to the browser, so cached data and the catalog
 * keep the plain store URLs and a template change takes effect immediately.
 */
type Template = { host: string; template: string };

let parsed: { raw: string; templates: Template[] } | null = null;

function templates(): Template[] {
  const raw = process.env.AFFILIATE_LINK_TEMPLATES?.trim() ?? "";
  if (!raw) return [];
  if (parsed?.raw === raw) return parsed.templates;
  const out: Template[] = [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [host, template] of Object.entries(value as Record<string, unknown>)) {
        const cleanHost = host.trim().toLowerCase().replace(/^www\./, "");
        if (!cleanHost || typeof template !== "string") continue;
        if (!/^https:\/\//i.test(template) || !/\{(?:raw)?url\}/.test(template)) continue;
        out.push({ host: cleanHost, template: template.trim() });
      }
    }
  } catch { /* invalid JSON: affiliate wrapping stays off rather than breaking offers */ }
  out.sort((a, b) => b.host.length - a.host.length); // most specific host first
  parsed = { raw, templates: out };
  return out;
}

export function affiliateTemplatesConfigured(): number {
  return templates().length;
}

/** Returns the tracking link for a plain store URL, or null when no template applies. */
export function wrapAffiliateUrl(url: string): string | null {
  const list = templates();
  if (!list.length) return null;
  let host: string;
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return null;
    host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
  const match = list.find((entry) => host === entry.host || host.endsWith(`.${entry.host}`));
  if (!match) return null;
  const wrapped = match.template.replaceAll("{url}", encodeURIComponent(url)).replaceAll("{rawurl}", url);
  try { return new URL(wrapped).protocol === "https:" ? wrapped : null; } catch { return null; }
}

export function applyAffiliateLinks<T extends { url: string; affiliate?: boolean }>(offers: T[]): T[] {
  if (!templates().length) return offers;
  return offers.map((offer) => {
    if (offer.affiliate) return offer;
    const wrapped = wrapAffiliateUrl(offer.url);
    return wrapped ? { ...offer, url: wrapped, affiliate: true } : offer;
  });
}
