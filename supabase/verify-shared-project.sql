-- READ-ONLY: run in SQL Editor BEFORE and AFTER installing Simple Grant.
-- One JSON row. No application/user/document records, file paths or secrets.
-- Compare unrelated_metadata_fingerprint + unrelated_object_count pre/post.
-- A match is evidence of unchanged catalog/config metadata, not full functional
-- verification, unchanged application records, or an audit of old policy logic.
with unrelated_metadata as (
  select 'default_acl'::text as category,
    pg_catalog.pg_get_userbyid(d.defaclrole) || '.' || coalesce(n.nspname,'GLOBAL') || '.' || d.defaclobjtype::text as object_name,
    jsonb_build_object('acl',d.defaclacl::text) as definition
  from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname is distinct from 'simple_grant'
  union all
  select 'schema'::text as category, n.nspname::text as object_name,
    jsonb_build_object('owner', n.nspowner, 'acl', n.nspacl::text) as definition
  from pg_catalog.pg_namespace n where n.nspname in ('public','auth','storage','supabase_migrations')
  union all
  select 'relation', n.nspname || '.' || c.relname,
    jsonb_build_object('kind', c.relkind, 'owner', c.relowner, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity, 'acl', c.relacl::text, 'options', c.reloptions)
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind in ('r','p','v','m','f','S')
  union all
  select 'column', n.nspname || '.' || c.relname || '.' || a.attname,
    jsonb_build_object('position', a.attnum, 'type', a.atttypid, 'typmod', a.atttypmod, 'notnull', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated, 'acl', a.attacl::text, 'default', pg_catalog.pg_get_expr(d.adbin,d.adrelid))
  from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public','auth','storage','supabase_migrations') and a.attnum > 0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
  union all
  select 'constraint', n.nspname || '.' || c.relname || '.' || k.conname,
    jsonb_build_object('definition', pg_catalog.pg_get_constraintdef(k.oid), 'validated', k.convalidated)
  from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations')
  union all
  select 'index', n.nspname || '.' || c.relname,
    jsonb_build_object('definition', pg_catalog.pg_get_indexdef(c.oid))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind in ('i','I')
  union all
  select 'routine', n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')',
    jsonb_build_object('source', p.prosrc, 'library', p.probin, 'kind', p.prokind, 'owner', p.proowner, 'acl', p.proacl::text, 'security_definer', p.prosecdef, 'config', p.proconfig, 'return_type', p.prorettype, 'volatility', p.provolatile)
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','auth','storage','supabase_migrations')
  union all
  select 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
    jsonb_build_object('permissive', p.polpermissive, 'command', p.polcmd, 'roles', p.polroles, 'using', pg_catalog.pg_get_expr(p.polqual,p.polrelid), 'check', pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations')
    and not (n.nspname = 'storage' and c.relname = 'objects' and p.polname ~ '^simple_grant_documents_')
  union all
  select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
    jsonb_build_object('definition', pg_catalog.pg_get_triggerdef(t.oid), 'enabled', t.tgenabled)
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','auth','storage','supabase_migrations') and not t.tgisinternal
  union all
  select 'bucket', b.id,
    jsonb_build_object('id', b.id, 'name', b.name, 'public', b.public, 'file_size_limit', b.file_size_limit, 'allowed_mime_types', b.allowed_mime_types)
  from storage.buckets b where b.id <> 'simple-grant-documents'
), fingerprint as (
  select md5(coalesce(string_agg(jsonb_build_object('category',category,'name',object_name,'definition',definition)::text, E'\n' order by category,object_name),'')) as digest,
    count(*) as object_count from unrelated_metadata
)
select jsonb_build_object(
  'unrelated_metadata_fingerprint', f.digest,
  'unrelated_object_count', f.object_count,
  'simple_grant_schema_exists', exists(select 1 from pg_catalog.pg_namespace where nspname = 'simple_grant'),
  'simple_grant_schema_acl', (select nspacl::text from pg_catalog.pg_namespace where nspname = 'simple_grant'),
  'simple_grant_tables', coalesce((select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'acl',c.relacl::text) order by c.relname)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'simple_grant' and c.relkind in ('r','p')), '[]'::jsonb),
  'simple_grant_functions', coalesce((select jsonb_agg(jsonb_build_object('name',p.proname,'argument_types',pg_catalog.oidvectortypes(p.proargtypes),'security_definer',p.prosecdef,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'config',p.proconfig) order by p.proname)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'simple_grant'), '[]'::jsonb),
  'simple_grant_bucket', (select jsonb_build_object('id',b.id,'public',b.public,'file_size_limit',b.file_size_limit,'allowed_mime_types',b.allowed_mime_types) from storage.buckets b where b.id = 'simple-grant-documents'),
  'storage_policies', coalesce((select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,'roles',p.polroles,'definition_hash',md5(coalesce(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'') || E'\n' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),''))) order by p.polname)
    from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid = p.polrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'objects'), '[]'::jsonb)
) as simple_grant_verification
from fingerprint f;
