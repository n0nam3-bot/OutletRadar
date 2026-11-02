import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { NearbyStore } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function readCache(zip: string, radius: number) {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT latitude, longitude, stores_json
      FROM nike_store_search_cache
      WHERE zip_code = ${zip} AND radius_miles = ${radius} AND expires_at > now()
      LIMIT 1
    ` as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;
    const stores = typeof row.stores_json === "string" ? JSON.parse(row.stores_json) : row.stores_json;
    return Array.isArray(stores) ? { latitude: Number(row.latitude), longitude: Number(row.longitude), stores: stores as NearbyStore[] } : null;
  } catch { return null; }
}

async function writeCache(zip: string, radius: number, lat: number, lon: number, stores: NearbyStore[]) {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO nike_store_search_cache (zip_code, radius_miles, latitude, longitude, stores_json, cached_at, expires_at)
      VALUES (${zip}, ${radius}, ${lat}, ${lon}, ${JSON.stringify(stores)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (zip_code, radius_miles) DO UPDATE SET
        latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
        stores_json = EXCLUDED.stores_json, cached_at = now(), expires_at = now() + interval '24 hours'
    `;
  } catch { /* Nearby-store lookup still succeeds if the optional cache table is missing. */ }
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
    const place = zipData.places?.[0];
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return NextResponse.json({ error: "The ZIP code service did not return usable coordinates." }, { status: 502 });

    const radiusMeters = Math.round(radius * 1609.344);
    const ql = `[out:json][timeout:20];(nwr["brand"~"Nike",i](around:${radiusMeters},${latitude},${longitude});nwr["name"~"Nike",i](around:${radiusMeters},${latitude},${longitude}););out center tags;`;
    let osmResponse: Response | null = null;
    for (const endpoint of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "OutletRadar/1.1 (Nike store locator)" },
          body: `data=${encodeURIComponent(ql)}`,
          signal: AbortSignal.timeout(8_000),
        });
        if (response.ok) { osmResponse = response; break; }
      } catch { /* Try the next public Overpass instance. */ }
    }
    if (!osmResponse) return NextResponse.json({ error: "The public store-location service is temporarily unavailable. Please try again later." }, { status: 502 });

    const osm = await osmResponse.json() as { elements?: Array<{ type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> };
    const seen = new Set<string>();
    const stores = (osm.elements ?? []).flatMap((element): NearbyStore[] => {
      const tags = element.tags ?? {};
      const name = text(tags.name) || text(tags.brand);
      const lat = Number(element.lat ?? element.center?.lat);
      const lon = Number(element.lon ?? element.center?.lon);
      if (!/nike/i.test(`${name} ${tags.brand ?? ""}`) || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const id = `${element.type ?? "node"}-${element.id ?? `${lat},${lon}`}`;
      if (seen.has(id)) return [];
      seen.add(id);
      const miles = milesBetween(latitude, longitude, lat, lon);
      if (miles > radius + 0.2) return [];
      const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
      const city = text(tags["addr:city"] || tags["addr:town"] || tags["addr:suburb"] || tags["addr:village"] || place?.["place name"]);
      const region = text(tags["addr:state"] || place?.state);
      const postalCode = text(tags["addr:postcode"]);
      const address = [street, city, region, postalCode].filter(Boolean).join(", ") || [city, region].filter(Boolean).join(", ") || "Address not listed";
      const isFactory = /factory|clearance|outlet/i.test(`${name} ${tags.shop ?? ""}`);
      return [{
        id, name: name || "Nike store", address, city, region, postalCode: postalCode || undefined,
        latitude: lat, longitude: lon, distanceMiles: Math.round(miles * 10) / 10,
        storeType: isFactory ? "Factory / Clearance" : "Nike Store",
        mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lon}`)}`,
      }];
    }).sort((a, b) => a.distanceMiles - b.distanceMiles);

    await writeCache(zip, radius, latitude, longitude, stores);
    return NextResponse.json({
      zip, radiusMiles: radius, center: { latitude, longitude, place: place?.["place name"], state: place?.state },
      stores, cached: false, source: "OpenStreetMap",
      note: "Store locations can be incomplete. This list does not report product-level inventory or verify clearance-floor stock.",
    });
  } catch {
    return NextResponse.json({ error: "Could not complete the nearby-store search. Please try again." }, { status: 502 });
  }
}
