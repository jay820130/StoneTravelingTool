# 第一階段診斷概要（保留的階段結論）

第一階段已完成回報，使用者其後授權進入第二階段。本檔記錄前一輪已確認的概要；2026-10-21 恢復工作區時，未提交的完整證據檔未保留，因此不補造逐請求 trace，也沒有在第二階段重新執行真實來源測試。

正式基線：Vercel Hobby／Next.js／Node 24；production commit `6da71771db29d7cd83f135dc65a2a1d07e4416f8`。Supabase Free。Gemini 使用 AI Studio key 的 OpenAI 相容端點；歷史設定 `gemini-3.5-flash-lite`，沒有 URL context 或 grounding。當時 Production env 為 Sensitive，API 不可反讀值，模型名稱並非從日誌獨立讀回。Cron + pg_net 每分鐘觸發 HTTP worker，持久化工作有 revision、claim 與租約，並非回應後臨時程序。

| 使用者提供的來源 | 當時正式來源狀態 | 候選數 | 工作結果   |
| ---------------- | ---------------- | ------ | ---------- |
| Maps 1           | needs_input      | 0      | done，1 次 |
| Maps 2           | needs_input      | 0      | done，1 次 |
| Maps 3           | needs_input      | 0      | done，1 次 |
| IG Reels 1       | parsed           | 17     | done，1 次 |
| IG Reels 2       | parsed           | 1      | done，1 次 |
| IG Reels 3       | parsed           | 1      | done，1 次 |
| Threads 1        | needs_input      | 0      | done，1 次 |
| Threads 2        | needs_input      | 0      | done，1 次 |
| Threads 3        | needs_input      | 0      | done，1 次 |

當時正式 worker 回應 200，沒有觀察到未處理例外或租約重試；不能據此說所有失敗細節都被記錄。舊版未保存來源 HTTP 轉址鏈、title／og、實際 AI input 與原始 AI 回應，因此逐欄 HTTP／HTML／Gemini 錯誤碼無法完整追溯。這些欄位應標記「未觀測」，不能拿本機抓取補成正式證據。

輔助環境曾觀察 Maps 短連結 302 → www.google.com.tw/maps/... → 200；當時程式允許清單沒有 google.com.tw。這證明程式規則有缺口，但輔助環境的轉址不代表當次 Vercel 的實際鏈。舊版社群讀取方式也不能保證取得受登入、JS 或平台限制的內容。Reels 樣本成功只適用於這三個樣本，不代表 Reels 一律可讀，亦不代表其他公開貼文一律不可讀。

已有 attachments 表、私人 screenshots bucket、單張上傳端點與待整理入口；缺少快速收藏多圖流程、HEIC、可靠上傳完成階段，且經 Vercel 中轉的 5 MB 檔案會遇到平台 4.5 MB 限制。第二階段針對上述缺口改為規則解析、有限 metadata、私人直接上傳及明確待補狀態，見 [第二階段](phase2.md)。
