-- Future organisations start with an unknown type until evidence/user approval.
-- Preserve EVERY existing organisation value: a saved Charity may be legitimate.
-- The creation RPC omits type and therefore inherits this column default.
begin;

do $$
declare
  v_column record;
begin
  select a.atttypid, a.attnotnull, pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
    into v_column
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'simple_grant' and c.relname = 'organizations'
      and c.relkind in ('r','p') and a.attname = 'type' and not a.attisdropped;
  if not found or v_column.atttypid is distinct from 25::oid or v_column.attnotnull is not true then
    raise exception 'Expected Simple Grant organizations.type text NOT NULL column is missing or incompatible; no existing data was changed'
      using errcode = '22023';
  end if;
  if v_column.default_expression is distinct from $empty_default$''::text$empty_default$ then
    alter table simple_grant.organizations alter column type set default '';
  end if;
end;
$$;

commit;
