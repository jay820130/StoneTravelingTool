# 技術決策與資料流

需求原文保留於根目錄 `codex_saved_places_prompt.md`。本文件記錄實作決策，不取代原需求。

- **Next.js 16 App Router、React、TypeScript**：同一個專案處理手機介面、私人 API 與匯出，避免微服務。
- **Supabase PostgreSQL、Auth、Storage**：正式資料在資料庫，登入使用電子郵件與密碼。沒有公開註冊頁；還需要 `profiles` 成員紀錄才能使用。所有私有資料表啟用 RLS，撤銷匿名權限；跨表使用 `(owner_id, id)` 複合外鍵，避免把別人的來源或到訪掛到自己帳下。
- **本機與正式環境使用同一組 migrations**，本機 Docker 服務沒有示範資料。自動測試使用另外建立、明確命名的測試帳號，絕不連線正式專案執行帳號清理。
- **Leaflet** 顯示人工確認的座標。沒有座標的店家留在清單及待補位置區，不把城市中心當店址。暫未接地理編碼或 Places API；Google Maps 僅是搜尋外連，不擷取或儲存 Google Places 資料。底圖可透過環境變數更換。
- **ExcelJS、PDFKit、Noto Sans TC** 產生分享檔。PDF 嵌入字型子集、按文字寬度換行與分頁，使用可點擊的 Maps URI。無法覆蓋的特殊字元以方框顯示；主驗證範圍為繁體中文、拉丁文字及日文店名。

## 保存與解析是兩條流程

1. `POST /api/sources` 先儲存原始網址、正規化去重網址、收藏原因。資料庫的唯一鍵阻擋重複連結；追蹤參數不影響去重。
2. 來源觸發器建立持久化 `import_jobs` 工作。HTTP 回應只代表收藏已保存。
3. 本機 `npm run worker` 或正式排程呼叫 `/api/worker`，使用資料庫鎖與租約一次領取一項工作。每次最多三次自動重試，有退避與失效租約復原。
4. 原文不完整時提示補文字／截圖。AI 未設定時不呼叫外部 AI，也不把結果標成成功。既有收藏、編輯、評分及匯出仍可使用。
5. 若設定支援圖片的 OpenAI 相容 API，僅傳送這份來源的文章文字與選擇上傳的截圖。私人到訪心得、評分、額外私人備註不送給 AI。模型輸出需經 Zod 驗證，不允許模型產生座標。
6. 候選店家由使用者勾選後，交易式建立店家及來源關聯；同一批候選重送不會重建。既有店家由使用者明確選擇關聯，避免同名分店被誤併。
7. 重新解析只更新來源的摘要及候選資訊，完全不更新已存在的店名、地址、分類、標籤、私人備註或評分。工作版本與領取 token 防止舊結果蓋過新補充內容。

## 主要資料表

| 資料表          | 用途                                                                 |
| --------------- | -------------------------------------------------------------------- |
| profiles        | 受邀使用者成員資格                                                   |
| places          | 店家基本資料、國家／城市、人工確認座標、類型、標籤、總評、私人備註   |
| sources         | 原網址、去重網址、補充內容、收藏原因、文章摘要、候選、解析狀態與版本 |
| place_sources   | 店家與來源的多對多關聯                                               |
| visits / dishes | 每次到訪與該次多個餐點，評分分別儲存                                 |
| labels          | 個人自訂標籤目錄；改名／刪除同步更新 places.tags                     |
| attachments     | 私人截圖物件路徑與來源關聯                                           |
| import_jobs     | 佇列、重試次數、租約、版本與結果                                     |
| request_quotas  | 每位使用者每小時 100 次寫入操作的共用計數                            |

類型與店家標籤使用 PostgreSQL 陣列，支援複選。國家與城市分欄儲存，已處理 Osaka／大阪、Japan／日本、Taiwan／台灣等常用別名；不是完整全球行政區資料庫，未知值保留使用者輸入。

## 安全與已知限制

- API 每次以 Supabase `getUser()` 驗證 session，從 cookie 取得目前使用者；一般 API 不使用 service role。所有 API 回應設為 `private, no-store`。修改端點檢查 Origin，匯出亦要求登入。
- 原始連結只接受 HTTPS Instagram、Threads、Google Maps 主機；每次重新導向重驗主機和 DNS 位址，封鎖內網／loopback，固定已驗證 IP，保留 TLS 憑證驗證，限制讀取大小、時間與重新導向次數。不攜帶使用者 cookie，也不嘗試登入社群。
- Storage bucket 私有，限制 MIME 和 5 MB 大小，伺服器另驗圖片簽章；檔案路徑以 user UUID 分隔。每份來源 UI 最多三張截圖。
- 使用者可透過自己的 Supabase session 存取自己的資料；應用寫入端點的每小時配額主要防止意外大量操作。若公開給大量使用者，需另在資料庫或 API gateway 統一限制所有直接 PostgREST 寫入與 AI 預算。
- 桌面與手機登出均清除畫面資料，切換 session 後忽略舊的非同步讀取結果，避免換帳號時短暫顯示上一個帳號的收藏。
- 同時更新同一筆店家目前採最後儲存者為準；個人用途下可用，但尚未提供多裝置衝突解決介面。
- 截圖刪除與關聯資料刪除跨 Storage／PostgreSQL，沒有跨服務交易。失敗會回報，可重試；正式環境需定期檢查孤立物件。
- 沒有自動下載影片、轉錄、原生 App 或公開分享網站；XLSX／PDF 是當下選定資料的副本，與完整備份不同。

依賴掃描（2026-10-18）：正式依賴有 2 個 moderate 標記，實際源頭為 [uuid v3/v5/v6 的 buffer bounds 問題](https://github.com/advisories/GHSA-w5hq-g745-h8pq)，另一項為 ExcelJS 連帶標記；沒有 high／critical。檢查已安裝 ExcelJS 的呼叫點僅使用 `uuid.v4()`，目前應用沒有受影響版本 API 的使用路徑。npm 建議的自動修正會降級 ExcelJS 到舊主要版本，因此未強制套用破壞性變更；後續升級需重驗三張工作表、連結及紀錄保留。

## 官方資料查閱（2026-10-18，台北）

已讀取官方 GitHub 文件：

- [Next.js 安裝與版本需求](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/01-installation.mdx)：Node 至少 20.9；本專案使用 Node 22+，驗證環境 Node 24。Next 16 建置不自動執行 ESLint，因此分別檢查。
- [Supabase SSR client](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/server-side/creating-a-client.mdx)：cookie session、伺服器驗證與快取限制。本專案資料只經 Route Handlers 讀寫，cookie 更新也發生在 handler，不在 Server Components 中讀取 session。
- [RLS](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/postgres/row-level-security.mdx)：同時檢查 grants 與 policies。
- [Supabase Cron](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/cron/quickstart.mdx) 與 [排程／Vault](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/schedule-functions.mdx)：使用持久化佇列配合定時 HTTP 請求，不依賴 HTTP 結束後仍存活的程序。
- [Supabase 計費](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/billing-on-supabase.mdx)：計費以組織與方案、運算、儲存、流量等用量組成；免費額度有上限，正式開通前需再次確認帳戶顯示的條件。
- [OpenAI 官方 API 規格](https://github.com/openai/openai-openapi)：可替換的 Chat Completions 介面；實際模型、圖片能力與費用須在啟用供應商時確認。

官方網站頁面目前曾被環境網路規則擋住，未宣稱已核實 Vercel 或 AI 的即時價格。開通前以 [Vercel pricing](https://vercel.com/pricing)、[Supabase pricing](https://supabase.com/pricing)、AI 供應商及 [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) 的最新頁面為準。沒有開通任何付費服務。
