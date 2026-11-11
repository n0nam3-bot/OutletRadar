import type { Metadata } from "next";
import { LEGAL_LAST_UPDATED, siteOperator, tipUrl } from "@/lib/site-info";

export const metadata: Metadata = {
  title: "Support | Outlet Radar",
  description: "Outlet Radar is free to use. Optional tips help cover hosting and data costs.",
};

export default function SupportPage() {
  const tip = tipUrl();
  const operator = siteOperator();
  return (
    <main className="legal-page">
      <a className="legal-back" href="/">&larr; Back to Outlet Radar</a>
      <h1>Support Outlet Radar</h1>
      <p className="legal-updated">Last updated {LEGAL_LAST_UPDATED}</p>
      <p>Outlet Radar is free to use, with no account and no paywall. {operator ? <>{operator} runs it </> : "It is run "}on free hosting and free data plans, and every lookup of live prices uses a small shared allowance.</p>

      <h2>Leaving a tip</h2>
      <p>If the site saved you money or time, you can leave an optional tip. Tips help pay for the services behind it, such as data lookups and hosting, and keep it free for everyone.</p>
      {tip
        ? <p><a className="support-button" href={tip} target="_blank" rel="noopener noreferrer">Leave a tip</a></p>
        : <p>Tips are not switched on right now.</p>}

      <h2>What a tip does and does not do</h2>
      <ul>
        <li>A tip is voluntary and unlocks nothing. Everyone gets the same results, prices and features.</li>
        <li>Tips do not change which prices are shown or how results are ordered.</li>
        <li>Tips are handled entirely by the tip service on its own page. Outlet Radar never sees or stores your name, card or payment details.</li>
        <li>Tips are not tax-deductible donations to a charity.</li>
      </ul>

      <h2>Other ways to help</h2>
      <p>Telling a friend, or sending a note about a wrong price or a missing store, helps as much as a tip. See the <a href="/privacy">privacy page</a> and the <a href="/disclosure">affiliate disclosure</a> for how the site works and how it may earn money.</p>
    </main>
  );
}
