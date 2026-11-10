-- Billable AI requests have a durable, per-user daily budget across all tenants.
begin;
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  requests integer not null check (requests between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
alter table public.ai_usage enable row level security;
-- No client policies or table grants. Only the function and service role write.
revoke all on public.ai_usage from anon, authenticated;
grant all on public.ai_usage to service_role;

create function public.claim_ai_request(p_org_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_date date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if v_user is null or not public.can_access_org(p_org_id) then
    raise exception 'Organisation access is required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('profile', 'discover', 'import-grant', 'draft', 'ask', 'report') then
    raise exception 'Unsupported AI action' using errcode = '22023';
  end if;
  if p_action <> 'ask' and not public.can_write_org(p_org_id) then
    raise exception 'Organisation editor access is required' using errcode = '42501';
  end if;
  insert into public.ai_usage(user_id, usage_date, requests)
    values (v_user, v_date, 1)
  on conflict (user_id, usage_date) do update
    set requests = ai_usage.requests + 1, updated_at = now()
    where ai_usage.requests < 60
  returning requests into v_count;
  return v_count is not null;
end;
$$;
revoke all on function public.claim_ai_request(uuid, text) from public, anon;
grant execute on function public.claim_ai_request(uuid, text) to authenticated;
commit;
