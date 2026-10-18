insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('screenshots','screenshots',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy screenshots_read on storage.objects for select to authenticated
  using(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy screenshots_insert on storage.objects for insert to authenticated
  with check(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.profiles where owner_id=(select auth.uid())));
create policy screenshots_delete on storage.objects for delete to authenticated
  using(bucket_id='screenshots' and (storage.foldername(name))[1]=(select auth.uid())::text);
