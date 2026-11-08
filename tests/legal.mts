import { siteUrl, contactEmail, siteOperator, LEGAL_LAST_UPDATED } from "../lib/site-info.ts";
import * as robotsMod from "../app/robots.ts";
import * as sitemapMod from "../app/sitemap.ts";
import * as configMod from "../next.config.ts";
const pick = (m: any) => (typeof m.default === "function" || (m.default && typeof m.default === "object") ? m.default : m);
const robots = pick(robotsMod).default ?? pick(robotsMod); const sitemap = pick(sitemapMod).default ?? pick(sitemapMod); const nextConfig = pick(configMod).default ?? pick(configMod);
let failures = 0;
function check(name: string, ok: boolean, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`); if (!ok) failures++; }
const env = (o: Record<string, string | undefined>) => { for (const k of ["SITE_URL", "CONTACT_EMAIL", "SITE_OPERATOR"]) delete process.env[k]; for (const [k, v] of Object.entries(o)) if (v !== undefined) process.env[k] = v; };

env({});
check("site-info: everything optional and absent by default", siteUrl() === null && contactEmail() === null && siteOperator() === null);
env({ SITE_URL: "https://outlet-radar.vercel.app/" });
check("site-info: trailing slash removed from SITE_URL", siteUrl() === "https://outlet-radar.vercel.app");
for (const bad of ["not a url", "ftp://x.com", "https://x.com/path", "javascript:alert(1)", "https://"]) { env({ SITE_URL: bad }); if (siteUrl() !== null) check(`site-info: rejects SITE_URL '${bad}'`, false); }
check("site-info: malformed SITE_URL values are rejected", true);
env({ CONTACT_EMAIL: "owner@example.com" }); check("site-info: valid contact e-mail accepted", contactEmail() === "owner@example.com");
env({ CONTACT_EMAIL: "not an email" }); check("site-info: invalid contact e-mail rejected (never rendered)", contactEmail() === null);
env({ CONTACT_EMAIL: '"><script>@x.com' }); check("site-info: markup in CONTACT_EMAIL rejected", contactEmail() === null);
check("site-info: last-updated date present", /\d{4}$/.test(LEGAL_LAST_UPDATED));

env({});
check("robots: always blocks /api/ and /admin/, no sitemap line without SITE_URL", JSON.stringify((robots() as any).rules[0].disallow) === JSON.stringify(["/api/", "/admin/"]) && !("sitemap" in robots()));
env({ SITE_URL: "https://shop.example.com" });
check("robots: points to the sitemap when SITE_URL is set", (robots() as any).sitemap === "https://shop.example.com/sitemap.xml");
check("sitemap: lists the home, privacy and disclosure pages", JSON.stringify(sitemap().map((e) => e.url)) === JSON.stringify(["https://shop.example.com", "https://shop.example.com/privacy", "https://shop.example.com/disclosure"]), JSON.stringify(sitemap().map((e) => e.url)));
env({});
check("sitemap: empty without SITE_URL (never lists wrong addresses)", sitemap().length === 0);

const headers = await (nextConfig as any).headers();
const map = Object.fromEntries(headers[0].headers.map((h: any) => [h.key, h.value]));
check("headers: applied to every path", headers[0].source === "/:path*");
check("headers: nosniff, frame denial, referrer policy, permissions policy", map["X-Content-Type-Options"] === "nosniff" && map["X-Frame-Options"] === "DENY" && map["Referrer-Policy"] === "strict-origin-when-cross-origin" && /camera=\(\)/.test(map["Permissions-Policy"]));
check("headers: no Content-Security-Policy is set blindly (would break retailer images)", !("Content-Security-Policy" in map));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL LEGAL CHECKS PASSED");
process.exit(failures ? 1 : 0);
