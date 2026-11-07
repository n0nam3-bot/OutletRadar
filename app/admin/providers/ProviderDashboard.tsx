"use client";

import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Budget = { provider: string; used: number; limit: number; remaining: number; dailyUsed: number; dailyLimit: number; dailyRemaining: number };
type Provider = {
  provider: string;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_latency_ms?: number | null;
  last_result_count?: number;
  last_size_quote_count?: number;
  last_size_matched_offers?: number;
  last_size_persisted_variants?: number;
  last_size_checked_at?: string | null;
  consecutive_failures?: number;
  disabled_until?: string | null;
  updated_at?: string | null;
};
type Diagnostics = {
  service: string;
  version: string;
  checkedAt: string;
  budgets: Budget[];
  providers: Provider[];
  feedIngest?: { enabled: boolean; configuredCatalogs: number; tableAvailable: boolean; impactOffers: number; rows: Array<{ catalogId: string; name: string; nextPage: number; numPages: number | null; itemsSeen: number; productsSaved: number; cycles: number; lastRunAt: string | null; lastError: string | null }> };
  clicks?: { available: boolean; byStore: Array<{ retailer: string; source: string; clicks: number }>; byProduct: Array<{ title: string; clicks: number }>; total: number };
  retailerCoverage?: { targets: Array<{ name: string; via: string; seen: boolean; offers: number; products: number; lastSeenAt: string | null; sellerNames: string[] }>; other: Array<{ retailer: string; source: string; offers: number }> };
  refreshQueue?: { available: boolean; pending: number; oldestPendingAt: string | null; completedLast7Days: number };
  catalog: { canonicalProducts: number; retailerOffers: number; sizeVariants: number; verifiedSizeSignals: number; availableSizeSignals: number; unknownSizeLabels: number };
  notes?: string[];
};

function dateLabel(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}
function providerLabel(value: string): string {
  return ({ stockx: "StockX", goat: "GOAT", flightclub: "Flight Club", kickscrew: "Kicks Crew", shopping: "Google Shopping", apish: "API.SH (Nike)", channel3: "Channel3", ebay: "eBay", impact: "Impact partners" } as Record<string, string>)[value] || value;
}

export default function ProviderAdminPage() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  type ProbeRow = { provider: string; label: string; status: string; durationMs: number; count: number; retailers: string[]; sample: string[]; credits: string; message: string };
  const [probes, setProbes] = useState<ProbeRow[] | null>(null);
  const [probeTargets, setProbeTargets] = useState<Array<{ name: string; providers: string[] }>>([]);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");

  type FeedPreviewData = { catalogs: Array<{ id: string; name: string; selected: boolean }>; sample?: { catalogId: string; name: string; items: number; numPages: number | null; fields: string[]; matched: number; products: number; examples: Array<{ title: string; brand: string; price?: number; sizes: string[]; category: string }> }; error?: string };
  const [feedPreview, setFeedPreview] = useState<FeedPreviewData | null>(null);
  const [feedPreviewing, setFeedPreviewing] = useState(false);
  const [feedPreviewError, setFeedPreviewError] = useState("");

  async function runFeedPreview(catalogId?: string) {
    setFeedPreviewing(true);
    setFeedPreviewError("");
    try {
      const response = await fetch(`/api/admin/providers/feed-preview${catalogId ? `?catalog=${encodeURIComponent(catalogId)}` : ""}`, { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${secret.trim()}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Feed preview failed (${response.status}).`);
      setFeedPreview(payload as FeedPreviewData);
    } catch (cause) {
      setFeedPreview(null);
      setFeedPreviewError(cause instanceof Error ? cause.message : "Could not preview the feeds.");
    } finally {
      setFeedPreviewing(false);
    }
  }

  async function runConnectionTest() {
    setProbing(true);
    setProbeError("");
    try {
      const response = await fetch("/api/admin/providers/test", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${secret.trim()}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Connection test failed (${response.status}).`);
      setProbes(payload.results as ProbeRow[]);
      setProbeTargets((payload.targets ?? []) as Array<{ name: string; providers: string[] }>);
      await loadDiagnostics();
    } catch (cause) {
      setProbes(null);
      setProbeError(cause instanceof Error ? cause.message : "Could not run the connection test.");
    } finally {
      setProbing(false);
    }
  }

  async function loadDiagnostics(event?: FormEvent) {
    event?.preventDefault();
    if (!secret.trim()) {
      setError("Enter the CRON_SECRET saved in Vercel.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/providers", {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${secret.trim()}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Diagnostics request failed (${response.status}).`);
      setData(payload as Diagnostics);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Could not load provider diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  function forgetSecret() {
    setSecret("");
    setData(null);
    setError("");
  }

  return (
    <main className="admin-page">
      <div className="admin-page-inner">
        <a className="admin-back-link" href="/">← Back to Outlet Radar</a>
        <div className="admin-heading">
          <div className="admin-kicker"><Activity size={14}/> SYSTEM MONITORING</div>
          <h1>Provider health</h1>
          <p>Check marketplace connections, daily/monthly safety budgets, size-feed extraction and normalized inventory writes. This page does not expose API keys.</p>
        </div>

        <form className="admin-auth-card" onSubmit={loadDiagnostics}>
          <div className="admin-auth-icon"><KeyRound size={19}/></div>
          <div className="admin-auth-copy">
            <strong>Administrator access</strong>
            <span>Enter the existing CRON_SECRET from Vercel → Project → Settings → Environment Variables.</span>
          </div>
          <label className="admin-secret-label" htmlFor="admin-secret">CRON_SECRET</label>
          <input
            id="admin-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSecret(event.target.value)}
            placeholder="Paste your administrator secret"
          />
          <div className="admin-auth-actions">
            <button type="submit" disabled={loading || !secret.trim()}>
              {loading ? <><RefreshCw size={14} className="admin-spin"/> Checking…</> : <><ShieldCheck size={14}/> Load diagnostics</>}
            </button>
            {(data || secret) && <button type="button" className="admin-secondary-button" onClick={forgetSecret}>Forget secret</button>}
          </div>
          <small>Your secret is held only in this page's memory and sent in an HTTPS authorization header. It is not saved in local storage or in the URL.</small>
        </form>

        {error && <div className="admin-error"><AlertTriangle size={17}/><span>{error}</span></div>}

        {data && <section className="admin-results" aria-live="polite">
          <div className="admin-results-top">
            <div><span className="admin-kicker">LIVE CHECK</span><h2>System overview</h2></div>
            <span className="admin-checked-at">Updated {dateLabel(data.checkedAt)}</span>
          </div>

          <div className="admin-stat-grid">
            <article className="admin-stat-card"><Database size={17}/><span>Canonical products</span><strong>{data.catalog.canonicalProducts.toLocaleString()}</strong></article>
            <article className="admin-stat-card"><Activity size={17}/><span>Retailer offers</span><strong>{data.catalog.retailerOffers.toLocaleString()}</strong></article>
            <article className="admin-stat-card"><CheckCircle2 size={17}/><span>Size variants</span><strong>{data.catalog.sizeVariants.toLocaleString()}</strong><small>{data.catalog.verifiedSizeSignals.toLocaleString()} verified · {data.catalog.availableSizeSignals.toLocaleString()} available · {data.catalog.unknownSizeLabels.toLocaleString()} unknown</small></article>
            {data.refreshQueue && <article className="admin-stat-card"><Activity size={17}/><span>Refresh queue</span><strong>{data.refreshQueue.available ? data.refreshQueue.pending.toLocaleString() : "Not set up"}</strong><small>{data.refreshQueue.available ? `${data.refreshQueue.completedLast7Days.toLocaleString()} completed in 7 days${data.refreshQueue.oldestPendingAt ? ` · oldest ${dateLabel(data.refreshQueue.oldestPendingAt)}` : ""}` : "Apply migration 004 to enable"}</small></article>}
          </div>

          <div className="admin-section-heading"><h2>Provider budgets</h2><span>Shared daily and monthly application-side reservations</span></div>
          <div className="admin-budget-grid">
            {data.budgets.map((budget) => {
              const percent = budget.limit > 0 ? Math.min(100, (budget.used / budget.limit) * 100) : 0;
              return <article className="admin-budget-card" key={budget.provider}>
                <div className="admin-budget-title"><strong>{budget.provider}</strong><span>{budget.remaining.toLocaleString()} remaining</span></div>
                <div className="admin-budget-values"><strong>{budget.used.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>of {budget.limit.toLocaleString()}</span></div>
                <div className="admin-budget-track"><span style={{ width: `${percent}%` }}/></div>
                <small>{percent.toFixed(1)}% of the monthly safety budget reserved</small>
                <div className="admin-budget-daily"><span>Today: <strong>{budget.dailyUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> / {budget.dailyLimit.toLocaleString()}</span><span>{budget.dailyRemaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} daily remaining</span></div>
              </article>;
            })}
          </div>

          <div className="admin-section-heading"><h2>Live connection test</h2><span>Sends one real search per configured provider (about one credit each)</span></div>
          <div className="admin-probe-actions">
            <button type="button" className="admin-probe-button" onClick={runConnectionTest} disabled={probing}>{probing ? "Testing providers…" : "Run connection test"}</button>
            {probeError && <span className="admin-probe-error">{probeError}</span>}
          </div>
          {probes && <div className="admin-coverage-list">
            {probes.map((probe) => <div className={`admin-coverage-row ${probe.status === "ok" ? "is-seen" : "is-missing"}`} key={probe.provider}>
              <strong>{probe.status === "ok" ? "✓" : probe.status === "not_configured" ? "–" : "!"} {probe.label}</strong>
              <span>{probe.status === "ok" || probe.status === "empty"
                ? `${probe.message} ${probe.count} result(s) in ${probe.durationMs} ms · ${probe.credits}${probe.retailers.length ? ` · stores: ${probe.retailers.join(", ")}` : ""}${probe.sample.length ? ` · e.g. ${probe.sample[0]}` : ""}`
                : probe.message}</span>
            </div>)}
          </div>}
          {probes && probeTargets.length > 0 && <>
            <p className="admin-coverage-other">Stores on your list found by this test search (&ldquo;Air Jordan 4&rdquo;; results vary by product):</p>
            <div className="admin-coverage-list">
              {probeTargets.map((target) => <div className={`admin-coverage-row ${target.providers.length ? "is-seen" : "is-missing"}`} key={target.name}>
                <strong>{target.providers.length ? "✓" : "–"} {target.name}</strong>
                <span>{target.providers.length ? `via ${target.providers.join(", ")}` : "not returned by any provider for this search"}</span>
              </div>)}
            </div>
          </>}
          {data.feedIngest && <>
            <div className="admin-section-heading"><h2>Bulk feed ingestion</h2><span>{data.feedIngest.enabled ? "On" : "Off"} · {data.feedIngest.configuredCatalogs} catalog(s) selected · {data.feedIngest.impactOffers.toLocaleString()} stored Impact offers</span></div>
            <div className="admin-probe-actions">
              <button type="button" className="admin-probe-button" onClick={() => runFeedPreview()} disabled={feedPreviewing}>{feedPreviewing ? "Reading feeds…" : "Preview Impact feeds"}</button>
              {feedPreviewError && <span className="admin-probe-error">{feedPreviewError}</span>}
            </div>
            {feedPreview && <div className="admin-coverage-list">
              {feedPreview.error && <div className="admin-coverage-row is-missing"><strong>!</strong><span>{feedPreview.error}</span></div>}
              {feedPreview.catalogs.map((catalog) => <div className={`admin-coverage-row ${catalog.selected ? "is-seen" : "is-missing"}`} key={catalog.id}><strong>{catalog.selected ? "✓" : "–"} {catalog.name}</strong><span>catalog id {catalog.id}{catalog.selected ? " · selected for ingestion" : ""} · <button type="button" className="admin-link-button" onClick={() => runFeedPreview(catalog.id)}>preview this catalog</button></span></div>)}
              {feedPreview.sample && <div className="admin-coverage-row is-seen"><strong>Sample: {feedPreview.sample.name}</strong><span>{feedPreview.sample.items} items on page 1 of {feedPreview.sample.numPages ?? "?"} · {feedPreview.sample.matched} pass the item filter → {feedPreview.sample.products} products · fields: {feedPreview.sample.fields.slice(0, 14).join(", ")}{feedPreview.sample.examples.length ? ` · e.g. ${feedPreview.sample.examples.map((example) => `${example.brand} ${example.title}${example.price ? ` $${example.price}` : ""}${example.sizes.length ? ` (sizes ${example.sizes.slice(0, 6).join("/")})` : ""}`).join("; ")}` : ""}</span></div>}
            </div>}
            {data.feedIngest.rows.length > 0 && <div className="admin-coverage-list">{data.feedIngest.rows.map((row) => <div className={`admin-coverage-row ${row.lastError ? "is-missing" : "is-seen"}`} key={row.catalogId}><strong>{row.name || row.catalogId}</strong><span>next page {row.nextPage}{row.numPages ? ` of ${row.numPages}` : ""} · {row.itemsSeen.toLocaleString()} items read · {row.productsSaved.toLocaleString()} products saved · {row.cycles} full cycle(s){row.lastRunAt ? ` · last run ${dateLabel(row.lastRunAt)}` : ""}{row.lastError ? ` · error: ${row.lastError}` : ""}</span></div>)}</div>}
            {!data.feedIngest.tableAvailable && <p className="admin-coverage-other">Apply migration 006 to enable feed ingestion.</p>}
          </>}
          {data.clicks && <>
            <div className="admin-section-heading"><h2>Outbound clicks</h2><span>Last 7 days · anonymous counts</span></div>
            {data.clicks.available ? (data.clicks.total > 0 ? <>
              <div className="admin-coverage-list">{data.clicks.byStore.map((row) => <div className="admin-coverage-row is-seen" key={`${row.retailer}-${row.source}`}><strong>{row.retailer}</strong><span>{row.clicks.toLocaleString()} click(s) · via {row.source}</span></div>)}</div>
              <p className="admin-coverage-other">Most clicked products: {data.clicks.byProduct.map((row) => `${row.title} (${row.clicks})`).join(", ")}</p>
            </> : <p className="admin-coverage-other">No outbound clicks recorded yet.</p>) : <p className="admin-coverage-other">Apply migration 005 to record outbound clicks.</p>}
          </>}
          {data.retailerCoverage && <>
            <div className="admin-section-heading"><h2>Retailer coverage</h2><span>Sellers actually stored from real searches</span></div>
            <div className="admin-coverage-list">
              {data.retailerCoverage.targets.map((target) => <div className={`admin-coverage-row ${target.seen ? "is-seen" : "is-missing"}`} key={target.name}>
                <strong>{target.seen ? "✓" : "–"} {target.name}</strong>
                <span>{target.seen ? `${target.offers.toLocaleString()} offers · ${target.products.toLocaleString()} products · last ${dateLabel(target.lastSeenAt)}` : `Not seen yet (expected via ${target.via})`}</span>
              </div>)}
            </div>
            {data.retailerCoverage.other.length > 0 && <p className="admin-coverage-other">Other sellers seen: {data.retailerCoverage.other.map((row) => `${row.retailer} (${row.offers})`).join(", ")}</p>}
          </>}
          <div className="admin-section-heading"><h2>Provider connections</h2><span>Errors trigger a temporary cooldown after repeated failures</span></div>
          <div className="admin-provider-list">
            {data.providers.length === 0 && <div className="admin-empty">No provider attempts have been recorded yet. A provider appears here after its first request.</div>}
            {data.providers.map((provider) => {
              const paused = provider.disabled_until && new Date(provider.disabled_until).getTime() > Date.now();
              const healthy = !paused && Number(provider.consecutive_failures || 0) === 0 && Boolean(provider.last_success_at);
              const noSizeRows = Boolean(provider.last_size_checked_at) && Number(provider.last_size_quote_count || 0) === 0;
              return <article className="admin-provider-card" key={provider.provider}>
                <div className="admin-provider-top">
                  <strong>{providerLabel(provider.provider)}</strong>
                  <span className={`admin-status ${paused ? "is-paused" : healthy ? "is-healthy" : "is-unknown"}`}>
                    {paused ? <><AlertTriangle size={12}/> Cooling down</> : noSizeRows ? <><AlertTriangle size={12}/> Connected · no size rows</> : healthy ? <><CheckCircle2 size={12}/> Connected</> : <><Activity size={12}/> Needs activity / review</>}
                  </span>
                </div>
                <div className="admin-provider-meta">
                  <span>Last success<strong>{dateLabel(provider.last_success_at)}</strong></span>
                  <span>Last attempt<strong>{dateLabel(provider.last_attempt_at)}</strong></span>
                  <span>Latency<strong>{provider.last_latency_ms == null ? "—" : `${provider.last_latency_ms} ms`}</strong></span>
                  <span>Consecutive failures<strong>{Number(provider.consecutive_failures || 0)}</strong></span>
                  <span>Search records returned<strong>{Number(provider.last_result_count || 0).toLocaleString()}</strong></span>
                  <span>Last size sync<strong>{dateLabel(provider.last_size_checked_at)}</strong></span>
                  <span>Size quotes extracted<strong>{Number(provider.last_size_quote_count || 0).toLocaleString()}</strong></span>
                  <span>Offers matched in Neon<strong>{Number(provider.last_size_matched_offers || 0).toLocaleString()}</strong></span>
                  <span>Size variants stored<strong>{Number(provider.last_size_persisted_variants || 0).toLocaleString()}</strong></span>
                </div>
                {paused && <div className="admin-provider-warning">Paused until {dateLabel(provider.disabled_until)}.</div>}
                {provider.last_error_message && <div className="admin-provider-error"><XCircle size={13}/><span>{provider.last_error_code || "Provider error"}: {provider.last_error_message}</span></div>}
              </article>;
            })}
          </div>

          {data.notes?.length ? <div className="admin-notes"><strong>Important notes</strong>{data.notes.map((note, index) => <p key={index}>{note}</p>)}</div> : null}
          <button className="admin-refresh-button" type="button" onClick={() => loadDiagnostics()} disabled={loading}><RefreshCw size={14}/> Refresh diagnostics</button>
        </section>}
      </div>
    </main>
  );
}
