import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { NearbyStore } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const RETAILER_PATTERN = "Nike|Foot Locker|Kids Foot Locker|Champs Sports|JD Sports|Finish Line|Dick.?s Sporting Goods|Hibbett|Shoe Palace|Snipes|Flight Club|adidas|New Balance|ASICS|PUMA";
function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
async function readCache(zip: string, radius: number) {
  const sql = getDb(); if (!sql) return null;
  try {
    const rows = await sql`SELECT latitude, longitude, stores_json FROM retailer_store_search_cache WHERE zip_code = ${zip} AND radius_miles = ${radius} AND expires_at > now() LIMIT 1` as Array<Record<string, unknown>>;
    const row = rows[0]; if (!row) return null;
    const stores = typeof row.stores_json === "string" ? JSON.parse(row.stores_json) : row.stores_json;
    return Array.isArray(stores) ? { latitude: Number(row.latitude), longitude: Number(row.longitude), stores: stores as NearbyStore[] } : null;
  } catch { return null; }
}
async function writeCache(zip: string, radius: number, lat: number, lon: number, stores: NearbyStore[]) {
  const sql = getDb(); if (!sql) return;
  try {
    await sql`
      INSERT INTO retailer_store_search_cache (zip_code, radius_miles, latitude, longitude, stores_json, cached_at, expires_at)
      VALUES (${zip}, ${radius}, ${lat}, ${lon}, ${JSON.stringify(stores)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (zip_code, radius_miles) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
        stores_json = EXCLUDED.stores_json, cached_at = now(), expires_at = now() + interval '24 hours'
    `;
  } catch { /* Public location lookup can still complete if caching fails. */ }
}

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip")?.trim().slice(0, 5) ?? "";
  const radius = Number(request.nextUrl.searchParams.get("radius") ?? 25);
  if (!/^\d{5}$/.test(zip)) return NextResponse.json({ error: "Enter a valid five-digit US ZIP code." }, { status: 400 });
  if (![5, 10, 25, 50, 100].includes(radius)) return NextResponse.json({ error: "Choose a radius of 5, 10, 25, 50, or 100 miles." }, { status: 400 });
  const cached = await readCache(zip, radius);
  if (cached) return NextResponse.json({ zip, radiusMiles: radius, ...cached, cached: true, source: "OpenStreetMap" });
  try {
    const zipResponse = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(7_000), next: { revalidate: 86_400 } });
    if (!zipResponse.ok) return NextResponse.json({ error: "That ZIP code could not be found. Check the ZIP and try again." }, { status: 404 });
    const zipData = await zipResponse.json() as { places?: Array<{ latitude?: string; longitude?: string; "place name"?: string; state?: string }> };
    const place = zipData.places?.[0]; const latitude = Number(place?.latitude); const longitude = Number(place?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return NextResponse.json({ error: "The ZIP code service did not return usable coordinates." }, { status: 502 });
    const radiusMeters = Math.round(radius * 1609.344);
    const ql = `[out:json][timeout:20];(nwr["brand"~"${RETAILER_PATTERN}",i](around:${radiusMeters},${latitude},${longitude});nwr["name"~"${RETAILER_PATTERN}",i](around:${radiusMeters},${latitude},${longitude}););out center tags;`;
    let osmResponse: Response | null = null;
    for (const endpoint of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "OutletRadar/1.7 (sneaker retailer location finder)" }, body: `data=${encodeURIComponent(ql)}`, signal: AbortSignal.timeout(9_000) });
        if (response.ok) { osmResponse = response; break; }
      } catch { /* try alternate public Overpass host */ }
    }
    if (!osmResponse) return NextResponse.json({ error: "The public retailer-location service is temporarily unavailable. Please try again later." }, { status: 502 });
    const osm = await osmResponse.json() as { elements?: Array<{ type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> };
    const seen = new Set<string>();
    const stores = (osm.elements ?? []).flatMap((element): NearbyStore[] => {
      const tags = element.tags ?? {}; const name = text(tags.name) || text(tags.brand);
      if (!new RegExp(RETAILER_PATTERN, "i").test(`${name} ${tags.brand ?? ""}`)) return [];
      const lat = Number(element.lat ?? element.center?.lat); const lon = Number(element.lon ?? element.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const id = `${element.type ?? "node"}-${element.id ?? `${lat},${lon}`}`;
      if (seen.has(id)) return []; seen.add(id);
      const distance = milesBetween(latitude, longitude, lat, lon); if (distance > radius + 0.2) return [];
      const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
      const city = text(tags["addr:city"] || tags["addr:town"] || tags["addr:suburb"] || tags["addr:village"] || place?.["place name"]);
      const region = text(tags["addr:state"] || place?.state); const postalCode = text(tags["addr:postcode"]);
      const address = [street, city, region, postalCode].filter(Boolean).join(", ") || [city, region].filter(Boolean).join(", ") || "Address not listed";
      const brand = text(tags.brand); const label = brand || name;
      let storeType = "Sneaker retailer";
      if (/foot locker/i.test(label)) storeType = "Foot Locker";
      else if (/champs/i.test(label)) storeType = "Champs Sports";
      else if (/jd sports/i.test(label)) storeType = "JD Sports";
      else if (/finish line/i.test(label)) storeType = "Finish Line";
      else if (/dick.?s/i.test(label)) storeType = "DICK'S Sporting Goods";
      else if (/hibbett/i.test(label)) storeType = "Hibbett";
      else if (/shoe palace/i.test(label)) storeType = "Shoe Palace";
      else if (/snipes/i.test(label)) storeType = "Snipes";
      else if (/flight club/i.test(label)) storeType = "Flight Club";
      else if (/nike/i.test(label)) storeType = /factory|clearance|outlet/i.test(name) ? "Nike Factory / Clearance" : "Nike Store";
      else if (/adidas/i.test(label)) storeType = "adidas";
      else if (/new balance/i.test(label)) storeType = "New Balance";
      else if (/asics/i.test(label)) storeType = "ASICS";
      else if (/puma/i.test(label)) storeType = "PUMA";
      return [{ id, name: name || label, address, city, region, postalCode: postalCode || undefined, latitude: lat, longitude: lon, distanceMiles: Math.round(distance * 10) / 10, storeType, mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}` }];
    }).sort((a, b) => a.distanceMiles - b.distanceMiles);
    await writeCache(zip, radius, latitude, longitude, stores);
    return NextResponse.json({ zip, radiusMiles: radius, center: { latitude, longitude, place: place?.["place name"], state: place?.state }, stores, cached: false, source: "OpenStreetMap", note: "These are nearby retailer locations, not product-level inventory. Call or check the retailer's pickup flow to confirm the requested size." });
  } catch { return NextResponse.json({ error: "Could not complete the nearby retailer search. Please try again." }, { status: 502 }); }
}
