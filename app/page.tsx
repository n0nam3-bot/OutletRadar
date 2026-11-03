"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp, ArrowRight, Check, ExternalLink, Heart,
  MapPin, PackageSearch, Search, ShieldCheck, ShoppingBag, Sparkles, Tag, X,
} from "lucide-react";
import type { MarketplaceOffer, MarketplaceSourceStatus, NearbyStore, NikeProduct, ProductSize } from "@/lib/types";

type Tab = "search" | "saved";
type Category = "All" | "Shoes" | "Apparel" | "Accessories" | "Other";
type Status = "idle" | "loading" | "success" | "error";

const SUGGESTED_SEARCHES = ["Air Max 90", "Dunk Low", "Vomero 5", "Tech Fleece"];
const CATEGORIES: Category[] = ["All", "Shoes", "Apparel", "Accessories", "Other"];
const GENDERS = [{ value: "all", label: "All audiences" }, { value: "men", label: "Men" }, { value: "women", label: "Women" }, { value: "kids", label: "Kids / Youth" }, { value: "unisex", label: "Unisex" }];
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

function audienceOf(product: NikeProduct): NonNullable<NikeProduct["gender"]> {
  const descriptor = `${product.title} ${product.subtitle ?? ""}`.toLowerCase();
  if (/\b(big kids?|grade school|gs|little kids?|preschool|ps|toddler|infant|youth|kids?|boys?|girls?)\b/.test(descriptor) ||
      (product.sizes ?? []).some((size) => /\d+(?:\.\d+)?\s*y\b/i.test(`${size.label} ${size.localizedLabel ?? ""}`))) return "Kids";
  const men = /\bmen(?:['’]s)?\b/.test(descriptor);
  const women = /\bwomen(?:['’]s)?\b/.test(descriptor);
  if (men && women) return "Unisex";
  if (men) return "Men";
  if (women) return "Women";
  return product.gender ?? "Unknown";
}

function productIsOnSale(product: NikeProduct) {
  return product.onSale === true || (product.discountPercent ?? 0) > 0 ||
    (product.price !== undefined && product.fullPrice !== undefined && product.fullPrice > product.price);
}

function normalizeSizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/^us\s+/, "").trim();
}

function sizeMatches(size: ProductSize, requested: string, gender?: NikeProduct["gender"]) {
  const target = normalizeSizeText(requested);
  if (!target) return true;
  const label = normalizeSizeText(size.label);
  const localized = normalizeSizeText(size.localizedLabel ?? "");
  // Nike sometimes sends a shared numeric label with a localized "M 6 / W 7.5".
  // The provider may put that combined text in either label field, so inspect both.
  // Match the audience-specific side before a generic token (6 is men's here, not women's).
  const sizeText = `${localized} ${label}`;
  const localizedSizes = [...sizeText.matchAll(/\b([mw])\s*(\d+(?:\.\d+)?)/g)];
  const audienceLetter = gender === "Women" ? "w" : gender === "Men" ? "m" : null;
  if (audienceLetter && localizedSizes.length) {
    return localizedSizes.some((match) => match[1] === audienceLetter && normalizeSizeText(match[2]) === target);
  }
  if (label === target || localized === target) return true;

  // Exact tokens only: 5Y must not be treated as adult size 5.
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenPattern = new RegExp(`(?:^|[\\s/])${escaped}(?:$|[\\s/])`, "i");
  return tokenPattern.test(label) || tokenPattern.test(localized);
}

const SIZE_STATUS_TTL_MS = 60 * 60 * 1000;

function sizesForDisplay(product: NikeProduct, details: Record<string, ProductSize[]>, checkedAt: Record<string, number>) {
  const values = details[product.url] ?? product.sizes ?? [];
  const checked = checkedAt[product.url];
  if (checked && Date.now() - checked < SIZE_STATUS_TTL_MS) return values;
  // Do not keep showing stale inventory status after the one-hour cache expires.
  return values.map(({ label, localizedLabel }) => ({ label, localizedLabel, available: null, status: "Refresh required" }));
}

function checkedAgeLabel(timestamp?: number) {
  if (!timestamp) return "not checked in this session";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? "checked just now" : `checked ${minutes} min ago`;
}

function availabilityMessage(product: NikeProduct, sizes: ProductSize[], requestedSize: string, checkedAt?: number) {
  if (!requestedSize.trim()) {
    return "Size options are not the same as stock. Search results only list sizes; press Check sizes for this product to request online availability. Store pickup is not checked.";
  }
  const match = sizes.find((size) => sizeMatches(size, requestedSize, audienceOf(product)));
  const checkedFresh = checkedAt !== undefined && Date.now() - checkedAt < SIZE_STATUS_TTL_MS;
  const age = checkedAgeLabel(checkedAt);
  if (match?.available === true) return `Provider reports online shipping available for size ${match.label} · ${age} · store pickup not checked`;
  if (match?.available === false) return `Provider reports size ${match.label} unavailable · ${age}`;
  if (match) return `Size ${match.label} is listed, but online stock is unverified${match.status ? ` (source status: ${match.status})` : ""} · ${age} · store pickup not checked`;
  if (checkedFresh && sizes.length === 0) return `Provider returned no size-level inventory data for this product · ${age} · availability unverified`;
  if (checkedFresh) return `Provider did not return a ${requestedSize} size entry · ${age} · availability not independently confirmed`;
  return `Size ${requestedSize} is not listed in the cached result. Click Check sizes to check this product · availability not confirmed`;
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
  const [marketplaceOffers, setMarketplaceOffers] = useState<MarketplaceOffer[]>([]);
  const [marketplaceSources, setMarketplaceSources] = useState<Array<MarketplaceSourceStatus & { key?: string }>>([]);
  const [marketplaceStatus, setMarketplaceStatus] = useState<Status>("idle");
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceCachedAt, setMarketplaceCachedAt] = useState<string | null>(null);
  const [saleOnly, setSaleOnly] = useState(false);
  const [genderFilter, setGenderFilter] = useState("all");
  const [suggestions, setSuggestions] = useState<NikeProduct[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedProductUrl, setSelectedProductUrl] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [sizeFilter, setSizeFilter] = useState("");
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
  const [availabilityClock, setAvailabilityClock] = useState(0);
  const [sizeDetails, setSizeDetails] = useState<Record<string, ProductSize[]>>({});
  const [sizeDetailsCheckedAt, setSizeDetailsCheckedAt] = useState<Record<string, number>>({});
  const sizeFetchAttemptsRef = useRef<Set<string>>(new Set());

  // Re-render when availability cache entries age out so stale green/red states
  // become unverified even when the user leaves the page open.
  useEffect(() => {
    const timer = window.setInterval(() => setAvailabilityClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
    if (genderFilter !== "all") filtered = filtered.filter((product) => audienceOf(product).toLowerCase() === genderFilter);
    if (saleOnly) filtered = filtered.filter(productIsOnSale);
    const requestedSize = sizeFilter.trim();
    if (requestedSize) {
      filtered = filtered.filter((product) => {
        const sizes = sizesForDisplay(product, sizeDetails, sizeDetailsCheckedAt);
        const matchingSize = sizes.find((size) => sizeMatches(size, requestedSize, audienceOf(product)));
        // Keep explicit sold-out matches visible so the card can show the unavailable
        // state instead of making the product silently disappear from the search.
        if (matchingSize) return true;

        // Do not silently hide a model just because the broad catalog result lacks a
        // size label. Keep unchecked candidates visible so the shopper can request one
        // product-detail lookup; hide it only after a fresh detail response confirms
        // that the requested size is absent.
        const checkedAt = sizeDetailsCheckedAt[product.url];
        const detailIsFresh = checkedAt !== undefined && Date.now() - checkedAt < SIZE_STATUS_TTL_MS;
        if (detailIsFresh && sizes.length === 0) return true; // provider supplied no size-level data
        return !detailIsFresh;
      });
      // Rank explicit provider-available sizes first, then unverified, then unavailable.
      // Keep unavailable matches visible so shoppers can see why a model did not qualify.
      const sizeRank = (product: NikeProduct) => {
        const match = sizesForDisplay(product, sizeDetails, sizeDetailsCheckedAt)
          .find((size) => sizeMatches(size, requestedSize, audienceOf(product)));
        if (match?.available === true) return 2;
        if (match?.available === false) return 0;
        if (match) return 1;
        return -1;
      };
      filtered.sort((a, b) => sizeRank(b) - sizeRank(a));
    }
    if (sortBy === "price-low") filtered = [...filtered].sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
    if (sortBy === "discount") filtered = [...filtered].sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
    return filtered;
  }, [availabilityClock, category, genderFilter, products, saved, saleOnly, selectedProductUrl, sizeDetails, sizeDetailsCheckedAt, sizeFilter, sortBy, tab]);

  const sizeOptions = useMemo(() => {
    const base = tab === "saved" ? saved : products;
    const labels = base.flatMap((product) => sizesForDisplay(product, sizeDetails, sizeDetailsCheckedAt).map((size) => size.label));
    return [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [availabilityClock, products, saved, sizeDetails, sizeDetailsCheckedAt, tab]);


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
    sizeFetchAttemptsRef.current.clear();
    setSizeDetails({});
    setSizeDetailsCheckedAt({});
    setSelectedProductUrl("");
    setSuggestionsOpen(false);
    setMarketplaceOffers([]);
    setMarketplaceSources([]);
    setMarketplaceStatus("idle");
    setMarketplaceError("");
    setMarketplaceCachedAt(null);
    try {
      const params = new URLSearchParams({ q: term });
      // Audience, sale, category and size are filtered from the same cached base result.
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

  async function compareRetailers() {
    const term = query.trim();
    if (term.length < 2) { setMarketplaceError("Enter a product or model name first."); return; }
    setMarketplaceStatus("loading");
    setMarketplaceError("");
    try {
      const response = await fetch(`/api/marketplaces?q=${encodeURIComponent(term)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Retailer comparison failed.");
      setMarketplaceOffers(Array.isArray(data.offers) ? data.offers : []);
      setMarketplaceSources(Array.isArray(data.sources) ? data.sources : []);
      setMarketplaceCachedAt(data.cachedAt ? String(data.cachedAt) : null);
      setMarketplaceStatus("success");
    } catch (caught) {
      setMarketplaceError(caught instanceof Error ? caught.message : "Retailer comparison failed.");
      setMarketplaceStatus("error");
    }
  }

  function chooseSuggestion(product: NikeProduct) {
    setQuery(product.title);
    setProducts([product]);
    setSelectedProductUrl(product.url);
    setTab("search");
    setSearchStatus("success");
    setProviderMeta({ cached: true, cacheSource: "neon" });
    sizeFetchAttemptsRef.current.clear();
    setSizeDetails({});
    setSizeDetailsCheckedAt({});
    setSuggestionsOpen(false);
    setError("");
    setMarketplaceOffers([]);
    setMarketplaceSources([]);
    setMarketplaceStatus("idle");
    setMarketplaceError("");
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

  const loadSizes = useCallback(async (product: NikeProduct, quiet = false, forceRefresh = false) => {
    const lastChecked = sizeDetailsCheckedAt[product.url];
    const detailsAreFresh = lastChecked !== undefined && Date.now() - lastChecked < SIZE_STATUS_TTL_MS;
    if (!forceRefresh && sizeDetails[product.url] !== undefined && detailsAreFresh) return;
    if (!forceRefresh && sizeFetchAttemptsRef.current.has(product.url)) return;
    sizeFetchAttemptsRef.current.add(product.url);
    if (forceRefresh) {
      // Remove the old positive signal while the fresh check is in flight.
      setSizeDetails((current) => ({
        ...current,
        [product.url]: (current[product.url] ?? product.sizes ?? []).map((size) => ({
          ...size, available: null, status: "Refreshing availability",
        })),
      }));
    }
    if (!quiet) setLoadingSizes(product.url);
    try {
      const refreshParam = forceRefresh ? "&refresh=1" : "";
      const response = await fetch(`/api/product?url=${encodeURIComponent(product.url)}${refreshParam}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load sizes.");
      const sizes = Array.isArray(data.product?.sizes) ? data.product.sizes : [];
      // If the provider returns no size-level rows, retain the search-result size labels
      // as unverified options rather than erasing them or implying they are unavailable.
      const sizesForDisplay = sizes.length ? sizes : (product.sizes ?? []).map(({ label, localizedLabel }) => ({ label, localizedLabel, available: null, status: "No size-level stock signal returned" }));
      setSizeDetails((current) => ({ ...current, [product.url]: sizesForDisplay }));
      const sourceCheckedAt = data.meta?.checkedAt ? Date.parse(data.meta.checkedAt) : Number.NaN;
      setSizeDetailsCheckedAt((current) => ({
        ...current,
        [product.url]: Number.isFinite(sourceCheckedAt) ? sourceCheckedAt : Date.now(),
      }));
      if (data.product && typeof data.product === "object") {
        const mergeDetails = (item: NikeProduct): NikeProduct => ({
          ...item,
          ...data.product,
          gender: data.product.gender && data.product.gender !== "Unknown" ? data.product.gender : item.gender,
          sizeSystem: data.product.sizeSystem && data.product.sizeSystem !== "unknown" ? data.product.sizeSystem : item.sizeSystem,
          sizes: Array.isArray(data.product.sizes) && data.product.sizes.length ? data.product.sizes : item.sizes,
        });
        setProducts((current) => current.map((item) => item.url === product.url ? mergeDetails(item) : item));
        setSaved((current) => current.map((item) => item.url === product.url ? mergeDetails(item) : item));
      }
      if (!quiet && !sizes.length) setMessage("Nike product details returned no size-level inventory data. Availability is unverified.");
      if (!quiet && data.meta?.cacheSource === "neon") setMessage("Showing a recent availability check from Neon. Use Refresh sizes to request a fresh provider lookup.");
    } catch (caught) {
      sizeFetchAttemptsRef.current.delete(product.url);
      if (forceRefresh) {
        setSizeDetails((current) => ({
          ...current,
          [product.url]: (current[product.url] ?? product.sizes ?? []).map((size) => ({
            ...size, available: null, status: "Refresh failed; not verified",
          })),
        }));
        setSizeDetailsCheckedAt((current) => ({ ...current, [product.url]: Date.now() }));
      }
      if (!quiet) setMessage(caught instanceof Error ? caught.message : "Could not load sizes.");
    } finally {
      sizeFetchAttemptsRef.current.delete(product.url);
      if (!quiet) {
        setLoadingSizes(null);
        window.setTimeout(() => setMessage(""), 4500);
      }
    }
  }, [sizeDetails, sizeDetailsCheckedAt]);

  // Size filtering itself is local and free. A product-detail lookup happens only
  // when the shopper explicitly presses Check sizes on an individual product. This
  // prevents a size filter from issuing up to ten paid API calls automatically.

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
          <p className="hero-copy">Search Nike styles, compare marketplace and retailer listings, and narrow results by audience and size. Reuse cached searches to conserve free API credits.</p>
          <div className="hero-points">
            <span><Check size={14} /> US catalog search</span>
            <span><Check size={14} /> Sale price comparison</span>
            <span><Check size={14} /> Size and audience filters</span>
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
          <div className="catalog-note"><span className="live-dot" /> Nike catalog + optional multi-retailer comparison</div>
        </div>
        <form className="search-form" onSubmit={onSubmit}>
          <div className="search-input-wrap"><Search size={21} /><input value={query} onFocus={() => setSuggestionsOpen(true)} onChange={(event) => { setQuery(event.target.value); setSelectedProductUrl(""); setSuggestionsOpen(true); setMarketplaceOffers([]); setMarketplaceSources([]); setMarketplaceStatus("idle"); setMarketplaceError(""); setMarketplaceCachedAt(null); }} placeholder="Search a style, model, or style code..." aria-label="Search sneaker products" autoComplete="off" /><button type="button" className="clear-query" onClick={() => { setQuery(""); setSuggestions([]); setSuggestionsOpen(false); setSelectedProductUrl(""); setMarketplaceOffers([]); setMarketplaceSources([]); setMarketplaceStatus("idle"); setMarketplaceError(""); setMarketplaceCachedAt(null); }} aria-label="Clear search">{query ? <X size={17} /> : null}</button></div>
          <button className="search-button" type="submit" disabled={searchStatus === "loading"}>{searchStatus === "loading" ? <span className="spinner" /> : <Search size={17} />} <span>{searchStatus === "loading" ? "Searching" : "Search"}</span><ArrowRight size={17} /></button>
        </form>
        {suggestionsOpen && query.trim().length >= 3 && suggestions.length === 0 && <div className="suggestion-hint">No previously cached product matches. Press Search to query Nike; that result will be saved in Neon for future suggestions.</div>}
        {suggestionsOpen && suggestions.length > 0 && <div className="search-suggestions"><div className="suggestion-heading">MATCHES FROM YOUR SAVED CATALOG <span>NO API CALL</span></div>{suggestions.map((product) => <button type="button" key={product.url} onClick={() => chooseSuggestion(product)}><span className="suggestion-thumb">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={17} />}</span><span className="suggestion-copy"><strong>{product.title}</strong><small>{product.styleCode || product.category || "Nike product"} · {money(product.price, product.currency)}</small></span><ArrowRight size={14} /></button>)}</div>}
        <div className="search-filter-panel">
          <div className="search-filter-heading"><strong>REFINE THIS SEARCH</strong><span>All filters are local. Size availability is checked only when you request it for a product.</span></div>
          <div className="search-filter-grid">
            <label className="search-filter-field"><span>GENDER / AUDIENCE</span><select value={genderFilter} onChange={(event) => setGenderFilter(event.target.value)}>{GENDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="search-filter-field"><span>SIZE</span><input list="nike-size-options" value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)} placeholder="Any size (e.g. 10 or 5Y)" /><datalist id="nike-size-options">{sizeOptions.map((size) => <option key={size} value={size} />)}</datalist></label>
            <label className="search-filter-field"><span>PRODUCT TYPE</span><select value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <button type="button" className={`sale-toggle search-sale-toggle ${saleOnly ? "sale-toggle-active" : ""}`} onClick={() => setSaleOnly((value) => !value)}><Tag size={15} /> Sale items only <span className="toggle-switch"><span /></span></button>
          </div>
          {sizeFilter.trim() && <div className="size-filter-foot"><p className="size-filter-note">Size matching uses each product's own sizing system. Youth 5Y stays separate from adult 5. Filtering does not use API credits. To check online stock, press Check sizes on an individual product; verified product details are reused from Neon for up to one hour.</p></div>}
        </div>
        <div className="search-controls"><div className="suggested"><span className="control-label">QUICK SEARCH</span>{SUGGESTED_SEARCHES.map((term) => <button type="button" className="suggestion" key={term} onClick={() => { setQuery(term); void runSearch(term); }}>{term}</button>)}</div></div>

        <section className="retailer-compare" aria-label="Compare sneaker retailers">
          <div className="retailer-compare-head">
            <div><div className="eyebrow dark-eyebrow">02 / MULTI-RETAILER SEARCH</div><h3>Check other retailers</h3><p>Compare StockX, GOAT, Flight Club, Kicks Crew, Foot Locker and other merchants.</p></div>
            <button className="compare-retailers-button" type="button" onClick={() => void compareRetailers()} disabled={marketplaceStatus === "loading" || query.trim().length < 2}>{marketplaceStatus === "loading" ? <span className="mini-spinner" /> : <ShoppingBag size={15} />} {marketplaceStatus === "loading" ? "Comparing" : "Compare retailers"}</button>
          </div>
          <p className="retailer-compare-note">Only runs when you press Compare retailers. Uncached requests are limited to 5 per IP per day and protected by monthly free-tier budgets. Results are cached in Neon for 6 hours; PCKT catalog snapshots may be up to 24 hours old.</p>
          {marketplaceError && <div className="store-error">{marketplaceError}</div>}
          {marketplaceStatus === "loading" && <div className="store-results-loading">Checking marketplace catalogs and online retailer listings…</div>}
          {marketplaceStatus === "success" && <div className="retailer-results-wrap">
            <div className="retailer-results-meta"><strong>{marketplaceOffers.length} matching online listing{marketplaceOffers.length === 1 ? "" : "s"}</strong><span>{marketplaceCachedAt ? `Cached ${new Date(marketplaceCachedAt).toLocaleString()}` : "Fresh comparison"} · exact size stock not assumed</span></div>
            {marketplaceSources.length > 0 && <div className="retailer-source-grid">{marketplaceSources.map((source) => <div className="retailer-source-status" key={`${source.key ?? source.name}-${source.status}`}><strong>{source.name} · {source.status === "success" ? `${source.results} found` : source.status.replaceAll("_", " ")}</strong><span>{source.message}</span></div>)}</div>}
            {marketplaceOffers.length > 0 ? <div className="retailer-offer-grid">{marketplaceOffers.map((offer) => <article className="retailer-offer-card" key={offer.id}>
              <div className="retailer-offer-image">{offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" /> : <PackageSearch size={25} />}</div>
              <div className="retailer-offer-body"><div className="retailer-offer-kicker"><span>{offer.retailer}</span><span>ONLINE</span></div><h4>{offer.title}</h4>{offer.styleCode && <small>Style / SKU: {offer.styleCode}</small>}{offer.price !== undefined && <div className="retailer-offer-price"><strong>{money(offer.price, offer.currency)}</strong><span>{offer.priceLabel ?? "Displayed price"}</span></div>}<p className="retailer-offer-stock"><span className="unknown-dot" />{offer.availabilityLabel}</p><a href={offer.url} target="_blank" rel="noreferrer">View online listing <ExternalLink size={12} /></a></div>
            </article>)}</div> : <div className="retailer-no-results"><strong>No matching online listings were returned.</strong><span>Check the source statuses above. Some retailers may not be configured, may not carry the style, or may have returned no exact model match.</span></div>}
            <p className="store-stock-disclaimer">These are online listings, not confirmed size-level stock. PCKT cached catalog data may be up to 24 hours old, even when the comparison itself is fresh. Open the retailer listing to verify the exact size and checkout status. Nearby physical store addresses are shown separately; they do not confirm that the searched item is stocked there.</p>
          </div>}
          {marketplaceStatus === "idle" && <div className="retailer-idle-hint">Enter a model above, then compare retailers. This does not run automatically or spend credits while you type.</div>}
        </section>

        <div className="location-strip">
          <div className="location-intro"><MapPin size={17} /><div><strong>Find sneaker retailers near a ZIP code</strong><span>See Nike, Foot Locker, Champs, JD Sports and other mapped store addresses.</span></div></div>
          <div className="location-actions"><input value={postalCode} onChange={(event) => { setPostalCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 5)); setStoreStatus("idle"); setStores([]); }} placeholder="ZIP code" aria-label="ZIP code" maxLength={5} /><select value={storeRadius} onChange={(event) => { setStoreRadius(event.target.value); setStoreStatus("idle"); setStores([]); }} aria-label="Search radius"><option value="5">5 miles</option><option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option><option value="100">100 miles</option></select><button className="map-link" type="button" onClick={() => void findNearbyStores()} disabled={storeStatus === "loading"}>{storeStatus === "loading" ? <span className="mini-spinner" /> : <MapPin size={14} />} Find stores</button></div>
        </div>
        {storeError && <div className="store-error">{storeError}</div>}
        {storeStatus === "loading" && <div className="store-results-loading">Searching nearby sneaker retailer locations…</div>}
        {storeStatus === "success" && <div className="nearby-store-panel"><div className="nearby-store-heading"><div><strong>{stores.length} nearby retailer {stores.length === 1 ? "location" : "locations"} found</strong><span>Within {storeRadius} miles of {postalCode}</span></div><button type="button" onClick={() => setStoreStatus("idle")}>Hide</button></div>{stores.length === 0 ? <p className="store-empty">No supported sneaker-retailer locations were found in the public map directory within this radius. Try a larger distance.</p> : <div className="nearby-store-grid">{stores.map((store) => <article className="nearby-store-card" key={store.id}><div className="nearby-store-top"><strong>{store.name}</strong><span>{store.distanceMiles.toFixed(1)} mi</span></div><div className="store-type">{store.storeType}</div><p>{store.address}</p><a href={store.mapUrl} target="_blank" rel="noreferrer">Directions <ExternalLink size={11} /></a></article>)}</div>}<p className="store-stock-disclaimer">Retailer locations are sourced from OpenStreetMap and may be incomplete. Distances are straight-line estimates from the ZIP-code centroid, not driving distances. These locations do not confirm the searched product or size is in stock. Contact the store or use its pickup flow to verify.</p></div>}
      </section>

      <section className="results-section" id="watchlist">
        <div className="results-topline">
          <div className="tabs" role="tablist" aria-label="Product views">
            <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "tab-active" : ""} onClick={() => setTab("search")}>Search results <span>{tab === "search" ? visibleProducts.length : products.length}</span></button>
            <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "tab-active" : ""} onClick={() => setTab("saved")}>Saved watchlist <span>{saved.length}</span></button>
          </div>
          <label className="sort-inline"><span>SORT BY</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="relevance">Relevance</option><option value="price-low">Price: low to high</option><option value="discount">Biggest discount</option></select></label>
        </div>

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

        {searchStatus === "success" && tab === "search" && visibleProducts.length === 0 && <div className="empty-state"><div className="empty-icon"><Search size={26} /></div><h3>{products.length === 0 ? "No matching products were returned." : "No products match these filters."}</h3><p>{products.length === 0 ? "Unrelated Nike recommendations are filtered out. Try a shorter model name or search by the style code from the product tag." : "The base product search is saved. Change the audience, size, product type, or sale-only filter above; changing filters does not make another catalog search."}</p>{products.length === 0 && <a href={`https://www.nike.com/w?q=${encodeURIComponent(query)}`} target="_blank" rel="noreferrer">Search this term on Nike.com <ExternalLink size={13} /></a>}</div>}

        {tab === "saved" && visibleProducts.length === 0 && <div className="empty-state"><div className="empty-icon"><Heart size={25} /></div><h3>Your watchlist is empty.</h3><p>Save products from search results to keep them together and track their price history when Neon is connected.</p><button className="text-action" onClick={() => setTab("search")}>Back to product search <ArrowRight size={14} /></button></div>}

        {visibleProducts.length > 0 && <div className="product-grid">
          {visibleProducts.map((product, index) => {
            const isSaved = savedUrls.has(product.url);
            const sizes = sizesForDisplay(product, sizeDetails, sizeDetailsCheckedAt);
            const hasDiscount = productIsOnSale(product);
            return <article className="product-card" key={product.url}>
              <div className="product-image-wrap">
                <span className="product-index">{String(index + 1).padStart(2, "0")}</span>
                {hasDiscount && <span className="discount-badge">{product.discountPercent ? `-${product.discountPercent}%` : "SALE"}</span>}
                <button className={`save-button ${isSaved ? "is-saved" : ""}`} onClick={() => void toggleSaved(product)} aria-label={isSaved ? "Remove from watchlist" : "Save to watchlist"}><Heart size={17} fill={isSaved ? "currentColor" : "none"} /></button>
                {product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : <div className="image-placeholder"><PackageSearch size={35} /><span>NIKE PRODUCT</span></div>}
              </div>
              <div className="product-info">
                <div className="product-kicker">{categoryOf(product).toUpperCase()} · {audienceOf(product).toUpperCase()}{product.sizeSystem === "youth" ? " · YOUTH SIZING" : ""} {product.styleCode ? `· ${product.styleCode}` : ""}</div>
                <h3>{product.title}</h3>
                {product.subtitle && <p className="product-subtitle">{product.subtitle}</p>}
                <div className="price-row"><strong>{money(product.price, product.currency)}</strong>{product.fullPrice && product.price && product.fullPrice > product.price && <><del>{money(product.fullPrice, product.currency)}</del><span className="savings">Save {money(product.fullPrice - product.price, product.currency)}</span></>}</div>
                {sizes.length > 0 && <div className="size-list"><span>ONLINE SIZE STATUS · GREEN PROVIDER REPORTS AVAILABLE · STRUCK THROUGH UNAVAILABLE · GRAY UNVERIFIED</span><div>{sizes.slice(0, 7).map((size, sizeIndex) => <span key={`${size.label}-${sizeIndex}`} className={size.available === true ? "size-available" : size.available === false ? "size-unavailable" : "size-unverified"} title={size.available === true ? `${size.label}: online shipping marked available` : size.available === false ? `${size.label}: online shipping marked unavailable` : `${size.label}: size listed, stock status not verified${size.status ? ` (source status: ${size.status})` : ""}`}>{size.label}</span>)}{sizes.length > 7 && <small>+{sizes.length - 7}</small>}</div></div>}
                <div className="product-actions">
                  <a className="pickup-button" href={pickupUrl(product)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open product page</a>
                  <button className="sizes-button" onClick={() => void loadSizes(product, false, Boolean(sizeDetailsCheckedAt[product.url]))} disabled={loadingSizes === product.url}>{loadingSizes === product.url ? <span className="mini-spinner" /> : <ArrowDownUp size={14} />} {sizeDetailsCheckedAt[product.url] ? "Refresh sizes" : "Check sizes"}</button>
                </div>
                <div className="availability-note"><ShieldCheck size={13} /><span>{availabilityMessage(product, sizes, sizeFilter, sizeDetailsCheckedAt[product.url])}</span></div>
              </div>
            </article>;
          })}
        </div>}

        {tab === "search" && searchStatus === "success" && products.length > 0 && <div className="bottom-note"><Sparkles size={15} /><span>One unfiltered product search is cached in Neon. Gender, size and sale-only changes are applied locally without repeating the search. Size availability is checked only on request and cached in Neon for one hour to conserve API credits; it is not store pickup inventory.</span></div>}
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
