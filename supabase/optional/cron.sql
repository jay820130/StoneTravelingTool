-- Run only AFTER deployment and after adding both values through Supabase Vault:
-- stone_worker_url = your HTTPS application URL followed by /api/worker
-- stone_cron_secret = the same secret as the deployment's CRON_SECRET
-- Do not put actual values into this file or commit them.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('stone-import-worker','* * * * *',$$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name='stone_worker_url'),
    headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='stone_cron_secret')),
    timeout_milliseconds := 55000
  )
  where exists(select 1 from public.import_jobs where
    (status='queued' and available_at<=now()) or (status='running' and locked_at<now()-interval '5 minutes'));
$$);

-- Keep only this application's old cron history, without affecting other jobs.
select cron.schedule('stone-cron-history-cleanup','0 0 * * *',$$
  delete from cron.job_run_details where end_time<now()-interval '7 days'
    and jobid in(select jobid from cron.job where jobname in('stone-import-worker','stone-cron-history-cleanup'));
$$);
