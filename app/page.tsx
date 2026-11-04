"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, ExternalLink, Heart,
  MapPin, PackageSearch, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Tag, X,
} from "lucide-react";
import type { CatalogBrowseCategory, CatalogBrowseProduct, MarketplaceOffer, MarketplaceSourceStatus, NearbyStore, NikeProduct, ProductSize } from "@/lib/types";

type Tab = "search" | "saved";
type Category = "All" | "Shoes" | "Apparel" | "Accessories" | "Other";
type Status = "idle" | "loading" | "success" | "error";

const SUGGESTED_SEARCHES = ["Air Max 90", "Dunk Low", "Vomero 5", "Tech Fleece"];
const CATALOG_TYPES: Array<{ value: CatalogBrowseCategory; label: string }> = [
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
  const [catalogType, setCatalogType] = useState<CatalogBrowseCategory>("sneakers");
  const [catalogBrand, setCatalogBrand] = useState("all");
  const [catalogGender, setCatalogGender] = useState("all");
  const [catalogSize, setCatalogSize] = useState("");
  const [catalogColor, setCatalogColor] = useState("");
  const [catalogMinPrice, setCatalogMinPrice] = useState("");
  const [catalogMaxPrice, setCatalogMaxPrice] = useState("");
  const [catalogSaleOnly, setCatalogSaleOnly] = useState(false);
  const [catalogFiltersOpen, setCatalogFiltersOpen] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogBrowseProduct[]>([]);
  const [catalogSources, setCatalogSources] = useState<Array<MarketplaceSourceStatus & { key?: string }>>([]);
  const [catalogStatus, setCatalogStatus] = useState<Status>("idle");
  const [catalogError, setCatalogError] = useState("");
  const [catalogCachedAt, setCatalogCachedAt] = useState<string | null>(null);
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

  const catalogVisibleProducts = useMemo(() => {
    let result = [...catalogProducts];
    if (catalogGender !== "all") result = result.filter((product) => {
      const audience = (product.gender ?? "Unknown").toLowerCase();
      if (catalogGender === "men" || catalogGender === "women") return audience === catalogGender || audience === "unisex";
      return audience === catalogGender;
    });
    const wantedSize = normalizeSizeText(catalogSize);
    if (wantedSize) result = result.filter((product) => (product.sizes ?? []).some((size) => normalizeSizeText(size) === wantedSize || normalizeSizeText(size).startsWith(`${wantedSize} `)));
    const wantedColor = catalogColor.trim().toLowerCase();
    if (wantedColor) result = result.filter((product) => [product.color, ...(product.colors ?? [])].filter(Boolean).some((color) => String(color).toLowerCase().includes(wantedColor)));
    const min = catalogMinPrice.trim() ? Number(catalogMinPrice) : undefined;
    const max = catalogMaxPrice.trim() ? Number(catalogMaxPrice) : undefined;
    if (min !== undefined && Number.isFinite(min)) result = result.filter((product) => product.price !== undefined && product.price >= min);
    if (max !== undefined && Number.isFinite(max)) result = result.filter((product) => product.price !== undefined && product.price <= max);
    if (catalogSaleOnly) result = result.filter((product) => product.onSale === true || (product.price !== undefined && product.originalPrice !== undefined && product.originalPrice > product.price));
    return result;
  }, [catalogProducts, catalogGender, catalogSize, catalogColor, catalogMinPrice, catalogMaxPrice, catalogSaleOnly]);


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
    setCatalogStatus("loading");
    setCatalogError("");
    setMarketplaceOffers([]);
    setMarketplaceSources([]);
    setMarketplaceStatus("idle");
    setMarketplaceError("");
    setMarketplaceCachedAt(null);
    try {
      const params = new URLSearchParams({ category: catalogType, brand: catalogBrand });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/catalog?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Catalog browse failed.");
      setCatalogProducts(Array.isArray(data.products) ? data.products : []);
      setCatalogSources(Array.isArray(data.sources) ? data.sources : []);
      setCatalogCachedAt(data.cachedAt ? String(data.cachedAt) : null);
      setCatalogStatus("success");
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : "Catalog browse failed.");
      setCatalogStatus("error");
      setCatalogProducts([]);
    }
  }

  async function compareRetailers(searchTerm = query) {
    const term = searchTerm.trim();
    if (term.length < 2) { setMarketplaceError("Enter a product or model name first."); return; }
    setQuery(term);
    setSelectedProductUrl("");
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

  function compareCatalogProduct(product: CatalogBrowseProduct) {
    const meaningfulBrand = product.brand && product.brand.toLowerCase() !== "various brands";
    const productQuery = meaningfulBrand && !product.title.toLowerCase().includes(product.brand.toLowerCase())
      ? `${product.brand} ${product.title}`
      : product.title;
    void compareRetailers(productQuery);
    window.setTimeout(() => document.getElementById("retailer-comparison")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
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
          <a className="nav-compare-link" href="#retailer-comparison">Compare</a>
          <a href="#watchlist" onClick={() => setTab("saved")}>Watchlist <span className="nav-count">{saved.length}</span></a>
          <a href="#store-locator">Stores</a>
        </nav>
        <div className="topbar-right"><span className="live-dot" /> MULTI-RETAILER SEARCH</div>
      </header>

      <section className="hero hero-hunt" id="top">
        <div className="hero-noise" />
        <div className="hero-hunt-inner">
          <div className="hero-hunt-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE HUNT STARTS HERE</div>
            <h1>What are you<br /><em>hunting for?</em></h1>
            <p className="hero-copy">Search any brand, model or style across retailers and resale marketplaces.</p>
          </div>
          <div className="hunt-panel">
            <form className="hunt-search-form" onSubmit={(event) => { event.preventDefault(); void browseCatalog(); }}>
              <div className="search-input-wrap"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try Jordan 4, New Balance 9060, Samba OG…" aria-label="What are you hunting for?" autoComplete="off" /><button type="button" className="clear-query" onClick={() => setQuery("")} aria-label="Clear search">{query ? <X size={17} /> : null}</button></div>
              <button className="search-button" type="submit" disabled={catalogStatus === "loading"}>{catalogStatus === "loading" ? <span className="spinner" /> : <Search size={17} />}<span>{catalogStatus === "loading" ? "Searching" : "Find it"}</span><ArrowRight size={17} /></button>
            </form>
            <div className="hunt-primary-filters">
              <label className="catalog-select-field"><span>ITEM TYPE</span><select value={catalogType} onChange={(event) => { setCatalogType(event.target.value as CatalogBrowseCategory); setCatalogStatus("idle"); setCatalogProducts([]); setCatalogSources([]); setCatalogCachedAt(null); }}>{CATALOG_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="catalog-select-field"><span>BRAND</span><select value={catalogBrand} onChange={(event) => { setCatalogBrand(event.target.value); setCatalogStatus("idle"); setCatalogProducts([]); setCatalogSources([]); setCatalogCachedAt(null); }}>{CATALOG_BRANDS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
              <button type="button" className={`refine-toggle ${catalogFiltersOpen ? "refine-toggle-active" : ""}`} onClick={() => setCatalogFiltersOpen((value) => !value)}><SlidersHorizontal size={14} /> Filters {catalogFiltersOpen ? <X size={13} /> : <span className="refine-count">{[catalogGender !== "all", Boolean(catalogSize), Boolean(catalogColor), Boolean(catalogMinPrice || catalogMaxPrice), catalogSaleOnly].filter(Boolean).length || ""}</span>}</button>
            </div>
            {catalogFiltersOpen && <div className="hunt-advanced-filters">
              <label className="search-filter-field"><span>GENDER</span><select value={catalogGender} onChange={(event) => setCatalogGender(event.target.value)}>{GENDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="search-filter-field"><span>SIZE</span><input value={catalogSize} onChange={(event) => setCatalogSize(event.target.value)} placeholder="e.g. 11.5 or 5Y" /></label>
              <label className="search-filter-field"><span>COLOR</span><input value={catalogColor} onChange={(event) => setCatalogColor(event.target.value)} placeholder="e.g. black, red" /></label>
              <label className="search-filter-field"><span>MIN PRICE ($)</span><input type="number" min="0" inputMode="decimal" value={catalogMinPrice} onChange={(event) => setCatalogMinPrice(event.target.value)} placeholder="No min" /></label>
              <label className="search-filter-field"><span>MAX PRICE ($)</span><input type="number" min="0" inputMode="decimal" value={catalogMaxPrice} onChange={(event) => setCatalogMaxPrice(event.target.value)} placeholder="No max" /></label>
              <button type="button" className={`sale-toggle search-sale-toggle ${catalogSaleOnly ? "sale-toggle-active" : ""}`} onClick={() => setCatalogSaleOnly((value) => !value)}><Tag size={15} /> Sale only <span className="toggle-switch"><span /></span></button>
              <button type="button" className="clear-refinements" onClick={() => { setCatalogGender("all"); setCatalogSize(""); setCatalogColor(""); setCatalogMinPrice(""); setCatalogMaxPrice(""); setCatalogSaleOnly(false); }}>Clear filters</button>
            </div>}
            <p className="hunt-note">Filters refine the discovered catalog locally. Size, color, price and sale filters only match details provided by sources; they do not confirm checkout availability.</p>
          </div>
        </div>
      </section>

      <section className="catalog-explorer catalog-results-section" id="catalog" aria-label="Product catalog">
        <div className="catalog-results-heading">
          <div><div className="eyebrow dark-eyebrow">PRODUCT CATALOG</div><h2>{query.trim() ? `Matches for “${query.trim()}”` : "Explore products across brands."}</h2></div>
          <span className="catalog-result-count">{catalogStatus === "success" ? `${catalogVisibleProducts.length} of ${catalogProducts.length} matches` : "Marketplace catalog discovery"}</span>
        </div>
        {catalogError && <div className="store-error">{catalogError}</div>}
        {catalogStatus === "loading" && <div className="store-results-loading">Searching product catalogs across connected marketplaces…</div>}
        {catalogStatus === "idle" && <div className="catalog-explorer-empty"><strong>Start with a model, brand or product type.</strong><span>Browse known models from marketplace catalogs, including older releases that the original brand may no longer sell.</span></div>}
        {catalogStatus === "success" && <div className="catalog-browser-results">
          <div className="catalog-browser-meta"><strong>{catalogVisibleProducts.length} matching product{catalogVisibleProducts.length === 1 ? "" : "s"}</strong><span>{catalogCachedAt ? `Cached ${new Date(catalogCachedAt).toLocaleString()}` : "Fresh discovery"} · Product data may be cached upstream</span></div>
          {catalogSources.length > 0 && <details className="catalog-sources-details"><summary>Sources checked ({catalogSources.filter((source) => source.status === "success").length} successful)</summary><div className="retailer-source-grid">{catalogSources.map((source) => <div className="retailer-source-status" key={`${source.key ?? source.name}-${source.status}`}><strong>{source.name} · {source.status === "success" ? `${source.results} found` : source.status.replaceAll("_", " ")}</strong><span>{source.message}</span></div>)}</div></details>}
          {catalogVisibleProducts.length > 0 ? <div className="catalog-product-grid">{catalogVisibleProducts.map((product) => {
            const savedProduct = toWatchlistProduct(product);
            const isSaved = savedProduct ? savedUrls.has(savedProduct.url) : false;
            const sale = product.onSale === true || (product.price !== undefined && product.originalPrice !== undefined && product.originalPrice > product.price);
            return <article className="catalog-product-card" key={product.id}>
              <div className="catalog-product-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : <PackageSearch size={28} />}{sale && <span className="catalog-sale-badge">SALE</span>}</div>
              <div className="catalog-product-body"><div className="catalog-product-brand">{product.brand} <span>{product.category.toUpperCase()}</span></div><h3>{product.title}</h3>
                <div className="catalog-product-facts">{product.gender && product.gender !== "Unknown" ? product.gender : "Audience not listed"}{product.color ? ` · ${product.color}` : ""}{product.sizes?.length ? ` · Sizes ${product.sizes.slice(0, 4).join(", ")}` : ""}</div>
                {product.price !== undefined && <div className="catalog-price-row"><strong>{money(product.price, product.currency || "USD")}</strong>{product.originalPrice && product.originalPrice > product.price && <del>{money(product.originalPrice, product.currency || "USD")}</del>}</div>}
                {product.styleCode && <small>Style / SKU: {product.styleCode}</small>}<div className="catalog-product-sources">Found on {product.sources.join(" · ")}</div>
                <div className="catalog-card-actions"><button type="button" onClick={() => compareCatalogProduct(product)}>Compare offers <ArrowRight size={13} /></button>{savedProduct && <button type="button" className={`catalog-save-button ${isSaved ? "catalog-save-active" : ""}`} onClick={() => void toggleSaved(savedProduct)} aria-label={isSaved ? "Remove from watchlist" : "Save to watchlist"}><Heart size={15} fill={isSaved ? "currentColor" : "none"} /></button>}</div>
              </div>
            </article>;
          })}</div> : <div className="catalog-explorer-empty"><strong>No products match those refinements.</strong><span>Try clearing one or more filters. Some sources do not provide color, size, audience or pricing data for every model.</span></div>}
          <p className="catalog-disclaimer">Catalog results identify product models and listings indexed by connected sources. Prices may not be available for every model. A listed size is not confirmation of stock; check the seller's live product page before purchasing.</p>
        </div>}
      </section>

      <section className="retailer-compare retailer-compare-standalone" id="retailer-comparison" aria-label="Compare retailer offers">
        <div className="retailer-compare-head"><div><div className="eyebrow dark-eyebrow">MULTI-RETAILER COMPARISON</div><h3>{marketplaceStatus === "success" ? "Retailer offers" : "Compare this find"}</h3><p>{query.trim() ? `See listings for ${query.trim()} across sneaker marketplaces and retailers.` : "Choose a catalog product and compare online offers across supported retailers."}</p></div></div>
        {marketplaceError && <div className="store-error">{marketplaceError}</div>}
        {marketplaceStatus === "loading" && <div className="store-results-loading">Checking retailer and marketplace listings…</div>}
        {marketplaceStatus === "success" && <div className="retailer-results-wrap">
          <div className="retailer-results-meta"><strong>{marketplaceOffers.length} matching online listing{marketplaceOffers.length === 1 ? "" : "s"}</strong><span>{marketplaceCachedAt ? `Cached ${new Date(marketplaceCachedAt).toLocaleString()}` : "Fresh comparison"} · exact size stock not assumed</span></div>
          {marketplaceSources.length > 0 && <details className="catalog-sources-details"><summary>Sources checked</summary><div className="retailer-source-grid">{marketplaceSources.map((source) => <div className="retailer-source-status" key={`${source.key ?? source.name}-${source.status}`}><strong>{source.name} · {source.status === "success" ? `${source.results} found` : source.status.replaceAll("_", " ")}</strong><span>{source.message}</span></div>)}</div></details>}
          {marketplaceOffers.length > 0 ? <div className="retailer-offer-grid">{marketplaceOffers.map((offer) => <article className="retailer-offer-card" key={offer.id}><div className="retailer-offer-image">{offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" /> : <PackageSearch size={25} />}</div><div className="retailer-offer-body"><div className="retailer-offer-kicker"><span>{offer.retailer}</span><span>ONLINE</span></div><h4>{offer.title}</h4>{offer.styleCode && <small>Style / SKU: {offer.styleCode}</small>}{offer.price !== undefined && <div className="retailer-offer-price"><strong>{money(offer.price, offer.currency)}</strong><span>{offer.priceLabel ?? "Displayed price"}</span></div>}<p className="retailer-offer-stock"><span className="unknown-dot" />{offer.availabilityLabel}</p><a href={offer.url} target="_blank" rel="noreferrer">View listing <ExternalLink size={12} /></a></div></article>)}</div> : <div className="retailer-no-results"><strong>No matching online listings were returned.</strong><span>Check the source statuses above. A product can remain in the catalog after current listings disappear.</span></div>}
          <p className="store-stock-disclaimer">These are online listings, not confirmed size-level stock. Open the retailer listing to verify the exact size and checkout status. Nearby physical-store locations do not confirm the searched item is stocked there.</p>
        </div>}
        {marketplaceStatus === "idle" && <div className="retailer-idle-hint">Choose a product above and press Compare offers. No comparison API request is made while typing or changing filters.</div>}
      </section>

      <section className="location-section" id="store-locator">
        <div className="location-strip"><div className="location-intro"><MapPin size={17} /><div><strong>Nearby retailer locations</strong><span>Find sneaker and footwear stores around a ZIP code. Store presence does not confirm item inventory.</span></div></div><div className="location-actions"><input value={postalCode} onChange={(event) => { setPostalCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 5)); setStoreStatus("idle"); setStores([]); }} placeholder="ZIP code" aria-label="ZIP code" maxLength={5} /><select value={storeRadius} onChange={(event) => { setStoreRadius(event.target.value); setStoreStatus("idle"); setStores([]); }} aria-label="Search radius"><option value="5">5 miles</option><option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option><option value="100">100 miles</option></select><button className="map-link" type="button" onClick={() => void findNearbyStores()} disabled={storeStatus === "loading"}>{storeStatus === "loading" ? <span className="mini-spinner" /> : <MapPin size={14} />} Find stores</button></div></div>
        {storeError && <div className="store-error">{storeError}</div>}{storeStatus === "loading" && <div className="store-results-loading">Searching nearby retailer locations…</div>}
        {storeStatus === "success" && <div className="nearby-store-panel"><div className="nearby-store-heading"><div><strong>{stores.length} nearby retailer {stores.length === 1 ? "location" : "locations"} found</strong><span>Within {storeRadius} miles of {postalCode}</span></div><button type="button" onClick={() => setStoreStatus("idle")}>Hide</button></div>{stores.length === 0 ? <p className="store-empty">No supported retailer locations were found within this radius. Try a larger distance.</p> : <div className="nearby-store-grid">{stores.map((store) => <article className="nearby-store-card" key={store.id}><div className="nearby-store-top"><strong>{store.name}</strong><span>{store.distanceMiles.toFixed(1)} mi</span></div><div className="store-type">{store.storeType}</div><p>{store.address}</p><a href={store.mapUrl} target="_blank" rel="noreferrer">Directions <ExternalLink size={11} /></a></article>)}</div>}<p className="store-stock-disclaimer">Locations are sourced from OpenStreetMap and may be incomplete. Distances are straight-line estimates from the ZIP-code center. These are store locations, not product-level inventory confirmations.</p></div>}
      </section>

      <section className="watchlist-section" id="watchlist">
        <div className="watchlist-heading"><div><div className="eyebrow dark-eyebrow">YOUR SAVED FINDS</div><h2>Watchlist</h2></div><span>{saved.length} saved</span></div>
        {message && <div className="toast-message"><Check size={15} /> {message}</div>}
        {saved.length ? <div className="watchlist-grid">{saved.map((product) => <article className="watchlist-card" key={product.url}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={26} />}<div><strong>{product.title}</strong><small>{product.subtitle || product.styleCode || "Saved product"}</small><span>{money(product.price, product.currency)}</span><a href={product.url} target="_blank" rel="noreferrer">Open listing <ExternalLink size={11} /></a></div><button type="button" onClick={() => void toggleSaved(product)} aria-label="Remove from watchlist"><X size={15} /></button></article>)}</div> : <div className="catalog-explorer-empty"><strong>No saved products yet.</strong><span>Save a model from the catalog using its bookmark icon.</span></div>}
      </section>

      <footer className="footer"><div className="footer-brand">OUTLET<span>RADAR</span></div><div className="footer-copy">Independent product-discovery and price-comparison platform. Not affiliated with or endorsed by the brands, retailers or marketplaces displayed. Outlet Radar may earn commissions from qualifying purchases.</div><div className="footer-links"><a href="#catalog">Browse catalog</a><a href="#store-locator">Nearby retailers</a><a className="nav-compare-link" href="#retailer-comparison">Compare</a></div></footer>
    </main>
  );
}
