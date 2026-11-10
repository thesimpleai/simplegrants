-- READ ONLY: Simple Grants login database prerequisite diagnosis.
-- Run the complete SELECT in the intended Supabase project's SQL Editor.
-- Safe when schema/table/functions are absent. Does not execute an application
-- RPC, claim a login attempt, look up an email, or read application/user records.
-- Returns no keys, email/IP values, token data, function source or secret config.
-- A ready result covers database prerequisites, not Netlify configuration,
-- Resend delivery, actual REST exposure, or a completed sign-in flow.
with roles as (
  select
    (select oid from pg_catalog.pg_roles where rolname = 'service_role') as service_oid,
    (select oid from pg_catalog.pg_roles where rolname = 'anon') as anon_oid,
    (select oid from pg_catalog.pg_roles where rolname = 'authenticated') as authenticated_oid
), target_schema as (
  select (select oid from pg_catalog.pg_namespace where nspname = 'simple_grant') as oid
), schema_state as (
  select s.oid,
    case when s.oid is not null and r.service_oid is not null then pg_catalog.has_schema_privilege(r.service_oid,s.oid,'USAGE') end as service_usage
  from target_schema s cross join roles r
), table_state as (
  select c.oid, c.relkind, c.relrowsecurity as rls_enabled,
    case when c.relkind in ('r','p') and r.service_oid is not null then
      pg_catalog.has_table_privilege(r.service_oid,c.oid,'SELECT')
      and pg_catalog.has_table_privilege(r.service_oid,c.oid,'INSERT')
      and pg_catalog.has_table_privilege(r.service_oid,c.oid,'UPDATE')
      and pg_catalog.has_table_privilege(r.service_oid,c.oid,'DELETE') end as service_crud,
    case when c.relkind in ('r','p') and r.anon_oid is not null then
      pg_catalog.has_table_privilege(r.anon_oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end as anon_table_access,
    case when c.relkind in ('r','p') and r.authenticated_oid is not null then
      pg_catalog.has_table_privilege(r.authenticated_oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') end as authenticated_table_access,
    case when c.oid is not null then (
      select count(*) = 4 from pg_catalog.pg_attribute a
      join (values ('id',2950::oid),('email_hash',25::oid),('ip_hash',25::oid),('claimed_at',1184::oid)) expected(column_name,type_oid)
        on a.attname = expected.column_name and a.atttypid = expected.type_oid
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attnotnull
    ) end as expected_columns_present
  from target_schema s cross join roles r
  left join pg_catalog.pg_class c on c.relnamespace = s.oid and c.relname = 'auth_email_requests'
), expected_functions(name,arg_types,return_oid,volatility) as (
  values ('claim_auth_email','25 25'::oidvector,2950::oid,'v'::"char"),
    ('auth_email_user_exists','25'::oidvector,16::oid,'s'::"char")
), function_states as (
  select e.name, p.oid, p.prosecdef as security_definer,
    case when p.oid is not null then p.prorettype = e.return_oid and p.provolatile = e.volatility end as expected_shape,
    case when p.oid is not null then exists (
      select 1 from unnest(p.proconfig) setting where setting in ('search_path=','search_path=""')
    ) end as empty_search_path,
    case when p.oid is not null and r.service_oid is not null then pg_catalog.has_function_privilege(r.service_oid,p.oid,'EXECUTE') end as service_execute,
    case when p.oid is not null and r.anon_oid is not null then pg_catalog.has_function_privilege(r.anon_oid,p.oid,'EXECUTE') end as anon_execute,
    case when p.oid is not null and r.authenticated_oid is not null then pg_catalog.has_function_privilege(r.authenticated_oid,p.oid,'EXECUTE') end as authenticated_execute
  from expected_functions e cross join target_schema s cross join roles r
  left join pg_catalog.pg_proc p on p.pronamespace = s.oid and p.proname = e.name
    and p.proargtypes = e.arg_types and p.prokind = 'f'
), checks as (
  select 1 as sort_order, 'schema.simple_grant'::text as check_name,
    case when s.oid is null then 'absent'
      when s.service_usage is not true then 'wrong_permission' else 'ready' end as status,
    jsonb_build_object('exists',s.oid is not null,'service_role_usage',s.service_usage) as details
  from schema_state s
  union all
  select 2, 'table.simple_grant.auth_email_requests',
    case when t.oid is null then 'absent'
      when t.relkind not in ('r','p') or t.rls_enabled is not true or t.expected_columns_present is not true then 'wrong_configuration'
      when t.service_crud is not true or t.anon_table_access is distinct from false or t.authenticated_table_access is distinct from false then 'wrong_permission'
      else 'ready' end,
    jsonb_build_object('exists',t.oid is not null,'rls_enabled',t.rls_enabled,'expected_columns_present',t.expected_columns_present,
      'service_role_crud',t.service_crud,'anon_table_access',t.anon_table_access,'authenticated_table_access',t.authenticated_table_access)
  from table_state t
  union all
  select case f.name when 'claim_auth_email' then 3 else 4 end,
    'function.simple_grant.' || f.name || case f.name when 'claim_auth_email' then '(text,text)' else '(text)' end,
    case when f.oid is null then 'absent'
      when f.security_definer is not true or f.expected_shape is not true or f.empty_search_path is not true then 'wrong_configuration'
      when f.service_execute is not true or f.anon_execute is distinct from false or f.authenticated_execute is distinct from false then 'wrong_permission'
      else 'ready' end,
    jsonb_build_object('exists',f.oid is not null,'security_definer',f.security_definer,'expected_shape',f.expected_shape,'empty_search_path',f.empty_search_path,
      'service_role_execute',f.service_execute,'anon_execute',f.anon_execute,'authenticated_execute',f.authenticated_execute)
  from function_states f
), exposure as (
  select nullif(btrim(pg_catalog.current_setting('pgrst.db_schemas',true)),'') as visible_setting
), exposure_state as (
  select case when e.visible_setting is null then null else exists (
    select 1 from regexp_split_to_table(e.visible_setting,',') entry where btrim(entry,E' \t\n\r"') = 'simple_grant'
  ) end as schema_listed from exposure e
)
select jsonb_build_object(
  'read_only',true,
  'scope','Database prerequisites only; no application RPCs or record reads; not a live email-delivery or REST-exposure test',
  'roles_present',jsonb_build_object('service_role',r.service_oid is not null,'anon',r.anon_oid is not null,'authenticated',r.authenticated_oid is not null),
  'database_prerequisites',case when exists(select 1 from checks where status = 'absent') then 'objects_missing'
    when exists(select 1 from checks where status = 'wrong_configuration') then 'wrong_configuration'
    when exists(select 1 from checks where status = 'wrong_permission') then 'wrong_permission' else 'ready' end,
  'checks',(select jsonb_agg(jsonb_build_object('check',check_name,'status',status,'details',details) order by sort_order) from checks),
  'api_schema_setting',jsonb_build_object('status',case when e.schema_listed is null then 'unknown' when e.schema_listed then 'listed_in_visible_setting' else 'not_listed_in_visible_setting' end,
    'simple_grant_listed',e.schema_listed,
    'note','SQL-session pgrst.db_schemas may be unset or differ from managed API configuration; unknown does not mean unexposed. Confirm Exposed schemas in project settings or use a safe REST helper check.')
) as simple_grants_login_diagnostic
from roles r cross join exposure_state e;
