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
