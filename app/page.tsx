"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp, ArrowRight, Check, ChevronDown, ExternalLink, Heart,
  MapPin, PackageSearch, Search, ShieldCheck, SlidersHorizontal, Sparkles,
  Tag, X,
} from "lucide-react";
import type { NikeProduct, ProductSize } from "@/lib/types";

type Tab = "search" | "saved";
type Category = "All" | "Shoes" | "Apparel" | "Accessories";
type Status = "idle" | "loading" | "success" | "error";

const SUGGESTED_SEARCHES = ["Air Max 90", "Dunk Low", "Vomero 5", "Tech Fleece"];
const CATEGORIES: Category[] = ["All", "Shoes", "Apparel", "Accessories"];
const LOCAL_KEY = "nike-clearance-finder:saved:v1";
const VISITOR_KEY = "nike-clearance-finder:visitor:v1";

function money(value?: number, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Price unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function categoryOf(product: NikeProduct): Exclude<Category, "All"> {
  const text = `${product.title} ${product.subtitle ?? ""}`.toLowerCase();
  if (/shirt|hoodie|jacket|fleece|pants|shorts|leggings|bra|jersey|sweatshirt|tee|apparel/.test(text)) return "Apparel";
  if (/bag|backpack|cap|hat|socks|glove|bottle|accessor/.test(text)) return "Accessories";
  return "Shoes";
}

function getVisitorId() {
  let value = localStorage.getItem(VISITOR_KEY);
  if (!value) {
    value = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replaceAll("-", "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VISITOR_KEY, value);
  }
  return value;
}

function toProductFromDb(row: Record<string, unknown>): NikeProduct {
  return {
    id: String(row.id ?? row.product_url),
    title: String(row.title ?? "Nike product"),
    styleCode: typeof row.style_code === "string" ? row.style_code : undefined,
    url: String(row.product_url),
    imageUrl: typeof row.image_url === "string" ? row.image_url : undefined,
    price: typeof row.current_price === "number" ? row.current_price : row.current_price ? Number(row.current_price) : undefined,
    fullPrice: typeof row.full_price === "number" ? row.full_price : row.full_price ? Number(row.full_price) : undefined,
    discountPercent: typeof row.discount_percent === "number" ? row.discount_percent : undefined,
    currency: typeof row.currency === "string" ? row.currency : "USD",
  };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [saleOnly, setSaleOnly] = useState(false);
  const [category, setCategory] = useState<Category>("All");
  const [sizeFilter, setSizeFilter] = useState("All sizes");
  const [sortBy, setSortBy] = useState("relevance");
  const [tab, setTab] = useState<Tab>("search");
  const [products, setProducts] = useState<NikeProduct[]>([]);
  const [saved, setSaved] = useState<NikeProduct[]>([]);
  const [searchStatus, setSearchStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [providerMeta, setProviderMeta] = useState<{ cached?: boolean; fetchedAt?: string; creditsUsed?: number } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [databaseConfigured, setDatabaseConfigured] = useState(false);
  const [loadingSizes, setLoadingSizes] = useState<string | null>(null);
  const [sizeDetails, setSizeDetails] = useState<Record<string, ProductSize[]>>({});
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as NikeProduct[];
      if (Array.isArray(local)) setSaved(local);
      const visitorId = getVisitorId();
      fetch(`/api/watchlist?visitorId=${encodeURIComponent(visitorId)}`)
        .then(async (response) => response.ok ? response.json() : null)
        .then((data) => {
          if (Array.isArray(data?.items)) {
            const remote = data.items.map((row: Record<string, unknown>) => toProductFromDb(row));
            setSaved(remote);
            localStorage.setItem(LOCAL_KEY, JSON.stringify(remote));
          }
        })
        .catch(() => undefined);
      fetch("/api/health").then((response) => response.json()).then((health) => {
        setProviderConfigured(Boolean(health.productSearchConfigured));
        setDatabaseConfigured(Boolean(health.databaseConfigured));
      }).catch(() => { setProviderConfigured(false); });
    } catch {
      setProviderConfigured(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
  }, [saved]);

  const visibleProducts = useMemo(() => {
    const base = tab === "saved" ? saved : products;
    let filtered = base.filter((product) => category === "All" || categoryOf(product) === category);
    if (sizeFilter !== "All sizes") {
      filtered = filtered.filter((product) => {
        const sizes = sizeDetails[product.url] ?? product.sizes ?? [];
        return sizes.some((size) => size.label.toLowerCase() === sizeFilter.toLowerCase() && size.available !== false);
      });
    }
    if (sortBy === "price-low") filtered = [...filtered].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
    if (sortBy === "discount") filtered = [...filtered].sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
    return filtered;
  }, [category, products, saved, sizeDetails, sizeFilter, sortBy, tab]);

  async function runSearch(searchTerm = query) {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    setQuery(term);
    setTab("search");
    setSearchStatus("loading");
    setError("");
    setMessage("");
    setSizeFilter("All sizes");
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(term)}${saleOnly ? "&sale=1" : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed. Please try again.");
      setProducts(Array.isArray(data.products) ? data.products : []);
      setProviderMeta(data.meta ?? null);
      setSearchStatus("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed. Please try again.");
      setSearchStatus("error");
      setProducts([]);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  async function toggleSaved(product: NikeProduct) {
    const alreadySaved = saved.some((item) => item.url === product.url);
    const next = alreadySaved ? saved.filter((item) => item.url !== product.url) : [product, ...saved];
    setSaved(next);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
    try {
      const visitorId = getVisitorId();
      if (alreadySaved) {
        await fetch("/api/watchlist", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId, productUrl: product.url }) });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId, productUrl: product.url, title: product.title, imageUrl: product.imageUrl,
            styleCode: product.styleCode, price: product.price, fullPrice: product.fullPrice,
            discountPercent: product.discountPercent, currency: product.currency,
          }),
        });
      }
    } catch { /* Local browser watchlist remains available if Neon is not connected. */ }
    setMessage(alreadySaved ? "Removed from your watchlist." : databaseConfigured ? "Saved. Daily price history runs after Neon, the product-data key, and Vercel Cron are configured." : "Saved on this device.");
    window.setTimeout(() => setMessage(""), 3500);
  }

  async function loadSizes(product: NikeProduct) {
    if (sizeDetails[product.url]?.length) return;
    setLoadingSizes(product.url);
    try {
      const response = await fetch(`/api/product?url=${encodeURIComponent(product.url)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load sizes.");
      const sizes = data.product?.sizes ?? [];
      setSizeDetails((current) => ({ ...current, [product.url]: sizes }));
      if (!sizes.length) setMessage("No size-level data was returned for this listing. Check the Nike product page.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not load sizes.");
    } finally {
      setLoadingSizes(null);
      window.setTimeout(() => setMessage(""), 4500);
    }
  }

  function pickupUrl(product: NikeProduct) {
    return product.url;
  }

  const savedUrls = useMemo(() => new Set(saved.map((item) => item.url)), [saved]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand-mark" href="#top" aria-label="Nike Clearance Finder home">
          <span className="brand-icon">N</span>
          <span>OUTLET<span className="brand-light">RADAR</span></span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a href="#search" className={tab === "search" ? "nav-active" : ""} onClick={() => setTab("search")}>Find deals</a>
          <a href="#watchlist" className={tab === "saved" ? "nav-active" : ""} onClick={() => setTab("saved")}>Watchlist <span className="nav-count">{saved.length}</span></a>
          <a href="https://www.nike.com/retail/directory/united-states" target="_blank" rel="noreferrer">Store directory <ExternalLink size={12} /></a>
        </nav>
        <div className="topbar-right"><span className="live-dot" /> US PRODUCT SEARCH</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-noise" />
        <div className="hero-content">
          <div className="eyebrow"><span className="eyebrow-line" /> THE HUNT STARTS HERE</div>
          <h1>Find the pair.<br /><em>Find the price.</em></h1>
          <p className="hero-copy">Search Nike styles, uncover markdowns, and jump straight to store pickup checks. One search. Every product result we can find.</p>
          <div className="hero-points">
            <span><Check size={14} /> US catalog search</span>
            <span><Check size={14} /> Sale price comparison</span>
            <span><Check size={14} /> Store pickup handoff</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="hero-number">01</div>
          <div className="hero-art-caption">LESS SCROLLING.<br />MORE FINDING.</div>
          <div className="hero-stamp">PRICE<br />HUNTER</div>
        </div>
      </section>

      <section className="search-section" id="search">
        <div className="section-heading">
          <div><div className="eyebrow dark-eyebrow">01 / PRODUCT SEARCH</div><h2>What are you hunting?</h2></div>
          <div className="catalog-note"><span className="live-dot" /> Searching Nike US public product listings</div>
        </div>
        <form className="search-form" onSubmit={onSubmit}>
          <div className="search-input-wrap"><Search size={21} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a style, name, or product code..." aria-label="Search Nike products" /><button type="button" className="clear-query" onClick={() => setQuery("")} aria-label="Clear search">{query ? <X size={17} /> : null}</button></div>
          <button className="search-button" type="submit" disabled={searchStatus === "loading"}>{searchStatus === "loading" ? <span className="spinner" /> : <Search size={17} />} <span>{searchStatus === "loading" ? "Searching" : "Search"}</span><ArrowRight size={17} /></button>
        </form>
        <div className="search-controls">
          <div className="suggested"><span className="control-label">QUICK SEARCH</span>{SUGGESTED_SEARCHES.map((term) => <button type="button" className="suggestion" key={term} onClick={() => { setQuery(term); void runSearch(term); }}>{term}</button>)}</div>
          <button type="button" className={`sale-toggle ${saleOnly ? "sale-toggle-active" : ""}`} onClick={() => setSaleOnly((value) => !value)}><Tag size={15} /> Sale items only <span className="toggle-switch"><span /></span></button>
        </div>
        <div className="location-strip">
          <div className="location-intro"><MapPin size={17} /><div><strong>Looking for stores near you?</strong><span>Use your ZIP to open a nearby Nike store search.</span></div></div>
          <div className="location-actions"><input value={postalCode} onChange={(event) => setPostalCode(event.target.value.replace(/[^0-9-]/g, "").slice(0, 10))} placeholder="ZIP code" aria-label="ZIP code" maxLength={10} /><a className="map-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Nike Factory Store or Nike Clearance Store near ${postalCode || "United States"}`)}`} target="_blank" rel="noreferrer"><MapPin size={14} /> Find nearby stores <ExternalLink size={12} /></a></div>
        </div>
      </section>

      <section className="results-section" id="watchlist">
        <div className="results-topline">
          <div className="tabs" role="tablist" aria-label="Product views">
            <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "tab-active" : ""} onClick={() => setTab("search")}>Search results <span>{products.length}</span></button>
            <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "tab-active" : ""} onClick={() => setTab("saved")}>Saved watchlist <span>{saved.length}</span></button>
          </div>
          <button className="filter-button" onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal size={15} /> Filters <ChevronDown size={14} className={showFilters ? "rotate" : ""} /></button>
        </div>

        {showFilters && <div className="filter-panel">
          <div className="filter-group"><label>DEPARTMENT</label><div className="filter-pills">{CATEGORIES.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? "filter-selected" : ""}>{item}</button>)}</div></div>
          <div className="filter-group"><label>SIZE</label><select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}><option>All sizes</option>{["6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14", "15"].map((size) => <option key={size}>{size}</option>)}</select></div>
          <div className="filter-group"><label>SORT BY</label><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="relevance">Relevance</option><option value="price-low">Price: low to high</option><option value="discount">Biggest discount</option></select></div>
        </div>}

        <div className="results-summary">
          <div><span className="results-count">{visibleProducts.length.toString().padStart(2, "0")}</span><span className="results-label">{tab === "saved" ? "SAVED PRODUCTS" : searchStatus === "success" ? "PRODUCTS FOUND" : "READY TO SEARCH"}</span></div>
          <div className="results-meta">{providerMeta?.cached ? "Provider cache" : providerMeta?.fetchedAt ? `Updated ${new Date(providerMeta.fetchedAt).toLocaleString()}` : "Live lookup when searched"}{providerMeta?.creditsUsed !== undefined ? ` · ${providerMeta.creditsUsed} credit` : ""}</div>
        </div>

        {message && <div className="toast-message"><Check size={15} /> {message}</div>}
        {error && <div className="error-banner"><X size={16} /><div><strong>Search unavailable</strong><span>{error}</span>{providerConfigured === false && <a href="https://api.sh/" target="_blank" rel="noreferrer">Get a free product-data key <ExternalLink size={12} /></a>}</div></div>}

        {searchStatus === "idle" && tab === "search" && products.length === 0 && <div className="empty-state welcome-state">
          <div className="empty-icon"><PackageSearch size={28} /></div><div className="eyebrow dark-eyebrow">YOUR NEXT FIND IS OUT THERE</div><h3>Search the Nike catalog.</h3><p>Try a model name, collection, or style code. Turn on Sale items only to focus on markdowns.</p>
          {providerConfigured === false && <div className="setup-callout"><strong>One-time setup</strong><span>Add a free API.SH key as <code>API_SH_KEY</code> in Vercel to enable live product results. The free account includes 1,000 credits each month.</span><a href="https://api.sh/" target="_blank" rel="noreferrer">Create free product-data key <ArrowRight size={14} /></a></div>}
        </div>}

        {searchStatus === "loading" && <div className="loading-grid">{[1,2,3,4].map((n) => <div className="skeleton-card" key={n}><div className="skeleton-image"/><div className="skeleton-line wide"/><div className="skeleton-line"/></div>)}</div>}

        {searchStatus === "success" && tab === "search" && products.length === 0 && <div className="empty-state"><div className="empty-icon"><Search size={26} /></div><h3>No matching products in this result.</h3><p>Try another model name or search by the style code from a Nike product tag.</p><a href={`https://www.nike.com/w?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">Search this term on Nike.com <ExternalLink size={13} /></a></div>}

        {tab === "saved" && visibleProducts.length === 0 && <div className="empty-state"><div className="empty-icon"><Heart size={25} /></div><h3>Your watchlist is empty.</h3><p>Save products from search results to keep them together and track their price history when Neon is connected.</p><button className="text-action" onClick={() => setTab("search")}>Back to product search <ArrowRight size={14} /></button></div>}

        {visibleProducts.length > 0 && <div className="product-grid">
          {visibleProducts.map((product, index) => {
            const isSaved = savedUrls.has(product.url);
            const sizes = sizeDetails[product.url] ?? product.sizes ?? [];
            const hasDiscount = (product.discountPercent ?? 0) > 0;
            return <article className="product-card" key={product.url}>
              <div className="product-image-wrap">
                <span className="product-index">{String(index + 1).padStart(2, "0")}</span>
                {hasDiscount && <span className="discount-badge">-{product.discountPercent}%</span>}
                <button className={`save-button ${isSaved ? "is-saved" : ""}`} onClick={() => void toggleSaved(product)} aria-label={isSaved ? "Remove from watchlist" : "Save to watchlist"}><Heart size={17} fill={isSaved ? "currentColor" : "none"} /></button>
                {product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : <div className="image-placeholder"><PackageSearch size={35} /><span>NIKE PRODUCT</span></div>}
              </div>
              <div className="product-info">
                <div className="product-kicker">{categoryOf(product).toUpperCase()} {product.styleCode ? `· ${product.styleCode}` : ""}</div>
                <h3>{product.title}</h3>
                {product.subtitle && <p className="product-subtitle">{product.subtitle}</p>}
                <div className="price-row"><strong>{money(product.price, product.currency)}</strong>{product.fullPrice && product.price && product.fullPrice > product.price && <><del>{money(product.fullPrice, product.currency)}</del><span className="savings">Save {money(product.fullPrice - product.price, product.currency)}</span></>}</div>
                {sizes.length > 0 && <div className="size-list"><span>ONLINE SIZE DATA</span><div>{sizes.slice(0, 7).map((size) => <span key={size.label} className={size.available === false ? "size-unavailable" : ""}>{size.label}</span>)}{sizes.length > 7 && <small>+{sizes.length - 7}</small>}</div></div>}
                <div className="product-actions">
                  <a className="pickup-button" href={pickupUrl(product)} target="_blank" rel="noreferrer"><MapPin size={14} /> Check store pickup <ExternalLink size={12} /></a>
                  <button className="sizes-button" onClick={() => void loadSizes(product)} disabled={loadingSizes === product.url}>{loadingSizes === product.url ? <span className="mini-spinner" /> : <ArrowDownUp size={14} />} Sizes</button>
                </div>
                <div className="availability-note"><ShieldCheck size={13} /><span>Store stock must be confirmed on Nike</span></div>
              </div>
            </article>;
          })}
        </div>}

        {tab === "search" && searchStatus === "success" && products.length > 0 && <div className="bottom-note"><Sparkles size={15} /><span>Prices and online size indicators come from Nike's public product listings. Store pickup results open on Nike so you can select the exact size and participating location.</span></div>}
      </section>

      <section className="how-it-works">
        <div className="eyebrow">02 / HOW IT WORKS</div><h2>From search to store run.</h2>
        <div className="steps-grid">
          <div className="step-card"><span>01</span><Search size={20} /><h3>Search any style</h3><p>Use the model name, product name, or style code to find the Nike listing.</p></div>
          <div className="step-card"><span>02</span><Tag size={20} /><h3>Compare the deal</h3><p>See current price, original price, markdown percentage, and online size data when provided.</p></div>
          <div className="step-card"><span>03</span><MapPin size={20} /><h3>Verify pickup</h3><p>Open Nike's product page, choose the color and size, then review participating stores.</p></div>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-brand">OUTLET<span>RADAR</span></div>
        <div className="footer-copy">Independent shopping research tool. Not affiliated with or endorsed by Nike, Inc.</div>
        <div className="footer-links"><a href="https://www.nike.com/help/a/store-pickup" target="_blank" rel="noreferrer">How Nike pickup works <ExternalLink size={11} /></a><a href="https://www.nike.com/retail/directory/united-states" target="_blank" rel="noreferrer">Nike store directory <ExternalLink size={11} /></a></div>
      </footer>
    </main>
  );
}
