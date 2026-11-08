import type { Metadata } from "next";
import { LEGAL_LAST_UPDATED, contactEmail, siteOperator } from "@/lib/site-info";

export const metadata: Metadata = {
  title: "Affiliate disclosure | Outlet Radar",
  description: "How Outlet Radar earns money, and what that does and does not affect.",
};

export default function DisclosurePage() {
  const operator = siteOperator();
  const email = contactEmail();
  return (
    <main className="legal-page">
      <a className="legal-back" href="/">&larr; Back to Outlet Radar</a>
      <h1>Affiliate disclosure</h1>
      <p className="legal-updated">Last updated {LEGAL_LAST_UPDATED}</p>
      <p>{operator ? <>{operator} runs </> : null}Outlet Radar{operator ? "" : " is run"} as an independent product-discovery and price-comparison site. Some links to stores and marketplaces are affiliate links: if you buy after clicking one, we may earn a commission from the seller or its affiliate network at no extra cost to you. Links that carry a tracking link are marked &ldquo;Affiliate link&rdquo; next to the button.</p>

      <h2>What this does not change</h2>
      <p>Affiliate relationships do not change which prices are shown or how results are ordered. Results are ordered by how many of your filters they match and, when you enter a size, by the price for that size. A store is not placed higher because it pays a commission.</p>

      <h2>Prices and stock</h2>
      <p>Prices, sizes and availability come from third-party data services and change quickly, so what you see may be out of date. A size marked as available on a marketplace means the marketplace reported an active offer for it; a size that a retailer merely lists is marked as unconfirmed. Always check the price, size, condition and seller on the store&rsquo;s own page before you buy. Independent sellers on marketplaces such as eBay are not verified by Outlet Radar.</p>

      <h2>Independence</h2>
      <p>Outlet Radar is not affiliated with, endorsed by or sponsored by the brands, retailers or marketplaces shown. Brand and store names are used only to identify products and sellers.</p>
      {email && <p>Questions: <a href={`mailto:${email}`}>{email}</a>.</p>}
      <p>See also the <a href="/privacy">privacy page</a>.</p>
    </main>
  );
}
