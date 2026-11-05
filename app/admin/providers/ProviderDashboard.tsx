"use client";

import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Budget = { provider: string; used: number; limit: number; remaining: number };
type Provider = {
  provider: string;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
  last_latency_ms?: number | null;
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
  catalog: { canonicalProducts: number; retailerOffers: number; sizeVariants: number };
  notes?: string[];
};

function dateLabel(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}
function providerLabel(value: string): string {
  return ({ stockx: "StockX", goat: "GOAT", flightclub: "Flight Club", kickscrew: "Kicks Crew", shopping: "Google Shopping" } as Record<string, string>)[value] || value;
}

export default function ProviderAdminPage() {
  const [secret, setSecret] = useState("");
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <p>Check marketplace connections, monthly safety budgets and the normalized catalog. This page does not expose API keys.</p>
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
            <article className="admin-stat-card"><CheckCircle2 size={17}/><span>Size variants</span><strong>{data.catalog.sizeVariants.toLocaleString()}</strong></article>
          </div>

          <div className="admin-section-heading"><h2>Monthly provider budgets</h2><span>Application-side reservations</span></div>
          <div className="admin-budget-grid">
            {data.budgets.map((budget) => {
              const percent = budget.limit > 0 ? Math.min(100, (budget.used / budget.limit) * 100) : 0;
              return <article className="admin-budget-card" key={budget.provider}>
                <div className="admin-budget-title"><strong>{budget.provider}</strong><span>{budget.remaining.toLocaleString()} remaining</span></div>
                <div className="admin-budget-values"><strong>{budget.used.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>of {budget.limit.toLocaleString()}</span></div>
                <div className="admin-budget-track"><span style={{ width: `${percent}%` }}/></div>
                <small>{percent.toFixed(1)}% of the configured monthly safety budget reserved</small>
              </article>;
            })}
          </div>

          <div className="admin-section-heading"><h2>Provider connections</h2><span>Errors trigger a temporary cooldown after repeated failures</span></div>
          <div className="admin-provider-list">
            {data.providers.length === 0 && <div className="admin-empty">No provider attempts have been recorded yet. A provider appears here after its first request.</div>}
            {data.providers.map((provider) => {
              const paused = provider.disabled_until && new Date(provider.disabled_until).getTime() > Date.now();
              const healthy = !paused && Number(provider.consecutive_failures || 0) === 0 && Boolean(provider.last_success_at);
              return <article className="admin-provider-card" key={provider.provider}>
                <div className="admin-provider-top">
                  <strong>{providerLabel(provider.provider)}</strong>
                  <span className={`admin-status ${paused ? "is-paused" : healthy ? "is-healthy" : "is-unknown"}`}>
                    {paused ? <><AlertTriangle size={12}/> Cooling down</> : healthy ? <><CheckCircle2 size={12}/> Healthy</> : <><Activity size={12}/> Needs activity / review</>}
                  </span>
                </div>
                <div className="admin-provider-meta">
                  <span>Last success<strong>{dateLabel(provider.last_success_at)}</strong></span>
                  <span>Last attempt<strong>{dateLabel(provider.last_attempt_at)}</strong></span>
                  <span>Latency<strong>{provider.last_latency_ms == null ? "—" : `${provider.last_latency_ms} ms`}</strong></span>
                  <span>Consecutive failures<strong>{Number(provider.consecutive_failures || 0)}</strong></span>
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
