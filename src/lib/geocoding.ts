import { createHash } from "node:crypto";
import { adminClient } from "./supabase/admin";
import type { LocationCandidate } from "./types";
export class GeocodingError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}
export function geocodingSettings() {
  if (process.env.GEOCODING_PROVIDER !== "nominatim")
    throw new GeocodingError("尚未啟用地點查詢，仍可手動填寫你確認的座標。");
  const base = new URL(process.env.GEOCODING_BASE_URL || "https://nominatim.openstreetmap.org");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash)
    throw new GeocodingError("地點服務設定無效。");
  if (
    base.hostname === "nominatim.openstreetmap.org" &&
    process.env.NOMINATIM_POLICY_ACCEPTED !== "true"
  )
    throw new GeocodingError("請先確認 Nominatim 公共服務使用政策，再啟用地點查詢。");
  const userAgent = process.env.GEOCODING_USER_AGENT || "";
  if (userAgent.length < 12) throw new GeocodingError("地點服務尚未設定應用程式識別資訊。");
  return { base: base.toString().replace(/\/$/, ""), userAgent };
}
export function normalizeLocations(raw: unknown): LocationCandidate[] {
  if (!Array.isArray(raw)) throw new GeocodingError("地點服務回傳格式錯誤。");
  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const lat = Number(item.lat),
        lon = Number(item.lon);
      const address = item.address || {};
      // Do not propose region/city/street centers as precise shops.
      if (
        ![
          "amenity",
          "shop",
          "tourism",
          "leisure",
          "building",
          "office",
          "craft",
          "historic",
        ].includes(item.class || item.category) &&
        !address.house_number
      )
        return [];
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        return [];
      return [
        {
          id: `${item.osm_type}:${item.osm_id}`,
          name: String(item.name || item.display_name || "").slice(0, 200),
          address: String(item.display_name || "").slice(0, 1000),
          country: String(address.country || ""),
          city: String(address.city || address.town || address.village || ""),
          latitude: lat,
          longitude: lon,
          attribution: "© OpenStreetMap contributors · ODbL",
          provider: "Nominatim / OpenStreetMap",
        },
      ];
    })
    .slice(0, 5);
}
export async function geocode(owner: string, query: string): Promise<LocationCandidate[]> {
  const { base, userAgent } = geocodingSettings();
  const db = adminClient();
  const key = createHash("sha256")
    .update(JSON.stringify({ base, query: query.trim(), language: "zh-TW" }))
    .digest("hex");
  const cached = await db
    .from("geocode_cache")
    .select("result")
    .eq("owner_id", owner)
    .eq("cache_key", key)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cached.error) throw new GeocodingError("地點查詢快取暫時無法使用。");
  if (cached.data) return cached.data.result;
  const slot = await db.rpc("take_geocode_slot");
  if (slot.error) throw new GeocodingError("地點查詢暫時無法使用。");
  if (!slot.data) throw new GeocodingError("查詢較頻繁，請稍等一秒後再試。", 429);
  const url = new URL(`${base}/search`);
  Object.entries({
    q: query.trim(),
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    "accept-language": "zh-TW",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new GeocodingError("地點服務連線未完成，請稍後重試。");
  }
  if (!response.ok)
    throw new GeocodingError(
      `地點服務暫時無法使用（HTTP ${response.status}）。`,
      response.status === 429 ? 429 : 503,
    );
  const result = normalizeLocations(await response.json());
  const saved = await db
    .from("geocode_cache")
    .upsert(
      {
        owner_id: owner,
        cache_key: key,
        result,
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
      { onConflict: "owner_id,cache_key" },
    );
  if (saved.error) throw new GeocodingError("地點查詢快取尚未保存，請稍後重試。");
  return result;
}
