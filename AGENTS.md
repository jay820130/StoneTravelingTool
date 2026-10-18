<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## StoneTravelingTool

- 請使用繁體中文溝通。需求原文位於 `codex_saved_places_prompt.md`，進度在 `docs/progress.md`。
- 直接使用既有隔離 checkout；除非使用者要求，不建立 Git worktree。
- 不將正式帳號、金鑰、私人資料放入 Git 或測試 fixture。不要對正式 Supabase 執行 reset 或測試帳號清理。
- 原始來源需先保存；AI 失敗不得遺失收藏或覆蓋人工資料。店家、到訪與餐點評分分開保存。
- 修改資料表時同時檢查 RLS、跨擁有者外鍵、交易與 migration 測試。
- 檢查：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`；完整互動另用本機 Supabase 執行 `npm run test:users`、`npm run test:e2e`。
- 讀取 `docs/environment.md` 後再調整 Docker／CLI；保留 TLS、checksum 與映像 digest 驗證。
