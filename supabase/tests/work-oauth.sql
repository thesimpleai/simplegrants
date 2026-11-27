begin;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'legacy_app'] loop
    if has_table_privilege(role_name, 'simple_grant.work_oauth_grants', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_function_privilege(role_name, 'simple_grant.begin_work_oauth(text,text,text,text,text,text,text)', 'EXECUTE') then
      raise exception 'Unexpected OAuth permission for %', role_name;
    end if;
  end loop;
end;
$$;

insert into auth.users(id) values ('88000000-0000-4000-8000-000000000040');
insert into simple_grant.organizations(id,name) values ('88000000-0000-4000-8000-000000000041','OAuth fixture');
insert into simple_grant.organization_members(org_id,user_id,role)
values ('88000000-0000-4000-8000-000000000041','88000000-0000-4000-8000-000000000040','viewer');

set local role service_role;
do $$
declare
  g uuid := simple_grant.begin_work_oauth('client','https://chatgpt.com/callback','https://grants.example/api/mcp','opaque-state','challenge','browser','source');
  consumed uuid;
begin
  update simple_grant.work_oauth_grants set phase='code', browser_hash=null,source_hash=null,
    org_id='88000000-0000-4000-8000-000000000041',user_id='88000000-0000-4000-8000-000000000040',code_hash='code-digest'
    where id=g and phase='pending' and browser_hash='browser' returning id into strict consumed;
  update simple_grant.work_oauth_grants set phase='active',code_hash=null,code_challenge=null,oauth_state=null,
    access_hash='access-digest',refresh_hash='refresh-digest',access_expires_at=now()+interval '1 hour',expires_at=now()+interval '30 days'
    where id=g and phase='code' and code_hash='code-digest' and code_challenge='challenge' returning id into strict consumed;
  if exists(select 1 from simple_grant.work_oauth_grants where id=g and (phase='code' or code_hash is not null)) then
    raise exception 'Authorization code still available after exchange';
  end if;
  delete from simple_grant.organization_members where org_id='88000000-0000-4000-8000-000000000041' and user_id='88000000-0000-4000-8000-000000000040';
  if exists(select 1 from simple_grant.work_oauth_grants where id=g) then
    raise exception 'Removed member retained their grant';
  end if;
end;
$$;

do $$
begin
  for attempt in 1..60 loop
    if simple_grant.begin_work_oauth('client','https://chatgpt.com/callback','https://grants.example/api/mcp',null,'challenge','browser','quota-source') is null then
      raise exception 'Pending request quota denied attempt %', attempt;
    end if;
  end loop;
  if simple_grant.begin_work_oauth('client','https://chatgpt.com/callback','https://grants.example/api/mcp',null,'challenge','browser','quota-source') is not null then
    raise exception 'Pending request quota was not enforced';
  end if;
  if simple_grant.begin_work_oauth('client','https://chatgpt.com/callback','https://grants.example/api/mcp',null,'challenge','browser','other-source') is null then
    raise exception 'A different source inherited the pending request quota';
  end if;
end;
$$;
rollback;
select 'PASS: Work grants are service-only, membership-bound and rate-limited.' as result;
