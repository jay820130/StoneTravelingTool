import type { SupabaseClient } from "@supabase/supabase-js";
import type { Library } from "./types";
export async function loadLibrary(db: SupabaseClient): Promise<Library> {
  const names = [
    "places",
    "sources",
    "visits",
    "dishes",
    "place_sources",
    "attachments",
    "labels",
  ] as const;
  const entries = await Promise.all(
    names.map(async (name) => {
      const rows: unknown[] = [];
      // PostgREST caps each response; page explicitly so exports never silently truncate.
      for (let start = 0; ; start += 500) {
        const order = name === "place_sources" ? "source_id" : "id";
        let query = db
          .from(name)
          .select("*")
          .order(order)
          .range(start, start + 499);
        if (name === "place_sources") query = query.order("place_id");
        const { data, error } = await query;
        if (error) throw new Error("讀取資料失敗，請確認資料庫 migrations 已套用");
        rows.push(...data);
        if (data.length < 500) break;
      }
      return [name, rows];
    }),
  );
  const library = Object.fromEntries(entries) as unknown as Library;
  library.places.sort((a, b) => b.created_at.localeCompare(a.created_at));
  library.sources.sort((a, b) => b.created_at.localeCompare(a.created_at));
  library.visits.sort(
    (a, b) => b.visited_on.localeCompare(a.visited_on) || b.created_at.localeCompare(a.created_at),
  );
  return library;
}
