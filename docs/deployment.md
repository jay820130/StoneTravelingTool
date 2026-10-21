# 正式設定、部署與備份

使用者已於 2026-10-18 完成建立 Supabase 專案、私人登入設定、個人 Auth 帳號與首次初始化。使用者提供的 SQL Editor 結果截圖顯示：`status=初始化完成`、`invited_accounts=1`、`protected_tables=10`、`screenshots_private=true`。Project URL 為 `https://cwkaosndndbzhtppvmat.supabase.co`；不要附加 `/rest/v1/`。使用者已提供 Vercel 首次部署成功畫面與正式網址 [stone-traveling-tool.vercel.app](https://stone-traveling-tool.vercel.app/)。使用者已回報正式帳號登入成功，收藏資料保存仍待驗證；金鑰由使用者直接填入 Vercel 環境變數，不在對話或 Git 保存。尚未開通付費方案或自訂網域，不需要一開始就提供 AI 金鑰。

## 1. Supabase

1. 登入 [Dashboard](https://supabase.com/dashboard)，建立新專案，選靠近使用地的區域。以當下頁面確認方案、免費專案名額與費用；需要付款時先比較，不自動升級。
2. 資料庫密碼放自己的密碼管理器，不貼進對話。
3. Authentication → Sign In / Providers 設定關閉 Allow new users to sign up 與匿名登入，保留 Email provider 啟用。程式另以 `profiles` 成員資格阻擋未受邀帳號。
4. Authentication → Users 建立自己的 email／password 帳號並確認啟用。首次設定若恰好只有這一個 Auth 帳號，可在 SQL Editor 新建查詢，完整執行 [first-time.sql](../supabase/setup/first-time.sql)。檔案包含五份 migration、私人 Storage、migration history，會授權這個唯一帳號；若 public 已有資料表、screenshots bucket 已存在，或帳號數不是一個，會停止，不刪除既有資料。全部步驟在同一交易執行；成功結果應為 `初始化完成`、`invited_accounts=1`、`protected_tables=13`、`screenshots_private=true`。此檔以 `node scripts/build-bootstrap.mjs` 從 migrations 產生，後續變更使用 CLI migrations，勿重跑初始化。
5. 若採取逐份執行 migrations 的替代流程，須另外記錄 migration history 並明確指定帳號授權；**已執行 first-time.sql 者跳過此步驟**。使用 Authentication → Users 的 UUID 執行：

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

使用者已建立個人 Hobby 帳號，以 GitHub 匯入本專案並完成首次部署。正式網址為 `https://stone-traveling-tool.vercel.app/`；首次實作提交為 `590e20a65aa240328320218ea2e13741e597d137`，已快轉整合至 `main`。後續修正由 `main` 部署，不能只憑部署成功畫面宣稱正式登入與資料存取已驗證。

1. 匯入此儲存庫，framework 選 Next.js，root 是根目錄，安裝 `npm ci`，建置 `npm run build`。亦可使用 Vercel CLI 或其他 Git 供應商。
2. 在 Production 的安全設定填入 Supabase 變數。Preview 應使用獨立測試資料庫，勿預設共用正式金鑰。
3. 在 Supabase → Authentication → URL Configuration，將 Site URL 設為 `https://stone-traveling-tool.vercel.app` 並儲存；使用者已提供顯示正確網址的設定截圖。本站目前使用 Email／密碼登入，不依賴 OAuth callback；Redirect URLs 空白不會造成這種登入方式失敗，未來需要 redirect 時才加入實際使用的明確網址。
4. 依進度文件與 iPhone 文件驗證未登入、另一帳號、重新登入、附件及匯出，不能只看建置成功。
5. 開通前再次確認 Vercel 當前方案、使用資格、Function 時間／請求大小／流量限制；尚未核實帳戶費用，不會自動付費。可先用平台網域。

Codex 起初對此網域的 HTTPS CONNECT 被代理回應 403；2026-10-18 後續重試已可連線。實際 HTTP 檢查：首頁 200；`/api/session` 200 且 `configured=true`、`user=null`；匿名 `/api/library` 和 `/api/worker` 均 401；本站 Origin 的空登入表單回應資料驗證 400，其他 Origin 回應 403。這只證明設定存在與匿名限制，尚未證明 Supabase 金鑰有效或私人帳號能登入。使用者截圖的錯誤為「登入失敗，請確認電子郵件與密碼」。原版把所有 Supabase Auth 錯誤合併為此訊息，已修正為依錯誤代碼區分帳密、Email 未驗證、停用 Email provider、頻率限制與服務設定／連線失敗；回應僅含固定文字，不輸出供應商原始內容或憑證。成員資格查詢失敗也與確實未受邀分開處理，兩者仍會登出。先前登入失敗的確切原因未獨立核實，後續結果如下。

後續結果：提交 `20afe6709eb76e8d92978d1d191e39637e9d73a4` 的 GitHub Vercel 狀態確認部署成功。以一次不存在的測試識別呼叫正式登入 API，收到正常帳密拒絕，未建立帳號或使用私人憑證。使用者確認 Auth 帳號存在且已驗證，之後回報正式網站已可登入；不據此推定先前失敗的確切原因。下一步驗證手動收藏、重新整理與重新登入後保留資料。不要對正式資料庫執行本機測試帳號腳本。

正式網站的 Chromium 自動檢查因本環境代理憑證信任錯誤 `ERR_CERT_AUTHORITY_INVALID` 無法載入，未停用 TLS 驗證；不可據此認定使用者瀏覽器有同樣問題。

## 3. 持久化背景工作

本機執行 `npm run worker`；正式環境用 Supabase Cron + pg_net 呼叫 `/api/worker`，不依賴 HTTP 結束後仍存活的程序。

1. 部署平台安全設定建立高強度隨機 `CRON_SECRET`。
2. Supabase Vault 新增 `stone_worker_url`（本專案為 `https://stone-traveling-tool.vercel.app/api/worker`）及 `stone_cron_secret`（與 Vercel `CRON_SECRET` 相同），不把實際密鑰放 SQL 檔或 Git。Vercel 變數選 Production，修改後需重新部署才套用。
3. 確認專案支援 Cron／pg_net 後執行 `supabase/optional/cron.sql`。每分鐘只在有待處理或逾時工作時發請求；一次一項，資料庫鎖阻擋重複領取。
4. 先不開 AI，新增測試連結應從等待解析變為待補內容，確認排程實際執行，再啟用 AI。
5. 監控 Cron 歷史與 import_jobs 狀態，不記錄私人內容或 key；腳本僅清除此應用七天前的排程歷史。

使用者已於 2026-10-19 完成上述 Vercel／Vault／Cron 設定。來源從「等待解析」轉為「待補內容」，補上文字後得到 Gemini 摘要及候選店家，證明背景執行與文字解析路徑可用；不需重新建立金鑰或排程。Maps 連結自動讀取仍待修正驗收，見 [Maps 匯入排錯](maps-import.md)。

## 4. AI 與底圖

- 設定支援 JSON 和圖片的 OpenAI 相容服務：`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`。預設是可替換起點，未進行真實付費呼叫。先確認當前圖片能力、資料保留與費用，設定預算／警示，再放入 key。
- 使用者選擇 Google Gemini Free tier，已在 Vercel Production 設定 `AI_API_KEY`、`AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`、`AI_MODEL=gemini-3.5-flash-lite` 並重新部署。帳號頁當時顯示此模型 RPM 15、TPM 250K；每日限制與後續額度以帳號頁為準，不能當永久無限制使用。免費服務內容可能供改善 Google 產品，避免傳送敏感內容。本站不傳一般私人筆記與到訪心得給 AI。
- 使用者希望先使用免費額度，未授權開通付費服務。日後可更換上述三個變數切回 OpenAI 相容 API；ChatGPT 訂閱不包含 API 費用。金鑰直接留在 Vercel，不貼到對話或 Codex。
- 沒有 AI 時不發送資料，手動功能可繼續。社群網站可能限制讀取，需補文字／截圖，不承諾所有 IG、Threads、影片都能解析。
- `NEXT_PUBLIC_MAP_TILE_URL`、`NEXT_PUBLIC_MAP_ATTRIBUTION` 可更換底圖。OSM 公共底圖僅供少量互動開發驗證；上線前閱讀最新政策，保留署名與 Referer，不預抓或離線下載。較大量需求需比較供應商額度與費用。
- 第二階段地理編碼設定與政策選用見 [phase2.md](phase2.md)。服務未啟用或找不到候選時仍可手動確認座標，不能使用城市中心代替。Maps 按鈕仍為一般外連，沒有付費 Places API。

## 第二階段發布

只對既有專案套用新增的 `import_content_pipeline` migration；**不要重跑 first-time.sql，也不要 reset**。先部署 DB 的相容新增欄位／RPC／私人 bucket MIME，再發布含新上傳流程的 Next.js。新表為內部 AI 快取、地理查詢快取與全站速率閘門；皆 RLS + service_role-only，沒有新增公開資料。

Production 的 `AI_MODEL=gemini-3.5-flash-lite`、`AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`；保留既有 AI key、CRON_SECRET 和 Supabase keys。`AI_MODEL` 不再有程式預設值。地理服務選用前保留 `GEOCODING_PROVIDER` 空白；其他設定見 `.env.example`。保持現有 Supabase 每分鐘排程，不新增受 Hobby 限制的 Vercel 高頻 Cron。

附件先由 API 預留 pending 列，再簽名直傳 Storage、驗證完成為 ready，最後 requeue。圖片本體不穿越 Vercel 請求／回應，因此 5 MiB 上限可用；完成驗證 API 只有小型 JSON。簽名上傳網址是短期持有者憑證，勿記錄或分享；查看圖片用 60 秒簽名網址，bucket 維持 private。

worker 僅將 job ID、狀態及固定錯誤代碼寫 Function logs。診斷的必要網址鏈、有限中繼資料、最多 400 字 input preview 存擁有者 RLS 保護的來源資料，不印完整私人內容或 key。清理來源、備份與復原時，內部快取也應納入私人資料管理。

發布後實際版本、檢查及未驗證清單以 [第二階段報告](phase2.md) 為準。第三階段真實資料驗收需另獲使用者確認。

## 備份、復原與停止服務

分享檔會排除未勾選資料、工作資訊及附件，**不是完整備份**。

1. 使用 Supabase 平台備份或官方支援的匯出流程保存 schema、資料、Auth 使用者與 migration history；確認自己的方案是否包含備份／PITR 與保留期限。
2. 額外以 Storage API 或支援的 S3 工具備份 `screenshots` 的**實體物件**，保留完整路徑與 MIME。只有資料庫 metadata 不代表圖片已備份。
3. 備份含私人資料，放受控、加密位置；記錄 schema 版本、時間、表格筆數、物件數與 checksum。credentials 另放密碼管理器。
4. 在獨立空白專案演練復原：依官方程序還原 Auth／資料庫並保持 user UUID，再還原 bucket 檔案與 metadata、確認 RLS、登入與附件權限；不直接覆蓋使用中的正式專案。
5. 若更換 Auth UUID，必須一致搬移所有 owner_id、Storage 路徑與外鍵。正式服務尚未完成設定，因此未宣稱完成雲端備份復原演練。

停止時先停用 `stone-import-worker` 並移除 AI key，備份驗證後再停部署。確定可復原才暫停／刪除 Supabase。Next.js 和 PostgreSQL 可遷移，Auth／Storage 介面需要相應替換；刪除資料不是一般部署步驟。
