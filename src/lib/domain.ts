import { z } from "zod";
import type { Library, Place } from "./types";

export const ratingSchema = z.number().int().min(1).max(5).nullable();
const short = z.string().trim().max(200);
export const placeSchema = z
  .object({
    name: short.min(1, "請填寫店名"),
    country: short.default(""),
    city: short.default(""),
    address: z.string().trim().max(1000).default(""),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    categories: z.array(short.min(1)).max(20).default([]),
    tags: z.array(short.min(1)).max(30).default([]),
    rating: ratingSchema.default(null),
    notes: z.string().max(20000).default(""),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), "經緯度請一起填寫或留空");
export const visitSchema = z.object({
  id: z.string().uuid().optional(),
  place_id: z.string().uuid(),
  visited_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => {
      const d = new Date(s);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, "日期無效"),
  rating: ratingSchema,
  notes: z.string().max(20000),
  dishes: z
    .array(z.object({ name: short.min(1), rating: ratingSchema, notes: z.string().max(5000) }))
    .max(50),
});
export const candidateSchema = z.object({
  name: short.min(1),
  country: short,
  city: short,
  address: z.string().max(1000),
  categories: z.array(short).max(20),
  dishes: z.array(short).max(30),
  summary: z.string().max(3000),
});
export const extractionSchema = z.object({
  summary: z.string().max(8000),
  candidates: z.array(candidateSchema).max(30),
});

const cities: Record<string, string> = {
  osaka: "大阪",
  大阪市: "大阪",
  tokyo: "東京",
  東京都: "東京",
  kyoto: "京都",
  taipei: "台北",
  臺北: "台北",
  kaohsiung: "高雄",
};
const countries: Record<string, string> = {
  japan: "日本",
  jp: "日本",
  taiwan: "台灣",
  tw: "台灣",
  臺灣: "台灣",
};
export function normalizeRegion(value: string, kind: "country" | "city") {
  const s = value.trim();
  return (kind === "city" ? cities : countries)[s.toLowerCase()] ?? s;
}
export interface Filters {
  q: string;
  country: string;
  city: string;
  category: string;
  tag: string;
  visited: "" | "yes" | "no";
}
export const emptyFilters: Filters = {
  q: "",
  country: "",
  city: "",
  category: "",
  tag: "",
  visited: "",
};
export function filterPlaces(data: Library, f: Filters): Place[] {
  const visited = new Set(data.visits.map((v) => v.place_id));
  return data.places.filter(
    (p) =>
      (!f.q || p.name.toLocaleLowerCase().includes(f.q.trim().toLocaleLowerCase())) &&
      (!f.country ||
        normalizeRegion(p.country, "country") === normalizeRegion(f.country, "country")) &&
      (!f.city || normalizeRegion(p.city, "city") === normalizeRegion(f.city, "city")) &&
      (!f.category || p.categories.includes(f.category)) &&
      (!f.tag || p.tags.includes(f.tag)) &&
      (!f.visited || visited.has(p.id) === (f.visited === "yes")),
  );
}
export function mapsUrl(
  place: Pick<Place, "name" | "address" | "city" | "country" | "latitude" | "longitude">,
) {
  const q =
    place.latitude !== null && place.longitude !== null
      ? `${place.latitude},${place.longitude}`
      : [place.name, place.address, place.city, place.country].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
export function sourceUrl(input: string): { original: string; canonical: string } {
  const original = z.string().trim().max(4000).url().parse(input);
  const u = new URL(original);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("僅接受 HTTPS 網址");
  if (!allowedSourceHost(u.hostname))
    throw new Error("請貼上 Instagram、Threads 或 Google Maps 連結");
  if (["www.google.com", "google.com"].includes(u.hostname) && !u.pathname.startsWith("/maps"))
    throw new Error("請使用 Google Maps 連結");
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || ["igsh", "igshid", "fbclid"].includes(key))
      u.searchParams.delete(key);
  u.searchParams.sort();
  return { original, canonical: u.toString() };
}
export function allowedSourceHost(host: string) {
  return [
    "instagram.com",
    "www.instagram.com",
    "threads.net",
    "www.threads.net",
    "threads.com",
    "www.threads.com",
    "maps.app.goo.gl",
    "maps.google.com",
    "www.google.com",
    "google.com",
  ].includes(host.toLowerCase());
}
export function stars(rating: number | null) {
  return rating === null ? "尚未評分" : "★".repeat(rating) + "☆".repeat(5 - rating);
}
