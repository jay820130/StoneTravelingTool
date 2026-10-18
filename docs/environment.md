# 雲端環境與排錯

工作目錄：`/workspace/StoneTravelingTool`。不需要新增 worktree。

## npm 與 CLI

此環境家目錄唯讀，`.npmrc` 將 npm cache 放在被忽略的 `.local/npm-cache`，不更改系統 HOME。

Supabase CLI 固定 2.76.8，以官方 release 的 SHA256 驗證後安裝到 `.local/bin/`。新版 CLI 在此環境會寫入唯讀家目錄；舊版 npm 安裝器不使用平台代理，所以改用會遵循既有 HTTPS proxy 的下載腳本，不停用 TLS／checksum。

## Docker VFS

這台環境 Docker driver 為 `vfs`。它逐層複製完整檔案系統，官方 PostgreSQL 映像的大量層曾讓 32 GB 磁碟耗盡；中止本次下載後，Docker 已回收未完成的層，未刪除專案資料。

`npm run db:start` 會先執行 `scripts/prepare-local-db.py`：

- 一般 overlay driver 不需額外處理；已有 PostgreSQL 映像時直接重用。
- Linux amd64 的 VFS 使用有官方 checksum 的 Crane 工具，讀取**固定 digest**的官方 Supabase PostgreSQL 映像；Crane 驗證各 registry blob 的 digest。
- 合併檔案系統層後匯入本機，保留原 CMD、ENTRYPOINT、ENV、USER、WORKDIR、port 與 volume 設定，並加上來源 digest 和 VFS 轉換標記。
- 匯入後的新 image ID 並非上游 digest；此處只改本機儲存層表示，沒有修改資料庫內容或停用任何驗證。完成後刪除暫存 tar。
- CLI 使用本機所需的 `supabase/postgres:17.6.1.081` tag；升級 CLI／Postgres 時必須一併重新確認此腳本的 tag、來源 digest 與平台，不能直接改期望 checksum。

首次需要 GitHub releases、`registry-1.docker.io`、`auth.docker.io` 及 registry 回應的映像層下載網域。預設 `public.ecr.aws` 曾被阻擋，因此使用 Supabase CLI 支援的 Docker Hub registry 設定。

## 保留狀態與重啟

原始碼、node_modules、`.local` helper 與 Docker volumes 是檔案狀態；Next.js、worker、Docker 容器是程序，不可假設在發布環境後繼續執行。新任務先 `npm run db:start`、`npm run local:env`，再啟動網站及 worker。

`.env.local`、本機帳號與測試憑證不提交 Git。正式 Supabase 設定與本機設定不要混用；不以 reset 解決未知正式資料庫問題。

Next 16 的 dev server 需要 `allowedDevOrigins: ['127.0.0.1']` 才能讓此環境的瀏覽器載入 dev 資源。已採精確主機設定，沒有開放萬用 origin。

若中斷任務後舊 dev server 仍佔用連接埠，但 HTTP 請求逾時，確認 PID 屬於本專案後停止並重新啟動；不要因此重置資料庫。瀏覽器測試會重用已有伺服器，需先確認它確實能回應。

本機 CLI 2.76.8 的 `[auth.email].enable_signup` 也影響 email provider 是否啟用，所以保留 `true` 以允許密碼登入；公開註冊由全域 `[auth].enable_signup = false` 關閉。正式 Dashboard 應保留 Email provider，同時關閉 Allow new users to sign up，不能把登入 provider 一起關掉。

`bash scripts/cloud-setup.sh` 是可重跑的安裝與檢查入口，不建立私人帳號、不清理測試帳號、不重置資料庫。自訂 `.env.local` 會保留，只有本腳本產生的本機設定會更新。
