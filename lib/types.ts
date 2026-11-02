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
  storeType: "Factory / Clearance" | "Nike Store";
  mapUrl: string;
};
