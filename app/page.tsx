"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp, ArrowRight, Check, ChevronDown, ExternalLink, Heart,
  MapPin, PackageSearch, Search, ShieldCheck, SlidersHorizontal, Sparkles,
  Tag, X,
} from "lucide-react";
import type { NearbyStore, NikeProduct, ProductSize } from "@/lib/types";

type Tab = "search" | "saved";
type Category = "All" | "Shoes" | "Apparel" | "Accessories" | "Other";
type Status = "idle" | "loading" | "success" | "error";

const SUGGESTED_SEARCHES = ["Air Max 90", "Dunk Low", "Vomero 5", "Tech Fleece"];
const CATEGORIES: Category[] = ["All", "Shoes", "Apparel", "Accessories", "Other"];
const GENDERS = [{ value: "all", label: "All" }, { value: "men", label: "Men" }, { value: "women", label: "Women" }, { value: "kids", label: "Kids" }, { value: "unisex", label: "Unisex" }];
const LOCAL_KEY = "nike-clearance-finder:saved:v1";
const VISITOR_KEY = "nike-clearance-finder:visitor:v1";

function money(value?: number, currency = "USD") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Price unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function categoryOf(product: NikeProduct): Exclude<Category, "All"> {
  if (product.category && product.category !== "Other") return product.category;
  const text = `${product.title} ${product.subtitle ?? ""}`.toLowerCase();
  if (/shirt|hoodie|jacket|fleece|pants|shorts|leggings|bra|jersey|sweatshirt|tee|apparel/.test(text)) return "Apparel";
  if (/bag|backpack|cap|hat|socks|glove|bottle|accessor/.test(text)) return "Accessories";
  if (/shoe|sneaker|jordan|dunk|air max|vomero|pegasus|zoom|trainer/.test(text)) return "Shoes";
  return "Other";
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
    gender: typeof row.gender === "string" ? row.gender as NikeProduct["gender"] : "Unknown",
    category: typeof row.category === "string" ? row.category as NikeProduct["category"] : "Other",
  };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [storeRadius, setStoreRadius] = useState("25");
  const [stores, setStores] = useState<NearbyStore[]>([]);
  const [storeStatus, setStoreStatus] = useState<Status>("idle");
  const [storeError, setStoreError] = useState("");
  const [saleOnly, setSaleOnly] = useState(false);
  const [genderFilter, setGenderFilter] = useState("all");
  const [suggestions, setSuggestions] = useState<NikeProduct[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedProductUrl, setSelectedProductUrl] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [sizeFilter, setSizeFilter] = useState("All sizes");
  const [sortBy, setSortBy] = useState("relevance");
  const [tab, setTab] = useState<Tab>("search");
  const [products, setProducts] = useState<NikeProduct[]>([]);
  const [saved, setSaved] = useState<NikeProduct[]>([]);
  const [searchStatus, setSearchStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [providerMeta, setProviderMeta] = useState<{ cached?: boolean; fetchedAt?: string; creditsUsed?: number; cacheSource?: "neon" | "provider" } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [databaseConfigured, setDatabaseConfigured] = useState(false);
  const [loadingSizes, setLoadingSizes] = useState<string | null>(null);
  const [sizeDetails, setSizeDetails] = useState<Record<string, ProductSize[]>>({});
  const [showFilters, setShowFilters] = useState(true);

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

  // Typeahead searches only the Neon product catalogue. It never calls API.SH while typing.
  useEffect(() => {
    if (!suggestionsOpen || selectedProductUrl || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await response.json();
        if (!controller.signal.aborted) {
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
          setSuggestionsOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedProductUrl, suggestionsOpen]);

  const visibleProducts = useMemo(() => {
    let base = tab === "saved" ? saved : products;
    if (tab === "search" && selectedProductUrl) base = base.filter((product) => product.url === selectedProductUrl);
    let filtered = base.filter((product) => category === "All" || categoryOf(product) === category);
    if (genderFilter !== "all") filtered = filtered.filter((product) => product.gender?.toLowerCase() === genderFilter);
    if (sizeFilter !== "All sizes") {
      filtered = filtered.filter((product) => {
        const sizes = sizeDetails[product.url] ?? product.sizes ?? [];
        return sizes.some((size) => size.label.toLowerCase() === sizeFilter.toLowerCase() && size.available !== false);
      });
    }
    if (sortBy === "price-low") filtered = [...filtered].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
    if (sortBy === "discount") filtered = [...filtered].sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
    return filtered;
  }, [category, genderFilter, products, saved, selectedProductUrl, sizeDetails, sizeFilter, sortBy, tab]);

  const sizeOptions = useMemo(() => {
    const base = tab === "saved" ? saved : products;
    const labels = base.flatMap((product) => (sizeDetails[product.url] ?? product.sizes ?? []).map((size) => size.label));
    return [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [products, saved, sizeDetails, tab]);

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
    setSelectedProductUrl("");
    setSuggestionsOpen(false);
    try {
      const params = new URLSearchParams({ q: term });
      if (saleOnly) params.set("sale", "1");
      if (genderFilter !== "all") params.set("gender", genderFilter);
      const response = await fetch(`/api/search?${params.toString()}`);
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

  function chooseSuggestion(product: NikeProduct) {
    setQuery(product.title);
    setProducts([product]);
    setSelectedProductUrl(product.url);
    setTab("search");
    setSearchStatus("success");
    setProviderMeta({ cached: true, cacheSource: "neon" });
    setSuggestionsOpen(false);
    setError("");
    void loadSizes(product);
  }

  function selectExactProduct(product: NikeProduct) {
    const nextUrl = selectedProductUrl === product.url ? "" : product.url;
    setSelectedProductUrl(nextUrl);
    setMessage(nextUrl ? `Showing the selected product: ${product.title}` : "Showing all matching products again.");
    if (nextUrl) void loadSizes(product);
    window.setTimeout(() => setMessage(""), 3000);
  }

  async function findNearbyStores() {
    const zip = postalCode.trim();
    if (!/^\d{5}$/.test(zip)) { setStoreError("Enter a valid five-digit US ZIP code."); return; }
    setStoreStatus("loading");
    setStoreError("");
    try {
      const response = await fetch(`/api/stores?zip=${encodeURIComponent(zip)}&radius=${storeRadius}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Nearby store search failed.");
      setStores(Array.isArray(data.stores) ? data.stores : []);
      setStoreStatus("success");
    } catch (caught) {
      setStoreError(caught instanceof Error ? caught.message : "Nearby store search failed.");
      setStoreStatus("error");
      setStores([]);
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
            gender: product.gender, category: product.category,
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
      if (data.product && typeof data.product === "object") {
        setProducts((current) => current.map((item) => item.url === product.url ? { ...item, ...data.product } : item));
        setSaved((current) => current.map((item) => item.url === product.url ? { ...item, ...data.product } : item));
      }
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
          <div className="search-input-wrap"><Search size={21} /><input value={query} onFocus={() => setSuggestionsOpen(true)} onChange={(event) => { setQuery(event.target.value); setSelectedProductUrl(""); setSuggestionsOpen(true); }} placeholder="Search a style, model, or style code..." aria-label="Search Nike products" autoComplete="off" /><button type="button" className="clear-query" onClick={() => { setQuery(""); setSuggestions([]); setSuggestionsOpen(false); setSelectedProductUrl(""); }} aria-label="Clear search">{query ? <X size={17} /> : null}</button></div>
          <button className="search-button" type="submit" disabled={searchStatus === "loading"}>{searchStatus === "loading" ? <span className="spinner" /> : <Search size={17} />} <span>{searchStatus === "loading" ? "Searching" : "Search"}</span><ArrowRight size={17} /></button>
        </form>
        {suggestionsOpen && query.trim().length >= 3 && suggestions.length === 0 && <div className="suggestion-hint">No previously cached product matches. Press Search to query Nike; that result will be saved in Neon for future suggestions.</div>}
        {suggestionsOpen && suggestions.length > 0 && <div className="search-suggestions"><div className="suggestion-heading">MATCHES FROM YOUR SAVED CATALOG <span>NO API CALL</span></div>{suggestions.map((product) => <button type="button" key={product.url} onClick={() => chooseSuggestion(product)}><span className="suggestion-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={17} />}</span><span className="suggestion-copy"><strong>{product.title}</strong><small>{product.styleCode || product.category || "Nike product"} · {money(product.price, product.currency)}</small></span><ArrowRight size={14} /></button>)}</div>}
        <div className="search-controls">
          <div className="suggested"><span className="control-label">QUICK SEARCH</span>{SUGGESTED_SEARCHES.map((term) => <button type="button" className="suggestion" key={term} onClick={() => { setQuery(term); void runSearch(term); }}>{term}</button>)}</div>
          <button type="button" className={`sale-toggle ${saleOnly ? "sale-toggle-active" : ""}`} onClick={() => setSaleOnly((value) => !value)}><Tag size={15} /> Sale items only <span className="toggle-switch"><span /></span></button>
        </div>
        <div className="location-strip">
          <div className="location-intro"><MapPin size={17} /><div><strong>Find Nike stores near a ZIP code</strong><span>See nearby store addresses and distance in miles.</span></div></div>
          <div className="location-actions"><input value={postalCode} onChange={(event) => { setPostalCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 5)); setStoreStatus("idle"); setStores([]); }} placeholder="ZIP code" aria-label="ZIP code" maxLength={5} /><select value={storeRadius} onChange={(event) => { setStoreRadius(event.target.value); setStoreStatus("idle"); setStores([]); }} aria-label="Search radius"><option value="5">5 miles</option><option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option><option value="100">100 miles</option></select><button className="map-link" type="button" onClick={() => void findNearbyStores()} disabled={storeStatus === "loading"}>{storeStatus === "loading" ? <span className="mini-spinner" /> : <MapPin size={14} />} Find stores</button></div>
        </div>
        {storeError && <div className="store-error">{storeError}</div>}
        {storeStatus === "loading" && <div className="store-results-loading">Searching nearby Nike store locations…</div>}
        {storeStatus === "success" && <div className="nearby-store-panel"><div className="nearby-store-heading"><div><strong>{stores.length} Nike {stores.length === 1 ? "location" : "locations"} found</strong><span>Within {storeRadius} miles of {postalCode}</span></div><button type="button" onClick={() => setStoreStatus("idle")}>Hide</button></div>{stores.length === 0 ? <p className="store-empty">No Nike locations were found in the public map directory within this radius. Try a larger distance.</p> : <div className="nearby-store-grid">{stores.map((store) => <article className="nearby-store-card" key={store.id}><div className="nearby-store-top"><strong>{store.name}</strong><span>{store.distanceMiles.toFixed(1)} mi</span></div><div className="store-type">{store.storeType}</div><p>{store.address}</p><a href={store.mapUrl} target="_blank" rel="noreferrer">Directions <ExternalLink size={11} /></a></article>)}</div>}<p className="store-stock-disclaimer">Store locations are sourced from OpenStreetMap and may be incomplete. Distances are straight-line estimates from the ZIP-code centroid, not driving distances. These results do not confirm that the searched product is in stock at any listed store. Check Nike Pickup for size-specific availability.</p></div>}
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
          <div className="filter-group"><label>PRODUCT TYPE</label><div className="filter-pills">{CATEGORIES.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? "filter-selected" : ""}>{item}</button>)}</div></div>
          <div className="filter-group"><label>GENDER</label><div className="filter-pills">{GENDERS.map((item) => <button key={item.value} onClick={() => setGenderFilter(item.value)} className={genderFilter === item.value ? "filter-selected" : ""}>{item.label}</button>)}</div></div>
          <div className="filter-group"><label>SIZE</label><select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}><option>All sizes</option>{sizeOptions.map((size) => <option key={size}>{size}</option>)}</select>{sizeOptions.length === 0 && <small className="filter-help">Select a product or use Sizes to load its online size data. Filtering only includes products with a returned matching size.</small>}</div>
          <div className="filter-group"><label>SORT BY</label><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="relevance">Relevance</option><option value="price-low">Price: low to high</option><option value="discount">Biggest discount</option></select></div>
        </div>}

        <div className="results-summary">
          <div><span className="results-count">{visibleProducts.length.toString().padStart(2, "0")}</span><span className="results-label">{tab === "saved" ? "SAVED PRODUCTS" : searchStatus === "success" ? "PRODUCTS FOUND" : "READY TO SEARCH"}</span></div>
          <div className="results-meta">{providerMeta?.cacheSource === "neon" ? "Saved in Neon · no API credit used" : providerMeta?.fetchedAt ? `Updated ${new Date(providerMeta.fetchedAt).toLocaleString()}` : "Live lookup when searched"}{providerMeta?.creditsUsed !== undefined ? ` · ${providerMeta.creditsUsed} credit` : ""}</div>
        </div>

        {message && <div className="toast-message"><Check size={15} /> {message}</div>}
        {error && <div className="error-banner"><X size={16} /><div><strong>Search unavailable</strong><span>{error}</span>{providerConfigured === false && <a href="https://api.sh/" target="_blank" rel="noreferrer">Get a free product-data key <ExternalLink size={12} /></a>}</div></div>}

        {searchStatus === "idle" && tab === "search" && products.length === 0 && <div className="empty-state welcome-state">
          <div className="empty-icon"><PackageSearch size={28} /></div><div className="eyebrow dark-eyebrow">YOUR NEXT FIND IS OUT THERE</div><h3>Search the Nike catalog.</h3><p>Try a model name, collection, or style code. Turn on Sale items only to focus on markdowns.</p>
          {providerConfigured === false && <div className="setup-callout"><strong>One-time setup</strong><span>Add a free API.SH key as <code>API_SH_KEY</code> in Vercel to enable live product results. Check your API.SH dashboard for the current free allowance and remaining credits.</span><a href="https://api.sh/" target="_blank" rel="noreferrer">Create free product-data key <ArrowRight size={14} /></a></div>}
        </div>}

        {searchStatus === "loading" && <div className="loading-grid">{[1,2,3,4].map((n) => <div className="skeleton-card" key={n}><div className="skeleton-image"/><div className="skeleton-line wide"/><div className="skeleton-line"/></div>)}</div>}

        {searchStatus === "success" && tab === "search" && products.length === 0 && <div className="empty-state"><div className="empty-icon"><Search size={26} /></div><h3>No exact product matches were returned.</h3><p>Unrelated Nike recommendations are filtered out. Try a shorter model name or search by the style code from the product tag.</p><a href={`https://www.nike.com/w?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">Search this term on Nike.com <ExternalLink size={13} /></a></div>}

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
                <div className="product-kicker">{categoryOf(product).toUpperCase()} · {(product.gender ?? "Unknown").toUpperCase()} {product.styleCode ? `· ${product.styleCode}` : ""}</div>
                <h3>{product.title}</h3>
                {product.subtitle && <p className="product-subtitle">{product.subtitle}</p>}
                <div className="price-row"><strong>{money(product.price, product.currency)}</strong>{product.fullPrice && product.price && product.fullPrice > product.price && <><del>{money(product.fullPrice, product.currency)}</del><span className="savings">Save {money(product.fullPrice - product.price, product.currency)}</span></>}</div>
                {sizes.length > 0 && <div className="size-list"><span>ONLINE SIZE DATA</span><div>{sizes.slice(0, 7).map((size) => <span key={size.label} className={size.available === false ? "size-unavailable" : ""}>{size.label}</span>)}{sizes.length > 7 && <small>+{sizes.length - 7}</small>}</div></div>}
                <div className="product-actions">
                  <a className="pickup-button" href={pickupUrl(product)} target="_blank" rel="noreferrer"><MapPin size={14} /> Check Nike pickup <ExternalLink size={12} /></a>
                  <button className="sizes-button" onClick={() => void loadSizes(product)} disabled={loadingSizes === product.url}>{loadingSizes === product.url ? <span className="mini-spinner" /> : <ArrowDownUp size={14} />} Sizes</button>
                </div>
                <button type="button" className={`select-product-button ${selectedProductUrl === product.url ? "selected" : ""}`} onClick={() => selectExactProduct(product)}>{selectedProductUrl === product.url ? <><Check size={12} /> Exact product selected</> : "Select this exact product"}</button>
                <div className="availability-note"><ShieldCheck size={13} /><span>Online size data only · store stock unverified</span></div>
              </div>
            </article>;
          })}
        </div>}

        {tab === "search" && searchStatus === "success" && products.length > 0 && <div className="bottom-note"><Sparkles size={15} /><span>Search results are matched against your terms. Repeated searches are cached in Neon. Online size availability is not store inventory; use Nike Pickup to check a selected size at participating locations.</span></div>}
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
