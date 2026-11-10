-- Upgrade for an existing Simple Grant install: app-specific Resend sign-in.
-- Apply ONLY this file when baselines 001-004 already exist. No Auth settings or
-- other applications' tables/functions/policies/migration history are changed.
begin;

create table simple_grant.auth_email_requests (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp()
);
create index auth_email_requests_email_time_idx on simple_grant.auth_email_requests(email_hash, claimed_at desc);
create index auth_email_requests_ip_time_idx on simple_grant.auth_email_requests(ip_hash, claimed_at desc);
create index auth_email_requests_prune_idx on simple_grant.auth_email_requests(claimed_at, id);
alter table simple_grant.auth_email_requests enable row level security;
-- No client policies. This app-only throttle never stores raw email/IP values.

create function simple_grant.claim_auth_email(p_email_hash text, p_ip_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_key bigint;
  v_now timestamptz;
  v_email_count bigint;
  v_ip_count bigint;
  v_last_email timestamptz;
  v_id uuid;
begin
  -- The advisory-lock freshness argument requires READ COMMITTED snapshots.
  -- Fail closed rather than permit stale counters in a custom isolation mode.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Auth email claim requires READ COMMITTED isolation' using errcode = '25001';
  end if;
  if p_email_hash is null or p_ip_hash is null
    or p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprints' using errcode = '22023';
  end if;
  -- Deterministic sorted locks serialize every shared email or IP. A rare
  -- advisory hash collision only adds contention; it cannot bypass a limit.
  for v_key in
    select distinct k from (values
      (pg_catalog.hashtextextended('simple_grant.auth_email.email:' || p_email_hash, 0)),
      (pg_catalog.hashtextextended('simple_grant.auth_email.ip:' || p_ip_hash, 0))
    ) locks(k) order by k
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_key);
  end loop;
  -- Sample the clock after waiting for locks, not at transaction start.
  v_now := clock_timestamp();
  select count(*), max(claimed_at) into v_email_count, v_last_email
    from simple_grant.auth_email_requests
    where email_hash = p_email_hash and claimed_at > v_now - interval '1 hour';
  select count(*) into v_ip_count from simple_grant.auth_email_requests
    where ip_hash = p_ip_hash and claimed_at > v_now - interval '1 hour';
  if v_email_count >= 5 or v_ip_count >= 20
    or v_last_email > v_now - interval '60 seconds' then
    return null;
  end if;
  insert into simple_grant.auth_email_requests(email_hash, ip_hash, claimed_at)
    values (p_email_hash, p_ip_hash, v_now) returning id into v_id;
  -- Bounded best-effort retention. Never scan/delete an unbounded event backlog;
  -- SKIP LOCKED also prevents competing cleanup workers waiting on old rows.
  delete from simple_grant.auth_email_requests where id in (
    select id from simple_grant.auth_email_requests
    where claimed_at < v_now - interval '24 hours'
    order by claimed_at, id limit 200 for update skip locked
  );
  return v_id;
end;
$$;

create function simple_grant.auth_email_user_exists(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(p_email));
$$;

-- Strip inherited ACLs only from these newly created SG objects, including
-- grants to unknown custom roles from pre-existing global default privileges.
do $$
declare v record;
begin
  for v in select distinct c.relname, a.grantee from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    where n.nspname = 'simple_grant' and c.relname = 'auth_email_requests'
      and c.relkind in ('r','p') and a.grantee <> c.relowner
  loop
    execute format('revoke all on table simple_grant.%I from %s',v.relname,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
  for v in select distinct p.oid::regprocedure::text as signature, a.grantee from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where n.nspname = 'simple_grant' and p.proname in ('claim_auth_email','auth_email_user_exists')
      and a.grantee <> p.proowner
  loop
    execute format('revoke all on function %s from %s',v.signature,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
revoke all on simple_grant.auth_email_requests from public, anon, authenticated;
grant all on simple_grant.auth_email_requests to service_role;
revoke all on function simple_grant.claim_auth_email(text,text), simple_grant.auth_email_user_exists(text) from public, anon, authenticated;
grant execute on function simple_grant.claim_auth_email(text,text), simple_grant.auth_email_user_exists(text) to service_role;

commit;
