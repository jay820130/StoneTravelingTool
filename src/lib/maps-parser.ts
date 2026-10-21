import { isMapsHost, sourceUrl } from "./domain";
import type { MapsData } from "./types";
import type { ParseResult } from "./parser";

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};
export function parseMapsUrl(input: string): MapsData {
  const u = new URL(sourceUrl(input).original);
  if (!isMapsHost(u.hostname)) throw new Error("不是 Google Maps 連結");
  const path = decode(u.pathname);
  const pairs = [...(path + u.search).matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  const viewport =
    path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ||
    (u.searchParams.get("query") || u.searchParams.get("q") || "").match(
      /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/,
    );
  const coords = pairs.length === 1 ? pairs[0] : viewport;
  const valid = coords && Math.abs(Number(coords[1])) <= 90 && Math.abs(Number(coords[2])) <= 180;
  const cid = u.searchParams.get("cid") || u.searchParams.get("ludocid") || "";
  const pid =
    u.searchParams.get("query_place_id") ||
    (u.searchParams.get("q") || "").match(/^place_id:(\S+)$/)?.[1] ||
    path.match(/!1s(ChI[^!/?]+)/)?.[1] ||
    "";
  return {
    final_url: u.toString(),
    name: decode(u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1] || "").slice(0, 200),
    latitude: valid ? Number(coords[1]) : null,
    longitude: valid ? Number(coords[2]) : null,
    ...(valid
      ? { coordinate_kind: pairs.length === 1 ? ("place" as const) : ("viewport" as const) }
      : {}),
    place_id: pid.slice(0, 300),
    cid: /^\d+$/.test(cid) ? cid : "",
    feature_id: path.match(/!1s(0x[\da-f]+:0x[\da-f]+)/i)?.[1] || "",
  };
}
export function mapsResult(map: MapsData): ParseResult {
  return {
    status: map.name ? "partial" : "needs_input",
    summary: "",
    candidates: map.name
      ? [
          {
            name: map.name,
            branch: "",
            location_clues: "",
            country: "",
            city: "",
            address: "",
            categories: [],
            dishes: [],
            summary: "",
            latitude: map.latitude,
            longitude: map.longitude,
            coordinate_kind: map.coordinate_kind,
          },
        ]
      : [],
    error: map.name
      ? "已從網址讀取店名；地址、分店與位置仍請確認，可補文字或截圖。"
      : "網址未包含足夠的店家資訊，請補上文字或截圖。原始連結已保存。",
    map_data: map,
  };
}
