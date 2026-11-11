-- Existing installations through 005: apply ONLY this idempotent upgrade.
-- Adds supported document MIME types to Simple Grant's dedicated bucket only.
-- Keeps privacy, 10 MiB limit, existing MIME extras, records and policies intact.
begin;

do $$
declare
  v_bucket record;
  v_mimes text[];
  v_additions text[] := array[
    'text/csv',
    'text/tab-separated-values',
    'text/markdown',
    'application/json',
    'text/html',
    'application/xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
begin
  select public, file_size_limit, allowed_mime_types into v_bucket
    from storage.buckets where id = 'simple-grant-documents' for update;
  if not found then
    raise exception 'Simple Grant documents bucket is missing; verify the existing installation before applying 006'
      using errcode = '22023';
  end if;
  if v_bucket.public is distinct from false then
    raise exception 'Simple Grant documents bucket must remain private; 006 does not change privacy settings'
      using errcode = '22023';
  end if;
  if v_bucket.file_size_limit is distinct from 10485760::bigint then
    raise exception 'Simple Grant documents bucket must retain its 10 MiB limit; 006 does not change size settings'
      using errcode = '22023';
  end if;
  if v_bucket.allowed_mime_types is null then
    raise exception 'Simple Grant documents bucket requires an existing finite MIME allowlist; review its configuration before applying 006'
      using errcode = '22023';
  end if;
  select array_agg(mime order by mime) into v_mimes
    from (select distinct mime from unnest(v_bucket.allowed_mime_types || v_additions) as existing_and_new(mime)) allowed;
  update storage.buckets set allowed_mime_types = v_mimes
    where id = 'simple-grant-documents' and allowed_mime_types is distinct from v_mimes;
end;
$$;

commit;
