-- Extracted source text is server-only and follows the lifetime of its source.
begin;

create table simple_grant.document_text_extracts (
  org_id uuid not null,
  document_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  extraction_version integer not null check (extraction_version > 0),
  method text not null check (method in ('local', 'ocr')),
  text text not null check (char_length(text) between 1 and 400000),
  created_at timestamptz not null default now(),
  primary key (org_id, document_id, source_sha256, extraction_version),
  foreign key (org_id, document_id)
    references simple_grant.documents(org_id, id) on delete cascade
);

alter table simple_grant.document_text_extracts enable row level security;

-- Shared Supabase projects may have global default grants to custom roles.
do $$
declare v record;
begin
  for v in select distinct a.grantee from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where c.oid = 'simple_grant.document_text_extracts'::regclass and a.grantee <> c.relowner
  loop
    execute format(
      'revoke all on table simple_grant.document_text_extracts from %s',
      case when v.grantee = 0 then 'public' else quote_ident(pg_catalog.pg_get_userbyid(v.grantee)) end
    );
  end loop;
end;
$$;
revoke all on table simple_grant.document_text_extracts from public, anon, authenticated;
grant select, insert on table simple_grant.document_text_extracts to service_role;

commit;
