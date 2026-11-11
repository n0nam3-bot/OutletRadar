"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, ExternalLink, Heart,
  PackageSearch, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Tag, X,
} from "lucide-react";
import { audienceSystem, catalogAudience, catalogColorsOf, catalogFilterEvaluation, quoteSystem } from "@/lib/catalog-filters";
import { matchSizeLabel, parseSizeQuery, type SizeSystem } from "@/lib/size-match";
import { urlQuery } from "@/lib/query-normalize";
import { describeSearch, loadSavedSearches, persistSavedSearches, priceSnapshot, productKey, summarizePriceChanges, upsertSavedSearch, type PriceChangeSummary, type SavedSearch, type SearchCriteria } from "@/lib/saved-searches";
import type { CatalogBrowseCategory, CatalogBrowseProduct, MarketplaceOffer, MarketplaceSizeQuote, MarketplaceSourceStatus, NikeProduct, ProductSize } from "@/lib/types";

type Tab = "search" | "saved";
type Category = "All" | "Shoes" | "Apparel" | "Accessories" | "Other";
type Status = "idle" | "loading" | "success" | "error";

const SUGGESTED_SEARCHES = ["Air Max 90", "Dunk Low", "Vomero 5", "Tech Fleece"];
const CATALOG_TYPES: Array<{ value: CatalogBrowseCategory; label: string }> = [
  { value: "all", label: "All products" },
  { value: "sneakers", label: "Sneakers & shoes" },
  { value: "apparel", label: "Apparel" },
  { value: "accessories", label: "Accessories" },
];
const CATALOG_BRANDS = [
  { value: "all", label: "All brands" }, { value: "jordan", label: "Jordan" }, { value: "nike", label: "Nike" },
  { value: "adidas", label: "Adidas" }, { value: "new balance", label: "New Balance" }, { value: "asics", label: "ASICS" },
  { value: "puma", label: "Puma" }, { value: "converse", label: "Converse" }, { value: "reebok", label: "Reebok" },
  { value: "vans", label: "Vans" }, { value: "yeezy", label: "Yeezy" }, { value: "hoka", label: "HOKA" },
  { value: "on running", label: "On Running" }, { value: "crocs", label: "Crocs" }, { value: "salomon", label: "Salomon" },
  { value: "timberland", label: "Timberland" }, { value: "underarmour", label: "Under Armour" },
];
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
    title: String(row.title ?? "Saved product"),
    styleCode: typeof row.style_code === "string" ? row.style_code : undefined,
    url: String(row.product_url),
    imageUrl: typeof row.image_url === "string" ? row.image_url : undefined,
    price: typeof row.current_price === "number" ? row.current_price : row.current_price ? Number(row.current_price) : undefined,
    fullPrice: typeof row.full_price === "number" ? row.full_price : row.full_price ? Number(row.full_price) : undefined,
    discountPercent: typeof row.discount_percent === "number" ? row.discount_percent : undefined,
    currency: typeof row.currency === "string" ? row.currency : "USD",
    gender: typeof (row.product_gender ?? row.gender) === "string" ? (row.product_gender ?? row.gender) as NikeProduct["gender"] : "Unknown",
    category: typeof (row.product_category ?? row.category) === "string" ? (row.product_category ?? row.category) as NikeProduct["category"] : "Other",
  };
}

function toWatchlistProduct(product: CatalogBrowseProduct): NikeProduct | null {
  const url = product.listings[0]?.url;
  if (!url) return null;
  const category: NikeProduct["category"] = product.category === "sneakers" ? "Shoes" : product.category === "apparel" ? "Apparel" : product.category === "accessories" ? "Accessories" : "Other";
  const discountPercent = product.price && product.originalPrice && product.originalPrice > product.price
    ? Math.round((1 - product.price / product.originalPrice) * 100) : undefined;
  return {
    id: product.id, title: product.title, subtitle: product.brand, styleCode: product.styleCode,
    url, imageUrl: product.imageUrl, price: product.price, fullPrice: product.originalPrice,
    currency: product.currency || "USD", discountPercent, gender: product.gender || "Unknown",
    category, onSale: product.onSale,
    sizes: (product.sizes ?? []).map((label) => ({ label, available: null, status: "Catalog size label; stock not verified" })),
  };
}

function ProductImageFrame({ sources, alt, className, badge }: { sources: Array<string | undefined>; alt: string; className: string; badge?: string }) {
  const candidates = [...new Set(sources.filter((value): value is string => Boolean(value)))];
  const candidateKey = candidates.join("|");
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidateKey]);
  const current = candidates[index];
  return (
    <div className={className}>
      {current ? <img src={current} alt={alt} loading="lazy" decoding="async" onError={() => setIndex((value) => Math.min(value + 1, candidates.length))} /> : <div className="image-unavailable"><PackageSearch size={27} /><span>Image unavailable</span></div>}
      {badge && <span className="catalog-sale-badge">{badge}</span>}
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [marketplaceOffers, setMarketplaceOffers] = useState<MarketplaceOffer[]>([]);
  const [marketplaceSources, setMarketplaceSources] = useState<Array<MarketplaceSourceStatus & { key?: string }>>([]);
  const [marketplaceStatus, setMarketplaceStatus] = useState<Status>("idle");
  const [marketplaceError, setMarketplaceError] = useState("");
  const [marketplaceCachedAt, setMarketplaceCachedAt] = useState<string | null>(null);
  const [catalogType, setCatalogType] = useState<CatalogBrowseCategory>("sneakers");
  const [catalogBrand, setCatalogBrand] = useState("all");
  const [catalogGender, setCatalogGender] = useState("all");
  const [catalogReleaseYear, setCatalogReleaseYear] = useState("");
  const [catalogSize, setCatalogSize] = useState("");
  const [catalogColor, setCatalogColor] = useState("");
  const [catalogMinPrice, setCatalogMinPrice] = useState("");
  const [catalogMaxPrice, setCatalogMaxPrice] = useState("");
  const [catalogSaleOnly, setCatalogSaleOnly] = useState(false);
  // Saved searches live in this browser only (see lib/saved-searches.ts).
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSavedSearchId, setActiveSavedSearchId] = useState<string | null>(null);
  const [pendingSavedRun, setPendingSavedRun] = useState(false);
  const [savedSearchChanges, setSavedSearchChanges] = useState<(PriceChangeSummary & { label: string; since?: string }) | null>(null);
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogBrowseProduct[]>([]);
  const [catalogSizeQuotes, setCatalogSizeQuotes] = useState<Record<string, MarketplaceSizeQuote[]>>({});
  const [catalogSizeQuoteSources, setCatalogSizeQuoteSources] = useState<Array<{ name: string; status: string; message: string }>>([]);
  const [activeCompareProduct, setActiveCompareProduct] = useState<CatalogBrowseProduct | null>(null);
  const [marketplaceSizeQuotes, setMarketplaceSizeQuotes] = useState<MarketplaceSizeQuote[]>([]);
  const [marketplaceSizeStatus, setMarketplaceSizeStatus] = useState<Status>("idle");
  const [marketplaceSizeSources, setMarketplaceSizeSources] = useState<Array<{ name: string; status: string; message: string }>>([]);
  const [catalogSources, setCatalogSources] = useState<Array<MarketplaceSourceStatus & { key?: string }>>([]);
  const [catalogStatus, setCatalogStatus] = useState<Status>("idle");
  const [catalogError, setCatalogError] = useState("");
  const [catalogCachedAt, setCatalogCachedAt] = useState<string | null>(null);
  // Set when the answer is incomplete (a provider is out of free lookups, paused, or only saved data is shown).
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  // Optional tip page (from /api/health?light=1). Tips are voluntary and processed by the tip service.
  const [tipUrl, setTipUrl] = useState<string | null>(null);

  // Reports an outbound click for the owner's anonymous daily counts. The link stays a normal
  // direct link; this runs in the background and never delays or blocks navigation.
  function trackOfferClick(offer: { source: string; retailer: string; url: string; title: string; brand?: string }) {
    try {
      const body = JSON.stringify({ source: offer.source, retailer: offer.retailer, url: offer.url, title: activeCompareProduct?.title ?? offer.title, brand: activeCompareProduct?.brand ?? offer.brand ?? "" });
      const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/click", new Blob([body], { type: "application/json" }));
      if (!sent) void fetch("/api/click", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch { /* tracking is best-effort */ }
  }
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
  const lastCompareScrollIdRef = useRef<string | null>(null);
  const activeCompareProductId = activeCompareProduct?.id;

  // Re-render when availability cache entries age out so stale green/red states
  // become unverified even when the user leaves the page open.
  useEffect(() => {
    const timer = window.setInterval(() => setAvailabilityClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Expand the comparison inside the selected product card, then bring that card into view.
  useEffect(() => {
    if (!activeCompareProductId) {
      lastCompareScrollIdRef.current = null;
      return;
    }
    if (lastCompareScrollIdRef.current === activeCompareProductId) return;
    lastCompareScrollIdRef.current = activeCompareProductId;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(`catalog-offers-${activeCompareProductId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCompareProductId]);

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
      fetch("/api/health?light=1").then((response) => response.json()).then((health) => {
        setProviderConfigured(Boolean(health.productSearchConfigured));
        setDatabaseConfigured(Boolean(health.databaseConfigured));
        setTipUrl(typeof health.tipUrl === "string" && health.tipUrl.startsWith("https://") ? health.tipUrl : null);
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

  // One control decides the size scale: the GENDER dropdown (a marker typed in the size box, such as "W 8" or "5Y", wins).
  const catalogSizeSystem: SizeSystem = catalogGender === "women" ? "women" : catalogGender === "kids" ? "youth" : "men";
  const activeSizeQuery = useMemo(() => (catalogSize.trim() ? parseSizeQuery(catalogSize, catalogSizeSystem) : null), [catalogSize, catalogSizeSystem]);
  const catalogFilters = useMemo(() => ({
    gender: catalogGender,
    releaseYear: catalogReleaseYear,
    size: catalogSize,
    sizeSystem: catalogSizeSystem,
    color: catalogColor,
    minPrice: catalogMinPrice,
    maxPrice: catalogMaxPrice,
    saleOnly: catalogSaleOnly,
  }), [catalogGender, catalogReleaseYear, catalogSize, catalogSizeSystem, catalogColor, catalogMinPrice, catalogMaxPrice, catalogSaleOnly]);

  const catalogEvaluated = useMemo(() => catalogProducts
    .map((product) => ({ product, evaluation: catalogFilterEvaluation(product, catalogFilters, catalogSizeQuotes[product.id] ?? []) }))
    .filter(({ evaluation }) => evaluation.keep)
    .sort((a, b) =>
      b.evaluation.matched - a.evaluation.matched ||
      // With a size selected: products with a verified price for that size first, cheapest size price first.
      Number(b.evaluation.size?.state === "verified") - Number(a.evaluation.size?.state === "verified") ||
      (a.evaluation.size?.price ?? Infinity) - (b.evaluation.size?.price ?? Infinity) ||
      a.product.title.localeCompare(b.product.title)),
  [catalogProducts, catalogFilters, catalogSizeQuotes]);
  const catalogVisibleProducts = useMemo(() => catalogEvaluated.map(({ product }) => product), [catalogEvaluated]);
  const catalogSizeInfo = useMemo(() => new Map(catalogEvaluated.map(({ product, evaluation }) => [product.id, evaluation] as const)), [catalogEvaluated]);

  // In Compare offers with a size selected: sellers with a verified ask for that size first (cheapest first),
  // then sellers that list the size, then the rest.
  const marketplaceOffersOrdered = useMemo(() => {
    if (!activeSizeQuery) return marketplaceOffers;
    const brand = activeCompareProduct?.brand ?? "";
    const fallback = audienceSystem(activeCompareProduct ? catalogAudience(activeCompareProduct) : "");
    const rank = (offer: (typeof marketplaceOffers)[number]) => {
      const quotes = marketplaceSizeQuotes.filter((quote) => quote.source === offer.source && matchSizeLabel(quote.label, activeSizeQuery, brand, quoteSystem(quote.sizeSystem)));
      const verified = quotes.filter((quote) => quote.available === true && typeof quote.price === "number").map((quote) => quote.price as number);
      if (verified.length) return { tier: 0, price: Math.min(...verified) };
      const listed = (offer.sizes ?? []).some((label) => matchSizeLabel(label, activeSizeQuery, brand, fallback)) || quotes.some((quote) => quote.available !== false);
      return { tier: listed ? 1 : 2, price: offer.price ?? Infinity };
    };
    return [...marketplaceOffers].sort((a, b) => { const left = rank(a); const right = rank(b); return left.tier - right.tier || left.price - right.price; });
  }, [marketplaceOffers, marketplaceSizeQuotes, activeSizeQuery, activeCompareProduct]);

  // ---- Saved searches (browser-only) ----
  useEffect(() => { setSavedSearches(loadSavedSearches(typeof window === "undefined" ? null : window.localStorage)); }, []);

  // Lowest relevant price per visible product: the selected size's verified price when there is one.
  const catalogTrackedPrices = useMemo(() => catalogEvaluated.flatMap(({ product, evaluation }) => {
    const sizePrice = evaluation.size?.state === "verified" ? evaluation.size.price : undefined;
    const candidates = [sizePrice, ...(sizePrice === undefined ? [product.price, ...(product.listings ?? []).map((listing) => listing.price)] : [])]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
    return candidates.length ? [{ key: productKey(product), title: product.title, price: Math.min(...candidates) }] : [];
  }), [catalogEvaluated]);

  function currentCriteria(): SearchCriteria {
    return { query: query.trim(), type: catalogType, brand: catalogBrand, gender: catalogGender, releaseYear: catalogReleaseYear.trim(), size: catalogSize.trim(), sizeChoice: "auto" as const, color: catalogColor.trim(), minPrice: catalogMinPrice.trim(), maxPrice: catalogMaxPrice.trim(), saleOnly: catalogSaleOnly };
  }

  function saveCurrentSearch() {
    const criteria = currentCriteria();
    if (criteria.query.length < 2) return;
    const next = upsertSavedSearch(savedSearches, criteria, priceSnapshot(catalogTrackedPrices));
    setSavedSearches(next);
    const stored = persistSavedSearches(window.localStorage, next);
    setMessage(stored ? "Search saved on this device. Run it again from Watchlist to see price changes." : "Could not save the search: this browser blocked local storage.");
  }

  function runSavedSearch(saved: SavedSearch) {
    setTab("search");
    setQuery(saved.query); setCatalogType(saved.type as CatalogBrowseCategory); setCatalogBrand(saved.brand); setCatalogGender(saved.gender === "all" && saved.sizeChoice === "women" ? "women" : saved.gender === "all" && saved.sizeChoice === "youth" ? "kids" : saved.gender === "all" && saved.sizeChoice === "men" ? "men" : saved.gender);
    setCatalogReleaseYear(saved.releaseYear); setCatalogSize(saved.size); setCatalogColor(saved.color);
    setCatalogMinPrice(saved.minPrice); setCatalogMaxPrice(saved.maxPrice); setCatalogSaleOnly(saved.saleOnly);
    setSavedSearchChanges(null);
    setActiveSavedSearchId(saved.id);
    setPendingSavedRun(true);
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
  }

  function deleteSavedSearch(id: string) {
    const next = savedSearches.filter((item) => item.id !== id);
    setSavedSearches(next);
    persistSavedSearches(window.localStorage, next);
  }

  // Runs the saved search once the restored filters are in state (effects see the updated values).
  useEffect(() => {
    if (!pendingSavedRun) return;
    setPendingSavedRun(false);
    void browseCatalog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSavedRun]);

  // After a saved search finishes loading (size prices arrive a moment later), report price changes
  // against its previous snapshot, then store the new snapshot.
  useEffect(() => {
    if (!activeSavedSearchId || catalogStatus !== "success") return;
    const timer = window.setTimeout(() => {
      const saved = savedSearches.find((item) => item.id === activeSavedSearchId);
      if (!saved) { setActiveSavedSearchId(null); return; }
      const summary = summarizePriceChanges(saved.prices, catalogTrackedPrices);
      setSavedSearchChanges({ ...summary, label: describeSearch(saved), since: saved.lastRunAt });
      const next = upsertSavedSearch(savedSearches, currentCriteria(), priceSnapshot(catalogTrackedPrices));
      setSavedSearches(next);
      persistSavedSearches(window.localStorage, next);
      setActiveSavedSearchId(null);
    }, 2500);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSavedSearchId, catalogStatus, catalogTrackedPrices]);

  const savedDropByKey = useMemo(() => new Map((savedSearchChanges?.drops ?? []).map((drop) => [drop.key, drop] as const)), [savedSearchChanges]);

  const catalogUnverifiedFilterCount = useMemo(() => catalogProducts.filter(
    (product) => !catalogFilterEvaluation(product, catalogFilters, catalogSizeQuotes[product.id] ?? []).keep && catalogFilterEvaluation(product, catalogFilters, catalogSizeQuotes[product.id] ?? []).unknown.length > 0,
  ).length, [catalogProducts, catalogFilters, catalogSizeQuotes]);


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

  async function browseCatalog() {
    const term = query.trim();
    if (term.length < 2) {
      setCatalogError("Enter at least two characters describing the product you are hunting for.");
      setCatalogStatus("error");
      return;
    }
    if (catalogReleaseYear.trim() && !/^(19|20)\d{2}$/.test(catalogReleaseYear.trim())) {
      setCatalogError("Enter a complete four-digit release year, or leave the year blank.");
      setCatalogStatus("error");
      return;
    }
    setCatalogStatus("loading");
    setCatalogError("");
    setCatalogNotice(null);
    setActiveCompareProduct(null);
    setMarketplaceOffers([]);
    setMarketplaceSources([]);
    setMarketplaceStatus("idle");
    setMarketplaceError("");
    setMarketplaceCachedAt(null);
    setMarketplaceSizeQuotes([]);
    setMarketplaceSizeStatus("idle");
    setCatalogSizeQuotes({});
    setCatalogSizeQuoteSources([]);
    try {
      const params = new URLSearchParams({ category: catalogType, brand: catalogBrand, gender: catalogGender });
      if (query.trim()) params.set("q", urlQuery(query));
      if (catalogReleaseYear.trim()) params.set("releaseYear", catalogReleaseYear.trim());
      const response = await fetch(`/api/catalog?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Catalog browse failed.");
      const discovered = Array.isArray(data.products) ? data.products as CatalogBrowseProduct[] : [];
      setCatalogProducts(discovered);
      setCatalogSources(Array.isArray(data.sources) ? data.sources : []);
      setCatalogCachedAt(data.cachedAt ? String(data.cachedAt) : null);
      setCatalogNotice(typeof data.notice === "string" && data.notice ? data.notice : null);
      setCatalogStatus("success");
      // Count this search for the owner's anonymous demand report. The search itself may have been answered by
      // the CDN, so the browser reports it; filters and lowercase search words only.
      try {
        const body = JSON.stringify({ q: urlQuery(query), category: catalogType, brand: catalogBrand, gender: catalogGender, releaseYear: catalogReleaseYear.trim(), results: discovered.length });
        if (!(typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/search-log", new Blob([body], { type: "application/json" })))) {
          void fetch("/api/search-log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
        }
      } catch { /* demand counting is best-effort */ }

      // A selected shoe size triggers one batched StockX and/or GOAT size-price
      // lookup (up to 20 product IDs per source), not one request per product.
      if (catalogSize.trim()) {
        const candidates = discovered.slice(0, 20).map((product) => ({
          catalogProductId: product.id,
          listings: (product.listings ?? []).filter((listing) => (listing.source === "stockx" || listing.source === "goat") && listing.providerProductId).map((listing) => ({
            source: listing.source, providerProductId: listing.providerProductId, url: listing.url, retailer: listing.retailer, gender: listing.gender && listing.gender !== "Unknown" ? listing.gender : product.gender,
          })),
        })).filter((product) => product.listings.length > 0);
        if (candidates.length) {
          try {
            const availabilityResponse = await fetch("/api/catalog/availability", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: catalogGender, products: candidates.map((product) => ({ ...product, audience: catalogGender })) }),
            });
            const availabilityData = await availabilityResponse.json();
            if (availabilityResponse.ok && Array.isArray(availabilityData.checks)) {
              const quoteMap: Record<string, MarketplaceSizeQuote[]> = {};
              for (const check of availabilityData.checks) if (check?.catalogProductId) quoteMap[String(check.catalogProductId)] = Array.isArray(check.quotes) ? check.quotes : [];
              setCatalogSizeQuotes(quoteMap);
              setCatalogSizeQuoteSources(Array.isArray(availabilityData.sources) ? availabilityData.sources : []);
            }
          } catch { /* Product discovery remains usable if size pricing is unavailable. */ }
        }
      }
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Catalog browse failed.");
      setCatalogStatus("error");
      setCatalogProducts([]);
    }
  }

  async function loadCatalogProductSizes(product: CatalogBrowseProduct) {
    setMarketplaceSizeStatus("loading");
    setMarketplaceSizeQuotes([]);
    setMarketplaceSizeSources([]);
    try {
      const response = await fetch("/api/catalog/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: catalogGender,
          catalogProduct: product,
          products: [{
            catalogProductId: product.id,
            audience: catalogGender,
            needsImage: !(product.imageUrl || (product.listings ?? []).some((listing) => listing.imageUrl)),
            listings: (product.listings ?? []).filter((listing) => (listing.source === "stockx" || listing.source === "goat" || listing.source === "flightclub") && listing.providerProductId).map((listing) => ({
              source: listing.source, providerProductId: listing.providerProductId, url: listing.url,
              retailer: listing.retailer, gender: listing.gender && listing.gender !== "Unknown" ? listing.gender : product.gender,
            })),
          }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not retrieve marketplace size data.");
      const check = Array.isArray(data.checks) ? data.checks.find((item: { catalogProductId?: string }) => item.catalogProductId === product.id) : null;
      const quotes = Array.isArray(check?.quotes) ? check.quotes as MarketplaceSizeQuote[] : [];
      setMarketplaceSizeQuotes(quotes);
      setCatalogSizeQuotes((current) => ({ ...current, [product.id]: quotes }));
      if (check?.imageUrl || (Array.isArray(check?.colors) && check.colors.length)) {
        const extraColors = Array.isArray(check.colors) ? check.colors.filter((value: unknown): value is string => typeof value === "string") : [];
        const mergeDetails = (current: CatalogBrowseProduct) => current.id === product.id ? {
          ...current,
          imageUrl: current.imageUrl || (typeof check.imageUrl === "string" ? check.imageUrl : undefined),
          colors: [...new Set([...(current.colors ?? []), ...extraColors])],
          color: current.color || extraColors[0],
        } : current;
        setActiveCompareProduct((current) => current ? mergeDetails(current) : current);
        setCatalogProducts((current) => current.map(mergeDetails));
      }
      setMarketplaceSizeSources(Array.isArray(data.sources) ? data.sources : []);
      setMarketplaceSizeStatus("success");
    } catch (caught) {
      setMarketplaceSizeStatus("error");
      setMarketplaceSizeSources([{ name: "Size-level marketplace data", status: "error", message: caught instanceof Error ? caught.message : "Size lookup failed." }]);
    }
  }

  async function compareCatalogProduct(product: CatalogBrowseProduct) {
    if (activeCompareProduct?.id === product.id) {
      setActiveCompareProduct(null);
      setMarketplaceStatus("idle");
      setMarketplaceOffers([]);
      setMarketplaceSources([]);
      setMarketplaceSizeQuotes([]);
      setMarketplaceSizeStatus("idle");
      return;
    }
    setActiveCompareProduct(product);
    setMarketplaceOffers([]);
    setMarketplaceSources([]);
    setMarketplaceStatus("loading");
    setMarketplaceError("");
    setMarketplaceCachedAt(null);
    setMarketplaceSizeQuotes([]);
    setMarketplaceSizeStatus("loading");
    setMarketplaceSizeSources([]);

    const comparisonRequest = fetch("/api/catalog/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, audience: catalogGender }),
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not compare this exact product.");
      setMarketplaceOffers(Array.isArray(data.offers) ? data.offers as MarketplaceOffer[] : []);
      setMarketplaceSources(Array.isArray(data.sources) ? data.sources as MarketplaceSourceStatus[] : []);
      setMarketplaceCachedAt(data.cachedAt ? String(data.cachedAt) : null);
      setMarketplaceStatus("success");
    }).catch((caught) => {
      setMarketplaceError(caught instanceof Error ? caught.message : "Could not compare this exact product.");
      setMarketplaceStatus("error");
    });

    // Size feeds are separate from catalog search and only run after the shopper
    // opens the comparison for this specific grouped product.
    await loadCatalogProductSizes(product);
    await comparisonRequest;
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
      if (!quiet && !sizes.length) setMessage("This product source returned no size-level inventory data. Availability is unverified.");
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
        <a className="brand-mark" href="#top" aria-label="Outlet Radar home">
          <span className="brand-icon">N</span>
          <span>OUTLET<span className="brand-light">RADAR</span></span>
        </a>
        <nav className="topnav" aria-label="Main navigation">
          <a href="#catalog">Catalog</a>
          <a className="nav-compare-link" href={activeCompareProduct ? `#catalog-offers-${activeCompareProduct.id}` : "#catalog"}>Compare</a>
          <a href="#watchlist" onClick={() => setTab("saved")}>Watchlist <span className="nav-count">{saved.length}</span></a>
        </nav>
        <div className="topbar-right"><span className="live-dot" /> MULTI-RETAILER SEARCH</div>
      </header>

      <section className="hero hero-hunt" id="top">
        <div className="hero-noise" />
        <div className="hero-hunt-inner">
          <div className="hero-hunt-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE HUNT STARTS HERE</div>
            <h1>What are you<br /><em>hunting for?</em></h1>
            <p className="hero-copy">Find the exact model, then compare its listings across retailers and marketplaces.</p>
          </div>
          <div className="hunt-panel">
            <form className="hunt-search-form" onSubmit={(event) => { event.preventDefault(); void browseCatalog(); }}>
              <div className="search-input-wrap"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try Jordan 4 Retro Bred, New Balance 9060, Samba OG…" aria-label="What are you hunting for?" autoComplete="off" minLength={2} required /><button type="button" className="clear-query" onClick={() => setQuery("")} aria-label="Clear search">{query ? <X size={17} /> : null}</button></div>
              <button className="search-button" type="submit" disabled={catalogStatus === "loading"}>{catalogStatus === "loading" ? <span className="spinner" /> : <Search size={17} />}<span>{catalogStatus === "loading" ? "Searching" : "Find it"}</span><ArrowRight size={17} /></button>
            </form>
            <div className="hunt-primary-filters hunt-primary-filters-v2">
              <label className="catalog-select-field"><span>ITEM TYPE</span><select value={catalogType} onChange={(event) => { setCatalogType(event.target.value as CatalogBrowseCategory); setCatalogStatus("idle"); setCatalogProducts([]); setCatalogSources([]); setCatalogCachedAt(null); }}>
                {CATALOG_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select></label>
              <label className="catalog-select-field"><span>BRAND</span><select value={catalogBrand} onChange={(event) => { setCatalogBrand(event.target.value); setCatalogStatus("idle"); setCatalogProducts([]); setCatalogSources([]); setCatalogCachedAt(null); }}>
                {CATALOG_BRANDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select></label>
              <label className="catalog-select-field"><span>GENDER</span><select value={catalogGender} onChange={(event) => setCatalogGender(event.target.value)}>
                {GENDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select></label>
              <label className="catalog-select-field"><span>RELEASE YEAR</span><input className="catalog-year-input" inputMode="numeric" maxLength={4} value={catalogReleaseYear} onChange={(event) => setCatalogReleaseYear(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Any year" /></label>
              <button type="button" className={`refine-toggle ${catalogFiltersOpen ? "refine-toggle-active" : ""}`} onClick={() => setCatalogFiltersOpen((value) => !value)}><SlidersHorizontal size={14} /> Filters {catalogFiltersOpen ? <X size={13} /> : <span className="refine-count">{[Boolean(catalogSize), Boolean(catalogColor), Boolean(catalogMinPrice || catalogMaxPrice), catalogSaleOnly].filter(Boolean).length || ""}</span>}</button>
            </div>
            {catalogFiltersOpen && <div className="hunt-advanced-filters">
              <label className="search-filter-field"><span>SIZE (US)</span><input value={catalogSize} onChange={(event) => setCatalogSize(event.target.value)} placeholder="e.g. 10.5, W 8 or 5Y" /></label>
              {catalogSize.trim() && <p className="catalog-size-help">{activeSizeQuery ? <>Looking for <strong>{activeSizeQuery.system === "women" ? "women\u2019s" : activeSizeQuery.system === "youth" ? "kids\u2019" : "men\u2019s"} US {activeSizeQuery.value}</strong>{activeSizeQuery.explicit ? " (from the size you typed)" : catalogGender === "all" ? " (GENDER is All, so sizes are read as men\u2019s; pick Women or Kids above, or type W 8 / 5Y)" : " (from GENDER)"}. </> : null}Press <strong>Apply refinements</strong> to check live prices for this size across marketplaces and retailers. Men&rsquo;s and women&rsquo;s sizes are converted only for Nike, Jordan, New Balance and adidas, and are labelled as converted.</p>}
              <label className="search-filter-field"><span>COLOR</span><input value={catalogColor} onChange={(event) => setCatalogColor(event.target.value)} placeholder="e.g. black, red" /></label>
              <label className="search-filter-field"><span>MIN PRICE ($)</span><input type="number" min="0" inputMode="decimal" value={catalogMinPrice} onChange={(event) => setCatalogMinPrice(event.target.value)} placeholder="No min" /></label>
              <label className="search-filter-field"><span>MAX PRICE ($)</span><input type="number" min="0" inputMode="decimal" value={catalogMaxPrice} onChange={(event) => setCatalogMaxPrice(event.target.value)} placeholder="No max" /></label>
              <button type="button" className={`sale-toggle search-sale-toggle ${catalogSaleOnly ? "sale-toggle-active" : ""}`} onClick={() => setCatalogSaleOnly((value) => !value)}><Tag size={15} /> Sale only <span className="toggle-switch"><span /></span></button>
              <button type="button" className="clear-refinements" onClick={() => { setCatalogSize(""); setCatalogColor(""); setCatalogMinPrice(""); setCatalogMaxPrice(""); setCatalogSaleOnly(false); }}>Clear refinements</button>
              <button type="button" className="apply-refinements" disabled={catalogStatus === "loading"} onClick={() => void browseCatalog()}>{catalogStatus === "loading" ? "Applying…" : "Apply refinements"}</button>
            </div>}
            <p className="hunt-note">Choose an item type, optional brand, audience and release year, then describe the model. Size, color, price and sale refine the results without starting a new provider search.</p>
          </div>
        </div>
      </section>

      <section className="catalog-explorer catalog-results-section" id="catalog" aria-label="Product catalog">
        <div className="catalog-results-heading">
          <div><div className="eyebrow dark-eyebrow">PRODUCT CATALOG</div><h2>{query.trim() ? `Matches for “${query.trim()}”` : "Explore products across brands."}</h2></div>
          <span className="catalog-result-count">{catalogStatus === "success" ? `${catalogVisibleProducts.length} of ${catalogProducts.length} matches` : "Marketplace catalog discovery"}</span>{catalogStatus === "success" && <button type="button" className="save-search-button" onClick={saveCurrentSearch}><Heart size={13} /> Save this search</button>}
        </div>
        {catalogError && <div className="store-error">{catalogError}</div>}
        {catalogStatus === "loading" && <div className="store-results-loading">Searching product catalogs across connected marketplaces…</div>}
        {catalogStatus === "idle" && <div className="catalog-explorer-empty"><strong>Start with an item type and model.</strong><span>Browse known models from connected catalogs, including older releases that the original brand may no longer sell.</span></div>}
        {catalogStatus === "success" && <div className="catalog-browser-results">
          {catalogNotice && <div className="catalog-incomplete-notice" role="status"><strong>Showing saved results</strong><span>{catalogNotice}</span></div>}
          {savedSearchChanges && <div className="saved-search-changes" role="status">
            <strong>{savedSearchChanges.drops.length ? `${savedSearchChanges.drops.length} price drop${savedSearchChanges.drops.length === 1 ? "" : "s"}` : "No price drops"} since {savedSearchChanges.since ? new Date(savedSearchChanges.since).toLocaleDateString() : "your last check"}</strong>
            <span>{savedSearchChanges.label} · compared {savedSearchChanges.compared} product{savedSearchChanges.compared === 1 ? "" : "s"}{savedSearchChanges.newProducts ? ` · ${savedSearchChanges.newProducts} new` : ""}{savedSearchChanges.rises.length ? ` · ${savedSearchChanges.rises.length} higher` : ""}</span>
            {savedSearchChanges.drops.slice(0, 5).map((drop) => <span key={drop.key}>↓ {drop.title}: {money(drop.from)} → <b>{money(drop.to)}</b></span>)}
          </div>}
          <div className="catalog-browser-meta"><strong>{catalogVisibleProducts.length} matching product{catalogVisibleProducts.length === 1 ? "" : "s"}</strong><span>{catalogCachedAt ? `Cached ${new Date(catalogCachedAt).toLocaleString()}` : "Fresh discovery"} · Offers are grouped by product model</span></div>
          {catalogUnverifiedFilterCount > 0 && <div className="catalog-filter-summary">{catalogUnverifiedFilterCount} products were excluded because provider data did not confirm the selected refinements. Clear a filter to broaden results.</div>}
          {catalogSizeQuoteSources.length > 0 && <div className="catalog-size-source-note">Size data: {catalogSizeQuoteSources.map((source) => `${source.name} — ${source.message}`).join(" · ")}</div>}
          {catalogSources.length > 0 && <details className="catalog-sources-details"><summary>Sources checked ({catalogSources.filter((source) => source.status === "success").length} successful)</summary><div className="retailer-source-grid">{catalogSources.map((source) => <div className="retailer-source-status" key={`${source.key ?? source.name}-${source.status}`}><strong>{source.name} · {source.status === "success" ? `${source.results} found` : source.status.replaceAll("_", " ")}</strong><span>{source.message}</span></div>)}</div></details>}
          {catalogVisibleProducts.length > 0 ? <div className="catalog-product-grid">{catalogVisibleProducts.map((product) => {
            const savedProduct = toWatchlistProduct(product);
            const isSaved = savedProduct ? savedUrls.has(savedProduct.url) : false;
            const sale = product.onSale === true || (product.price !== undefined && product.originalPrice !== undefined && product.originalPrice > product.price);
            const expanded = activeCompareProduct?.id === product.id;
            return <article className={`catalog-product-card ${expanded ? "catalog-product-card-expanded" : ""}`} key={product.id}>
              <ProductImageFrame className="catalog-product-image" alt={product.title} sources={[product.imageUrl, ...(product.listings ?? []).map((listing) => listing.imageUrl)]} badge={sale ? "SALE" : undefined} />
              <div className="catalog-product-body"><div className="catalog-product-brand">{product.brand} <span>{product.category.toUpperCase()}</span></div><h3>{product.title}</h3>
                {savedDropByKey.has(productKey(product)) && <div className="catalog-price-drop-badge">↓ {money((savedDropByKey.get(productKey(product))?.from ?? 0) - (savedDropByKey.get(productKey(product))?.to ?? 0))} since you last checked</div>}
                <div className="catalog-product-facts">{product.gender && product.gender !== "Unknown" ? product.gender : "Audience not listed"}{product.releaseYear ? ` · ${product.releaseYear}` : ""}{catalogColorsOf(product).length ? ` · ${catalogColorsOf(product).slice(0, 2).join(", ")}` : ""}</div>
                {catalogSize.trim() && activeSizeQuery && (() => {
                  const rows = catalogSizeInfo.get(product.id)?.sizeOffers ?? [];
                  if (!rows.length) return null;
                  const seller = (row: (typeof rows)[number]) => row.source === "stockx" ? "StockX" : row.source === "goat" ? "GOAT" : row.source === "flightclub" ? "Flight Club" : row.retailer ?? row.source ?? "Retailer";
                  const scale = activeSizeQuery.system === "women" ? "women\u2019s" : activeSizeQuery.system === "youth" ? "kids\u2019" : "men\u2019s";
                  return <div className="catalog-size-evidence">
                    <div className="catalog-size-head">Size {activeSizeQuery.value} · {scale} US · lowest price first</div>
                    {rows.slice(0, 5).map((row, index) => <div className={`catalog-size-row ${row.state === "verified" ? "is-verified" : ""} ${index === 0 ? "is-best" : ""}`} key={`${row.source}-${row.retailer}-${index}`}>
                      <strong>{typeof row.price === "number" ? money(row.price, row.currency || "USD") : "price n/a"}</strong>
                      <span>{seller(row)}{row.kind === "converted" ? ` · listed as ${row.label}, converted` : row.kind === "assumed" ? " · scale not stated" : ""}</span>
                      <em>{row.state === "verified" ? "✓ ask for this size" : "size listed · stock unconfirmed"}</em>
                    </div>)}
                    {rows.length > 5 && <small>+{rows.length - 5} more seller{rows.length - 5 === 1 ? "" : "s"} in Compare offers</small>}
                  </div>;
                })()}
                {!catalogSize.trim() && catalogSizeQuotes[product.id]?.some((quote) => quote.available === true) && <div className="catalog-verified-sizes">Size signals: {catalogSizeQuotes[product.id].filter((quote) => quote.available === true).slice(0, 5).map((quote) => `${quote.label} (${quote.source === "stockx" ? "StockX ask" : quote.retailer})`).join(" · ")}</div>}
                {product.price !== undefined && !(catalogSize.trim() && activeSizeQuery && (catalogSizeInfo.get(product.id)?.sizeOffers?.length ?? 0) > 0) && <div className="catalog-price-row"><strong>{money(product.price, product.currency || "USD")}</strong>{product.originalPrice && product.originalPrice > product.price && <del>{money(product.originalPrice, product.currency || "USD")}</del>}</div>}
                {product.styleCode && <small>Style / SKU: {product.styleCode}</small>}<div className="catalog-product-sources">{product.listings.length} retailer listing{product.listings.length === 1 ? "" : "s"} · {product.sources.join(" · ")}</div>
                <div className="catalog-card-actions"><button type="button" aria-expanded={expanded} aria-controls={`catalog-offers-${product.id}`} onClick={() => void compareCatalogProduct(product)}>{expanded ? "Hide offers" : "Compare offers"} <ArrowRight size={13} /></button>{savedProduct && <button type="button" className={`catalog-save-button ${isSaved ? "catalog-save-active" : ""}`} onClick={() => void toggleSaved(savedProduct)} aria-label={isSaved ? "Remove from watchlist" : "Save to watchlist"}><Heart size={15} fill={isSaved ? "currentColor" : "none"} /></button>}</div>
              </div>
              {expanded && <div className="catalog-inline-comparison" id={`catalog-offers-${product.id}`}>
                <div className="catalog-inline-head"><div><span className="eyebrow dark-eyebrow">EXACT PRODUCT OFFERS{catalogGender !== "all" ? ` · ${catalogGender.toUpperCase()}` : ""}</span><strong>{product.title}</strong><small>{product.brand}{product.styleCode ? ` · Style ${product.styleCode}` : ""}{product.releaseYear ? ` · ${product.releaseYear}` : ""}{catalogGender === "men" ? " · Adult men only; PS/GS/youth offers excluded" : catalogGender === "women" ? " · Adult women only; PS/GS/youth offers excluded" : catalogGender === "kids" ? " · Kids/youth sizing only" : ""}</small></div><button type="button" onClick={() => { setActiveCompareProduct(null); setMarketplaceOffers([]); setMarketplaceStatus("idle"); setMarketplaceSizeQuotes([]); setMarketplaceSizeStatus("idle"); }}>Close</button></div>
                {marketplaceError && <div className="store-error">{marketplaceError}</div>}
                {marketplaceSizeStatus === "error" && marketplaceSizeSources.map((source) => <div className="catalog-filter-summary" key={source.name}>{source.name}: {source.message}</div>)}
                {(marketplaceStatus === "loading" || marketplaceSizeStatus === "loading") && <div className="store-results-loading">Checking this product's grouped retailer listings and size feeds…</div>}
                {marketplaceStatus === "success" && <>
                  <div className="catalog-inline-meta"><strong>{marketplaceOffers.length} matching retailer offer{marketplaceOffers.length === 1 ? "" : "s"}</strong><span>{marketplaceCachedAt ? `Cached ${new Date(marketplaceCachedAt).toLocaleString()}` : "Fresh comparison"}</span></div>
                  {marketplaceOffers.length > 0 ? <div className="catalog-inline-offers">{marketplaceOffersOrdered.map((offer) => {
                    const quotes = marketplaceSizeQuotes.filter((quote) => quote.source === offer.source);
                    const quoteLabels = [...new Set(quotes.map((quote) => quote.label))];
                    const listedSizes = offer.sizes ?? [];
                    const productBrand = activeCompareProduct?.brand ?? offer.brand ?? "";
                    const fallbackSystem = audienceSystem(activeCompareProduct ? catalogAudience(activeCompareProduct) : "");
                    // With a size filter, show only that size. Other sizes are not listed.
                    const sizeQuotesForSelected = activeSizeQuery ? quotes.filter((quote) => matchSizeLabel(quote.label, activeSizeQuery, productBrand, quoteSystem(quote.sizeSystem))) : [];
                    const listedForSelected = activeSizeQuery ? listedSizes.filter((label) => matchSizeLabel(label, activeSizeQuery, productBrand, fallbackSystem)) : [];
                    const selectedScale = activeSizeQuery ? (activeSizeQuery.system === "women" ? "women\u2019s" : activeSizeQuery.system === "youth" ? "kids\u2019" : "men\u2019s") : "";
                    return <article className="catalog-inline-offer" key={offer.id}>
                      <div className="catalog-inline-offer-top"><strong>{offer.retailer}</strong><span>ONLINE LISTING</span></div>
                      <h4>{offer.title}</h4>
                      {offer.price !== undefined && <div className="catalog-inline-price">{money(offer.price, offer.currency)} <small>{offer.priceLabel ?? "Displayed price"}</small></div>}
                      {activeSizeQuery ? <div className="catalog-inline-sizes"><b>Size {activeSizeQuery.value} ({selectedScale} US)</b><div>{
                        sizeQuotesForSelected.length > 0 ? sizeQuotesForSelected.map((quote, index) => <span className={quote.available === true ? "is-available" : quote.available === false ? "is-unavailable" : "is-unknown"} key={`${quote.label}-${index}`}>{quote.label} · {quote.available === true ? "ask available" : quote.available === false ? "no ask" : "unverified"}{quote.price !== undefined ? ` · ${money(quote.price, quote.currency)}` : ""}</span>)
                        : listedForSelected.length > 0 ? <span className="is-unknown">{listedForSelected[0]} · listed by seller, stock not confirmed</span>
                        : <span className="is-unavailable">{quoteLabels.length > 0 || listedSizes.length > 0 ? "Not listed by this seller" : "This source did not provide size-level data"}</span>
                      }</div></div>
                      : quoteLabels.length > 0 ? <div className="catalog-inline-sizes"><b>Marketplace size signals</b><div>{quotes.slice(0, 18).map((quote, index) => <span className={quote.available === true ? "is-available" : quote.available === false ? "is-unavailable" : "is-unknown"} key={`${quote.label}-${index}`}>{quote.label} · {quote.available === true ? "signal" : quote.available === false ? "no ask" : "unverified"}{quote.price !== undefined ? ` · ${money(quote.price, quote.currency)}` : ""}</span>)}</div></div> : listedSizes.length > 0 ? <div className="catalog-inline-sizes"><b>Sizes listed by seller (stock not confirmed)</b><div>{listedSizes.slice(0, 18).map((size) => <span className="is-unknown" key={size}>{size}</span>)}</div></div> : <p className="catalog-inline-no-sizes">This source did not provide size-level data.</p>}
                      <p className="catalog-inline-stock">{offer.availabilityLabel}</p>
                      <a className="catalog-inline-link" href={offer.url} target="_blank" rel="noreferrer" onClick={() => trackOfferClick(offer)}>Open this exact listing <ExternalLink size={12} /></a>
                      {offer.affiliate && <small className="catalog-affiliate-note">Affiliate link: Outlet Radar may earn a commission at no cost to you.</small>}
                    </article>;
                  })}</div> : <div className="retailer-no-results"><strong>No exact retailer listings passed the product match.</strong><span>We do not show similar models as offers. The product remains in the catalog; check back later or use the original catalog listings if a seller changes its title.</span></div>}
                  {marketplaceSources.length > 0 && <details className="catalog-sources-details"><summary>Retailers checked</summary><div className="retailer-source-grid">{marketplaceSources.map((source) => <div className="retailer-source-status" key={`${source.key ?? source.name}-${source.status}`}><strong>{source.name} · {source.status === "success" ? `${source.results} found` : source.status.replaceAll("_", " ")}</strong><span>{source.message}</span></div>)}</div></details>}
                  <p className="store-stock-disclaimer">A retailer listing is not a guarantee that every size is in stock. Check the seller's selected size and checkout page before purchasing.</p>
                </>}
              </div>}
            </article>;
          })}</div> : <div className="catalog-explorer-empty"><strong>No products match those filters.</strong><span>Try clearing size, color, price or sale refinements. A product is excluded when its available catalog data does not confirm the selected attribute.</span></div>}
          <p className="catalog-disclaimer">Each card represents a product model. Compare offers opens only listings that pass the selected model's match checks, with direct links to the seller's product page.</p>
          {tipUrl && <div className="support-line">
            <span>Free to use, no account needed. If it saved you money, you can leave an optional tip to help cover hosting and data costs.</span>
            <a className="support-button" href={tipUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackOfferClick({ source: "tip", retailer: "Tip jar", url: tipUrl, title: "Tip link" })}>Leave a tip</a>
            <a className="support-more" href="/support">How tips are used</a>
          </div>}
        </div>}
      </section>

      <section className="watchlist-section" id="watchlist">
        <div className="watchlist-heading"><div><div className="eyebrow dark-eyebrow">YOUR SAVED FINDS</div><h2>Watchlist</h2></div><span>{saved.length} saved</span></div>
        {message && <div className="toast-message"><Check size={15} /> {message}</div>}
        <div className="saved-searches">
          <h3>Saved searches</h3>
          {savedSearches.length ? <ul>{savedSearches.map((saved) => <li key={saved.id}>
            <div><strong>{describeSearch(saved)}</strong><small>{saved.lastRunAt ? `Last checked ${new Date(saved.lastRunAt).toLocaleDateString()}` : "Not checked yet"} · {Object.keys(saved.prices).length} product{Object.keys(saved.prices).length === 1 ? "" : "s"} tracked</small></div>
            <div className="saved-search-actions"><button type="button" onClick={() => runSavedSearch(saved)}>Run &amp; check prices</button><button type="button" onClick={() => deleteSavedSearch(saved.id)} aria-label="Delete saved search"><X size={13} /></button></div>
          </li>)}</ul> : <p>No saved searches yet. Run a search, then press <strong>Save this search</strong>. Saved searches stay in this browser; running one compares today&rsquo;s prices with the last time you checked.</p>}
        </div>
        {saved.length ? <div className="watchlist-grid">{saved.map((product) => <article className="watchlist-card" key={product.url}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={26} />}<div><strong>{product.title}</strong><small>{product.subtitle || product.styleCode || "Saved product"}</small><span>{money(product.price, product.currency)}</span><a href={product.url} target="_blank" rel="noreferrer">Open listing <ExternalLink size={11} /></a></div><button type="button" onClick={() => void toggleSaved(product)} aria-label="Remove from watchlist"><X size={15} /></button></article>)}</div> : <div className="catalog-explorer-empty"><strong>No saved products yet.</strong><span>Save a model from the catalog using its bookmark icon.</span></div>}
      </section>

      <footer className="footer"><div className="footer-brand">OUTLET<span>RADAR</span></div><div className="footer-copy">Independent product-discovery and price-comparison platform. Not affiliated with or endorsed by the brands, retailers or marketplaces displayed. Outlet Radar may earn commissions from qualifying purchases.</div><div className="footer-links">{tipUrl && <a href="/support">Support</a>}<a href="/privacy">Privacy</a><a href="/disclosure">Affiliate disclosure</a><a href="#catalog">Browse catalog</a><a className="nav-compare-link" href={activeCompareProduct ? `#catalog-offers-${activeCompareProduct.id}` : "#catalog"}>Compare</a></div></footer>
    </main>
  );
}
