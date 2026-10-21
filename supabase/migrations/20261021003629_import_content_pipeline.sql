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
