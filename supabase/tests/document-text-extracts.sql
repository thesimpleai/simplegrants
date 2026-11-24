begin;

do $$
declare role_name text;
begin
  for role_name in select unnest(array['anon', 'authenticated', 'legacy_app'])
  loop
    if has_table_privilege(role_name, 'simple_grant.document_text_extracts',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    then
      raise exception 'Client or unrelated app role has access to document text: %', role_name;
    end if;
  end loop;
end;
$$;

insert into simple_grant.organizations(id, name) values
  ('88000000-0000-4000-8000-000000000001', 'Transcript test organisation'),
  ('88000000-0000-4000-8000-000000000002', 'Other test organisation');
insert into simple_grant.documents(id, org_id, name, storage_path, mime_type, size_bytes)
values (
  '88000000-0000-4000-8000-000000000003',
  '88000000-0000-4000-8000-000000000001',
  'test.txt',
  '88000000-0000-4000-8000-000000000001/test.txt',
  'text/plain', 20
);

set local role service_role;
insert into simple_grant.document_text_extracts
  (org_id, document_id, source_sha256, extraction_version, method, text)
values (
  '88000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000003',
  repeat('a', 64), 1, 'local', 'Source transcript'
);

do $$
begin
  if (select text from simple_grant.document_text_extracts
      where document_id = '88000000-0000-4000-8000-000000000003')
      is distinct from 'Source transcript'
  then
    raise exception 'Server cannot read the transcript it stored';
  end if;
  begin
    insert into simple_grant.document_text_extracts
      (org_id, document_id, source_sha256, extraction_version, method, text)
    values (
      '88000000-0000-4000-8000-000000000002',
      '88000000-0000-4000-8000-000000000003',
      repeat('a', 64), 1, 'local', 'Cross-organisation copy'
    );
    raise exception 'Transcript accepted for the wrong organisation';
  exception when foreign_key_violation then null;
  end;
end;
$$;
reset role;

delete from simple_grant.documents where id = '88000000-0000-4000-8000-000000000003';
do $$
begin
  if exists (select 1 from simple_grant.document_text_extracts
             where document_id = '88000000-0000-4000-8000-000000000003')
  then
    raise exception 'Transcript survived source deletion';
  end if;
end;
$$;

rollback;
select 'PASS: Document transcripts are server-only, tenant-bound, and deleted with their source.' as result;
