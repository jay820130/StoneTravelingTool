import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const files = (await readdir(new URL("supabase/migrations/", root)))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (!files.length) throw new Error("No migrations found");
const sections = [
  `-- StoneTravelingTool：僅供全新 Supabase 專案的一次性初始化。
-- 自動產生自 supabase/migrations/，請勿手動修改此檔。
-- 重新產生：node scripts/build-bootstrap.mjs
-- 執行前須在 Authentication → Users 建立且僅建立一個自己的登入帳號。
-- 本檔會建立資料表、RLS、私人截圖 bucket、migration history，並授權該唯一帳號。
-- 全部步驟放在同一交易；有錯誤會回滾，不會刪除既有資料。

begin;

do $bootstrap$
declare account_count integer;
begin
  select count(*) into account_count from auth.users;
  if account_count <> 1 then
    raise exception '初始化已停止：Authentication → Users 必須恰好有一個你自己的登入帳號；目前為 % 個。請勿刪除既有帳號，先回報此訊息。', account_count;
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  ) then
    raise exception '初始化已停止：public schema 已有資料表。此檔僅供全新專案；請勿重複執行或刪除既有資料。';
  end if;
  if exists(select 1 from storage.buckets where id='screenshots') then
    raise exception '初始化已停止：screenshots bucket 已存在，請先回報目前狀態。';
  end if;
end
$bootstrap$;

-- 使用 Supabase CLI 的標準 migration history 欄位，避免後續 db push 重跑這些版本。
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
-- 版本紀錄同樣啟用 RLS；管理者仍可寫入 migration history。
alter table supabase_migrations.schema_migrations enable row level security;`,
];
for (const file of files) {
  const [, version, name] = file.match(/^(\d+)_([a-z0-9_]+)\.sql$/);
  sections.push(
    `-- Migration: ${file}\n${await readFile(new URL(`supabase/migrations/${file}`, root), "utf8")}\ninsert into supabase_migrations.schema_migrations(version,name) values ('${version}','${name}');`,
  );
}
sections.push(`-- 授權剛剛由你建立的唯一 Auth 帳號；不輸出帳號、密碼或金鑰。
insert into public.profiles(owner_id,display_name)
select id,'旅人' from auth.users;

commit;

select
  '初始化完成' as status,
  (select count(*) from public.profiles) as invited_accounts,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity) as protected_tables,
  (select not public from storage.buckets where id='screenshots') as screenshots_private;
`);
const destination = new URL("supabase/setup/first-time.sql", root);
await mkdir(new URL("supabase/setup/", root), { recursive: true });
await writeFile(destination, sections.join("\n\n"));
console.log(`Generated ${fileURLToPath(destination)} from ${files.length} migrations.`);
