import { savedSearchId, productKey, describeSearch, summarizePriceChanges, priceSnapshot, loadSavedSearches, persistSavedSearches, upsertSavedSearch, MAX_SAVED_SEARCHES, SAVED_SEARCH_KEY } from "../lib/saved-searches.ts";
let failures = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); if (!ok) failures++; }
const crit = (o: Record<string, unknown> = {}) => ({ query: "Air Jordan 4", type: "sneakers", brand: "jordan", gender: "men", releaseYear: "", size: "10", sizeChoice: "auto" as const, color: "", minPrice: "", maxPrice: "250", saleOnly: false, ...o });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

check("id: identical criteria -> identical id, case/spacing ignored", savedSearchId(crit()) === savedSearchId(crit({ query: "  air  JORDAN 4 " })));
check("id: any criterion change -> different id", savedSearchId(crit()) !== savedSearchId(crit({ size: "11" })) && savedSearchId(crit()) !== savedSearchId(crit({ maxPrice: "300" })) && savedSearchId(crit()) !== savedSearchId(crit({ saleOnly: true })));
check("productKey: style code wins and ignores punctuation/case", productKey({ styleCode: "CU1110-010", brand: "Jordan", title: "x" }) === productKey({ styleCode: "cu1110 010", brand: "Other", title: "y" }));
check("productKey: falls back to brand + title", productKey({ brand: "Jordan", title: "Air Jordan 4 Retro" }) === "tt:jordan air jordan 4 retro");
check("describe: readable summary", describeSearch(crit()) === "Air Jordan 4 · jordan · men · size 10 · $0–$250", describeSearch(crit()));

const before = { a: 250, b: 180, c: 100, d: 90 };
const now = [{ key: "a", title: "A", price: 230 }, { key: "b", title: "B", price: 190 }, { key: "c", title: "C", price: 100 }, { key: "e", title: "E", price: 75 }];
const sum = summarizePriceChanges(before, now);
check("changes: drop, rise, unchanged, new product, missing product", sum.drops.length === 1 && sum.drops[0].key === "a" && sum.drops[0].from === 250 && sum.drops[0].to === 230 && sum.rises.length === 1 && sum.rises[0].key === "b" && sum.newProducts === 1 && sum.compared === 3, JSON.stringify(sum));
check("changes: first run (no previous prices) reports everything as new", summarizePriceChanges({}, now).newProducts === 4 && summarizePriceChanges({}, now).drops.length === 0);
check("changes: sub-cent noise is ignored", summarizePriceChanges({ a: 100 }, [{ key: "a", title: "A", price: 99.999 }]).drops.length === 0);
check("changes: biggest drop first", summarizePriceChanges({ a: 100, b: 100 }, [{ key: "a", title: "A", price: 90 }, { key: "b", title: "B", price: 50 }]).drops[0].key === "b");
const many = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, price: i + 1 }));
check("snapshot: capped at 200 cheapest products", Object.keys(priceSnapshot(many)).length === 200 && priceSnapshot(many).k0 === 1 && priceSnapshot(many).k300 === undefined);

const store = mem();
check("storage: empty / null storage -> empty list", loadSavedSearches(store).length === 0 && loadSavedSearches(null).length === 0);
let list = upsertSavedSearch([], crit(), { a: 1 }, new Date("2026-01-01T00:00:00Z"));
list = upsertSavedSearch(list, crit({ query: "Dunk Low" }), {}, new Date("2026-01-02T00:00:00Z"));
list = upsertSavedSearch(list, crit(), { a: 2 }, new Date("2026-01-03T00:00:00Z"));
check("upsert: same search updates in place, keeps createdAt, moves to front", list.length === 2 && list[0].query === "Air Jordan 4" && list[0].createdAt === "2026-01-01T00:00:00.000Z" && list[0].lastRunAt === "2026-01-03T00:00:00.000Z" && list[0].prices.a === 2);
persistSavedSearches(store, list);
check("storage: round-trips", JSON.stringify(loadSavedSearches(store).map((s) => s.id)) === JSON.stringify(list.map((s) => s.id)));
let big: any[] = [];
for (let i = 0; i < 30; i++) big = upsertSavedSearch(big, crit({ query: `search ${i}` }), {});
check("upsert: capped at 20 saved searches, newest kept", big.length === MAX_SAVED_SEARCHES && big[0].query === "search 29");
store.setItem(SAVED_SEARCH_KEY, "{not json");
check("storage: corrupt data is ignored, not thrown", loadSavedSearches(store).length === 0);
store.setItem(SAVED_SEARCH_KEY, JSON.stringify([{ id: "x", query: "ok" }, { nope: 1 }, "str", null]));
const loaded = loadSavedSearches(store);
check("storage: invalid entries dropped, valid entries get default prices", loaded.length === 1 && typeof loaded[0].prices === "object");
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
check("storage: blocked or full storage fails soft", loadSavedSearches(blocked as any).length === 0 && persistSavedSearches(blocked as any, list) === false);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL SAVED-SEARCH CHECKS PASSED");
process.exit(failures ? 1 : 0);
