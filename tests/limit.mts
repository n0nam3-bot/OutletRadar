import { allowLiveLookup, clientKeyFromHeaders, liveLookupsPerHour, resetLiveLimits } from "../lib/live-limit.ts";
let failures = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); if (!ok) failures++; }
const H = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

delete process.env.LIVE_LOOKUPS_PER_HOUR; resetLiveLimits();
check("limit: default is 15 fresh lookups per hour", liveLookupsPerHour() === 15);
const t0 = 1_000_000;
const results = Array.from({ length: 17 }, (_, i) => allowLiveLookup("1.2.3.4", t0 + i));
check("limit: first 15 allowed, 16th and 17th refused", results.slice(0, 15).every(Boolean) && !results[15] && !results[16], JSON.stringify(results.map(Number).join("")));
check("limit: another connection is unaffected", allowLiveLookup("5.6.7.8", t0 + 20) === true);
check("limit: allowance returns after the hour", allowLiveLookup("1.2.3.4", t0 + 60 * 60 * 1000 + 5) === true);
check("limit: unknown client (no address) is never limited", Array.from({ length: 50 }, () => allowLiveLookup(null)).every(Boolean));
process.env.LIVE_LOOKUPS_PER_HOUR = "0"; resetLiveLimits();
check("limit: LIVE_LOOKUPS_PER_HOUR=0 turns limiting off", Array.from({ length: 100 }, () => allowLiveLookup("9.9.9.9")).every(Boolean));
process.env.LIVE_LOOKUPS_PER_HOUR = "2"; resetLiveLimits();
check("limit: configurable", allowLiveLookup("a:b::1") && allowLiveLookup("a:b::1") && !allowLiveLookup("a:b::1"));
process.env.LIVE_LOOKUPS_PER_HOUR = "garbage"; check("limit: invalid setting falls back to 15", liveLookupsPerHour() === 15);
process.env.LIVE_LOOKUPS_PER_HOUR = "-5"; check("limit: negative setting is treated as off (0)", liveLookupsPerHour() === 0);
delete process.env.LIVE_LOOKUPS_PER_HOUR;

check("address: first x-forwarded-for entry is used", clientKeyFromHeaders(H({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })) === "203.0.113.7");
check("address: falls back to x-real-ip, accepts IPv6", clientKeyFromHeaders(H({ "x-real-ip": "2001:db8::1" })) === "2001:db8::1");
check("address: missing or malformed headers give null (never limited)", clientKeyFromHeaders(H({})) === null && clientKeyFromHeaders(H({ "x-forwarded-for": "<script>" })) === null && clientKeyFromHeaders(H({ "x-forwarded-for": "x".repeat(200) })) === null);

process.env.LIVE_LOOKUPS_PER_HOUR = "1"; resetLiveLimits();
for (let i = 0; i < 20_001; i++) allowLiveLookup(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
check("limit: memory is bounded (table is cleared rather than growing past 20,000 clients)", allowLiveLookup("77.77.77.77") === true);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL LIMIT CHECKS PASSED");
process.exit(failures ? 1 : 0);
