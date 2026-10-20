# Maps 分享連結：修正與驗證紀錄

更新：2026-10-20。修正接續 `codex/stone-traveling-tool` 的 `6a01b53`，尚未部署至正式 `main`，也尚未證明使用者的原始短連結能自動取得店名及地址。補上文字後 Gemini 能產生候選店家，不能替代連結匯入的驗收。

## 2026-10-20 接續結果

- 已以使用者貼出的原始短連結實測；`maps.app.goo.gl` 回傳 **HTTP 302**，跳到 **`www.google.com.tw/maps/place/…`**。使用與應用程式相同的 User-Agent、Accept、Accept-Encoding、Accept-Language 再讀一次，亦跳到相同主機。私人短碼、完整跳轉網址與實際頁面不寫入 Git 或 fixture。
- 本次環境已帶入先前發布的 Maps 網域，但缺少 `www.google.com.tw`。沿原始跳轉讀取時，第二站仍收到代理 **CONNECT 403**，不是 Google 頁面的 HTTP 403。環境狀態工具的政策狀態仍為 `unknown`，不能只憑設定清單宣稱全部已生效；實際短連結和官方文件已可通過代理。
- 找到另一個可獨立重現的程式缺口：`sourceUrl` 會拒絕 `www.google.com.tw`，因此只調整環境也不足以完成匯入。現已精確允許此主機，並共用 Maps 主機判斷，確保臺灣頁面同樣在取得完整分享預覽後停止下載。一般 Google 主機僅允許 `/maps` 或 `/maps/…`，不接受 `/maps-redirect` 等相似前綴；逐跳 HTTPS、憑證／port、DNS 與固定 IP 的防護保留。
- 回歸測試先在舊實作重現臺灣跳轉／來源拒絕及路徑邊界問題，修正後相關 60 項通過。使用明確虛構資料測試臺灣短鏈跳轉 → 預覽 → 模擬 AI 候選、提早停止大型頁面、原網址保存、私人 IP 與不安全跳轉。真實 Gemini、正式 worker 與資料保存尚未驗證。
- 最終檢查：`npm run typecheck`、`npm run lint`、`npm test`（**106 項**）、`npm run build` 全部通過。本次未改動資料庫或帳號設定，未重跑完整本機瀏覽器 E2E。
- 修正已提交並推送為 `20ecd3a`。使用者隨後回覆已新增並發布 `www.google.com.tw`；重測相同短連結仍是 302 → 該主機 CONNECT 403。當前任務的 `environment_status` 顯示 `observations_current=true`、spec／observed revision 均為 `5`、政策 `enforced`，但 `allowed_hosts` 與 `effective_allowed_hosts` 均不含此主機，且 `source_config_version_id` 與發布前觀察到的值相同。這證明當前任務尚未帶入包含該主機的版本，不能據此說使用者沒有完成發布。需讓任務套用最新發布的環境版本；若介面無法更新既有任務，從最新版本啟動新任務後接續此分支。現有工具僅能讀取狀態，無法切換綁定版本。

## 官方文件查閱

2026-10-20 經既有 HTTPS proxy、保留 TLS 驗證取得以下官方文件，均為 HTTP 200：

- [Google Maps 額外條款](https://www.google.com/help/terms_maps/)（頁面標示最後修改 2026-01-27）：限制內容複製（除另有許可或適用法律允許）、大量下載／建立批次資料，以及建立替代或實質相似服務的地圖相關資料集。不能因少量個人使用或可讀分享預覽就宣稱取得任意長期儲存授權。
- [Maps URLs 官方文件](https://developers.google.com/maps/documentation/urls/get-started)：原 `/urls/guide` 導向此頁。Maps URLs 是免 API key 的 Google Maps 外連方式，使用 `api=1`；並非回傳店名／地址的資料匯入 API，也未承諾網頁預覽的格式或可讀性。

此次只完成使用者指定來源的連線診斷與程式相容修正，未新增正式資料、開通 Places API、擷取座標繪製到其他底圖，或複製評論／照片。正式匯入仍需確認資料使用範圍，不能將上述外連文件視為內容授權。

## 已確認的程式缺口與變更

- 舊擷取器移除所有 HTML tags 時也丟掉分享預覽的 `meta content`。改以固定版本的 `htmlparser2` 擷取 Open Graph、Twitter、itemprop 的公開標題與描述，保留文章文字，忽略 script、style、template 等內容，不執行網頁程式。
- Maps 的完整頁面包含大型網頁程式。現在取得完整 head 且具有地點分享標題後即停止下載；沒有足夠分享資訊時仍保留 1 MiB 限制，輸入 AI 的文字最多 20,000 字元。這能處理「預覽可讀、後方程式很大」的頁面，尚未證實原始連結的失敗就是大小限制。
- 逐跳檢查 HTTPS、主機、路徑、port、帳密與 DNS 位址，拒絕私人／混合 DNS；每次請求固定已驗證的 IP 並保留 TLS hostname。最多五次跳轉、總計十二秒，優先使用已驗證的 IPv4 位址。
- 來源讀取錯誤改為固定分類訊息，區分 DNS、網路、逾時、HTTP、類型、大小及不支援的跳轉。暫時錯誤使用既有持久化佇列、最多三次嘗試；不再一律吞掉錯誤並永久轉待補內容。不回傳供應商原始錯誤或 response body。
- 補充文字仍優先，截圖備援保留；收藏原因、私人筆記與評分不送給 AI。未設定 AI 時不下載來源或附件。資料庫與既有人工資料不變。

## 證據與邊界

型別檢查、Lint、94 項測試及 production build 通過。其中新增 35 項測試使用明確虛構的分享預覽／地址與模擬 HTTP、DNS、AI 回應，驗證短網址 → 預覽 → AI → 工作結果的處理，也涵蓋 SSRF、UTF-8 邊界、HTTP 429／503 重試、無 AI、補文字及截圖備援。既有資料庫測試驗證有限重試及 revision／claim token；本次未重跑完整瀏覽器 E2E，也未使用正式帳號或真實 AI 金鑰。

Codex 原執行環境一度無法啟動；使用者發布環境後已恢復，checkout 與依賴保留。現在 HTTPS proxy 對 Maps 與官方文件主機回應 CONNECT 403，直接 DNS 查詢亦曾得到 EAI_AGAIN；這是 Codex 開發環境的限制，不能拿來推定 Vercel 上的實際錯誤原因。

先前已在 Codex 環境草稿保留原有網域並新增 `maps.app.goo.gl`、`www.google.com`、`google.com`、`maps.google.com`、`developers.google.com`、`ai.google.dev`。使用者已發布，且本次已收到文字形式的原始連結；最新實測見上方。未繞過代理、停用 TLS 或放寬應用程式的 SSRF 防護；不得把私人來源或實際頁面加入 Git／fixture。

## 接下來的必要驗證

1. 使用者已回報新增 `www.google.com.tw` 並發布，**不要再次要求重做設定**。先確認當前任務實際綁定最新版本、有效允許清單包含此主機，再以對話中的同一原始短連結確認完整跳轉、最終 HTTP 狀態及公開分享預覽。現有任務的版本未更新，必要時從最新發布版本啟動新任務。原始回應只存在 `/workspace/work/maps-import/` 臨時檔，不記錄到正式日誌或 Git。現有環境工具只能讀取政策，不能代為切換版本；不要改寫跳轉主機來繞過代理拒絕，也不要重做帳號設定。
2. 官方文件已取得，結論見上方；資料使用範圍與真實預覽仍需確認。Codex 使用代理的連線診斷與 Vercel 的 DNS／固定 IP 讀取是不同路徑，不能把 curl 成功等同正式 worker 或 Gemini 匯入成功。
3. 確認實際資料可讀及適用範圍後，再推進正式部署與使用者驗收。遇到網站實際拒絕或缺少資訊時如實回報，不能宣稱所有 Maps、IG 或 Threads 連結都可解析。
4. 使用者已經補過文字的來源會優先解析補充文字，不能靠重試這筆資料假稱自動讀取成功。驗收須直接檢查原網址讀取結果，或使用尚未收藏的新 Maps 連結；不要清除既有補充內容、筆記或收藏。
5. 自動產生候選店家後仍需使用者核對並確認新增；正式重新整理／登出再登入的資料保存驗證仍待完成。
