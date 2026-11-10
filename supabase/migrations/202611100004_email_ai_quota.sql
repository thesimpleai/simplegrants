-- Optional inbound public-only AI replies share the portal's per-user budget.
-- The webhook must first verify the provider signature and sender membership.
begin;
create function public.claim_email_ai_request(p_org_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_user_id is null or not exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and m.user_id = p_user_id
  ) then
    raise exception 'Sender organisation membership is required' using errcode = '42501';
  end if;
  insert into public.ai_usage(user_id, usage_date, requests)
    values (p_user_id, v_date, 1)
  on conflict (user_id, usage_date) do update
    set requests = ai_usage.requests + 1, updated_at = now()
    where ai_usage.requests < 60
  returning requests into v_count;
  return v_count is not null;
end;
$$;
revoke all on function public.claim_email_ai_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_email_ai_request(uuid, uuid) to service_role;
commit;
