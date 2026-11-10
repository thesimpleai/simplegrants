-- Test-only common existing-app objects. Never run on a hosted DB.
create extension if not exists pgcrypto with schema extensions;
create role legacy_app nologin;
grant usage on schema storage to anon, legacy_app;
grant usage on schema auth to anon, legacy_app;
grant execute on function auth.uid(), auth.role() to anon, legacy_app;
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
