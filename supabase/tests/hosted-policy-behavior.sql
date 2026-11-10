-- Exact-policy behavior regression, executed BEFORE and AFTER SG installation.
-- This checks SQL object access, not the public-bucket HTTP download endpoint.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','',true);
do $$
begin
  if auth.role() <> 'authenticated' then raise exception 'Test JWT role mismatch'; end if;
  if (select count(*) from storage.objects where bucket_id = 'pdfs') <> 1 then raise exception 'Existing authenticated PDF read changed'; end if;
  insert into storage.objects(bucket_id,name) values ('pdfs','authenticated-upload.pdf');
  if (select count(*) from storage.objects where bucket_id = 'pdfs') <> 2 then raise exception 'Existing authenticated PDF upload changed'; end if;
  update storage.objects set name = 'forbidden-pdf-update.pdf' where bucket_id = 'pdfs';
  if found then raise exception 'Simple Grant added PDF UPDATE rights'; end if;
  delete from storage.objects where bucket_id = 'pdfs';
  if found then raise exception 'Simple Grant added PDF DELETE rights'; end if;
  if exists (select 1 from storage.objects where bucket_id = 'finance-evidence') then raise exception 'Authenticated finance read became allowed'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('finance-evidence','forbidden-auth.pdf');
    raise exception 'Authenticated finance INSERT became allowed';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = 'forbidden-finance-edit.pdf' where bucket_id = 'finance-evidence';
  if found then raise exception 'Authenticated finance UPDATE became allowed'; end if;
  delete from storage.objects where bucket_id = 'finance-evidence';
  if found then raise exception 'Authenticated finance DELETE became allowed'; end if;
  -- The exact PDF policy requires BOTH the SQL role and matching JWT claim.
  perform set_config('request.jwt.claim.role','anon',true);
  if exists (select 1 from storage.objects where bucket_id = 'pdfs') then raise exception 'PDF auth.role check stopped applying'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('pdfs','forbidden-mismatched-claim.pdf');
    raise exception 'Mismatched JWT role could upload PDF';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
select set_config('request.jwt.claim.role','anon',true);
do $$
begin
  if exists (select 1 from storage.objects where bucket_id in ('pdfs','finance-evidence')) then raise exception 'Anonymous SQL metadata access became allowed'; end if;
  begin
    insert into storage.objects(bucket_id,name) values ('pdfs','forbidden-anon.pdf');
    raise exception 'Anonymous PDF INSERT became allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('finance-evidence','forbidden-anon-finance.pdf');
    raise exception 'Anonymous finance INSERT became allowed';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = 'forbidden-anon-edit.pdf' where bucket_id in ('pdfs','finance-evidence');
  if found then raise exception 'Anonymous legacy UPDATE became allowed'; end if;
  delete from storage.objects where bucket_id in ('pdfs','finance-evidence');
  if found then raise exception 'Anonymous legacy DELETE became allowed'; end if;
end;
$$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'finance-evidence') <> 1 then raise exception 'Service finance read bypass changed'; end if;
  insert into storage.objects(bucket_id,name) values ('finance-evidence','service-insert.pdf');
  update storage.objects set name = 'service-updated.pdf' where bucket_id = 'finance-evidence' and name = 'service-insert.pdf';
  if not found then raise exception 'Service finance UPDATE bypass changed'; end if;
  delete from storage.objects where bucket_id = 'finance-evidence' and name = 'service-updated.pdf';
  if not found then raise exception 'Service finance DELETE bypass changed'; end if;
end;
$$;
reset role;
do $$
begin
  if (select title from public.documents where id = '90000000-0000-4000-8000-000000000001') <> 'Existing app evidence: must stay unchanged'
    or (select count(*) from public.documents) <> 1 then raise exception 'Existing public.documents changed'; end if;
  if public.create_organization('existing','app') <> 'existing app function preserved' then raise exception 'Existing public function changed'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260101000000' and name = 'existing_other_app')
    or (select count(*) from supabase_migrations.schema_migrations) <> 1 then raise exception 'Existing migration history changed'; end if;
end;
$$;
select 'PASS: exact hosted PDF SELECT/INSERT preserved, no added UPDATE/DELETE, finance denied to anon/auth and service bypass preserved' as result;
rollback;
