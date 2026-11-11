-- Test-only MIME configuration and tenant-write regression; no file bytes/API.
begin;
do $$
declare v_bucket record;
begin
  select * into v_bucket from storage.buckets where id = 'simple-grant-documents';
  if v_bucket.public is distinct from false or v_bucket.file_size_limit is distinct from 10485760::bigint then raise exception 'Document format upgrade weakened bucket settings'; end if;
  if not (v_bucket.allowed_mime_types @> array[
    'application/pdf','image/jpeg','image/png','image/webp','text/plain',
    'text/csv','text/tab-separated-values','text/markdown','application/json','text/html','application/xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]) then raise exception 'Required document MIME type missing from bucket allowlist'; end if;
end;
$$;
insert into auth.users(id,email) values ('60000000-0000-4000-8000-000000000001','format-test@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000001',true);
do $$
declare v_org simple_grant.organizations; v_format record; v_path text;
begin
  select * into v_org from simple_grant.create_organization('Document formats test','never');
  for v_format in select * from (values
    ('text/csv','csv'),('text/tab-separated-values','tsv'),('text/markdown','md'),
    ('application/json','json'),('text/html','html'),('application/xml','xml'),
    ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'),
    ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx')
  ) formats(mime,extension) loop
    v_path := v_org.id::text || '/synthetic-format-test.' || v_format.extension;
    insert into storage.objects(bucket_id,name) values ('simple-grant-documents',v_path);
    insert into simple_grant.documents(org_id,name,storage_path,mime_type,size_bytes)
      values (v_org.id,'synthetic-format-test.'||v_format.extension,v_path,v_format.mime,100);
  end loop;
  if (select count(*) from simple_grant.documents where org_id = v_org.id) <> 8 then raise exception 'Tenant metadata write failed for new document formats'; end if;
end;
$$;
reset role;
select 'PASS: thirteen configured MIME types, private10MiB bucket and tenant writes for eight new formats (not hosted Storage API)' as result;
rollback;
