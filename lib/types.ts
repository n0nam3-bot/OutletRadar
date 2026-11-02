export type ProductSize = {
  label: string;
  available?: boolean | null;
  status?: string | null;
};

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
  sourceFetchedAt?: string;
};

export type SearchResponse = {
  products: NikeProduct[];
  meta?: { cached?: boolean; fetchedAt?: string; creditsUsed?: number };
  source: "api.sh";
};
