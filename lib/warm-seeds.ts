/**
 * Searches the warm-up job keeps fresh when no visitor searches are waiting in the
 * queue. They spend only leftover free-tier credits (see WARM_DAILY_SHARE). Edit
 * this list to match what your visitors actually look for. Each entry is a normal
 * catalog search: product type, brand and a model query.
 */
export type WarmSeed = { category: "sneakers" | "apparel" | "accessories"; brand: string; query: string };

export const WARM_SEEDS: WarmSeed[] = [
  { category: "sneakers", brand: "jordan", query: "Air Jordan 1" },
  { category: "sneakers", brand: "jordan", query: "Air Jordan 4" },
  { category: "sneakers", brand: "jordan", query: "Air Jordan 3" },
  { category: "sneakers", brand: "jordan", query: "Air Jordan 11" },
  { category: "sneakers", brand: "nike", query: "Dunk Low" },
  { category: "sneakers", brand: "nike", query: "Air Force 1" },
  { category: "sneakers", brand: "nike", query: "Air Max 90" },
  { category: "sneakers", brand: "nike", query: "Air Max 1" },
  { category: "sneakers", brand: "nike", query: "Vomero 5" },
  { category: "sneakers", brand: "adidas", query: "Samba" },
  { category: "sneakers", brand: "adidas", query: "Campus 00s" },
  { category: "sneakers", brand: "adidas", query: "Gazelle" },
  { category: "sneakers", brand: "adidas", query: "Ultraboost" },
  { category: "sneakers", brand: "yeezy", query: "Yeezy Boost 350" },
  { category: "sneakers", brand: "yeezy", query: "Yeezy Slide" },
  { category: "sneakers", brand: "new balance", query: "550" },
  { category: "sneakers", brand: "new balance", query: "990" },
  { category: "sneakers", brand: "new balance", query: "2002R" },
  { category: "sneakers", brand: "new balance", query: "9060" },
  { category: "sneakers", brand: "asics", query: "Gel-Kayano 14" },
  { category: "sneakers", brand: "asics", query: "Gel-1130" },
  { category: "sneakers", brand: "converse", query: "Chuck Taylor All Star" },
  { category: "sneakers", brand: "puma", query: "Speedcat" },
  { category: "sneakers", brand: "hoka", query: "Clifton 9" },
  { category: "sneakers", brand: "on running", query: "Cloudmonster" },
  { category: "sneakers", brand: "salomon", query: "XT-6" },
  { category: "sneakers", brand: "vans", query: "Old Skool" },
  { category: "sneakers", brand: "crocs", query: "Classic Clog" },
];
