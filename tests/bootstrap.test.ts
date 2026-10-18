import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const bootstrap = await readFile("supabase/setup/first-time.sql", "utf8");

beforeEach(async () => {
  db = new PGlite();
  // Minimal platform schemas; no default Data API table grants. Simulate the
  // Dashboard's automatic RLS option as a real PostgreSQL event trigger.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
    $$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    create function public.test_auto_rls() returns event_trigger language plpgsql as $$
    declare command record;
    begin
      for command in select * from pg_event_trigger_ddl_commands() loop
        if command.object_type='table' and command.schema_name='public' then
          execute format('alter table %s enable row level security',command.object_identity);
        end if;
      end loop;
    end $$;
    create event trigger test_auto_rls on ddl_command_end when tag in ('CREATE TABLE') execute function public.test_auto_rls();
  `);
});
afterEach(async () => {
  await db.close();
});

describe("first-time hosted project bootstrap", () => {
  it("initializes the sole invited account, private storage, RLS and CLI history without default grants", async () => {
    await db.query("insert into auth.users(id) values($1)", [owner]);
    const result = await db.exec(bootstrap);
    expect(result.at(-1)?.rows).toEqual([
      {
        status: "初始化完成",
        invited_accounts: 1,
        protected_tables: 10,
        screenshots_private: true,
      },
    ]);
    expect(
      (
        await db.query(
          "select version,name from supabase_migrations.schema_migrations order by version",
        )
      ).rows,
    ).toEqual([
      { version: "202610180001", name: "core" },
      { version: "202610180002", name: "storage" },
      { version: "202610180003", name: "candidates" },
      { version: "202610180004", name: "job_recovery" },
    ]);
    expect(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid='supabase_migrations.schema_migrations'::regclass",
        )
      ).rows,
    ).toEqual([{ relrowsecurity: true }]);
    await db.exec(`set role anon`);
    await expect(db.query("select * from public.places")).rejects.toThrow(/permission denied/);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${owner}'`);
    await db.exec("insert into public.places(name) values('初始化後的私人收藏')");
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    expect((await db.query("select * from public.places")).rows).toEqual([]);
    await db.exec("reset role; set role service_role");
    expect((await db.query("select * from public.places")).rows).toHaveLength(1);
    await db.query("select public.claim_import_job()");
  });

  it.each([0, 2])(
    "refuses %i Auth users without choosing or deleting an account",
    async (count) => {
      if (count) await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
      await expect(db.exec(bootstrap)).rejects.toThrow(/必須恰好有一個/);
      await db.exec("rollback");
      expect((await db.query("select count(*)::integer as n from auth.users")).rows).toEqual([
        { n: count },
      ]);
      expect((await db.query("select to_regclass('public.profiles') as relation")).rows).toEqual([
        { relation: null },
      ]);
    },
  );

  it("refuses re-running initialization and preserves existing collections", async () => {
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.exec(bootstrap);
    await db.query("insert into public.places(owner_id,name) values($1,'保留這筆收藏')", [owner]);
    await expect(db.exec(bootstrap)).rejects.toThrow(/已有資料表/);
    await db.exec("rollback");
    expect((await db.query("select name from public.places")).rows).toEqual([
      { name: "保留這筆收藏" },
    ]);
  });

  it("rolls back newly created tables when a later migration history insert fails", async () => {
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.exec(`create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
      insert into supabase_migrations.schema_migrations(version) values('202610180001');`);
    await expect(db.exec(bootstrap)).rejects.toThrow(/duplicate key/);
    await db.exec("rollback");
    expect((await db.query("select to_regclass('public.profiles') as relation")).rows).toEqual([
      { relation: null },
    ]);
    expect((await db.query("select count(*)::integer as n from auth.users")).rows).toEqual([
      { n: 1 },
    ]);
  });
});
