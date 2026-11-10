-- Run as a database administrator against a disposable Supabase database after
-- migrations. All test data is rolled back. Any failed assertion aborts the run.
begin;

insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001', 'owner-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002', 'owner-b@example.invalid'),
 ('10000000-0000-4000-8000-000000000003', 'viewer@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare v_org simple_grant.organizations;
begin
  select * into v_org from simple_grant.create_organization('  Test charity A  ', 'weekly');
  perform set_config('test.org_a', v_org.id::text, true);
  if v_org.name <> 'Test charity A' then raise exception 'Name must be trimmed'; end if;
  if not exists (select 1 from simple_grant.organization_members where org_id = v_org.id and role = 'owner') then
    raise exception 'RPC did not create owner membership';
  end if;
  begin
    perform simple_grant.create_organization('Invalid frequency', 'daily');
    raise exception 'Invalid frequency accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare v_org simple_grant.organizations; v_opp uuid;
begin
  select * into v_org from simple_grant.create_organization('Test charity B', 'never');
  perform set_config('test.org_b', v_org.id::text, true);
  insert into simple_grant.opportunities(org_id, title) values (v_org.id, 'Private B opportunity') returning id into v_opp;
  perform set_config('test.opp_b', v_opp::text, true);
  insert into storage.objects(bucket_id,name) values ('simple-grant-documents',v_org.id::text||'/private-b.pdf');
  if (select count(*) from simple_grant.organizations) <> 1 then raise exception 'Owner B sees another tenant'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare v_org uuid := current_setting('test.org_a')::uuid; v_opp uuid; v_app uuid; v_project uuid; v_doc uuid;
begin
  if exists (select 1 from simple_grant.opportunities where org_id = current_setting('test.org_b')::uuid) then
    raise exception 'Cross-tenant opportunity visible';
  end if;
  insert into simple_grant.documents(org_id,name,storage_path,mime_type,size_bytes)
    values (v_org,'Evidence.pdf',v_org::text||'/evidence.pdf','application/pdf',100) returning id into v_doc;
  insert into simple_grant.opportunities(org_id,title) values (v_org,'Own opportunity') returning id into v_opp;
  insert into simple_grant.applications(org_id,opportunity_id,title) values (v_org,v_opp,'Own application') returning id into v_app;
  insert into simple_grant.funded_projects(org_id,application_id,title,end_date)
    values (v_org,v_app,'Own funded project', current_date + 365) returning id into v_project;
  insert into simple_grant.expenses(org_id,project_id,description,amount,document_id)
    values (v_org,v_project,'Test expense',10,v_doc);
  update simple_grant.funded_projects set report_draft = '{"summary":"Human review pending"}'::jsonb where id = v_project;
  if (select report_draft->>'summary' from simple_grant.funded_projects where id = v_project) <> 'Human review pending' then
    raise exception 'Report draft did not persist';
  end if;
  begin
    update simple_grant.funded_projects set report_draft = '[]'::jsonb where id = v_project;
    raise exception 'Non-object report draft accepted';
  exception when check_violation then null;
  end;
  insert into storage.objects(bucket_id,name) values ('simple-grant-documents',v_org::text||'/evidence.pdf');
  begin
    insert into simple_grant.opportunities(org_id,title) values (current_setting('test.org_b')::uuid,'Forbidden');
    raise exception 'Cross-tenant insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into simple_grant.applications(org_id,opportunity_id,title)
      values (v_org,current_setting('test.opp_b')::uuid,'Forbidden link');
    raise exception 'Cross-tenant relationship allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into simple_grant.organization_members(org_id,user_id,role)
      values (current_setting('test.org_b')::uuid,auth.uid(),'owner');
    raise exception 'Client could escalate membership';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('simple-grant-documents',current_setting('test.org_b')||'/forbidden.pdf');
    raise exception 'Cross-tenant storage upload allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('simple-grant-documents','not-a-uuid/forbidden.pdf');
    raise exception 'Invalid storage path allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into simple_grant.documents(org_id,name,storage_path,mime_type,size_bytes)
      values (v_org,'Spoofed',current_setting('test.org_b')||'/spoofed.pdf','application/pdf',100);
    raise exception 'Metadata storage prefix spoof allowed';
  exception when check_violation then null;
  end;
end;
$$;

reset role;
insert into simple_grant.organization_members(org_id,user_id,role) values
 (current_setting('test.org_a')::uuid, '10000000-0000-4000-8000-000000000003', 'viewer'),
 (current_setting('test.org_b')::uuid, '10000000-0000-4000-8000-000000000001', 'member');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    update simple_grant.documents set org_id = current_setting('test.org_b')::uuid,
      storage_path = current_setting('test.org_b')||'/moved.pdf'
      where org_id = current_setting('test.org_a')::uuid;
    raise exception 'Record moved between tenants';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$
begin
  if (select count(*) from simple_grant.documents) <> 1 then raise exception 'Viewer cannot read own evidence'; end if;
  if (select count(*) from storage.objects where bucket_id = 'simple-grant-documents') <> 1 then raise exception 'Viewer cannot read storage metadata'; end if;
  begin
    insert into simple_grant.opportunities(org_id,title) values (current_setting('test.org_a')::uuid,'Viewer write');
    raise exception 'Viewer can create opportunity';
  exception when insufficient_privilege then null;
  end;
  update simple_grant.organizations set name = 'Viewer edit' where id = current_setting('test.org_a')::uuid;
  if found then raise exception 'Viewer can edit organisation'; end if;
  begin
    perform simple_grant.claim_notification_run(current_setting('test.org_a')::uuid,'forbidden');
    raise exception 'Viewer can claim server job';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role service_role;
do $$
declare v_org uuid := current_setting('test.org_a')::uuid;
begin
  if not simple_grant.claim_notification_run(v_org,'test-period') then raise exception 'First notification claim failed'; end if;
  if simple_grant.claim_notification_run(v_org,'test-period') then raise exception 'Duplicate notification claim allowed'; end if;
  update simple_grant.notification_runs set status = 'failed' where org_id = v_org and period_key = 'test-period';
  if not simple_grant.claim_notification_run(v_org,'test-period') then raise exception 'Failed notification cannot retry'; end if;
  update simple_grant.notification_runs set status = 'sent' where org_id = v_org and period_key = 'test-period';
  if simple_grant.claim_notification_run(v_org,'test-period') then raise exception 'Sent notification can resend'; end if;
  if not simple_grant.claim_webhook_event('test-delivery','email.received') then raise exception 'First webhook claim failed'; end if;
  if simple_grant.claim_webhook_event('test-delivery','email.received') then raise exception 'Duplicate webhook claim allowed'; end if;
  update simple_grant.webhook_events set status = 'processed' where event_id = 'test-delivery';
  if simple_grant.claim_webhook_event('test-delivery','email.received') then raise exception 'Processed webhook can replay'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$
begin
  if not simple_grant.claim_ai_request(current_setting('test.org_a')::uuid,'ask') then
    raise exception 'Viewer could not claim allowed ask action';
  end if;
  begin
    perform simple_grant.claim_ai_request(current_setting('test.org_a')::uuid,'draft');
    raise exception 'Viewer could claim write AI action';
  exception when insufficient_privilege then null;
  end;
  begin
    perform simple_grant.claim_ai_request(current_setting('test.org_b')::uuid,'ask');
    raise exception 'Unauthorised organisation could claim AI request';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from simple_grant.ai_usage;
    raise exception 'Client could reset AI request counter';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare i integer; v_org uuid;
begin
  for i in 1..60 loop
    -- Owner A is also a member of B. Alternating organisations must still share
    -- the same user quota rather than allowing a fresh budget per tenant.
    v_org := case when i % 2 = 0 then current_setting('test.org_a')::uuid else current_setting('test.org_b')::uuid end;
    if not simple_grant.claim_ai_request(v_org,'discover') then raise exception 'AI quota blocked before request 60'; end if;
  end loop;
  if simple_grant.claim_ai_request(current_setting('test.org_a')::uuid,'ask') then
    raise exception 'AI quota allowed request 61';
  end if;
  begin
    perform simple_grant.claim_ai_request(current_setting('test.org_a')::uuid,'invalid-action');
    raise exception 'Unsupported AI action was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
-- Clients cannot impersonate a sender to claim or reset another user's quota.
do $$
begin
  begin
    perform simple_grant.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000001');
    raise exception 'Authenticated client could invoke service email quota';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  if simple_grant.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000001') then
    raise exception 'Email could bypass exhausted portal quota';
  end if;
  if not simple_grant.claim_email_ai_request(current_setting('test.org_b')::uuid,'10000000-0000-4000-8000-000000000002') then
    raise exception 'Email could not claim member request';
  end if;
  begin
    perform simple_grant.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000002');
    raise exception 'Non-member sender could claim request';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare i integer;
begin
  for i in 1..59 loop
    if not simple_grant.claim_ai_request(current_setting('test.org_b')::uuid,'ask') then
      raise exception 'Email and portal shared quota blocked before 60 total';
    end if;
  end loop;
  if simple_grant.claim_ai_request(current_setting('test.org_b')::uuid,'ask') then
    raise exception 'Email claim was not counted toward portal quota';
  end if;
end;
$$;
-- Legacy permissive TO PUBLIC policies must never expose SG objects.
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
begin
  if simple_grant.can_access_org(current_setting('test.org_a')::uuid)
    or simple_grant.can_write_org(current_setting('test.org_a')::uuid) then
    raise exception 'Anonymous helper claimed organisation membership';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'simple-grant-documents') then
    raise exception 'Legacy permissive policy exposed SG to anonymous user';
  end if;
  begin
    insert into storage.objects(bucket_id,name) values ('simple-grant-documents',current_setting('test.org_a')||'/anon.pdf');
    raise exception 'Legacy permissive policy allowed anonymous SG upload';
  exception when insufficient_privilege then null;
  end;
  begin
    update storage.objects set bucket_id = 'simple-grant-documents',name = current_setting('test.org_a')||'/moved.pdf'
      where bucket_id = 'pdfs' and name = 'legacy-public.pdf';
    raise exception 'Legacy permissive policy allowed moving public file into SG';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = 'forbidden-update.pdf' where bucket_id = 'simple-grant-documents';
  if found then raise exception 'Anonymous could update SG objects'; end if;
  delete from storage.objects where bucket_id = 'simple-grant-documents';
  if found then raise exception 'Anonymous could delete SG objects'; end if;
  begin
    perform simple_grant.create_organization('Anonymous bypass','never');
    raise exception 'Anonymous could create an organisation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform simple_grant.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000001');
    raise exception 'Anonymous could invoke service AI quota';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from simple_grant.organizations;
    raise exception 'Anonymous has direct SG table rights';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role legacy_app;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'simple-grant-documents' and name like current_setting('test.org_a')||'/%') then
    raise exception 'Custom role could read another SG organisation via legacy policy';
  end if;
  begin
    insert into storage.objects(bucket_id,name) values ('simple-grant-documents',current_setting('test.org_a')||'/custom-role.pdf');
    raise exception 'Custom role could upload to another SG organisation';
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = current_setting('test.org_a')||'/custom-edit.pdf'
    where bucket_id = 'simple-grant-documents' and name like current_setting('test.org_a')||'/%';
  if found then raise exception 'Custom role could update another SG organisation'; end if;
  delete from storage.objects where bucket_id = 'simple-grant-documents' and name like current_setting('test.org_a')||'/%';
  if found then raise exception 'Custom role could delete another SG organisation'; end if;
end;
$$;
reset role;
do $$
declare v record;
begin
  if has_schema_privilege('legacy_app','simple_grant','CREATE') then raise exception 'Inherited custom schema CREATE survived'; end if;
  for v in select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'simple_grant' and c.relkind = 'r' loop
    if has_table_privilege('legacy_app',v.oid,'SELECT') or has_table_privilege('anon',v.oid,'SELECT') then
      raise exception 'Inherited custom/anonymous table ACL survived';
    end if;
  end loop;
  if has_function_privilege('legacy_app','simple_grant.claim_notification_run(uuid,text)','EXECUTE')
    or has_function_privilege('legacy_app','simple_grant.claim_webhook_event(text,text)','EXECUTE')
    or has_function_privilege('legacy_app','simple_grant.claim_ai_request(uuid,text)','EXECUTE')
    or has_function_privilege('legacy_app','simple_grant.claim_email_ai_request(uuid,uuid)','EXECUTE')
    or has_function_privilege('legacy_app','simple_grant.create_organization(text,text)','EXECUTE') then
    raise exception 'Inherited custom EXECUTE survived on privileged SG function';
  end if;
end;
$$;
select 'PASS: custom-schema ownership/RLS, all-role storage boundaries, inherited-ACL cleanup, legacy isolation, idempotency, and shared portal/email AI quota' as result;
rollback;
