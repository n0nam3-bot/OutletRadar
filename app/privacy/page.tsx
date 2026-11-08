import type { Metadata } from "next";
import { LEGAL_LAST_UPDATED, contactEmail, siteOperator } from "@/lib/site-info";

export const metadata: Metadata = {
  title: "Privacy | Outlet Radar",
  description: "What Outlet Radar stores, what it does not, and how to remove saved items.",
};

export default function PrivacyPage() {
  const operator = siteOperator();
  const email = contactEmail();
  return (
    <main className="legal-page">
      <a className="legal-back" href="/">&larr; Back to Outlet Radar</a>
      <h1>Privacy</h1>
      <p className="legal-updated">Last updated {LEGAL_LAST_UPDATED}</p>
      <p>Outlet Radar helps you search and compare products. It has no accounts, asks for no name or e-mail address, and sets no cookies of its own. This page explains what is stored and what is not.</p>
      {(operator || email) && <p>{operator ? <>Operated by <strong>{operator}</strong>. </> : null}{email ? <>Questions or removal requests: <a href={`mailto:${email}`}>{email}</a>.</> : null}</p>}

      <h2>What happens when you search</h2>
      <p>Your search words and filters (product type, brand, audience, year) are sent to our server to find results. To find products we may send those same words to our data providers (marketplace and retailer product-data services and affiliate networks). We do not send them anything that identifies you.</p>

      <h2>Anonymous counts</h2>
      <p>So we can keep popular searches up to date, your browser reports each search and each click on a store link as an anonymous daily count: the lowercase search words and filters, or the store, product title and link domain. These counts contain no IP address, cookie, browser details or account, and cannot be tied to you. Search counts are deleted after 60 days.</p>

      <h2>Protecting the shared allowance</h2>
      <p>Fresh product lookups use a small shared daily allowance. To stop one connection using it all, the server briefly counts fresh lookups per connection address in its memory for up to an hour. This count is never saved or logged. Over the limit you still get results, from saved data.</p>

      <h2>Saved searches</h2>
      <p>Saved searches (and the prices they remember) are stored only in your own browser. They are never sent to our server. Clearing this site&rsquo;s data in your browser removes them.</p>

      <h2>Watchlist</h2>
      <p>When you save a product to your watchlist, we store the product link, title, image and price details together with a random identifier created in your browser. There is no name or e-mail address attached. The identifier lets your list reappear on the same device. You can remove an item at any time, and clearing your browser data removes the identifier from your device.</p>

      <h2>Hosting and technical logs</h2>
      <p>The site is served by hosting and database services (Vercel and Neon). Like most web services they may keep technical logs of requests, including IP addresses, under their own privacy policies. We do not use those logs to profile visitors.</p>

      <h2>Links to other sites</h2>
      <p>When you open a store or marketplace link you leave Outlet Radar. That site, and any affiliate network that tracks the click, may set cookies and collect data under its own policy. See the <a href="/disclosure">affiliate disclosure</a>.</p>

      <h2>Your choices</h2>
      <p>Remove watchlist items in the app, clear this site&rsquo;s data in your browser to remove saved searches and the watchlist identifier{email ? <>, or write to <a href={`mailto:${email}`}>{email}</a></> : null}.</p>
    </main>
  );
}
