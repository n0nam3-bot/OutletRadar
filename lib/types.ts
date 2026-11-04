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
  /** Shoe sizing audience; useful when Nike labels youth products separately from adult styles. */
  sizeSystem?: "men" | "women" | "youth" | "toddler" | "infant" | "unisex" | "unknown";
  onSale?: boolean;
  /** Internal cache marker used to distinguish unfiltered v1.2 catalogue rows. */
  catalogVersion?: number;
  category?: ProductCategory;
  sourceFetchedAt?: string;
};

export type SearchResponse = {
  products: NikeProduct[];
  meta?: { cached?: boolean; fetchedAt?: string; creditsUsed?: number; cacheSource?: "neon" | "provider" };
  source: "api.sh";
};

export type NearbyStore = {
  id: string;
  name: string;
  address: string;
  city?: string;
  region?: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
  distanceMiles: number;
  storeType: string;
  mapUrl: string;
};

export type MarketplaceProvider = "stockx" | "goat" | "flightclub" | "kickscrew" | "shopping";
export type MarketplaceOffer = {
  id: string;
  source: MarketplaceProvider;
  retailer: string;
  channel: "online" | "store";
  title: string;
  url: string;
  imageUrl?: string;
  styleCode?: string;
  brand?: string;
  price?: number;
  priceLabel?: string;
  currency: string;
  availability: "available" | "unavailable" | "unknown";
  availabilityLabel: string;
  sourceUpdatedAt?: string;
};

export type CatalogBrowseCategory = "sneakers" | "apparel" | "accessories" | "all";
export type CatalogListing = {
  source: MarketplaceProvider;
  retailer: string;
  url: string;
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
};

export type MarketplaceSourceStatus = {
  name: string;
  status: "success" | "not_configured" | "error" | "budget_reached";
  results: number;
  message: string;
};
