# 正式設定、部署與備份

使用者已於 2026-10-18 完成建立 Supabase 專案、私人登入設定、個人 Auth 帳號與首次初始化。使用者提供的 SQL Editor 結果截圖顯示：`status=初始化完成`、`invited_accounts=1`、`protected_tables=10`、`screenshots_private=true`。已取得 Project URL：`https://cwkaosndndbzhtppvmat.supabase.co`；不要附加 `/rest/v1/`。網站與正式專案的連線及登入尚未驗證，金鑰將由使用者填入 Vercel 的環境變數欄位。尚未部署網站，也未開通付費方案或網域。不需要一開始就提供 AI 金鑰。

## 1. Supabase

1. 登入 [Dashboard](https://supabase.com/dashboard)，建立新專案，選靠近使用地的區域。以當下頁面確認方案、免費專案名額與費用；需要付款時先比較，不自動升級。
2. 資料庫密碼放自己的密碼管理器，不貼進對話。
3. Authentication → Sign In / Providers 設定關閉 Allow new users to sign up 與匿名登入，保留 Email provider 啟用。程式另以 `profiles` 成員資格阻擋未受邀帳號。
4. Authentication → Users 建立自己的 email／password 帳號並確認啟用。首次設定若恰好只有這一個 Auth 帳號，可在 SQL Editor 新建查詢，完整執行 [first-time.sql](../supabase/setup/first-time.sql)。檔案包含四份 migration、私人 Storage、migration history，會授權這個唯一帳號；若 public 已有資料表、screenshots bucket 已存在，或帳號數不是一個，會停止，不刪除既有資料。全部步驟在同一交易執行；成功結果應為 `初始化完成`、`invited_accounts=1`、`protected_tables=10`、`screenshots_private=true`。此檔以 `node scripts/build-bootstrap.mjs` 從 migrations 產生，後續變更使用 CLI migrations，勿重跑初始化。
5. 若採取逐份執行四個 migration 的替代流程，須另外記錄 migration history 並明確指定帳號授權；**已執行 first-time.sql 者跳過此步驟**。使用 Authentication → Users 的 UUID 執行：

   ```sql
   insert into public.profiles(owner_id, display_name)
   values ('你的使用者 UUID', '旅人');
   ```

6. 在平台安全環境變數設定填入以下項目，不貼入對話：

   | 變數                                 | 用途                                                   |
   | ------------------------------------ | ------------------------------------------------------ |
   | NEXT_PUBLIC_SUPABASE_URL             | HTTPS Project URL                                      |
   | NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | publishable key；本機可用 anon key                     |
   | SUPABASE_SERVICE_ROLE_KEY            | 背景工作用的伺服器專用金鑰，絕不能加 NEXT_PUBLIC_ 前綴 |

這時可以先驗證登入、手動收藏、到訪與匯出。若環境使用網域允許清單，加入**實際專案 hostname**，例如你的專案識別碼 `.supabase.co`，不需開放整個 Internet。

首次 SQL 的舊版本可能讓 SQL Editor 提示 `supabase_migrations.schema_migrations` 尚未啟用 RLS；可選 **Run and enable RLS**，管理者仍能寫入版本紀錄。產生器已補上這張內部表的 RLS。若同時看到 destructive operations 提示，需核對正在執行本專案的完整初始化檔：其中 DELETE 位於日後編輯／合併等功能的函式定義內，初始化不會呼叫這些刪除；檔案也會拒絕對已有 public 資料表的專案重跑。不要把這個說明套用到其他 SQL。

## 2. 部署 Next.js

使用者尚無 Vercel 帳號，正在引導建立個人 Hobby 帳號並使用 GitHub 登入；尚未部署，不自動開通付費方案。

1. 匯入此儲存庫，framework 選 Next.js，root 是根目錄，安裝 `npm ci`，建置 `npm run build`。亦可使用 Vercel CLI 或其他 Git 供應商。
2. 在 Production／Preview 的安全設定填入 Supabase 變數。建議測試與正式資料庫分開。
3. Supabase Auth Site URL 設為網站網址，redirect URL 使用明確網址。本站不要求 Google 帳號。
4. 依進度文件與 iPhone 文件驗證未登入、另一帳號、重新登入、附件及匯出，不能只看建置成功。
5. 開通前再次確認 Vercel 當前方案、使用資格、Function 時間／請求大小／流量限制；尚未核實帳戶費用，不會自動付費。可先用平台網域。

## 3. 持久化背景工作

本機執行 `npm run worker`；正式環境用 Supabase Cron + pg_net 呼叫 `/api/worker`，不依賴 HTTP 結束後仍存活的程序。

1. 部署平台安全設定建立高強度隨機 `CRON_SECRET`。
2. Supabase Vault 新增 `stone_worker_url`（完整 HTTPS `/api/worker` URL）及 `stone_cron_secret`（同一個 secret），不把值放 SQL 檔或 Git。
3. 確認專案支援 Cron／pg_net 後執行 `supabase/optional/cron.sql`。每分鐘只在有待處理或逾時工作時發請求；一次一項，資料庫鎖阻擋重複領取。
4. 先不開 AI，新增測試連結應從等待解析變為待補內容，確認排程實際執行，再啟用 AI。
5. 監控 Cron 歷史與 import_jobs 狀態，不記錄私人內容或 key；腳本僅清除此應用七天前的排程歷史。

## 4. AI 與底圖

- 設定支援 JSON 和圖片的 OpenAI 相容服務：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`。預設是可替換起點，未進行真實付費呼叫。先確認當前圖片能力、資料保留與費用，設定預算／警示，再放入 key。
- 沒有 AI 時不發送資料，手動功能可繼續。社群網站可能限制讀取，需補文字／截圖，不承諾所有 IG、Threads、影片都能解析。
- `NEXT_PUBLIC_MAP_TILE_URL`、`NEXT_PUBLIC_MAP_ATTRIBUTION` 可更換底圖。OSM 公共底圖僅供少量互動開發驗證；上線前閱讀最新政策，保留署名與 Referer，不預抓或離線下載。較大量需求需比較供應商額度與費用。
- 目前沒有地理編碼服務，座標由人工確認。Maps 按鈕是一般外連，不使用付費 Places API 或儲存其專有資料。

## 備份、復原與停止服務

分享檔會排除未勾選資料、工作資訊及附件，**不是完整備份**。

1. 使用 Supabase 平台備份或官方支援的匯出流程保存 schema、資料、Auth 使用者與 migration history；確認自己的方案是否包含備份／PITR 與保留期限。
2. 額外以 Storage API 或支援的 S3 工具備份 `screenshots` 的**實體物件**，保留完整路徑與 MIME。只有資料庫 metadata 不代表圖片已備份。
3. 備份含私人資料，放受控、加密位置；記錄 schema 版本、時間、表格筆數、物件數與 checksum。credentials 另放密碼管理器。
4. 在獨立空白專案演練復原：依官方程序還原 Auth／資料庫並保持 user UUID，再還原 bucket 檔案與 metadata、確認 RLS、登入與附件權限；不直接覆蓋使用中的正式專案。
5. 若更換 Auth UUID，必須一致搬移所有 owner_id、Storage 路徑與外鍵。正式服務尚未完成設定，因此未宣稱完成雲端備份復原演練。

停止時先停用 `stone-import-worker` 並移除 AI key，備份驗證後再停部署。確定可復原才暫停／刪除 Supabase。Next.js 和 PostgreSQL 可遷移，Auth／Storage 介面需要相應替換；刪除資料不是一般部署步驟。
