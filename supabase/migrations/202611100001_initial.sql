-- Simple Grant: multi-tenant core, private evidence storage, and service-only jobs.
-- Shared projects: use generated install-simple-grant.sql in SQL Editor.
-- This canonical baseline is not a command to push/repair shared app history.
begin;

-- Dedicated namespace: fail safely if it already exists. Never move or reuse
-- another application's public tables or functions.
create schema simple_grant;
-- Strip inherited schema ACLs only on our newly created namespace.
do $$
declare v record;
begin
  for v in select distinct a.grantee from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
    where n.nspname = 'simple_grant' and a.grantee <> n.nspowner
  loop
    execute format('revoke all on schema simple_grant from %s',case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
revoke all on schema simple_grant from public, anon, authenticated;
grant usage on schema simple_grant to public;
grant usage on schema simple_grant to authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

create table simple_grant.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  abn text check (abn is null or abn ~ '^[0-9]{11}$'),
  type text not null default 'Charity',
  state text not null default '',
  description text not null default '',
  focus_areas text[] not null default '{}',
  website text,
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  notification_frequency text not null default 'weekly' check (notification_frequency in ('weekly', 'monthly', 'never')),
  verification_status text not null default 'draft' check (verification_status in ('draft', 'review', 'approved')),
  inbox_alias text not null unique default ('org-' || encode(extensions.gen_random_bytes(12), 'hex'))
    check (inbox_alias ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table simple_grant.organization_members (
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on simple_grant.organization_members(user_id, org_id);

-- Helpers run as the table owner, so the membership lookup cannot recurse into RLS.
-- No dynamic SQL; fully qualified names and an empty search_path prevent hijacking.
create function simple_grant.can_access_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from simple_grant.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;
create function simple_grant.can_write_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from simple_grant.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')
  );
$$;
create function simple_grant.can_manage_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from simple_grant.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function simple_grant.can_access_org(uuid), simple_grant.can_write_org(uuid), simple_grant.can_manage_org(uuid) from public;
grant execute on function simple_grant.can_access_org(uuid), simple_grant.can_write_org(uuid), simple_grant.can_manage_org(uuid) to authenticated, service_role;

alter table simple_grant.organizations enable row level security;
alter table simple_grant.organization_members enable row level security;
create policy organizations_read on simple_grant.organizations for select to authenticated using (simple_grant.can_access_org(id));
create policy organizations_update on simple_grant.organizations for update to authenticated using (simple_grant.can_write_org(id)) with check (simple_grant.can_write_org(id));
create policy organizations_delete on simple_grant.organizations for delete to authenticated using (
  exists (select 1 from simple_grant.organization_members m where m.org_id = id and m.user_id = auth.uid() and m.role = 'owner')
);
create policy organization_members_read on simple_grant.organization_members for select to authenticated using (simple_grant.can_access_org(org_id));
-- No membership mutation policies. Only trusted server administration can add,
-- remove or promote a member. A client cannot make itself owner/admin.

create function simple_grant.create_organization(p_name text, p_frequency text default 'weekly')
returns simple_grant.organizations language plpgsql security definer set search_path = '' as $$
declare
  v_org simple_grant.organizations;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to create an organisation' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200 then
    raise exception 'Organisation name must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('weekly', 'monthly', 'never') then
    raise exception 'Choose weekly, monthly or never' using errcode = '22023';
  end if;
  insert into simple_grant.organizations(name, notification_frequency)
    values (btrim(p_name), p_frequency) returning * into v_org;
  insert into simple_grant.organization_members(org_id, user_id, role) values (v_org.id, v_user, 'owner');
  return v_org;
end;
$$;
revoke all on function simple_grant.create_organization(text, text) from public;
grant execute on function simple_grant.create_organization(text, text) to authenticated;

create table simple_grant.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 500),
  category text not null default 'other',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  extracted_text text,
  expires_on date,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (split_part(storage_path, '/', 1) = org_id::text)
);
create table simple_grant.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  funder text not null default '',
  amount_min numeric(14,2) check (amount_min is null or amount_min >= 0),
  amount_max numeric(14,2) check (amount_max is null or amount_max >= 0),
  opens_on date,
  closes_at timestamptz,
  source_url text not null default '',
  guidelines_text text not null default '',
  summary text not null default '',
  location text not null default 'Australia',
  focus_areas text[] not null default '{}',
  match_score integer check (match_score is null or match_score between 0 and 100),
  requirements text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'saved', 'archived')),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (amount_min is null or amount_max is null or amount_min <= amount_max)
);
create index opportunities_org_close_idx on simple_grant.opportunities(org_id, closes_at);

create table simple_grant.applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'submitted', 'awarded', 'declined')),
  draft jsonb not null default '{}'::jsonb,
  project_details jsonb not null default '{}'::jsonb,
  requested_amount numeric(14,2) check (requested_amount is null or requested_amount >= 0),
  submitted_at timestamptz,
  grant_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, opportunity_id) references simple_grant.opportunities(org_id, id)
);
create table simple_grant.funded_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  application_id uuid,
  title text not null,
  funder text not null default '',
  awarded_amount numeric(14,2) not null default 0 check (awarded_amount >= 0),
  start_date date not null default current_date,
  end_date date not null,
  next_report_due date,
  status text not null default 'active' check (status in ('active', 'report_due', 'completed', 'closed')),
  proposal jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  milestones jsonb not null default '[]'::jsonb check (jsonb_typeof(milestones) = 'array'),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, application_id) references simple_grant.applications(org_id, id),
  check (end_date >= start_date)
);
create table simple_grant.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  project_id uuid not null,
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  incurred_on date not null default current_date,
  document_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, project_id) references simple_grant.funded_projects(org_id, id),
  foreign key (org_id, document_id) references simple_grant.documents(org_id, id)
);
create table simple_grant.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  project_id uuid,
  sender text not null,
  subject text not null default '',
  body text not null default '',
  classification text not null default 'unclassified',
  status text not null default 'needs_review' check (status in ('needs_review', 'reviewed', 'processed', 'rejected')),
  received_at timestamptz not null default now(),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  provider_event_id text unique,
  unique (org_id, id),
  foreign key (org_id, project_id) references simple_grant.funded_projects(org_id, id)
);
create table simple_grant.activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index inbox_messages_org_received_idx on simple_grant.inbox_messages(org_id, received_at desc);

-- Tenant ids cannot be moved after creation, even between two organisations
-- belonging to the same user. The composite FKs also reject cross-tenant links.
create function simple_grant.prevent_tenant_move() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'An existing record cannot change organisation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create function simple_grant.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger organizations_updated_at before update on simple_grant.organizations for each row execute function simple_grant.touch_updated_at();
create trigger applications_updated_at before update on simple_grant.applications for each row execute function simple_grant.touch_updated_at();

do $$
declare v_table text;
begin
  foreach v_table in array array['documents', 'opportunities', 'applications', 'funded_projects', 'expenses', 'inbox_messages'] loop
    execute format('alter table simple_grant.%I enable row level security', v_table);
    execute format('create index %I on simple_grant.%I(org_id)', v_table || '_org_idx', v_table);
    execute format('create policy %I on simple_grant.%I for select to authenticated using (simple_grant.can_access_org(org_id))', v_table || '_read', v_table);
    execute format('create policy %I on simple_grant.%I for insert to authenticated with check (simple_grant.can_write_org(org_id))', v_table || '_insert', v_table);
    execute format('create policy %I on simple_grant.%I for update to authenticated using (simple_grant.can_write_org(org_id)) with check (simple_grant.can_write_org(org_id))', v_table || '_update', v_table);
    execute format('create policy %I on simple_grant.%I for delete to authenticated using (simple_grant.can_write_org(org_id))', v_table || '_delete', v_table);
    execute format('create trigger %I before update on simple_grant.%I for each row execute function simple_grant.prevent_tenant_move()', v_table || '_immutable_org', v_table);
  end loop;
end;
$$;
alter table simple_grant.activity_log enable row level security;
create policy activity_log_read on simple_grant.activity_log for select to authenticated using (simple_grant.can_access_org(org_id));

create table simple_grant.notification_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references simple_grant.organizations(id) on delete cascade,
  period_key text not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed')),
  last_error text,
  provider_message_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, period_key)
);
create table simple_grant.webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'rejected', 'failed')),
  org_id uuid references simple_grant.organizations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table simple_grant.notification_runs enable row level security;
alter table simple_grant.webhook_events enable row level security;
-- No client policies: idempotency records are exclusively server-managed.

create function simple_grant.claim_notification_run(p_org_id uuid, p_period_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed uuid;
begin
  insert into simple_grant.notification_runs(org_id, period_key)
  values (p_org_id, p_period_key)
  on conflict (org_id, period_key) do update
    set status = 'processing', last_error = null, started_at = now(), completed_at = null
    where notification_runs.status = 'failed'
      or (notification_runs.status = 'processing' and notification_runs.started_at < now() - interval '15 minutes')
  returning id into v_claimed;
  return v_claimed is not null;
end;
$$;
create function simple_grant.claim_webhook_event(p_event_id text, p_event_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed text;
begin
  insert into simple_grant.webhook_events(event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do update
    set status = 'processing', last_error = null, received_at = now(), processed_at = null
    where webhook_events.status = 'failed'
      or (webhook_events.status = 'processing' and webhook_events.received_at < now() - interval '15 minutes')
  returning event_id into v_claimed;
  return v_claimed is not null;
end;
$$;
revoke all on function simple_grant.claim_notification_run(uuid, text), simple_grant.claim_webhook_event(text, text) from public, anon, authenticated;
grant execute on function simple_grant.claim_notification_run(uuid, text), simple_grant.claim_webhook_event(text, text) to service_role;

-- Remove inherited table grants to ANY custom app roles, only in SG schema.
do $$
declare v record;
begin
  for v in select distinct c.relname, a.grantee from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    where n.nspname = 'simple_grant' and c.relkind in ('r','p') and a.grantee <> c.relowner
  loop
    execute format('revoke all on table simple_grant.%I from %s',v.relname,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
revoke all on all tables in schema simple_grant from public, anon, authenticated;
grant usage on schema simple_grant to public;
grant usage on schema simple_grant to authenticated, service_role;
grant select, update, delete on simple_grant.organizations to authenticated;
grant select on simple_grant.organization_members, simple_grant.activity_log to authenticated;
grant select, insert, update, delete on simple_grant.documents, simple_grant.opportunities, simple_grant.applications, simple_grant.funded_projects, simple_grant.expenses, simple_grant.inbox_messages to authenticated;
grant all on simple_grant.organizations, simple_grant.organization_members, simple_grant.documents, simple_grant.opportunities, simple_grant.applications, simple_grant.funded_projects, simple_grant.expenses, simple_grant.inbox_messages, simple_grant.activity_log, simple_grant.notification_runs, simple_grant.webhook_events to service_role;

-- Private evidence bucket. An object key must begin with its organisation UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('simple-grant-documents', 'simple-grant-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
on conflict (id) do nothing;

-- A shared project may already contain a bucket with this name. Never silently
-- reuse a public or differently configured bucket, nor mutate another app's
-- bucket. The enclosing transaction rolls back instead of exposing evidence.
do $$
declare
  v_bucket record;
  v_expected_mimes text[] := array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
begin
  select public, file_size_limit, allowed_mime_types into v_bucket
    from storage.buckets where id = 'simple-grant-documents';
  if v_bucket.public is distinct from false
    or v_bucket.file_size_limit is distinct from 10485760::bigint
    or (v_bucket.allowed_mime_types @> v_expected_mimes) is not true
    or (v_bucket.allowed_mime_types <@ v_expected_mimes) is not true then
    raise exception 'Existing simple-grant-documents bucket is incompatible: a private 10 MiB PDF/image/plain-text bucket is required; use a dedicated Supabase project or resolve the bucket conflict before migrating'
      using errcode = '22023';
  end if;
end;
$$;

create function simple_grant.storage_org_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function simple_grant.storage_org_id(text) from public;
grant execute on function simple_grant.storage_org_id(text) to authenticated, service_role;

create policy simple_grant_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'simple-grant-documents' and simple_grant.can_access_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'simple-grant-documents' and simple_grant.can_write_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_update on storage.objects for update to authenticated
  using (bucket_id = 'simple-grant-documents' and simple_grant.can_write_org(simple_grant.storage_org_id(name)))
  with check (bucket_id = 'simple-grant-documents' and simple_grant.can_write_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'simple-grant-documents' and simple_grant.can_write_org(simple_grant.storage_org_id(name)));


-- Existing project-wide permissive policies may allow every authenticated user
-- (or anonymous users) to access storage.objects. PostgreSQL ORs permissive
-- policies, so these additional RESTRICTIVE boundaries are required. They are
-- true for every other bucket and never change another app's policy definition.
-- service_role intentionally bypasses RLS; keep its key server-side.
create policy simple_grant_documents_select_boundary on storage.objects as restrictive for select to public
  using (bucket_id is distinct from 'simple-grant-documents'
    or simple_grant.can_access_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_insert_boundary on storage.objects as restrictive for insert to public
  with check (bucket_id is distinct from 'simple-grant-documents'
    or simple_grant.can_write_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_update_boundary on storage.objects as restrictive for update to public
  using (bucket_id is distinct from 'simple-grant-documents'
    or simple_grant.can_write_org(simple_grant.storage_org_id(name)))
  with check (bucket_id is distinct from 'simple-grant-documents'
    or simple_grant.can_write_org(simple_grant.storage_org_id(name)));
create policy simple_grant_documents_delete_boundary on storage.objects as restrictive for delete to public
  using (bucket_id is distinct from 'simple-grant-documents'
    or simple_grant.can_write_org(simple_grant.storage_org_id(name)));

-- Override any pre-existing project default function ACLs only for our schema.
-- Every role needs safe boolean/path helpers because storage policy expressions can be
-- initialised even when another-bucket OR branch evaluates true. These helpers
-- return false/null without a JWT and expose no organisation records.
-- Remove inherited function grants to ANY custom app roles before allowlisting.
do $$
declare v record;
begin
  for v in select distinct p.oid::regprocedure::text as signature, a.grantee from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where n.nspname = 'simple_grant' and a.grantee <> p.proowner
  loop
    execute format('revoke all on function %s from %s',v.signature,case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end);
  end loop;
end;
$$;
revoke all on all functions in schema simple_grant from public, anon, authenticated;
grant execute on function simple_grant.can_access_org(uuid), simple_grant.can_write_org(uuid), simple_grant.storage_org_id(text) to public;
grant execute on function simple_grant.can_manage_org(uuid), simple_grant.create_organization(text, text) to authenticated;
grant execute on function simple_grant.claim_notification_run(uuid, text), simple_grant.claim_webhook_event(text, text) to service_role;

commit;
