import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { create as createFont } from "fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { filterPlaces, mapsUrl, stars } from "./domain";
import type { Library } from "./types";

export const exportSchema = z.object({
  format: z.enum(["xlsx", "pdf"]),
  ids: z.array(z.uuid()).min(1).max(500),
  filters: z.object({
    q: z.string(),
    country: z.string(),
    city: z.string(),
    category: z.string(),
    tag: z.string(),
    visited: z.enum(["", "yes", "no"]),
  }),
  visits: z.enum(["all", "latest", "none"]),
  visitNotes: z.boolean(),
  dishes: z.boolean(),
  dishNotes: z.boolean(),
  privateNotes: z.boolean(),
  sources: z.boolean(),
  summaries: z.boolean(),
});
export type ExportOptions = z.infer<typeof exportSchema>;
export function exportSelection(data: Library, options: ExportOptions) {
  const places = filterPlaces(data, options.filters).filter((p) => options.ids.includes(p.id));
  const ids = new Set(places.map((p) => p.id));
  let visits =
    options.visits === "none"
      ? []
      : data.visits
          .filter((v) => ids.has(v.place_id))
          .sort(
            (a, b) =>
              b.visited_on.localeCompare(a.visited_on) || b.created_at.localeCompare(a.created_at),
          );
  if (options.visits === "latest") {
    const seen = new Set<string>();
    visits = visits.filter((v) => {
      if (seen.has(v.place_id)) return false;
      seen.add(v.place_id);
      return true;
    });
  }
  const vids = new Set(visits.map((v) => v.id));
  const dishes = options.dishes ? data.dishes.filter((d) => vids.has(d.visit_id)) : [];
  return { places, visits, dishes };
}
export async function exportLibrary(data: Library, o: ExportOptions) {
  const { places, visits, dishes } = exportSelection(data, o);
  if (!places.length) throw new Error("沒有符合條件的店家");
  const getSources = (id: string) =>
    data.sources.filter((s) =>
      data.place_sources.some((l) => l.place_id === id && l.source_id === s.id),
    );
  if (o.format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Stone · 旅藏";
    const ps = wb.addWorksheet("店家總覽");
    ps.addRow([
      "店家識別碼",
      "店名",
      "國家／地區",
      "城市",
      "地址",
      "類型",
      "標籤",
      "Google Maps",
      "狀態",
      "店家總評",
      ...(o.privateNotes ? ["私人備註"] : []),
      ...(o.sources ? ["原始來源"] : []),
      ...(o.summaries ? ["來源摘要與推薦餐點"] : []),
    ]);
    for (const p of places)
      ps.addRow([
        p.id,
        p.name,
        p.country,
        p.city,
        p.address,
        p.categories.join("、"),
        p.tags.join("、"),
        { text: "開啟 Google Maps", hyperlink: mapsUrl(p) },
        data.visits.some((v) => v.place_id === p.id) ? "去過" : "想去",
        p.rating,
        ...(o.privateNotes ? [p.notes] : []),
        ...(o.sources
          ? [
              getSources(p.id)
                .map((s) => s.original_url)
                .join("\n"),
            ]
          : []),
        ...(o.summaries
          ? [
              getSources(p.id)
                .map(
                  (s) =>
                    `來源 ${s.id}：${s.summary}\n${s.candidates.map((c) => c.name + "：" + c.dishes.join("、")).join("\n")}`,
                )
                .join("\n"),
            ]
          : []),
      ]);
    const vs = wb.addWorksheet("到訪紀錄");
    vs.addRow([
      "到訪識別碼",
      "店家識別碼",
      "日期",
      "到訪評分",
      ...(o.visitNotes ? ["到訪心得"] : []),
    ]);
    for (const v of visits)
      vs.addRow([v.id, v.place_id, v.visited_on, v.rating, ...(o.visitNotes ? [v.notes] : [])]);
    const ds = wb.addWorksheet("餐點紀錄");
    ds.addRow([
      "品項識別碼",
      "到訪識別碼",
      "品項",
      "品項評分",
      ...(o.dishNotes ? ["品項評論"] : []),
    ]);
    for (const d of dishes)
      ds.addRow([d.id, d.visit_id, d.name, d.rating, ...(o.dishNotes ? [d.notes] : [])]);
    for (const sheet of wb.worksheets) {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF21554B" } };
      sheet.columns.forEach((c) => {
        c.width = 24;
      });
      sheet.eachRow((row) => {
        row.alignment = { vertical: "top", wrapText: true };
      });
    }
    return {
      bytes: await wb.xlsx.writeBuffer(),
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  const fontBytes = await readFile(path.join(process.cwd(), "public/fonts/NotoSansTC.ttf"));
  const parsedFont = createFont(fontBytes);
  if (!("characterSet" in parsedFont)) throw new Error("Invalid export font");
  const characterSet = new Set(parsedFont.characterSet);
  const pdf = new PDFDocument({
    size: [420, 595],
    margins: { top: 32, bottom: 38, left: 28, right: 28 },
    info: { Title: "旅藏 · 我的旅行口袋名單", Author: "Stone 旅藏" },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  pdf.registerFont("CJK", fontBytes).font("CJK");
  const write = (text: string, size = 11, link?: string) => {
    const clean = [...text.replace(/\r/g, "")]
      .map((c) => (c === "\n" || characterSet.has(c.codePointAt(0)!) ? c : "□"))
      .join("");
    pdf
      .fontSize(size)
      .fillColor(link ? "#24584c" : "#233d35")
      .text(clean, { lineGap: 4, link, underline: !!link });
    pdf.moveDown(0.25);
  };
  write("旅藏 · 我的旅行口袋名單", 19);
  write(`${places.length} 家店 · 匯出內容為當下選定資料`, 10);
  pdf.moveDown(0.7);
  for (const p of places) {
    if (pdf.y > 440) pdf.addPage();
    write(p.name, 17);
    write([p.country, p.city, p.categories.join("、")].filter(Boolean).join(" · "));
    if (p.address) write(p.address);
    write(
      `店家總評：${stars(p.rating)} · ${data.visits.some((v) => v.place_id === p.id) ? "去過" : "想去"}`,
    );
    if (p.tags.length) write(`標籤：${p.tags.join("、")}`);
    write("在 Google Maps 開啟 ↗", 11, mapsUrl(p));
    if (o.privateNotes && p.notes) write(`私人備註：${p.notes}`);
    for (const v of visits.filter((v) => v.place_id === p.id)) {
      write(`${v.visited_on} 到訪 · ${stars(v.rating)}`, 12);
      if (o.visitNotes && v.notes) write(v.notes);
      for (const d of dishes.filter((d) => d.visit_id === v.id)) {
        write(`  ${d.name} · ${stars(d.rating)}`);
        if (o.dishNotes && d.notes) write(`  ${d.notes}`);
      }
    }
    for (const s of getSources(p.id)) {
      if (o.sources) write(`收藏來源：${s.original_url}`, 9, s.original_url);
      if (o.summaries) {
        write(`來源 ${s.id} 摘要：${s.summary || "尚未解析"}`, 10);
        for (const c of s.candidates)
          write(`${c.name} · 文章推薦：${c.dishes.join("、") || "未提供"}`, 10);
      }
    }
    pdf.moveDown(1);
  }
  pdf.end();
  return { bytes: await finished, type: "application/pdf" };
}
