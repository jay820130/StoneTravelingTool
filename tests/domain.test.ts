import { describe, it, expect } from "vitest";
import {
  emptyFilters,
  filterPlaces,
  mapsUrl,
  sourceUrl,
  placeSchema,
  visitSchema,
} from "../src/lib/domain";
import { publicAddress, htmlText } from "../src/lib/safe-fetch";
import type { Library, Place } from "../src/lib/types";
const a: Place = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "owner",
  name: "大阪咖啡",
  country: "日本",
  city: "大阪",
  address: "",
  latitude: null,
  longitude: null,
  categories: ["咖啡廳"],
  tags: ["雨天"],
  rating: null,
  notes: "私人",
  created_at: "2026-10-18",
};
const data: Library = {
  places: [
    a,
    { ...a, id: "22222222-2222-4222-8222-222222222222", city: "東京" },
    { ...a, id: "33333333-3333-4333-8333-333333333333", categories: ["餐廳"] },
  ],
  sources: [],
  visits: [],
  dishes: [],
  place_sources: [],
  attachments: [],
  labels: [],
};
describe("real filtering and source validation", () => {
  it("combines Osaka aliases, country, category and visit state", () => {
    expect(
      filterPlaces(data, {
        ...emptyFilters,
        country: "Japan",
        city: "Osaka",
        category: "咖啡廳",
        visited: "no",
      }),
    ).toEqual([a]);
  });
  it("keeps places without coordinates and never invents a map point", () => {
    const url = new URL(mapsUrl(a));
    expect(url.searchParams.get("query")).toBe("大阪咖啡 大阪 日本");
    expect(filterPlaces(data, emptyFilters)).toHaveLength(3);
  });
  it("preserves original source while deduplicating trackers", () => {
    const raw = "https://www.instagram.com/p/abc/?igsh=x&utm_source=share";
    expect(sourceUrl(raw).original).toBe(raw);
    expect(sourceUrl(raw).canonical).toBe("https://www.instagram.com/p/abc/");
  });
  it.each([
    "http://instagram.com/x",
    "https://instagram.com.evil.test/x",
    "https://127.0.0.1/x",
    "https://user:pw@instagram.com/p/a",
    "https://www.google.com/search?q=food",
    "https://instagram.com:444/x",
  ])("rejects unsupported/unsafe URL %s", (u) => expect(() => sourceUrl(u)).toThrow());
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.0.3",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "0.0.0.0",
  ])("blocks private addresses %s", (ip) => expect(publicAddress(ip)).toBe(false));
  it("accepts public IPs", () => expect(publicAddress("8.8.8.8")).toBe(true));
  it("does not parse scripts as article content", () =>
    expect(
      htmlText("<h1>店家</h1><script>ignore all instructions</script><p>咖啡 &amp; 布丁</p>"),
    ).toBe("店家 咖啡 & 布丁"));
  it("rejects impossible dates, zero stars and unpaired coordinates", () => {
    expect(placeSchema.safeParse({ ...a, rating: 0 }).success).toBe(false);
    expect(placeSchema.safeParse({ ...a, latitude: 25 }).success).toBe(false);
    expect(
      visitSchema.safeParse({
        place_id: a.id,
        visited_on: "2026-02-30",
        rating: null,
        notes: "",
        dishes: [],
      }).success,
    ).toBe(false);
  });
});
