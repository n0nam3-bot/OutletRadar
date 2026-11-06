export type ProductSize = {
  label: string;
  localizedLabel?: string;
  available?: boolean | null;
  status?: string | null;
};

export type ProductGender = "Men" | "Women" | "Kids" | "Unisex" | "Unknown";
export type ProductCategory = "Shoes" | "Apparel" | "Accessories" | "Other";

export type NikeProduct = {
  id: string;
  title: string;
  subtitle?: string;
  styleCode?: string;
  url: string;
  imageUrl?: string;
  price?: number;
  fullPrice?: number;
  currency: string;
  discountPercent?: number;
  sizes?: ProductSize[];
  gender?: ProductGender;
  sizeSystem?: "men" | "women" | "youth" | "toddler" | "infant" | "unisex" | "unknown";
  onSale?: boolean;
  catalogVersion?: number;
  category?: ProductCategory;
  sourceFetchedAt?: string;
};

export type SearchResponse = {
  products: NikeProduct[];
  meta?: { cached?: boolean; fetchedAt?: string; creditsUsed?: number; cacheSource?: "neon" | "provider" };
  source: "api.sh";
};

export type MarketplaceProvider = "stockx" | "goat" | "flightclub" | "kickscrew" | "shopping" | "nike" | "channel3" | "ebay";
export type MarketplaceOffer = {
  id: string;
  source: MarketplaceProvider;
  retailer: string;
  providerProductId?: string;
  condition?: string;
  channel: "online" | "store";
  title: string;
  url: string;
  imageUrl?: string;
  styleCode?: string;
  brand?: string;
  gender?: ProductGender | string;
  color?: string;
  price?: number;
  priceLabel?: string;
  currency: string;
  availability: "available" | "unavailable" | "unknown";
  availabilityLabel: string;
  sourceUpdatedAt?: string;
  releaseYear?: number;
  sizes?: string[];
  sizeQuotes?: MarketplaceSizeQuote[];
};

export type CatalogBrowseCategory = "sneakers" | "apparel" | "accessories" | "all";
export type CatalogListing = {
  source: MarketplaceProvider;
  retailer: string;
  /** Exact title returned by this specific retailer/provider listing. */
  title?: string;
  url: string;
  providerProductId?: string;
  styleCode?: string;
  imageUrl?: string;
  price?: number;
  originalPrice?: number;
  currency?: string;
  color?: string;
  sizes?: string[];
  gender?: ProductGender;
  releaseYear?: number;
  onSale?: boolean;
};

export type MarketplaceSizeQuote = {
  label: string;
  available: boolean | null;
  price?: number;
  currency: string;
  status: string;
  sizeSystem?: "men" | "women" | "youth" | "unisex" | "unknown";
  retailer: string;
  source: "stockx" | "goat" | "flightclub" | "kickscrew";
};

export type CatalogBrowseProduct = {
  id: string;
  title: string;
  brand: string;
  category: CatalogBrowseCategory;
  styleCode?: string;
  imageUrl?: string;
  sources: string[];
  listings: CatalogListing[];
  /** Best price observed among catalog listings; not a checkout quote. */
  price?: number;
  originalPrice?: number;
  currency?: string;
  color?: string;
  colors?: string[];
  sizes?: string[];
  gender?: ProductGender;
  releaseYear?: number;
  onSale?: boolean;
  sizeQuotes?: MarketplaceSizeQuote[];
};

export type MarketplaceSourceStatus = {
  name: string;
  status: "success" | "cached" | "not_configured" | "error" | "budget_reached" | "cooldown" | "stale" | "skipped";
  results: number;
  message: string;
};
