import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
async function as(id: string, role = "authenticated") {
  await db.exec(`reset role;set role ${role};set request.jwt.claim.sub='${id}'`);
}
async function place(name = "咖啡店") {
  return (
    await db.query<{ id: string }>("insert into places(name) values($1) returning id", [name])
  ).rows[0].id;
}
async function source(url = "https://www.instagram.com/p/a/") {
  return (
    await db.query<{ id: string }>(
      "insert into sources(original_url,canonical_url) values($1,$1) returning id",
      [url],
    )
  ).rows[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;",
  );
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    grant usage on schema storage to authenticated,anon,service_role;
    grant select,insert,delete on storage.objects to authenticated;`);
  for (const p of [
    "202610180001_core.sql",
    "202610180002_storage.sql",
    "202610180003_candidates.sql",
    "202610180004_job_recovery.sql",
    "20261021003629_import_content_pipeline.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${p}`, "utf8"));
});
beforeEach(async () => {
  await db.exec(
    `reset role;truncate auth.users cascade;insert into auth.users(id) values('${owner}'),('${other}');insert into profiles(owner_id) values('${owner}'),('${other}')`,
  );
  await as(owner);
});
afterAll(async () => {
  await db.close();
});
describe("PostgreSQL constraints and row-level security", () => {
  it("owner can CRUD; stranger cannot read, update, delete or forge ownership", async () => {
    const id = await place();
    await as(other);
    expect((await db.query("select * from places")).rows).toHaveLength(0);
    expect(
      (await db.query("update places set name='stolen' where id=$1 returning id", [id])).rows,
    ).toHaveLength(0);
    expect((await db.query("delete from places where id=$1 returning id", [id])).rows).toHaveLength(
      0,
    );
    await expect(
      db.query("insert into places(owner_id,name) values($1,'forged')", [owner]),
    ).rejects.toThrow();
    await as(owner);
    expect(
      (await db.query("update places set name='updated' where id=$1 returning name", [id])).rows,
    ).toEqual([{ name: "updated" }]);
    expect((await db.query("delete from places where id=$1 returning id", [id])).rows).toHaveLength(
      1,
    );
  });
  it("anon has no CRUD privilege on every private table", async () => {
    await as("", "anon");
    for (const t of [
      "profiles",
      "places",
      "sources",
      "place_sources",
      "visits",
      "dishes",
      "labels",
      "attachments",
      "import_jobs",
      "request_quotas",
    ]) {
      await expect(db.query(`select * from ${t}`)).rejects.toThrow();
      for (const privilege of ["insert", "update", "delete"]) {
        const r = await db.query<{ allowed: boolean }>(
          "select has_table_privilege('anon',$1,$2) as allowed",
          [t, privilege],
        );
        expect(r.rows[0].allowed).toBe(false);
      }
    }
  });
  it("sources are idempotent and same-name branches are independent", async () => {
    await source();
    await expect(source()).rejects.toThrow();
    expect(await place("同名店")).not.toBe(await place("同名店"));
    expect((await db.query("select * from import_jobs")).rows).toHaveLength(1);
  });
  it("many-to-many links retain sources and reject cross-owner links", async () => {
    const a = await place(),
      b = await place(),
      s = await source();
    await db.query("insert into place_sources(place_id,source_id) values($1,$3),($2,$3)", [
      a,
      b,
      s,
    ]);
    expect((await db.query("select * from place_sources")).rows).toHaveLength(2);
    await as(other);
    const foreignPlace = await place();
    await expect(
      db.query("insert into place_sources(place_id,source_id) values($1,$2)", [foreignPlace, s]),
    ).rejects.toThrow();
  });
  it("stores multiple visits and dishes atomically; retry does not duplicate", async () => {
    const p = await place();
    const payload = {
      id: crypto.randomUUID(),
      place_id: p,
      visited_on: "2026-10-18",
      rating: 4,
      notes: "第一次",
      dishes: [
        { name: "拿鐵", rating: 5, notes: "香" },
        { name: "布丁", rating: 3, notes: "甜" },
      ],
    };
    for (let i = 0; i < 2; i++)
      await db.query("select save_visit($1::jsonb)", [JSON.stringify(payload)]);
    await db.query("select save_visit($1::jsonb)", [
      JSON.stringify({ ...payload, id: crypto.randomUUID(), visited_on: "2026-10-19" }),
    ]);
    expect((await db.query("select * from visits")).rows).toHaveLength(2);
    expect((await db.query("select * from dishes")).rows).toHaveLength(4);
    await expect(
      db.query("select save_visit($1::jsonb)", [
        JSON.stringify({ ...payload, dishes: [{ name: "bad", rating: 0, notes: "" }] }),
      ]),
    ).rejects.toThrow();
    expect((await db.query("select * from dishes")).rows).toHaveLength(4);
    await as(other);
    for (const t of ["visits", "dishes"])
      expect((await db.query(`select * from ${t}`)).rows).toHaveLength(0);
    await expect(
      db.query("select save_visit($1::jsonb)", [JSON.stringify(payload)]),
    ).rejects.toThrow();
  });
  it("reparse keeps manual fields and rejects stale job completion", async () => {
    const p = await place();
    await db.query(
      "update places set notes='手動私人心得',tags=array['自訂'],rating=5 where id=$1",
      [p],
    );
    const s = await source();
    await as(owner, "service_role");
    const job = (
      await db.query<{ job: { id: string; claim_id: string } }>(
        "select row_to_json(claim_import_job()) as job",
      )
    ).rows[0].job;
    await as(owner);
    await db.query("select requeue_source($1,'補充文字','收藏原因')", [s]);
    await as(owner, "service_role");
    const r = await db.query<{ done: boolean }>(
      "select complete_import_job($1,$2,$3::jsonb,false) as done",
      [
        job.id,
        job.claim_id,
        JSON.stringify({ status: "parsed", summary: "old", candidates: [], error: "" }),
      ],
    );
    expect(r.rows[0].done).toBe(false);
    await as(owner);
    expect(
      (await db.query("select notes,tags,rating from places where id=$1", [p])).rows[0],
    ).toEqual({ notes: "手動私人心得", tags: ["自訂"], rating: 5 });
    expect((await db.query("select summary from sources where id=$1", [s])).rows[0]).toEqual({
      summary: "",
    });
  });
  it("candidate acceptance is explicit and repeatable for multiple stores", async () => {
    const s = await source();
    await db.query("update sources set candidates=$1::jsonb where id=$2", [
      JSON.stringify([
        {
          name: "A",
          branch: "測試分店",
          country: "日本",
          city: "大阪",
          address: "",
          categories: ["咖啡廳"],
        },
        { name: "B", country: "日本", city: "大阪", address: "", categories: ["甜點"] },
      ]),
      s,
    ]);
    for (let i = 0; i < 2; i++) await db.query("select accept_candidates($1,array[0,1])", [s]);
    expect((await db.query("select name from places order by name")).rows).toEqual([
      { name: "A · 測試分店" },
      { name: "B" },
    ]);
    expect((await db.query("select * from place_sources")).rows).toHaveLength(2);
  });
  it("merge retains visits, original notes and all source links", async () => {
    const a = await place("A"),
      b = await place("B"),
      s = await source();
    await db.query("update places set notes='keep',rating=4 where id=$1", [a]);
    await db.query("insert into place_sources(place_id,source_id) values($1,$2)", [a, s]);
    await db.query("select save_visit($1::jsonb)", [
      JSON.stringify({
        place_id: a,
        visited_on: "2026-10-18",
        rating: 5,
        notes: "visit",
        dishes: [{ name: "tea", rating: 5, notes: "" }],
      }),
    ]);
    await db.query("select merge_places($1,$2)", [a, b]);
    expect((await db.query("select * from places")).rows).toHaveLength(1);
    expect((await db.query<{ notes: string }>("select notes from places")).rows[0].notes).toContain(
      "keep",
    );
    expect((await db.query("select place_id from visits")).rows[0]).toEqual({ place_id: b });
    expect((await db.query("select * from dishes")).rows).toHaveLength(1);
    expect((await db.query("select place_id from place_sources")).rows[0]).toEqual({ place_id: b });
  });
  it("label rename and deletion update every place without touching notes", async () => {
    const p = await place();
    await db.query("update places set tags=array['舊標籤'],notes='private' where id=$1", [p]);
    await db.query("select rename_label('舊標籤','新標籤')");
    expect((await db.query("select tags from places")).rows[0]).toEqual({ tags: ["新標籤"] });
    await db.query("select rename_label('新標籤','')");
    expect((await db.query("select tags,notes from places")).rows[0]).toEqual({
      tags: [],
      notes: "private",
    });
  });
  it("rate limits are database backed and shared across requests", async () => {
    for (let i = 0; i < 100; i++)
      expect(
        (await db.query<{ allowed: boolean }>("select consume_quota() as allowed")).rows[0].allowed,
      ).toBe(true);
    expect(
      (await db.query<{ allowed: boolean }>("select consume_quota() as allowed")).rows[0].allowed,
    ).toBe(false);
    await as(other);
    expect(
      (await db.query<{ allowed: boolean }>("select consume_quota() as allowed")).rows[0].allowed,
    ).toBe(true);
  });
  it("expires an exhausted worker lease and permits an explicit retry", async () => {
    const s = await source();
    await as(owner, "service_role");
    await db.query("update sources set status='processing' where id=$1", [s]);
    await db.query(
      "update import_jobs set status='running',attempts=3,locked_at=now()-interval '6 minutes' where source_id=$1",
      [s],
    );
    await db.query("select claim_import_job()");
    expect((await db.query("select status from sources where id=$1", [s])).rows[0]).toEqual({
      status: "failed",
    });
    await as(owner);
    await db.query("select requeue_source($1,'補充','')", [s]);
    expect(
      (await db.query("select status,attempts from import_jobs where source_id=$1", [s])).rows[0],
    ).toEqual({ status: "queued", attempts: 0 });
  });
});

describe("content intake, cache and location migration", () => {
  it("holds work until all content is saved and rejects an obsolete claim", async () => {
    const s = await source();
    await as(owner, "service_role");
    const job = (
      await db.query<{ id: string; claim_id: string }>("select * from claim_import_job()")
    ).rows[0];
    await as(owner);
    await db.query("select save_source_draft($1,'saved text','private reason')", [s]);
    await as(owner, "service_role");
    expect(
      (
        await db.query("select complete_import_job($1,$2,$3::jsonb,false) as ok", [
          job.id,
          job.claim_id,
          JSON.stringify({ status: "parsed", summary: "obsolete", candidates: [] }),
        ])
      ).rows,
    ).toEqual([{ ok: false }]);
    expect(
      (await db.query("select content_text,intake_pending,status from sources where id=$1", [s]))
        .rows[0],
    ).toMatchObject({ content_text: "saved text", intake_pending: true, status: "needs_input" });
    await as(owner);
    await db.query("select requeue_source($1,'saved text','private reason')", [s]);
    expect((await db.query("select status,attempts from import_jobs")).rows).toEqual([
      { status: "queued", attempts: 0 },
    ]);
  });
  it("reserves images atomically with ownership, count and total byte limits", async () => {
    const s = await source();
    await as(other);
    await expect(db.query("select reserve_attachment($1,'image/png',10)", [s])).rejects.toThrow();
    await as(owner);
    for (let i = 0; i < 6; i++)
      await db.query("select reserve_attachment($1,'image/png',100)", [s]);
    await expect(db.query("select reserve_attachment($1,'image/png',100)", [s])).rejects.toThrow(
      "Image limit",
    );
    expect(
      (await db.query<{ state: string }>("select state from attachments")).rows.every(
        (a) => a.state === "pending",
      ),
    ).toBe(true);
    const t = await source("https://www.instagram.com/p/second");
    for (let i = 0; i < 2; i++)
      await db.query("select reserve_attachment($1,'image/heic',5242880)", [t]);
    await expect(
      db.query("select reserve_attachment($1,'image/heic',5242880)", [t]),
    ).rejects.toThrow("Image limit");
  });
  it("requires an owned source for Storage insertion", async () => {
    const s = await source();
    await db.query("insert into storage.objects(bucket_id,name) values('screenshots',$1)", [
      `${owner}/${s}/test`,
    ]);
    await as(other);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values('screenshots',$1)", [
        `${other}/${s}/forged`,
      ]),
    ).rejects.toThrow();
  });
  it("protects internal cache functions and gives one in-flight claim per owner/content", async () => {
    await expect(db.query("select claim_ai_extraction($1,'hash')", [owner])).rejects.toThrow();
    await expect(db.query("select * from ai_extractions")).rejects.toThrow();
    await as(owner, "service_role");
    const claim = (
      await db.query<{ v: { token: string } }>("select claim_ai_extraction($1,'hash') as v", [
        owner,
      ])
    ).rows[0].v;
    expect(claim.token).toBeTruthy();
    expect((await db.query("select claim_ai_extraction($1,'hash') as v", [owner])).rows[0]).toEqual(
      { v: {} },
    );
    await db.query("select finish_ai_extraction($1,'hash',$2,$3::jsonb)", [
      owner,
      claim.token,
      JSON.stringify({ summary: "cached" }),
    ]);
    expect((await db.query("select claim_ai_extraction($1,'hash') as v", [owner])).rows[0]).toEqual(
      { v: { result: { summary: "cached" } } },
    );
    expect(
      (
        await db.query<{ v: { token: string } }>("select claim_ai_extraction($1,'hash') as v", [
          other,
        ])
      ).rows[0].v.token,
    ).toBeTruthy();
  });
  it("accepts explicit place coordinates but never viewport coordinates", async () => {
    const s = await source();
    await db.query("update sources set candidates=$1::jsonb where id=$2", [
      JSON.stringify([
        { name: "A", categories: [], latitude: 25, longitude: 121, coordinate_kind: "place" },
        { name: "B", categories: [], latitude: 26, longitude: 122, coordinate_kind: "viewport" },
      ]),
      s,
    ]);
    await db.query("select accept_candidates($1,array[0,1])", [s]);
    await db.query("select accept_candidates($1,array[0,1])", [s]);
    expect(
      (await db.query("select name,latitude,longitude from places order by name")).rows,
    ).toEqual([
      { name: "A", latitude: 25, longitude: 121 },
      { name: "B", latitude: null, longitude: null },
    ]);
  });
  it("persists provider retry-after and waits before claiming again", async () => {
    await source();
    await as(owner, "service_role");
    const job = (
      await db.query<{ id: string; claim_id: string }>("select * from claim_import_job()")
    ).rows[0];
    await db.query("select complete_import_job($1,$2,$3::jsonb,true)", [
      job.id,
      job.claim_id,
      JSON.stringify({ status: "failed", error: "HTTP_429", retry_after: 120 }),
    ]);
    expect(
      (
        await db.query(
          "select status,available_at>=now()+interval '119 seconds' as delayed from import_jobs",
        )
      ).rows,
    ).toEqual([{ status: "queued", delayed: true }]);
  });
  it("gates geocoding globally and keeps cached queries server-only", async () => {
    await expect(db.query("select take_geocode_slot()")).rejects.toThrow();
    await expect(db.query("select * from geocode_cache")).rejects.toThrow();
    await as(owner, "service_role");
    expect((await db.query("select take_geocode_slot() as ok")).rows).toEqual([{ ok: true }]);
    expect((await db.query("select take_geocode_slot() as ok")).rows).toEqual([{ ok: false }]);
  });
});
