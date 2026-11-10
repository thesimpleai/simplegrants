-- Billable AI requests have a durable, per-user daily budget across all tenants.
begin;
create table simple_grant.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null check (requests between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table simple_grant.ai_usage enable row level security;
-- No client policies or table grants. Only the function and service role write.
revoke all on simple_grant.ai_usage from public, anon, authenticated;
grant all on simple_grant.ai_usage to service_role;

create function simple_grant.claim_ai_request(p_org_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_date date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if v_user is null or not simple_grant.can_access_org(p_org_id) then
    raise exception 'Organisation access is required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('profile', 'discover', 'import-grant', 'draft', 'ask', 'report') then
    raise exception 'Unsupported AI action' using errcode = '22023';
  end if;
  if p_action <> 'ask' and not simple_grant.can_write_org(p_org_id) then
    raise exception 'Organisation editor access is required' using errcode = '42501';
  end if;
  insert into simple_grant.ai_usage(user_id, usage_date, requests)
    values (v_user, v_date, 1)
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
  for v in select distinct c.relname, a.grantee from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    where n.nspname = 'simple_grant' and c.relkind in ('r','p') and a.grantee <> c.relowner and c.relname in ('ai_usage')
  loop
    execute format('revoke all on table simple_grant.%I from %s',v.relname,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
  for v in select distinct p.oid::regprocedure::text as signature, a.grantee from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where n.nspname = 'simple_grant' and a.grantee <> p.proowner and p.proname in ('claim_ai_request')
  loop
    execute format('revoke all on function %s from %s',v.signature,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
grant all on simple_grant.ai_usage to service_role;
revoke all on function simple_grant.claim_ai_request(uuid, text) from public, anon, authenticated;
grant execute on function simple_grant.claim_ai_request(uuid, text) to authenticated;
commit;
