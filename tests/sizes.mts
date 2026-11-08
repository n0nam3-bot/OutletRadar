import { parseSizeLabel, parseSizeQuery, matchSizeLabel, womensOffset } from "../lib/size-match.ts";
import { catalogFilterEvaluation } from "../lib/catalog-filters.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); if (!ok) failures++; }
const j = (v: unknown) => JSON.stringify(v);

// ---- parsing ----
check("parse: '10 M' -> men 10", j(parseSizeLabel("10 M")) === j([{ system: "men", value: 10 }]));
check("parse: 'M 11.5 / W 13' -> two entries", j(parseSizeLabel("M 11.5 / W 13")) === j([{ system: "men", value: 11.5 }, { system: "women", value: 13 }]));
check("parse: '10.5W', '5Y', '5.5 Y', '10½'", j(parseSizeLabel("10.5W")) === j([{ system: "women", value: 10.5 }]) && j(parseSizeLabel("5Y")) === j([{ system: "youth", value: 5 }]) && parseSizeLabel("5.5 Y")[0].value === 5.5 && parseSizeLabel("10½")[0].value === 10.5);
check("parse: UK/EU/CM, apparel, toddler C and out-of-range labels are ignored", [parseSizeLabel("UK 9"), parseSizeLabel("EU 43"), parseSizeLabel("28 cm"), parseSizeLabel("XL"), parseSizeLabel("10C"), parseSizeLabel("100"), parseSizeLabel("8-10")].every((x) => x.length === 0));
check("parse: label without a scale uses the fallback", j(parseSizeLabel("US 10", "women")) === j([{ system: "women", value: 10 }]) && parseSizeLabel("10")[0].system === null);
check("query: plain number takes the default scale, markers override it", j(parseSizeQuery("10", "men")) === j({ system: "men", value: 10, explicit: false }) && parseSizeQuery("w 8", "men")?.system === "women" && parseSizeQuery("5y", "men")?.system === "youth");
check("query: apparel and combined input are not shoe queries", parseSizeQuery("L", "men") === null && parseSizeQuery("10 / 11", "men") === null);
check("offsets: only brands with a fixed published offset", womensOffset("Nike") === 1.5 && womensOffset("New Balance") === 1.5 && womensOffset("adidas") === 1 && womensOffset("Converse") === null && womensOffset("ASICS") === null);

// ---- matching ----
const men10 = { system: "men" as const, value: 10, explicit: false };
check("match: men's 10 matches '10 M' exactly", matchSizeLabel("10 M", men10, "Nike") === "exact");
check("match: men's 10 does NOT match women's 10 (the old bug)", matchSizeLabel("10 W", men10, "Nike") === null && matchSizeLabel("W 10", men10, "Jordan") === null);
check("match: men's 10 = women's 11.5 for Nike (converted), women's 11 for adidas", matchSizeLabel("11.5 W", men10, "Nike") === "converted" && matchSizeLabel("11 W", men10, "adidas") === "converted" && matchSizeLabel("11.5 W", men10, "adidas") === null);
check("match: no conversion for Converse or unknown brands", matchSizeLabel("11.5 W", men10, "Converse") === null && matchSizeLabel("11.5 W", men10, "Vans") === null);
check("match: women's query converts from men's label (Nike men's 8.5 = women's 10)", matchSizeLabel("8.5 M", { system: "women", value: 10, explicit: false }, "Nike") === "converted");
check("match: unlabeled size is 'assumed' for men's queries only", matchSizeLabel("10", men10, "Nike") === "assumed" && matchSizeLabel("10", { system: "women", value: 10, explicit: false }, "Nike") === null);
check("match: unlabeled size takes its fallback scale", matchSizeLabel("10", { system: "women", value: 10, explicit: false }, "Nike", "women") === "exact");
check("match: youth is exact-only and never crosses scales", matchSizeLabel("5Y", { system: "youth", value: 5, explicit: true }, "Nike") === "exact" && matchSizeLabel("6.5 W", { system: "youth", value: 5, explicit: true }, "Nike") === null && matchSizeLabel("5Y", { system: "men", value: 5, explicit: false }, "Nike") === null);
check("match: 10 does not match 10.5 or 1", matchSizeLabel("10.5 M", men10, "Nike") === null && matchSizeLabel("1 M", men10, "Nike") === null);

// ---- product filtering ----
const base = { id: "p1", title: "Air Jordan 4 Retro Black Cat Men's", brand: "Jordan", category: "sneakers", sources: ["StockX", "GOAT"], gender: "Men", price: 150, currency: "USD", listings: [] as any[], sizes: [] as string[] };
const filters = (o: Record<string, unknown> = {}) => ({ gender: "all", releaseYear: "", size: "10", sizeSystem: "men" as const, color: "", minPrice: "", maxPrice: "", saleOnly: false, ...o });
const quote = (label: string, available: boolean | null, price: number | undefined, source: string, sizeSystem = "men") => ({ label, available, price, currency: "USD", status: "", sizeSystem, retailer: source, source } as any);
const withQuotes = (quotes: any[]) => ({ ...base, sizeQuotes: quotes } as any);

let ev = catalogFilterEvaluation(withQuotes([quote("10 M", true, 245, "stockx"), quote("10 M", true, 230, "goat"), quote("9 M", false, undefined, "stockx")]), filters());
check("filter: verified size with the cheapest price for that size", ev.keep && ev.size?.state === "verified" && ev.size.price === 230 && ev.size.source === "goat" && ev.size.kind === "exact", j(ev.size));
ev = catalogFilterEvaluation(withQuotes([quote("9 M", false, undefined, "stockx"), quote("10 M", true, 230, "goat")]), filters({ size: "9" }));
check("filter: sold-out size is excluded, not 'unknown'", !ev.keep && ev.unknown.length === 0);
ev = catalogFilterEvaluation(withQuotes([quote("10 M", true, 230, "goat")]), filters({ maxPrice: "200" }));
check("filter: price limit uses the selected size's price, not the cheapest listing of any size", !ev.keep, `product.price=150, size price=230 -> keep=${ev.keep}`);
ev = catalogFilterEvaluation(withQuotes([quote("10 M", true, 230, "goat")]), filters({ minPrice: "200", maxPrice: "250" }));
check("filter: size price inside the range is kept", ev.keep && ev.size?.price === 230);
ev = catalogFilterEvaluation(withQuotes([quote("10 M", true, 230, "goat")]), filters({ size: "11.5", sizeSystem: "women" }));
check("filter: women's 11.5 finds Jordan men's 10 as converted", ev.keep && ev.size?.kind === "converted" && ev.size.label === "10 M", j(ev.size));
ev = catalogFilterEvaluation({ ...withQuotes([quote("10 M", true, 120, "stockx")]), brand: "Converse" }, filters({ size: "11.5", sizeSystem: "women" }));
check("filter: Converse is never converted between scales", !ev.keep && ev.unknown.length === 0);
ev = catalogFilterEvaluation({ ...base, sizeQuotes: [] } as any, filters());
check("filter: no size data at all -> unknown 'size list', not silently dropped", !ev.keep && ev.unknown.includes("size list"));
ev = catalogFilterEvaluation({ ...base, sizeQuotes: [], listings: [{ source: "nike", retailer: "Nike.com", url: "https://nike.com/x", sizes: ["8", "9", "10"], price: 150 }] } as any, filters());
check("filter: retailer-listed size is kept but not 'verified'", ev.keep && ev.size?.state === "listed" && ev.size.kind === "exact", j(ev.size));
ev = catalogFilterEvaluation({ ...base, gender: "Unknown", title: "Air Jordan 4 Retro", sizeQuotes: [], listings: [{ source: "shopping", retailer: "X", url: "https://x.com/a", sizes: ["10"], price: 150 }] } as any, filters({ size: "10", sizeSystem: "women" }));
check("filter: unlabeled listed size on an unknown-audience product does not match a women's query", !ev.keep, j(ev));
ev = catalogFilterEvaluation({ ...base, category: "apparel", title: "Tech Fleece Hoodie", sizeQuotes: [], listings: [{ source: "nike", retailer: "Nike.com", url: "https://nike.com/h", sizes: ["S", "M", "L"], price: 100 }] } as any, filters({ size: "L" }));
check("filter: apparel sizes (S/M/L) still work", ev.keep);
ev = catalogFilterEvaluation({ ...withQuotes([quote("5Y", true, 90, "stockx", "youth")]), title: "Air Jordan 4 GS Big Kids", gender: "Kids" }, filters({ size: "5y", gender: "kids", sizeSystem: "youth" }));
check("filter: kids' size 5Y verified with price", ev.keep && ev.size?.price === 90 && ev.size.kind === "exact", j(ev.size));
ev = catalogFilterEvaluation(withQuotes([quote("10 M", true, 245, "stockx"), quote("11.5 W", true, 200, "goat", "women")]), filters());
check("filter: a cheaper converted-scale ask from another seller wins the headline, labelled converted, both rows kept", ev.size?.kind === "converted" && ev.size.price === 200 && ev.sizeOffers?.length === 2 && ev.sizeOffers[1].kind === "exact", j(ev.sizeOffers));


// ---- best price for the size across ALL sources ----
const multi = { ...base, listings: [
  { source: "nike", retailer: "Nike.com", url: "https://nike.com/aj4", sizes: ["9", "9.5", "10"], price: 210, currency: "USD" },
  { source: "impact", retailer: "Foot Locker", url: "https://fl.pxf.io/aj4", sizes: ["9.5"], price: 205, currency: "USD" },
  { source: "shopping", retailer: "Champs Sports", url: "https://champs.com/aj4", sizes: ["8", "11"], price: 150, currency: "USD" },
], sizeQuotes: [quote("9.5 M", true, 245, "stockx"), quote("9.5 M", true, 230, "goat"), quote("9.5 M", true, 260, "flightclub"), quote("10 M", true, 190, "stockx"), quote("9 M", true, 180, "goat")] } as any;
ev = catalogFilterEvaluation(multi, filters({ size: "9.5" }));
const labels = (ev.sizeOffers ?? []).map((r) => `${r.retailer}:${r.price}:${r.state}`);
check("rows: every source that has size 9.5 gets one price row, cheapest first", j(labels) === j(["Foot Locker:205:listed", "Nike.com:210:listed", "goat:230:verified", "stockx:245:verified", "flightclub:260:verified"]), j(labels));
check("rows: other sizes (10, 9, 8, 11) never appear", (ev.sizeOffers ?? []).every((r) => /9\.5/.test(r.label)) && !labels.some((l) => /Champs/.test(l)), j((ev.sizeOffers ?? []).map((r) => r.label)));
check("rows: headline is the cheapest VERIFIED ask (GOAT 230), not an unconfirmed retailer", ev.size?.state === "verified" && ev.size.price === 230 && ev.size.source === "goat", j(ev.size));
ev = catalogFilterEvaluation(multi, filters({ size: "9.5", maxPrice: "206" }));
check("price filter: a retailer that has the size within range keeps the product", ev.keep);
ev = catalogFilterEvaluation(multi, filters({ size: "9.5", maxPrice: "150" }));
check("price filter: Champs ($150) does not have size 9.5, so a $150 cap excludes the product", !ev.keep);
ev = catalogFilterEvaluation(multi, filters({ size: "9.5", minPrice: "300" }));
check("price filter: nothing for this size above $300 excludes the product", !ev.keep);
ev = catalogFilterEvaluation({ ...multi, sizeQuotes: [quote("9.5 M", false, undefined, "stockx"), quote("9.5 M", false, undefined, "goat")] }, filters({ size: "9.5" }));
check("rows: marketplaces with no ask are dropped but retailers listing the size remain", (ev.sizeOffers ?? []).length === 2 && ev.keep && ev.size?.state === "listed", j((ev.sizeOffers ?? []).map((r) => r.retailer)));
ev = catalogFilterEvaluation({ ...multi, listings: [], sizeQuotes: [quote("9.5 M", false, undefined, "stockx")] }, filters({ size: "9.5" }));
check("rows: size only reported unavailable -> product excluded", !ev.keep && ev.unknown.length === 0);
ev = catalogFilterEvaluation({ ...multi, sizeQuotes: [quote("9.5 M", true, 245, "stockx"), quote("9.5 M", true, 240, "stockx")], listings: [] }, filters({ size: "9.5" }));
check("rows: one row per seller (cheapest verified ask kept)", (ev.sizeOffers ?? []).length === 1 && ev.sizeOffers?.[0].price === 240);
ev = catalogFilterEvaluation({ ...multi, brand: "Nike", listings: [{ source: "nike", retailer: "Nike.com", url: "https://nike.com/x", sizes: ["11 W"], price: 120, currency: "USD" }], sizeQuotes: [] }, filters({ size: "9.5" }));
check("rows: a women's-listed size converts for Nike (women's 11 = men's 9.5) and is labelled", ev.keep && ev.sizeOffers?.[0].kind === "converted" && ev.sizeOffers[0].label === "11 W", j(ev.sizeOffers));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL SIZE CHECKS PASSED");
process.exit(failures ? 1 : 0);
