-- Only the Simple Grants OAuth server may read or write connector credentials.
begin;

create table simple_grant.work_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('pending', 'code', 'active')),
  client_id text not null,
  redirect_uri text not null,
  resource text not null,
  scope text not null default 'simple-grants' check (scope = 'simple-grants'),
  oauth_state text,
  code_challenge text,
  browser_hash text,
  source_hash text,
  code_hash text unique,
  access_hash text unique,
  refresh_hash text unique,
  org_id uuid,
  user_id uuid,
  access_expires_at timestamptz,
  expires_at timestamptz not null,
  foreign key (org_id, user_id) references simple_grant.organization_members(org_id, user_id) on delete cascade,
  check (
    (phase = 'pending' and code_challenge is not null and browser_hash is not null and source_hash is not null
      and code_hash is null and access_hash is null and refresh_hash is null and access_expires_at is null
      and org_id is null and user_id is null)
    or (phase = 'code' and code_challenge is not null and browser_hash is null and source_hash is null
      and code_hash is not null and access_hash is null and refresh_hash is null and access_expires_at is null
      and org_id is not null and user_id is not null)
    or (phase = 'active' and code_challenge is null and browser_hash is null and source_hash is null and oauth_state is null
      and code_hash is null and access_hash is not null and refresh_hash is not null and access_expires_at is not null
      and org_id is not null and user_id is not null)
  )
);
create index work_oauth_expiry_idx on simple_grant.work_oauth_grants(expires_at);
create index work_oauth_pending_source_idx on simple_grant.work_oauth_grants(source_hash) where phase = 'pending';
create index work_oauth_member_idx on simple_grant.work_oauth_grants(org_id, user_id);
alter table simple_grant.work_oauth_grants enable row level security;

create function simple_grant.begin_work_oauth(
  p_client_id text, p_redirect_uri text, p_resource text, p_oauth_state text,
  p_challenge text, p_browser_hash text, p_source_hash text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('simple_grant.work_oauth:' || p_source_hash, 0));
  delete from simple_grant.work_oauth_grants where expires_at <= now();
  if (select count(*) from simple_grant.work_oauth_grants where phase = 'pending' and source_hash = p_source_hash) >= 60 then
    return null;
  end if;
  insert into simple_grant.work_oauth_grants
    (phase,client_id,redirect_uri,resource,oauth_state,code_challenge,browser_hash,source_hash,expires_at)
    values ('pending',p_client_id,p_redirect_uri,p_resource,p_oauth_state,p_challenge,p_browser_hash,p_source_hash,now() + interval '10 minutes')
    returning id into v_id;
  return v_id;
end;
$$;

-- Remove shared-project default ACLs, including grants to unrelated custom roles.
do $$
declare v record;
begin
  for v in select distinct a.grantee from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where c.oid = 'simple_grant.work_oauth_grants'::regclass and a.grantee <> c.relowner
  loop
    execute format('revoke all on table simple_grant.work_oauth_grants from %s',
      case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
  for v in select distinct a.grantee from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = 'simple_grant.begin_work_oauth(text,text,text,text,text,text,text)'::regprocedure and a.grantee <> p.proowner
  loop
    execute format('revoke all on function simple_grant.begin_work_oauth(text,text,text,text,text,text,text) from %s',
      case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
grant select, insert, update, delete on simple_grant.work_oauth_grants to service_role;
grant execute on function simple_grant.begin_work_oauth(text,text,text,text,text,text,text) to service_role;

commit;
