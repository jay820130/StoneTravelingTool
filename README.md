# Stone 旅藏

手機優先、繁體中文的私人店家收藏與旅行整理工具。使用 Next.js／TypeScript、Supabase PostgreSQL／Auth／Storage，原需求完整保留於 [codex_saved_places_prompt.md](codex_saved_places_prompt.md)。

已實作收藏與來源、店家編輯、組合篩選、到訪與餐點、標籤管理、多來源關聯／合併、私人截圖、地圖、XLSX／PDF 分享，以及可替換 AI 的持久化解析佇列。正式 Supabase、AI 與部署仍需設定，尚未上線。最新驗證結果見 [進度紀錄](docs/progress.md)。

## 本機開發

需要 Node.js 22+（已驗證 Node 24）、npm、Docker、Python 3。PDF 測試另需 Poppler 的 `pdftotext`，瀏覽器測試使用 Chromium。

Codex 任務已在隔離環境中，直接使用既有 checkout；除非明確要求，不建立 Git worktree。

```bash
cd /workspace/StoneTravelingTool
npm ci
npm run tools:setup
npm run db:start
npm run local:env
npm run local:account
npm run dev
```

`tools:setup` 安裝固定版本 CLI，驗證官方 SHA256。`local:env` 把本機服務自帶的設定寫入被忽略的 `.env.local`，不列印金鑰或覆蓋未知設定。`local:account` 以隱藏密碼輸入建立你自己的本機帳號，不開放公開註冊。

另一個終端執行背景工作：

```bash
cd /workspace/StoneTravelingTool
npm run worker
```

沒設定 AI 時會顯示「待補內容」，手動收藏、編輯、評分與匯出仍可使用。沒有 Supabase 時網站顯示設定說明，不會假裝保存成功。

`npm run db:stop` 保留本機資料；網站與 worker 以 Ctrl+C 停止。`npm run db:reset -- --confirm-local-data-loss` **會刪除本機資料**，只適用於可丟棄測試庫，不是日常啟動步驟。Docker `vfs` 的磁碟問題見 [環境排錯](docs/environment.md)。

## 驗證

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

單元／資料庫測試使用 PGlite 的真正 PostgreSQL 引擎驗證 migrations、RLS、關聯、交易，另驗證解析失敗與匯出。這不代表正式 Supabase 已驗證。

完整瀏覽器流程使用本機 Supabase 的兩個獨立測試帳號：

```bash
npm run test:users
npm run test:e2e
```

`test:users` 只允許 localhost／127.0.0.1，會重建 `stone-e2e-a@example.test`、`stone-e2e-b@example.test` 及其可丟棄資料。測試憑證存於被忽略的 `.local/`，不列印、不與私人帳號混用。測試不會 reset 或部署正式資料庫。

## 日常操作

1. 貼上 IG、Threads、Maps 網址，先確實保存，再另外解析；相同連結不重複建立。
2. 「待整理」可補文字、截圖、收藏原因，確認候選或手動連結店家。一份來源可對應多店。
3. 組合國家、城市、類型、標籤、到訪狀態與店名搜尋。清單與地圖共用篩選；沒有座標的店家留在待補位置區。
4. 店家、每次到訪、每個餐點的評分各自保存；刪除最後一次到訪後回到「想去」。
5. 匯出前取消不要的店家、選擇到訪範圍和分享欄位。額外私人備註預設不勾選。

## 設定與維護

- [正式 Supabase、部署、AI、備份](docs/deployment.md)
- [iPhone 捷徑與實機驗收](docs/iphone.md)
- [架構、權限與技術選擇](docs/architecture.md)
- [完成／待驗證項目](docs/progress.md)

密碼、service role、AI key 不放 Git 或對話；填入平台的安全環境變數設定。`.env.example` 僅含名稱與非機密預設值。
