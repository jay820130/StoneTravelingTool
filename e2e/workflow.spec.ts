import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { processOneJob } from "../src/lib/worker";
type TestUser = { email: string; password: string; id: string };
const users: TestUser[] = JSON.parse(readFileSync(".local/test-users.json", "utf8"));
async function login(page: Page, user = users[0]) {
  await page.goto("/");
  await page.getByLabel("電子郵件", { exact: true }).fill(user.email);
  await page.getByLabel("密碼", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登入我的收藏", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的收藏", exact: false })).toBeVisible();
}
test.describe.serial("private collection on real local Supabase", () => {
  test.beforeAll(async () => {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    const signup = await db.auth.signUp({
      email: "stone-e2e-uninvited@example.test",
      password: crypto.randomUUID(),
    });
    expect(signup.error?.code).toBe("signup_disabled");
  });
  test("saves stores, two visits and dishes, then restores after sign-in", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "手動新增", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("店名 *").fill("測試·大阪咖啡");
    await dialog.getByLabel("國家／地區", { exact: true }).fill("Japan");
    await dialog.getByLabel("城市", { exact: true }).fill("Osaka");
    await dialog.getByLabel("地址", { exact: true }).fill("測試地址，非真實店家");
    await dialog.getByLabel("咖啡廳", { exact: true }).check();
    await dialog.getByLabel("自訂標籤").fill("測試標籤");
    await dialog.getByLabel("我的店家總評").selectOption("5");
    await dialog.getByLabel("額外私人備註").fill("不要匯出的私人備註");
    await dialog.getByText("精確位置（選填）").click();
    await dialog.getByLabel("緯度", { exact: true }).fill("34.69");
    await dialog.getByLabel("經度", { exact: true }).fill("135.50");
    await dialog.getByRole("button", { name: "儲存店家", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    for (const [i, date] of ["2026-10-18", "2026-10-19"].entries()) {
      await page
        .getByRole("button", { name: /測試·大阪咖啡/ })
        .first()
        .click();
      await page.getByRole("button", { name: "新增到訪", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("到訪日期 *").fill(date);
      await dialog.getByLabel("這次到訪評分").selectOption(i ? "4" : "5");
      await dialog.getByLabel("到訪心得", { exact: true }).fill(`第 ${i + 1} 次測試心得`);
      for (const [n, name] of ["拿鐵", "布丁"].entries()) {
        await dialog.getByRole("button", { name: "加入品項" }).click();
        await dialog.getByLabel(`品項 ${n + 1} 名稱`, { exact: true }).fill(name);
        await dialog
          .getByRole("combobox", { name: `品項 ${n + 1} 評分`, exact: true })
          .selectOption(n ? "3" : "5");
        await dialog.getByLabel(`品項 ${n + 1} 評論`, { exact: true }).fill(`${name}測試評論`);
      }
      await dialog.getByRole("button", { name: "儲存到訪紀錄", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.getByRole("button", { name: "登出", exact: true }).click();
    await login(page);
    await page
      .getByRole("button", { name: /測試·大阪咖啡/ })
      .first()
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText("2026-10-18", { exact: true })).toBeVisible();
    await expect(dialog.getByText("2026-10-19", { exact: true })).toBeVisible();
    await expect(dialog.getByText("拿鐵", { exact: true })).toHaveCount(2);
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByLabel("國家篩選").selectOption("日本");
    await page.getByLabel("城市篩選").selectOption("大阪");
    await page.getByRole("button", { name: "咖啡廳", exact: true }).click();
    await page.getByLabel("到訪狀態篩選").selectOption("yes");
    await expect(page.getByRole("button", { name: /測試·大阪咖啡/ }).first()).toBeVisible();
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.getByRole("button", { name: "位置模式" }).click();
    await expect(page.getByLabel("收藏店家位置地圖")).toBeVisible();
    await expect(page.locator(".leaflet-interactive")).toHaveCount(1);
    await expect(page.getByText("部分底圖無法載入", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "匯出分享", exact: true }).click();
    await expect(page.getByLabel("額外私人備註", { exact: true })).not.toBeChecked();
    await expect(page.locator(".export-preview")).not.toContainText("不要匯出的私人備註");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載 XLSX" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
    expect(await file.failure()).toBeNull();
    const pdfDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載 PDF" }).click();
    const pdf = await pdfDownload;
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await pdf.failure()).toBeNull();
  });
  test("deduplicates links, keeps unreadable sources, protects screenshots and preserves manual edits", async ({
    page,
    playwright,
  }) => {
    await login(page);
    const url = "https://www.instagram.com/p/stone-e2e-fixture/?utm_source=test";
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("收藏連結", { exact: true }).fill(url);
      await page.getByRole("button", { name: "收進口袋", exact: false }).click();
      await expect(page.getByLabel("收藏連結", { exact: true })).toHaveValue("");
    }
    const source = page.locator(".source-card");
    await expect(source).toHaveCount(1);
    await source.click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("補上文章內容或店家資訊")
      .fill("測試內容：讀不到社群文章時保留這段補充");
    await dialog.getByRole("button", { name: "儲存補充內容並重新解析" }).click();
    await expect(dialog.getByRole("button", { name: "儲存補充內容並重新解析" })).toBeEnabled();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(dialog.getByRole("link", { name: "查看私人截圖 ↗" })).toBeVisible();
    await dialog.getByLabel("選擇既有店家").selectOption({ label: "測試·大阪咖啡 · 大阪" });
    await dialog.getByRole("button", { name: "連結", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "解除關聯" })).toBeVisible();
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    expect((await processOneJob()).processed).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "待整理", exact: false }).click();
    await page.locator(".source-card").click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText("待補內容", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("補上文章內容或店家資訊")).toHaveValue(
      "測試內容：讀不到社群文章時保留這段補充",
    );
    const image = dialog.getByRole("link", { name: "查看私人截圖 ↗" });
    const imagePath = await image.getAttribute("href");
    expect((await page.request.get(imagePath!)).status()).toBe(200);
    const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
    expect((await anonymous.get("/api/library")).status()).toBe(401);
    expect((await anonymous.get(imagePath!)).status()).toBe(401);
    await anonymous.dispose();
    await dialog.getByRole("button", { name: "關閉", exact: true }).click();
    const library = await (await page.request.get("/api/library")).json();
    expect(library.places[0].notes).toBe("不要匯出的私人備註");
    expect(library.places[0].rating).toBe(5);
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    await db.auth.signInWithPassword({ email: users[1].email, password: users[1].password });
    const result = await db.from("places").select("*");
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    const privateImage = await db.storage.from("screenshots").download(library.attachments[0].path);
    expect(privateImage.data).toBeNull();
    expect(privateImage.error).toBeTruthy();
    expect(
      (
        await page.request.post("/api/places", {
          headers: { Origin: "https://attacker.invalid" },
          data: { name: "forged" },
        })
      ).status(),
    ).toBe(403);
  });
  test("mobile layout supports editing and deleting visits without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await expect(page.locator(".sidebar nav")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page
      .getByRole("button", { name: /測試·大阪咖啡/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "編輯到訪", exact: true }).first().click();
    await page.getByRole("textbox", { name: "到訪心得", exact: true }).fill("手機修改後的心得");
    await page.getByRole("button", { name: "儲存到訪紀錄", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page
      .getByRole("button", { name: /測試·大阪咖啡/ })
      .first()
      .click();
    await expect(page.getByText("手機修改後的心得", { exact: true })).toBeVisible();
    await page.screenshot({ path: ".local/mobile-detail.png", fullPage: true });
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "刪除到訪", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "刪除到訪", exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "刪除到訪", exact: true }).click();
    await expect(page.getByText("想去 · 還沒留下到訪紀錄", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "關閉", exact: true }).click();
    await page.screenshot({ path: ".local/mobile-collection.png", fullPage: true });
  });
  test("mobile can collect, supplement, filter, view positions and export", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page
      .getByLabel("收藏連結", { exact: true })
      .fill("https://www.threads.com/@stone-e2e/post/mobile-fixture");
    await page.getByRole("button", { name: "收進口袋", exact: false }).click();
    await expect(page.getByLabel("收藏連結", { exact: true })).toHaveValue("");
    await page.locator(".source-card").filter({ hasText: "www.threads.com" }).click();
    await page
      .getByRole("textbox", { name: "補上文章內容或店家資訊" })
      .fill("手機補充文字，非真實貼文。");
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/sources/retry") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "儲存補充內容並重新解析" }).click();
    expect((await saved).ok()).toBe(true);
    await page.getByRole("button", { name: "關閉", exact: true }).click();
    await page.getByRole("button", { name: "我的收藏", exact: true }).click();
    await page.getByRole("button", { name: "篩選", exact: true }).click();
    await page.getByLabel("國家篩選").selectOption("日本");
    await page.getByLabel("城市篩選").selectOption("大阪");
    await page.getByRole("button", { name: "咖啡廳", exact: true }).click();
    await page.getByLabel("到訪狀態篩選").selectOption("no");
    await expect(page.getByRole("button", { name: /測試·大阪咖啡/ }).first()).toBeVisible();
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.getByRole("button", { name: "位置模式" }).click();
    await expect(page.locator(".leaflet-interactive")).toHaveCount(1);
    await page.locator(".leaflet-interactive").click();
    const maps = page.locator(".leaflet-popup").getByRole("link", { name: "Google Maps" });
    await expect(maps).toHaveAttribute("href", /https:\/\/www\.google\.com\/maps\//);
    await page.getByRole("button", { name: "匯出分享", exact: true }).click();
    await expect(page.locator(".export-preview")).toContainText("測試·大阪咖啡");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載 PDF" }).click();
    expect(await (await downloading).failure()).toBeNull();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: ".local/mobile-export.png", fullPage: true });
  });
  test("switching accounts on mobile clears the previous user's collection before loading", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await expect(page.getByRole("button", { name: /測試·大阪咖啡/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "手機登出", exact: true }).click();
    await expect(page.getByRole("button", { name: "登入我的收藏", exact: true })).toBeVisible();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/library", async (route) => {
      await ready;
      await route.continue();
    });
    try {
      await page.getByLabel("電子郵件", { exact: true }).fill(users[1].email);
      await page.getByLabel("密碼", { exact: true }).fill(users[1].password);
      await page.getByRole("button", { name: "登入我的收藏", exact: true }).click();
      await expect(page.getByText("正在讀取收藏…", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /測試·大阪咖啡/ })).toHaveCount(0);
    } finally {
      release();
    }
    await expect(
      page.getByRole("heading", { name: "我的收藏 0 個地方", exact: true }),
    ).toBeVisible();
  });
});
