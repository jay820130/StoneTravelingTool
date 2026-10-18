import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { exportLibrary, exportSelection, type ExportOptions } from "../src/lib/export";
import { emptyFilters } from "../src/lib/domain";
import type { Library } from "../src/lib/types";
const pid = "11111111-1111-4111-8111-111111111111",
  sid = "22222222-2222-4222-8222-222222222222";
const data: Library = {
  places: [
    {
      id: pid,
      owner_id: "u",
      name: "大阪咖啡・喫茶",
      country: "日本",
      city: "大阪",
      address: "大阪市",
      latitude: null,
      longitude: null,
      categories: ["咖啡廳"],
      tags: ["雨天"],
      rating: 5,
      notes: "PRIVATE_DO_NOT_SHARE",
      created_at: "2026-10-18",
    },
  ],
  sources: [],
  visits: [
    {
      id: "v2",
      owner_id: "u",
      place_id: pid,
      visited_on: "2026-10-19",
      rating: 4,
      notes: "第二次心得",
      created_at: "2026-10-19",
    },
    {
      id: "v1",
      owner_id: "u",
      place_id: pid,
      visited_on: "2026-10-18",
      rating: 5,
      notes: "第一次心得",
      created_at: "2026-10-18",
    },
  ],
  dishes: [
    { id: "d1", owner_id: "u", visit_id: "v1", name: "拿鐵", rating: 5, notes: "咖啡香" },
    { id: "d2", owner_id: "u", visit_id: "v1", name: "布丁", rating: 3, notes: "甜" },
    { id: "d3", owner_id: "u", visit_id: "v2", name: "焙茶", rating: 4, notes: "好喝" },
  ],
  place_sources: [],
  attachments: [],
  labels: [],
};
const opts: ExportOptions = {
  format: "xlsx",
  ids: [pid, sid],
  filters: { ...emptyFilters, city: "大阪", category: "咖啡廳" },
  visits: "all",
  visitNotes: true,
  dishes: true,
  dishNotes: true,
  privateNotes: false,
  sources: false,
  summaries: false,
};
describe("exports preserve selected records and privacy", () => {
  it("selects exactly the displayed filters and requested ids", () => {
    expect(exportSelection(data, opts).places).toHaveLength(1);
    expect(
      exportSelection(data, { ...opts, filters: { ...opts.filters, city: "東京" } }).places,
    ).toEqual([]);
    expect(exportSelection(data, { ...opts, ids: [sid] }).places).toEqual([]);
  });
  it("latest visit also restricts its dishes", () => {
    const r = exportSelection(data, { ...opts, visits: "latest" });
    expect(r.visits.map((v) => v.id)).toEqual(["v2"]);
    expect(r.dishes.map((d) => d.id)).toEqual(["d3"]);
  });
  it("XLSX retains two visits, three dishes, literal user strings and hyperlinks", async () => {
    const out = await exportLibrary(data, opts);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.bytes as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => [s.name, s.rowCount])).toEqual([
      ["店家總覽", 2],
      ["到訪紀錄", 3],
      ["餐點紀錄", 4],
    ]);
    const rows = JSON.stringify(wb.worksheets.map((s) => s.getSheetValues()));
    expect(rows).toContain("拿鐵");
    expect(rows).toContain("第一次心得");
    expect(rows).not.toContain("PRIVATE_DO_NOT_SHARE");
    expect(wb.worksheets[0].getRow(2).getCell(8).hyperlink).toContain(
      "https://www.google.com/maps/",
    );
  });
  it("omitting comments really removes them from output", async () => {
    const out = await exportLibrary(data, {
      ...opts,
      visitNotes: false,
      dishNotes: false,
      visits: "latest",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.bytes as unknown as ExcelJS.Buffer);
    const rows = JSON.stringify(wb.worksheets.map((s) => s.getSheetValues()));
    expect(rows).not.toContain("心得");
    expect(rows).not.toContain("好喝");
    expect(wb.worksheets[1].rowCount).toBe(2);
    expect(wb.worksheets[2].rowCount).toBe(2);
  });
  it("PDF embeds Chinese, clickable Maps links and paginates long reviews", async () => {
    const long = structuredClone(data);
    long.visits[0].notes = "跨頁心得測試。".repeat(400);
    const out = await exportLibrary(long, { ...opts, format: "pdf" });
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const annotation = pdf.getPage(0).node.Annots()?.get(0);
    expect(annotation).toBeDefined();
    const dict = pdf.context.lookup(annotation!) as import("pdf-lib").PDFDict;
    const action = dict.lookup(PDFName.of("A")) as import("pdf-lib").PDFDict;
    expect((action.lookup(PDFName.of("URI")) as PDFString).decodeText()).toContain(
      "https://www.google.com/maps/",
    );
    await mkdir(".local", { recursive: true });
    await writeFile(".local/test-export.pdf", new Uint8Array(out.bytes));
    const text = execFileSync("pdftotext", [".local/test-export.pdf", "-"], { encoding: "utf8" });
    expect(text).toContain("大阪咖啡");
    expect(text).toContain("拿鐵");
    expect(text).toContain("跨頁心得");
    expect(text).not.toContain("PRIVATE_DO_NOT_SHARE");
  });
});
