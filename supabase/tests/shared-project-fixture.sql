-- Test-only representative existing SH Sales/CFO project. Never run on hosted DB.
create extension if not exists pgcrypto with schema extensions;
create role legacy_app nologin;
grant usage on schema storage to anon, legacy_app;
grant usage on schema auth to anon, legacy_app;
grant execute on function auth.uid() to anon, legacy_app;
grant select, insert, update, delete on storage.objects to anon, legacy_app;

create table public.documents(id uuid primary key, title text not null);
insert into public.documents values ('90000000-0000-4000-8000-000000000001','Existing app evidence: must stay unchanged');
create function public.create_organization(text,text) returns text language sql as $$select 'existing app function preserved'::text$$;
create function public.touch_updated_at() returns trigger language plpgsql as $$begin return new; end$$;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, name text);
insert into supabase_migrations.schema_migrations values ('20260101000000','existing_other_app');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('finance-evidence','finance-evidence',false,20971520,null),
 ('pdfs','pdfs',true,null,null);
insert into storage.objects(bucket_id,name) values
 ('finance-evidence','legacy-invoice.pdf'), ('pdfs','legacy-public.pdf');
-- Deliberately broader than known hosted policies, to test the strongest OR leak.
create policy legacy_broad_select on storage.objects for select to public using (true);
create policy legacy_broad_insert on storage.objects for insert to public with check (true);
create policy legacy_broad_update on storage.objects for update to public using (true) with check (true);
create policy legacy_broad_delete on storage.objects for delete to public using (true);
-- A representative existing restrictive policy that fences only its own bucket.
-- Actual hosted expressions remain unverified and may legitimately block SG.
create policy finance_evidence_server_only on storage.objects as restrictive for all to public
 using (bucket_id is distinct from 'finance-evidence' or current_user = 'service_role')
 with check (bucket_id is distinct from 'finance-evidence' or current_user = 'service_role');

-- Existing global defaults must remain intact but cannot leak onto SG objects.
alter default privileges grant all on tables to anon, authenticated, legacy_app;
alter default privileges grant execute on functions to anon, authenticated, legacy_app;
alter default privileges grant all on schemas to legacy_app;
create table public.default_acl_sentinel(id integer primary key);
insert into public.default_acl_sentinel values (1);
