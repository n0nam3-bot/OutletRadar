export type ProductSize = {
  label: string;
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
