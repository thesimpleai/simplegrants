-- Simple Grant: multi-tenant core, private evidence storage, and service-only jobs.
-- Apply with the Supabase SQL editor or `supabase db push`.
begin;

create extension if not exists pgcrypto with schema extensions;

create table public.organizations (
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

create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id, org_id);

-- Helpers run as the table owner, so the membership lookup cannot recurse into RLS.
-- No dynamic SQL; fully qualified names and an empty search_path prevent hijacking.
create function public.can_access_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;
create function public.can_write_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')
  );
$$;
create function public.can_manage_org(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public.can_access_org(uuid), public.can_write_org(uuid), public.can_manage_org(uuid) from public;
grant execute on function public.can_access_org(uuid), public.can_write_org(uuid), public.can_manage_org(uuid) to authenticated, service_role;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
create policy organizations_read on public.organizations for select to authenticated using (public.can_access_org(id));
create policy organizations_update on public.organizations for update to authenticated using (public.can_write_org(id)) with check (public.can_write_org(id));
create policy organizations_delete on public.organizations for delete to authenticated using (
  exists (select 1 from public.organization_members m where m.org_id = id and m.user_id = auth.uid() and m.role = 'owner')
);
create policy organization_members_read on public.organization_members for select to authenticated using (public.can_access_org(org_id));
-- No membership mutation policies. Only trusted server administration can add,
-- remove or promote a member. A client cannot make itself owner/admin.

create function public.create_organization(p_name text, p_frequency text default 'weekly')
returns public.organizations language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to create an organisation' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 200 then
    raise exception 'Organisation name must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_frequency is null or p_frequency not in ('weekly', 'monthly', 'never') then
    raise exception 'Choose weekly, monthly or never' using errcode = '22023';
  end if;
  insert into public.organizations(name, notification_frequency)
    values (btrim(p_name), p_frequency) returning * into v_org;
  insert into public.organization_members(org_id, user_id, role) values (v_org.id, v_user, 'owner');
  return v_org;
end;
$$;
revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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
create index opportunities_org_close_idx on public.opportunities(org_id, closes_at);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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
  foreign key (org_id, opportunity_id) references public.opportunities(org_id, id)
);
create table public.funded_projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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
  foreign key (org_id, application_id) references public.applications(org_id, id),
  check (end_date >= start_date)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  incurred_on date not null default current_date,
  document_id uuid,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, project_id) references public.funded_projects(org_id, id),
  foreign key (org_id, document_id) references public.documents(org_id, id)
);
create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
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
  foreign key (org_id, project_id) references public.funded_projects(org_id, id)
);
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index inbox_messages_org_received_idx on public.inbox_messages(org_id, received_at desc);

-- Tenant ids cannot be moved after creation, even between two organisations
-- belonging to the same user. The composite FKs also reject cross-tenant links.
create function public.prevent_tenant_move() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'An existing record cannot change organisation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger organizations_updated_at before update on public.organizations for each row execute function public.touch_updated_at();
create trigger applications_updated_at before update on public.applications for each row execute function public.touch_updated_at();

do $$
declare v_table text;
begin
  foreach v_table in array array['documents', 'opportunities', 'applications', 'funded_projects', 'expenses', 'inbox_messages'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create index %I on public.%I(org_id)', v_table || '_org_idx', v_table);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_org(org_id))', v_table || '_read', v_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write_org(org_id))', v_table || '_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write_org(org_id)) with check (public.can_write_org(org_id))', v_table || '_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write_org(org_id))', v_table || '_delete', v_table);
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_tenant_move()', v_table || '_immutable_org', v_table);
  end loop;
end;
$$;
alter table public.activity_log enable row level security;
create policy activity_log_read on public.activity_log for select to authenticated using (public.can_access_org(org_id));

create table public.notification_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  period_key text not null,
  status text not null default 'processing' check (status in ('processing', 'sent', 'failed')),
  last_error text,
  provider_message_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, period_key)
);
create table public.webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'rejected', 'failed')),
  org_id uuid references public.organizations(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);
alter table public.notification_runs enable row level security;
alter table public.webhook_events enable row level security;
-- No client policies: idempotency records are exclusively server-managed.

create function public.claim_notification_run(p_org_id uuid, p_period_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed uuid;
begin
  insert into public.notification_runs(org_id, period_key)
  values (p_org_id, p_period_key)
  on conflict (org_id, period_key) do update
    set status = 'processing', last_error = null, started_at = now(), completed_at = null
    where notification_runs.status = 'failed'
      or (notification_runs.status = 'processing' and notification_runs.started_at < now() - interval '15 minutes')
  returning id into v_claimed;
  return v_claimed is not null;
end;
$$;
create function public.claim_webhook_event(p_event_id text, p_event_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_claimed text;
begin
  insert into public.webhook_events(event_id, event_type)
  values (p_event_id, p_event_type)
  on conflict (event_id) do update
    set status = 'processing', last_error = null, received_at = now(), processed_at = null
    where webhook_events.status = 'failed'
      or (webhook_events.status = 'processing' and webhook_events.received_at < now() - interval '15 minutes')
  returning event_id into v_claimed;
  return v_claimed is not null;
end;
$$;
revoke all on function public.claim_notification_run(uuid, text), public.claim_webhook_event(text, text) from public, anon, authenticated;
grant execute on function public.claim_notification_run(uuid, text), public.claim_webhook_event(text, text) to service_role;

grant usage on schema public to authenticated, service_role;
grant select, update, delete on public.organizations to authenticated;
grant select on public.organization_members, public.activity_log to authenticated;
grant select, insert, update, delete on public.documents, public.opportunities, public.applications, public.funded_projects, public.expenses, public.inbox_messages to authenticated;
grant all on public.organizations, public.organization_members, public.documents, public.opportunities, public.applications, public.funded_projects, public.expenses, public.inbox_messages, public.activity_log, public.notification_runs, public.webhook_events to service_role;

-- Private evidence bucket. An object key must begin with its organisation UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
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
    from storage.buckets where id = 'documents';
  if v_bucket.public is distinct from false
    or v_bucket.file_size_limit is distinct from 10485760::bigint
    or (v_bucket.allowed_mime_types @> v_expected_mimes) is not true
    or (v_bucket.allowed_mime_types <@ v_expected_mimes) is not true then
    raise exception 'Existing documents bucket is incompatible: a private 10 MiB PDF/image/plain-text bucket is required; use a dedicated Supabase project or resolve the bucket conflict before migrating'
      using errcode = '22023';
  end if;
end;
$$;

create function public.storage_org_id(p_name text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function public.storage_org_id(text) from public;
grant execute on function public.storage_org_id(text) to authenticated, service_role;

create policy documents_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_access_org(public.storage_org_id(name)));
create policy documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_write_org(public.storage_org_id(name)));
create policy documents_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.can_write_org(public.storage_org_id(name)))
  with check (bucket_id = 'documents' and public.can_write_org(public.storage_org_id(name)));
create policy documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_write_org(public.storage_org_id(name)));

commit;
