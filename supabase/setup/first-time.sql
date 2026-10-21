-- StoneTravelingTool：僅供全新 Supabase 專案的一次性初始化。
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
alter table supabase_migrations.schema_migrations enable row level security;

-- Migration: 202610180001_core.sql
create table public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '旅人'
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy own_profile on public.profiles for select to authenticated using (owner_id = (select auth.uid()));

create table public.places (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(owner_id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  country text not null default '', city text not null default '', address text not null default '',
  latitude double precision, longitude double precision,
  categories text[] not null default '{}', tags text[] not null default '{}',
  rating integer check (rating between 1 and 5), notes text not null default '',
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
);
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(owner_id) on delete cascade,
  original_url text not null check(length(original_url) <= 4000),
  canonical_url text not null check(length(canonical_url) <= 4000),
  content_text text not null default '' check(length(content_text) <= 30000),
  reason text not null default '' check(length(reason) <= 10000),
  status text not null default 'pending' check(status in ('pending','processing','parsed','partial','needs_input','failed')),
  summary text not null default '', candidates jsonb not null default '[]', error text not null default '',
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique(owner_id, canonical_url), unique(owner_id,id)
);
create table public.place_sources (
  owner_id uuid not null default auth.uid(), place_id uuid not null, source_id uuid not null,
  primary key(owner_id,place_id,source_id),
  foreign key(owner_id,place_id) references public.places(owner_id,id) on delete cascade,
  foreign key(owner_id,source_id) references public.sources(owner_id,id) on delete cascade
);
create table public.visits (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), place_id uuid not null,
  visited_on date not null, rating integer check(rating between 1 and 5), notes text not null default '',
  created_at timestamptz not null default now(), unique(owner_id,id),
  foreign key(owner_id,place_id) references public.places(owner_id,id) on delete cascade
);
create table public.dishes (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), visit_id uuid not null,
  name text not null check(length(trim(name)) between 1 and 200), rating integer check(rating between 1 and 5), notes text not null default '',
  foreign key(owner_id,visit_id) references public.visits(owner_id,id) on delete cascade
);
create table public.labels (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references public.profiles(owner_id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 200), unique(owner_id,name)
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), source_id uuid not null,
  path text not null unique, mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp')),
  created_at timestamptz not null default now(),
  foreign key(owner_id,source_id) references public.sources(owner_id,id) on delete cascade,
  check (split_part(path,'/',1)=owner_id::text)
);
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, source_id uuid not null unique,
  revision integer not null, status text not null default 'queued' check(status in ('queued','running','done','failed')),
  attempts integer not null default 0, available_at timestamptz not null default now(),
  locked_at timestamptz, claim_id uuid, last_error text not null default '',
  foreign key(owner_id,source_id) references public.sources(owner_id,id) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['places','sources','place_sources','visits','dishes','labels','attachments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))',t);
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',t);
    execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = (select auth.uid()))',t);
    execute format('create index on public.%I(owner_id)',t);
  end loop;
end $$;
alter table public.import_jobs enable row level security;
revoke all on public.import_jobs from anon, authenticated;
grant select on public.import_jobs to authenticated;
create policy owner_read on public.import_jobs for select to authenticated using(owner_id = (select auth.uid()));
create index on public.import_jobs(status,available_at);
create index on public.place_sources(source_id);
create index on public.visits(place_id);
create index on public.dishes(visit_id);

create function public.enqueue_source() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.import_jobs(owner_id,source_id,revision) values(new.owner_id,new.id,new.revision)
  on conflict(source_id) do update set revision=excluded.revision,status='queued',attempts=0,available_at=now(),locked_at=null,claim_id=null,last_error='';
  return new;
end $$;
create trigger source_created after insert on public.sources for each row execute function public.enqueue_source();
create trigger source_revised after update of revision on public.sources for each row when (new.revision<>old.revision) execute function public.enqueue_source();

create function public.requeue_source(source uuid, content text, why text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.sources set content_text=content,reason=why,revision=revision+1,status='pending',error='' where id=source and owner_id=auth.uid();
  if not found then raise exception 'Source not found'; end if;
end $$;

create function public.save_visit(payload jsonb) returns uuid language plpgsql security invoker set search_path = '' as $$
declare vid uuid := coalesce((payload->>'id')::uuid,gen_random_uuid()); item jsonb;
begin
  if jsonb_array_length(payload->'dishes')>50 then raise exception 'Too many items'; end if;
  insert into public.visits(id,owner_id,place_id,visited_on,rating,notes)
    values(vid,auth.uid(),(payload->>'place_id')::uuid,(payload->>'visited_on')::date,(payload->>'rating')::integer,payload->>'notes')
    on conflict(id) do update set visited_on=excluded.visited_on,rating=excluded.rating,notes=excluded.notes
      where visits.owner_id=auth.uid() and visits.place_id=excluded.place_id;
  if not found then raise exception 'Visit not found'; end if;
  delete from public.dishes where visit_id=vid and owner_id=auth.uid();
  for item in select * from jsonb_array_elements(payload->'dishes') loop
    insert into public.dishes(owner_id,visit_id,name,rating,notes) values(auth.uid(),vid,item->>'name',(item->>'rating')::integer,item->>'notes');
  end loop;
  return vid;
end $$;

create function public.rename_label(old_name text, new_name text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if new_name<>'' then
    insert into public.labels(owner_id,name) values(auth.uid(),new_name) on conflict(owner_id,name) do nothing;
    update public.places set tags=array(select distinct x from unnest(array_replace(tags,old_name,new_name)) x) where owner_id=auth.uid() and old_name=any(tags);
  else
    update public.places set tags=array_remove(tags,old_name) where owner_id=auth.uid();
  end if;
  if new_name<>old_name then delete from public.labels where owner_id=auth.uid() and name=old_name; end if;
end $$;

-- Explicit merge is atomic; sources, visits and attachments are retained.
create function public.merge_places(from_id uuid, into_id uuid) returns void language plpgsql security invoker set search_path = '' as $$
declare a public.places; b public.places;
begin
  if from_id=into_id then raise exception 'Choose different places'; end if;
  perform 1 from public.places where id in (from_id,into_id) and owner_id=auth.uid() order by id for update;
  select * into strict a from public.places where id=from_id and owner_id=auth.uid();
  select * into strict b from public.places where id=into_id and owner_id=auth.uid();
  insert into public.place_sources(owner_id,place_id,source_id) select auth.uid(),into_id,source_id from public.place_sources where place_id=from_id on conflict do nothing;
  update public.visits set place_id=into_id where place_id=from_id and owner_id=auth.uid();
  update public.places set tags=array(select distinct x from unnest(a.tags||b.tags) x),categories=array(select distinct x from unnest(a.categories||b.categories) x),
    notes=concat_ws(E'\n\n',nullif(b.notes,''),'合併自：'||a.name||'；原總評：'||coalesce(a.rating::text,'未評分')||E'\n'||a.notes) where id=into_id;
  delete from public.places where id=from_id and owner_id=auth.uid();
end $$;

-- Shared database quota works across serverless instances; no in-memory limiter.
create table public.request_quotas(owner_id uuid not null references public.profiles(owner_id) on delete cascade, bucket timestamptz not null, count integer not null, primary key(owner_id,bucket));
alter table public.request_quotas enable row level security;
revoke all on public.request_quotas from anon,authenticated;
create function public.consume_quota() returns boolean language plpgsql security definer set search_path = '' as $$
declare hits integer; begin
  if auth.uid() is null then return false; end if;
  insert into public.request_quotas(owner_id,bucket,count) values(auth.uid(),date_trunc('hour',now()),1)
    on conflict(owner_id,bucket) do update set count=request_quotas.count+1 returning count into hits;
  delete from public.request_quotas where owner_id=auth.uid() and bucket<now()-interval '2 hours';
  return hits<=100;
end $$;

create function public.claim_import_job() returns public.import_jobs language plpgsql security definer set search_path = '' as $$
declare job public.import_jobs; begin
  select * into job from public.import_jobs
    where ((status='queued' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes')) and attempts<3
    order by available_at for update skip locked limit 1;
  if job.id is null then return null; end if;
  update public.import_jobs set status='running',attempts=attempts+1,locked_at=now(),claim_id=gen_random_uuid() where id=job.id returning * into job;
  return job;
end $$;

create function public.complete_import_job(job_id uuid, token uuid, result jsonb, retry boolean default false) returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.import_jobs; begin
  select * into job from public.import_jobs where id=job_id and claim_id=token and status='running' for update;
  if job.id is null then return false; end if;
  update public.sources set status=case when retry and job.attempts<3 then 'pending' else result->>'status' end,
    summary=coalesce(result->>'summary',''),candidates=coalesce(result->'candidates','[]'),error=coalesce(result->>'error','')
    where id=job.source_id and revision=job.revision;
  update public.import_jobs set status=case when retry and job.attempts<3 then 'queued' when result->>'status'='failed' then 'failed' else 'done' end,
    available_at=now()+make_interval(secs=>30*job.attempts),last_error=coalesce(result->>'error',''),locked_at=null where id=job.id;
  return true;
end $$;

revoke execute on function public.enqueue_source() from public,anon,authenticated;
revoke execute on function public.claim_import_job() from public,anon,authenticated;
revoke execute on function public.complete_import_job(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.claim_import_job(),public.complete_import_job(uuid,uuid,jsonb,boolean) to service_role;
revoke execute on function public.requeue_source(uuid,text,text),public.save_visit(jsonb),public.rename_label(text,text),public.merge_places(uuid,uuid),public.consume_quota() from public,anon;
grant execute on function public.requeue_source(uuid,text,text),public.save_visit(jsonb),public.rename_label(text,text),public.merge_places(uuid,uuid),public.consume_quota() to authenticated;
grant all on all tables in schema public to service_role;

insert into supabase_migrations.schema_migrations(version,name) values ('202610180001','core');

-- Migration: 202610180002_storage.sql
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('screenshots','screenshots',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy screenshots_read on storage.objects for select to authenticated
  using(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy screenshots_insert on storage.objects for insert to authenticated
  with check(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.profiles where owner_id=(select auth.uid())));
create policy screenshots_delete on storage.objects for delete to authenticated
  using(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text);

insert into supabase_migrations.schema_migrations(version,name) values ('202610180002','storage');

-- Migration: 202610180003_candidates.sql
create function public.accept_candidates(source_id uuid, indices integer[]) returns void language plpgsql security invoker set search_path = '' as $$
declare s public.sources; candidate jsonb; i integer; pid uuid; result jsonb;
begin
  select * into strict s from public.sources where id=source_id and owner_id=auth.uid() for update;
  result=s.candidates;
  foreach i in array indices loop
    if i<0 or i>=jsonb_array_length(result) then raise exception 'Invalid candidate'; end if;
    candidate=result->i;
    pid=(candidate->>'place_id')::uuid;
    if pid is null or not exists(select 1 from public.places where id=pid and owner_id=auth.uid()) then
      insert into public.places(owner_id,name,country,city,address,categories)
      values(auth.uid(),candidate->>'name',coalesce(candidate->>'country',''),coalesce(candidate->>'city',''),coalesce(candidate->>'address',''),array(select jsonb_array_elements_text(candidate->'categories')))
      returning id into pid;
      result=jsonb_set(result,array[i::text,'place_id'],to_jsonb(pid::text));
    end if;
    insert into public.place_sources(owner_id,place_id,source_id) values(auth.uid(),pid,s.id) on conflict do nothing;
  end loop;
  update public.sources set candidates=result where id=s.id;
end $$;
revoke execute on function public.accept_candidates(uuid,integer[]) from public,anon;
grant execute on function public.accept_candidates(uuid,integer[]) to authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('202610180003','candidates');

-- Migration: 202610180004_job_recovery.sql
-- A process can die on its third attempt. Expire exhausted leases instead of
-- leaving the source permanently in "processing".
create or replace function public.claim_import_job() returns public.import_jobs language plpgsql security definer set search_path = '' as $$
declare job public.import_jobs; begin
  update public.sources s set status='failed',error='解析工作已達重試上限，請補充內容後再試。'
    from public.import_jobs j where j.source_id=s.id and j.revision=s.revision
      and j.status='running' and j.attempts>=3 and j.locked_at<now()-interval '5 minutes';
  update public.import_jobs set status='failed',locked_at=null,last_error='Worker lease expired after maximum attempts'
    where status='running' and attempts>=3 and locked_at<now()-interval '5 minutes';
  select * into job from public.import_jobs
    where ((status='queued' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes')) and attempts<3
    order by available_at for update skip locked limit 1;
  if job.id is null then return null; end if;
  update public.import_jobs set status='running',attempts=attempts+1,locked_at=now(),claim_id=gen_random_uuid() where id=job.id returning * into job;
  return job;
end $$;

insert into supabase_migrations.schema_migrations(version,name) values ('202610180004','job_recovery');

-- Migration: 20261021003629_import_content_pipeline.sql
-- Additive import changes; original sources, places and visit history are retained.
alter table public.sources add column intake_pending boolean not null default false,
  add column map_data jsonb not null default '{}', add column diagnostics jsonb not null default '{}',
  add column error_code text not null default '';
alter table public.places add column location_source text not null default '';
alter table public.attachments drop constraint attachments_mime_type_check;
alter table public.attachments add constraint attachments_mime_type_check check(mime_type in ('image/png','image/jpeg','image/webp','image/heic','image/heif')),
  add column state text not null default 'ready' check(state in ('pending','ready')),
  add column size_bytes integer not null default 0 check(size_bytes between 0 and 5242880),
  add column sha256 text not null default '';
update storage.buckets set public=false,file_size_limit=5242880,
  allowed_mime_types=array['image/png','image/jpeg','image/webp','image/heic','image/heif'] where id='screenshots';
drop policy screenshots_insert on storage.objects;
create policy screenshots_insert on storage.objects for insert to authenticated with check(
  bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.sources s where s.owner_id=(select auth.uid()) and s.id::text=(storage.foldername(name))[2])
);

create or replace function public.enqueue_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.intake_pending then
    update public.import_jobs set status='done',claim_id=null,locked_at=null,revision=new.revision where source_id=new.id;
  else
    insert into public.import_jobs(owner_id,source_id,revision) values(new.owner_id,new.id,new.revision)
      on conflict(source_id) do update set revision=excluded.revision,status='queued',attempts=0,available_at=now(),locked_at=null,claim_id=null,last_error='';
  end if;
  return new;
end $$;
create function public.begin_source_intake(source uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.sources set intake_pending=true,revision=revision+1,status='needs_input',error='補充內容已保存，完成上傳後請按重新解析。'
    where id=source and owner_id=auth.uid();
  if not found then raise exception 'Source not found'; end if;
end $$;
create function public.save_source_draft(source uuid,content text,why text) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.begin_source_intake(source);
  update public.sources set content_text=content,reason=why where id=source and owner_id=auth.uid();
end $$;
create or replace function public.requeue_source(source uuid,content text,why text) returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.sources set content_text=content,reason=why,intake_pending=false,revision=revision+1,status='pending',error='',error_code=''
    where id=source and owner_id=auth.uid();
  if not found then raise exception 'Source not found'; end if;
end $$;
create function public.reserve_attachment(source uuid,mime text,bytes integer) returns public.attachments language plpgsql security invoker set search_path='' as $$
declare s public.sources; a public.attachments; count_files integer; total_bytes bigint; aid uuid:=gen_random_uuid();
begin
  select * into strict s from public.sources where id=source and owner_id=auth.uid() for update;
  if bytes<=0 or bytes>5242880 or mime not in ('image/png','image/jpeg','image/webp','image/heic','image/heif') then raise exception 'Invalid image'; end if;
  select count(*),coalesce(sum(size_bytes),0) into count_files,total_bytes from public.attachments where source_id=source and owner_id=auth.uid();
  if count_files>=6 or total_bytes+bytes>12582912 then raise exception 'Image limit exceeded'; end if;
  if not s.intake_pending then perform public.begin_source_intake(source); end if;
  insert into public.attachments(id,owner_id,source_id,path,mime_type,state,size_bytes)
    values(aid,auth.uid(),source,auth.uid()::text||'/'||source::text||'/'||aid::text,mime,'pending',bytes) returning * into a;
  return a;
end $$;
revoke execute on function public.begin_source_intake(uuid),public.save_source_draft(uuid,text,text),public.reserve_attachment(uuid,text,integer) from public,anon;
grant execute on function public.begin_source_intake(uuid),public.save_source_draft(uuid,text,text),public.reserve_attachment(uuid,text,integer) to authenticated;

create or replace function public.complete_import_job(job_id uuid,token uuid,result jsonb,retry boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare job public.import_jobs;
begin
  select * into job from public.import_jobs where id=job_id and claim_id=token and status='running' for update;
  if job.id is null then return false; end if;
  update public.sources set status=case when retry and job.attempts<3 then 'pending' else result->>'status' end,
    summary=coalesce(result->>'summary',''),candidates=coalesce(result->'candidates','[]'),error=coalesce(result->>'error',''),
    error_code=coalesce(result->>'error_code',''),map_data=coalesce(result->'map_data','{}'),diagnostics=coalesce(result->'diagnostics','{}')
    where id=job.source_id and revision=job.revision and not intake_pending;
  if not found then return false; end if;
  update public.import_jobs set status=case when retry and job.attempts<3 then 'queued' when result->>'status'='failed' then 'failed' else 'done' end,
    available_at=now()+make_interval(secs=>greatest(30*power(2,job.attempts-1),least(coalesce((result->>'retry_after')::double precision,0),86400))),
    last_error=coalesce(result->>'error',''),locked_at=null where id=job.id;
  return true;
end $$;

-- Internal caches are accessible only by server credentials. RLS has no client policies.
create table public.ai_extractions (
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  content_hash text not null, result jsonb, claim_id uuid, locked_until timestamptz,
  primary key(owner_id,content_hash)
);
alter table public.ai_extractions enable row level security;
revoke all on public.ai_extractions from public,anon,authenticated;
grant all on public.ai_extractions to service_role;
create function public.claim_ai_extraction(owner uuid,hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.ai_extractions; token uuid:=gen_random_uuid();
begin
  insert into public.ai_extractions(owner_id,content_hash) values(owner,hash) on conflict do nothing;
  select * into strict c from public.ai_extractions where owner_id=owner and content_hash=hash for update;
  if c.result is not null then return jsonb_build_object('result',c.result); end if;
  if c.locked_until>now() then return '{}'::jsonb; end if;
  update public.ai_extractions set claim_id=token,locked_until=now()+interval '90 seconds' where owner_id=owner and content_hash=hash;
  return jsonb_build_object('token',token);
end $$;
create function public.finish_ai_extraction(owner uuid,hash text,token uuid,result jsonb) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.ai_extractions set result=finish_ai_extraction.result,locked_until=null,claim_id=null
    where owner_id=owner and content_hash=hash and claim_id=token;
  return found;
end $$;
revoke execute on function public.claim_ai_extraction(uuid,text),public.finish_ai_extraction(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_ai_extraction(uuid,text),public.finish_ai_extraction(uuid,text,uuid,jsonb) to service_role;

create table public.geocode_gate(id boolean primary key default true check(id),next_at timestamptz not null default now());
insert into public.geocode_gate(id) values(true);
create table public.geocode_cache(owner_id uuid not null references public.profiles(owner_id) on delete cascade,cache_key text not null,result jsonb not null,expires_at timestamptz not null,primary key(owner_id,cache_key));
alter table public.geocode_gate enable row level security;
alter table public.geocode_cache enable row level security;
revoke all on public.geocode_gate,public.geocode_cache from public,anon,authenticated;
grant all on public.geocode_gate,public.geocode_cache to service_role;
create function public.take_geocode_slot() returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.geocode_gate set next_at=clock_timestamp()+interval '1.1 seconds' where id and next_at<=clock_timestamp();
  return found;
end $$;
revoke execute on function public.take_geocode_slot() from public,anon,authenticated;
grant execute on function public.take_geocode_slot() to service_role;

create or replace function public.accept_candidates(source_id uuid,indices integer[]) returns void language plpgsql security invoker set search_path='' as $$
declare s public.sources; candidate jsonb; i integer; pid uuid; result jsonb; lat double precision; lng double precision;
begin
  select * into strict s from public.sources where id=source_id and owner_id=auth.uid() for update;
  result=s.candidates;
  foreach i in array indices loop
    if i<0 or i>=jsonb_array_length(result) then raise exception 'Invalid candidate'; end if;
    candidate=result->i;pid=(candidate->>'place_id')::uuid;
    if pid is null or not exists(select 1 from public.places where id=pid and owner_id=auth.uid()) then
      lat=null;lng=null;
      if candidate->>'coordinate_kind'='place' then lat=(candidate->>'latitude')::double precision;lng=(candidate->>'longitude')::double precision;end if;
      insert into public.places(owner_id,name,country,city,address,categories,latitude,longitude,location_source)
        values(auth.uid(),left(case when coalesce(candidate->>'branch','')<>'' and position(candidate->>'branch' in candidate->>'name')=0 then (candidate->>'name')||' · '||(candidate->>'branch') else candidate->>'name' end,200),coalesce(candidate->>'country',''),coalesce(candidate->>'city',''),coalesce(candidate->>'address',''),array(select jsonb_array_elements_text(candidate->'categories')),lat,lng,case when lat is not null then coalesce(s.map_data->>'final_url','') else '' end)
        returning id into pid;
      result=jsonb_set(result,array[i::text,'place_id'],to_jsonb(pid::text));
    end if;
    insert into public.place_sources(owner_id,place_id,source_id) values(auth.uid(),pid,s.id) on conflict do nothing;
  end loop;
  update public.sources set candidates=result where id=s.id;
end $$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261021003629','import_content_pipeline');

-- 授權剛剛由你建立的唯一 Auth 帳號；不輸出帳號、密碼或金鑰。
insert into public.profiles(owner_id,display_name)
select id,'旅人' from auth.users;

commit;

select
  '初始化完成' as status,
  (select count(*) from public.profiles) as invited_accounts,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity) as protected_tables,
  (select not public from storage.buckets where id='screenshots') as screenshots_private;
