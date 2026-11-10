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
declare v_org public.organizations;
begin
  select * into v_org from public.create_organization('  Test charity A  ', 'weekly');
  perform set_config('test.org_a', v_org.id::text, true);
  if v_org.name <> 'Test charity A' then raise exception 'Name must be trimmed'; end if;
  if not exists (select 1 from public.organization_members where org_id = v_org.id and role = 'owner') then
    raise exception 'RPC did not create owner membership';
  end if;
  begin
    perform public.create_organization('Invalid frequency', 'daily');
    raise exception 'Invalid frequency accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare v_org public.organizations; v_opp uuid;
begin
  select * into v_org from public.create_organization('Test charity B', 'never');
  perform set_config('test.org_b', v_org.id::text, true);
  insert into public.opportunities(org_id, title) values (v_org.id, 'Private B opportunity') returning id into v_opp;
  perform set_config('test.opp_b', v_opp::text, true);
  if (select count(*) from public.organizations) <> 1 then raise exception 'Owner B sees another tenant'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare v_org uuid := current_setting('test.org_a')::uuid; v_opp uuid; v_app uuid; v_project uuid; v_doc uuid;
begin
  if exists (select 1 from public.opportunities where org_id = current_setting('test.org_b')::uuid) then
    raise exception 'Cross-tenant opportunity visible';
  end if;
  insert into public.documents(org_id,name,storage_path,mime_type,size_bytes)
    values (v_org,'Evidence.pdf',v_org::text||'/evidence.pdf','application/pdf',100) returning id into v_doc;
  insert into public.opportunities(org_id,title) values (v_org,'Own opportunity') returning id into v_opp;
  insert into public.applications(org_id,opportunity_id,title) values (v_org,v_opp,'Own application') returning id into v_app;
  insert into public.funded_projects(org_id,application_id,title,end_date)
    values (v_org,v_app,'Own funded project', current_date + 365) returning id into v_project;
  insert into public.expenses(org_id,project_id,description,amount,document_id)
    values (v_org,v_project,'Test expense',10,v_doc);
  update public.funded_projects set report_draft = '{"summary":"Human review pending"}'::jsonb where id = v_project;
  if (select report_draft->>'summary' from public.funded_projects where id = v_project) <> 'Human review pending' then
    raise exception 'Report draft did not persist';
  end if;
  begin
    update public.funded_projects set report_draft = '[]'::jsonb where id = v_project;
    raise exception 'Non-object report draft accepted';
  exception when check_violation then null;
  end;
  insert into storage.objects(bucket_id,name) values ('documents',v_org::text||'/evidence.pdf');
  begin
    insert into public.opportunities(org_id,title) values (current_setting('test.org_b')::uuid,'Forbidden');
    raise exception 'Cross-tenant insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.applications(org_id,opportunity_id,title)
      values (v_org,current_setting('test.opp_b')::uuid,'Forbidden link');
    raise exception 'Cross-tenant relationship allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.organization_members(org_id,user_id,role)
      values (current_setting('test.org_b')::uuid,auth.uid(),'owner');
    raise exception 'Client could escalate membership';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('documents',current_setting('test.org_b')||'/forbidden.pdf');
    raise exception 'Cross-tenant storage upload allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values ('documents','not-a-uuid/forbidden.pdf');
    raise exception 'Invalid storage path allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.documents(org_id,name,storage_path,mime_type,size_bytes)
      values (v_org,'Spoofed',current_setting('test.org_b')||'/spoofed.pdf','application/pdf',100);
    raise exception 'Metadata storage prefix spoof allowed';
  exception when check_violation then null;
  end;
end;
$$;

reset role;
insert into public.organization_members(org_id,user_id,role) values
 (current_setting('test.org_a')::uuid, '10000000-0000-4000-8000-000000000003', 'viewer'),
 (current_setting('test.org_b')::uuid, '10000000-0000-4000-8000-000000000001', 'member');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
begin
  begin
    update public.documents set org_id = current_setting('test.org_b')::uuid,
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
  if (select count(*) from public.documents) <> 1 then raise exception 'Viewer cannot read own evidence'; end if;
  if (select count(*) from storage.objects where bucket_id = 'documents') <> 1 then raise exception 'Viewer cannot read storage metadata'; end if;
  begin
    insert into public.opportunities(org_id,title) values (current_setting('test.org_a')::uuid,'Viewer write');
    raise exception 'Viewer can create opportunity';
  exception when insufficient_privilege then null;
  end;
  update public.organizations set name = 'Viewer edit' where id = current_setting('test.org_a')::uuid;
  if found then raise exception 'Viewer can edit organisation'; end if;
  begin
    perform public.claim_notification_run(current_setting('test.org_a')::uuid,'forbidden');
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
  if not public.claim_notification_run(v_org,'test-period') then raise exception 'First notification claim failed'; end if;
  if public.claim_notification_run(v_org,'test-period') then raise exception 'Duplicate notification claim allowed'; end if;
  update public.notification_runs set status = 'failed' where org_id = v_org and period_key = 'test-period';
  if not public.claim_notification_run(v_org,'test-period') then raise exception 'Failed notification cannot retry'; end if;
  update public.notification_runs set status = 'sent' where org_id = v_org and period_key = 'test-period';
  if public.claim_notification_run(v_org,'test-period') then raise exception 'Sent notification can resend'; end if;
  if not public.claim_webhook_event('test-delivery','email.received') then raise exception 'First webhook claim failed'; end if;
  if public.claim_webhook_event('test-delivery','email.received') then raise exception 'Duplicate webhook claim allowed'; end if;
  update public.webhook_events set status = 'processed' where event_id = 'test-delivery';
  if public.claim_webhook_event('test-delivery','email.received') then raise exception 'Processed webhook can replay'; end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$
begin
  if not public.claim_ai_request(current_setting('test.org_a')::uuid,'ask') then
    raise exception 'Viewer could not claim allowed ask action';
  end if;
  begin
    perform public.claim_ai_request(current_setting('test.org_a')::uuid,'draft');
    raise exception 'Viewer could claim write AI action';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_ai_request(current_setting('test.org_b')::uuid,'ask');
    raise exception 'Unauthorised organisation could claim AI request';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.ai_usage;
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
    if not public.claim_ai_request(v_org,'discover') then raise exception 'AI quota blocked before request 60'; end if;
  end loop;
  if public.claim_ai_request(current_setting('test.org_a')::uuid,'ask') then
    raise exception 'AI quota allowed request 61';
  end if;
  begin
    perform public.claim_ai_request(current_setting('test.org_a')::uuid,'invalid-action');
    raise exception 'Unsupported AI action was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
-- Clients cannot impersonate a sender to claim or reset another user's quota.
do $$
begin
  begin
    perform public.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000001');
    raise exception 'Authenticated client could invoke service email quota';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  if public.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000001') then
    raise exception 'Email could bypass exhausted portal quota';
  end if;
  if not public.claim_email_ai_request(current_setting('test.org_b')::uuid,'10000000-0000-4000-8000-000000000002') then
    raise exception 'Email could not claim member request';
  end if;
  begin
    perform public.claim_email_ai_request(current_setting('test.org_a')::uuid,'10000000-0000-4000-8000-000000000002');
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
    if not public.claim_ai_request(current_setting('test.org_b')::uuid,'ask') then
      raise exception 'Email and portal shared quota blocked before 60 total';
    end if;
  end loop;
  if public.claim_ai_request(current_setting('test.org_b')::uuid,'ask') then
    raise exception 'Email claim was not counted toward portal quota';
  end if;
end;
$$;
reset role;
select 'PASS: ownership, tenant isolation, relationship isolation, viewer access, storage, idempotency, and shared portal/email AI quota' as result;
rollback;
