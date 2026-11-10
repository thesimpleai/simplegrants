-- Optional inbound public-only AI replies share the portal's per-user budget.
-- The webhook must first verify the provider signature and sender membership.
begin;
create function simple_grant.claim_email_ai_request(p_org_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_user_id is null or not exists (
    select 1 from simple_grant.organization_members m
    where m.org_id = p_org_id and m.user_id = p_user_id
  ) then
    raise exception 'Sender organisation membership is required' using errcode = '42501';
  end if;
  insert into simple_grant.ai_usage(user_id, usage_date, requests)
    values (p_user_id, v_date, 1)
  on conflict (user_id, usage_date) do update
    set requests = ai_usage.requests + 1, updated_at = now()
    where ai_usage.requests < 60
  returning requests into v_count;
  return v_count is not null;
end;
$$;
do $$
declare v record;
begin
  for v in select distinct p.oid::regprocedure::text as signature, a.grantee from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where n.nspname = 'simple_grant' and a.grantee <> p.proowner and p.proname in ('claim_email_ai_request')
  loop
    execute format('revoke all on function %s from %s',v.signature,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
revoke all on function simple_grant.claim_email_ai_request(uuid, uuid) from public, anon, authenticated;
grant execute on function simple_grant.claim_email_ai_request(uuid, uuid) to service_role;
commit;
