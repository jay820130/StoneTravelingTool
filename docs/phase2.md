# 第二階段：解析與圖片上傳

更新：2026-10-21。第二階段程式與部署已完成；實機、服務選用及額度項目仍列為待辦。第三階段尚未開始。本報告區分程式完成、測試環境與外部待驗證項目。原需求仍適用。

## 已實作

| 項目           | 行為                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Maps    | 最多 5 次轉址；每跳驗證 HTTPS、精確網域與 Maps 路徑、DNS 全部 IP，連線固定已檢查的 IP 並保留 TLS 驗證。加入 google.com.tw 等明確地區網域。從最終網址讀取店名、`!3d!4d`、`@lat,lng`、place ID、cid、feature ID；只有連結時不呼叫 AI。                                                              |
| 座標可信度     | `@` 是視角中心，記為 viewport，不直接存成店址；單一 `!3d!4d` 地點座標須在確認候選後才保存。資訊不完整維持部分解析／待補內容，不補造城市與地址。                                                                                                                                                   |
| IG／Threads    | 僅讀公開 og／twitter／description 中繼資料；不取內文、不執行 JS、不登入。沒有實質文字就待補內容；原始網址與去重依據保留，不把網址送 AI 猜店家。一次讀不到就提示補文字或圖片，不反覆爬取。                                                                                                         |
| 一次收藏       | 快速收藏可同時貼連結、文字、選多圖；待整理也可補資料。來源與文字先保存，圖片逐張回報保存成功後才排入解析。                                                                                                                                                                                        |
| 私人圖片       | JPEG、PNG、WebP、HEIC／HEIF；每張最多 5 MiB、每份最多 6 張且合計 12 MiB。前後端檢查檔案簽章、大小及 MIME；DB 鎖定來源後預留附件，避免並發超額。                                                                                                                                                   |
| 上傳與重試     | 瀏覽器使用擁有者授權的簽名上傳網址直接 PUT 到私人 Supabase Storage，檔案不經 Vercel 請求本文。完成端點重新下載驗證並保存 SHA256；同一頁重試使用原附件 ID。失敗保留已保存內容，待整理可重試確認或刪除未完成附件。關頁後需重新選取尚未傳完的本機圖片。                                              |
| 圖片閱讀／刪除 | 讀取端點先驗證登入、RLS 所有權，再 303 跳轉至 60 秒簽名網址；bucket 維持 private，沒有公開物件網址。刪除時移除實體物件與附件紀錄，並使舊解析 claim 失效。                                                                                                                                         |
| Gemini         | `AI_MODEL` 必填環境變數；AI Studio API key 經 OpenAI 相容端點。要求 JSON schema，回應另經 Zod 驗證。只抽取明確資料，文字／圖片皆視為不可信資料，不提供工具、Search／Maps grounding 或 URL context。支援多店候選及分店、地址、地點線索、類型、推薦餐點、摘要。                                     |
| 錯誤／去重     | 429、408、5xx、連線與逾時可重試；其他供應商錯誤、模型設定、結構錯誤保留固定錯誤代碼。最多 3 次，指數退避並尊重 Retry-After。每位擁有者依模型、版本、實際文字與圖片雜湊快取成功結果，DB claim 防止同內容同時送 AI。若程序在供應商成功後、快取寫入前中止，仍可能重送；沒有宣稱跨服務 exactly-once。 |
| 人工資料       | Worker 只更新來源，不覆蓋店家、手動標籤、私人筆記、到訪與餐點；重新解析保留可精確比對的已確認候選關聯，失敗亦保留已確認關聯。                                                                                                                                                                     |
| 背景執行       | 保留已運作的 Supabase Cron + pg_net → Vercel `/api/worker`，在 HTTP 回應前 await 一份工作。來源 revision、claim token、5 分鐘租約復原及最多 3 次重試；上傳中的來源暫停排程，不處理半套圖片。                                                                                                      |
| 位置搜尋       | 可設定 Nominatim 相容服務；明確按鈕查詢、不做自動完成。全站 DB 閘門至少間隔 1.1 秒、30 天快取、識別 User-Agent、OSM 署名。排除城市／行政區中心；列出候選讓使用者確認才寫入店家，查不到保留空座標。                                                                                                |

## 官方限制與設定決策

2026-10-21 已重新查閱官方文件：

- [Gemini 圖片文件](https://ai.google.dev/gemini-api/docs/image-understanding) 明列 HEIC／HEIF，所以目前直接送原始圖片，不新增有損轉檔。此為文件確認；真實 iPhone HEIC 經目前模型的辨識仍待第三階段。
- [Gemini 價目表](https://ai.google.dev/gemini-api/docs/pricing) 的 `gemini-3.5-flash-lite` 提供免費輸入／輸出；[淘汰公告](https://ai.google.dev/gemini-api/docs/deprecations) 未宣布此 ID 關閉日期。[OpenAI 相容介面](https://ai.google.dev/gemini-api/docs/openai) 支援結構化輸出。沒有依賴免費方案不提供的 grounding。
- [速率文件](https://ai.google.dev/gemini-api/docs/rate-limits) 要求從 AI Studio 查看專案的實際 RPM／RPD。此工作階段無 AI Studio 額度頁存取權；歷史 RPM 15／TPM 250K 不當成目前保證，**目前專案 RPM／RPD 尚未核實**。沒有為確認額度而故意耗盡配額。
- [Vercel Function 限制](https://vercel.com/docs/functions/limitations) 的請求／回應本文上限 4.5 MB，故圖片改為直接 Storage 上傳與簽名讀取跳轉。`/api/worker` 設 60 秒，抓來源最多 12 秒、圖片下載合計 16 秒、AI 20 秒，另留資料庫處理時間；被平台中斷時由租約復原。
- [Supabase changelog](https://supabase.com/changelog) 提醒 Data API 新表須明確 grants。新增 3 張內部表啟用 RLS，撤銷 anon／authenticated 權限，僅 service_role 可操作；使用者附件及來源 RPC 保留 invoker 與所有權檢查。
- [Nominatim 公共服務政策](https://operations.osmfoundation.org/policies/nominatim/) 要求開發者明確選用並負責遵守。已說明每秒最多一次、識別、快取、署名、不得自動完成或送機密內容；**尚未收到使用者對公共服務的明確選擇，因此正式地理編碼預設停用**。可改用自架或其他 Nominatim 相容端點，不必更改前端。

地理編碼選用後才設定：`GEOCODING_PROVIDER=nominatim`、`GEOCODING_BASE_URL`、可識別此網站的 `GEOCODING_USER_AGENT`。若是公共主機，另需明確設定 `NOMINATIM_POLICY_ACCEPTED=true`。無服務時仍可手動輸入已確認座標。

## 驗證與發布紀錄

- 114 項單元／PGlite 測試已覆蓋通過（完整 113 項通過後，新增一項候選關聯回歸，相關 35 項重跑通過）。涵蓋規則解析、SSRF 每跳驗證、metadata-only、URL-only 不送 AI、schema、429、HEIC 格式、RLS、上傳預留、快取鎖、延遲重試、人工資料保留。
- 本機 Supabase 真實 Auth／PostgreSQL／Storage + Chromium：**6 項流程通過，51.1 秒**。資料為虛構；包含多圖、4.7 MB 圖片、第二張 PUT 503 後重試不重複、來源與首張圖片保留、刪圖、另一帳號隔離、匿名拒絕、390×844 無橫向溢出。
- 型別、Lint、Next.js 正式建置全部通過。
- 正式 Supabase 已套用 `20261021003629_import_content_pipeline`；本地 migration 檔名同步平台產生的版本，避免 CLI 再次套用。Vercel 正式部署 `dpl_31Brwb4BYK1fjqgdJyymT6uVGMyW` 為 READY，程式提交 `713bedecc80a792d18f816e79ce7a674be3470c0` 已指向 [正式網址](https://stone-traveling-tool.vercel.app/)，其後僅補更新文件。Production 已明確設定 `AI_MODEL=gemini-3.5-flash-lite` 與 Gemini 相容端點，保留既有 key。本次唯讀確認現有 Cron 每分鐘啟用，pg_cron 1.6.4／pg_net 0.20.4；12 份來源、20 家店、0 次到訪、0 張附件，12 項工作皆 done。migration 前後筆數一致，原有資料保留；13 張 public 表啟用 RLS，AI 快取及 claim RPC 對匿名／一般登入使用者均不可存取，worker 可呼叫，私人 bucket 的 5 種 MIME 與 5 MiB 限制正確。
- 發布後匿名 HTTP：首頁 200，session 200 且 configured=true／user=null，library、worker、附件端點皆 401。新部署的 error／fatal Function logs 查詢未回傳紀錄；這些是基本部署檢查，沒有提交九個真實來源、沒有呼叫 Gemini，不代表第三階段通過。
- 正式 RLS advisors 的既有項目：內部 request_quotas 與新增的 ai_extractions／geocode_cache／geocode_gate 無 client policy 是刻意設計（[RLS advisor 說明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)）；consume_quota 為必要的 authenticated RPC；平台 rls_auto_enable 經 SQL 確認回傳 event_trigger，不能像一般 RPC 呼叫；Auth 密碼保護的既有提示未變動，不假稱所有 advisories 清零。

## 尚未驗證／外部條件

| 項目                                                                     | 狀態與替代做法                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 實體 iPhone Safari 相簿、多選、拍照、HEIC                                | 無實體裝置，不能以 Chromium 手機尺寸代替；依 [iPhone 文件](iphone.md) 實測，必要時使用 JPEG 截圖。                       |
| IG／Threads／Maps App 分享資料型別                                       | 尚未觀察實機 payload；提供逐來源紀錄表。捷徑先傳 URL，選擇附圖時在網站選相簿，不宣稱 iOS 會自動將原 App 的圖片交給網頁。 |
| Nominatim 正式查詢                                                       | 介面、快取與節流測試已完成；等待服務選擇與設定。查不到不存城市中心。                                                     |
| Gemini 專案實際 RPM／RPD                                                 | 待 AI Studio 專案頁確認，不需要貼 API key。                                                                              |
| 真實連結前後比較、真實截圖 OCR、原規格 1／2／3／4／5／7／10／11 正式驗收 | **第三階段，尚未執行，等待使用者確認。**                                                                                 |

正式發布不代表九個真實來源或 iPhone 已通過第三階段。需要登入、JS 呈現或封鎖機器存取的 IG／Threads，仍可能長期無法穩定讀取；提供文字／截圖是主要補充方式。
