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
