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
